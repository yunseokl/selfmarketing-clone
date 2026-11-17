// WebGL2 로 그리는 부분만 모았습니다. 무엇을 어디에 그릴지(장면)는 engine.js 가 정하고, 여기서는 받은 배열을 화면에 올립니다.
// 그리는 순서: 피질 점(장식 껍질) → 선(장식 섬유 + 데이터 연결) → 뉴런(데이터 점).

import { CORTEX_VS, CORTEX_FS, RIBBON_VS, RIBBON_FS, NODE_VS, NODE_FS } from './shaders';
import { CORE } from './brain';
import { IVORY, SHELL, STAGE, SPARK } from './palette';

// 선 하나를 몇 토막으로 나눠 그릴지
const SEGMENTS = 28;
// 선 하나의 고정 값: 시작 3 + 굽힘점 3 + 끝 3 + 색 3 + 색 3 + 모양 4
export const LINK_FIXED = 19;
// 선 하나의 바뀌는 값: 상태 4(마지막 칸은 팽팽함) + 신호 4 + 신호 4
export const LINK_LIVE = 12;
// 끌어당기는 동안에만 바뀌는 값: 시작 점 변위 3 + 끝 점 변위 3 + 줄의 휨 3
export const LINK_MOVE = 9;
// 뉴런 하나: 자리 3 + 모양 4 + 색 3 + 선명한 색 3 + 상태 4 + 표시 4
export const NODE_SIZE = 21;

const COMMON_UNIFORMS = ['uRot', 'uTarget', 'uView', 'uCenter', 'uScale', 'uDist', 'uDpr', 'uTime'];

function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(`셰이더 컴파일 실패: ${log}`);
    }
    return shader;
}

function link(gl, vertex, fragment, names) {
    const program = gl.createProgram();
    const vs = compile(gl, gl.VERTEX_SHADER, vertex);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fragment);
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const log = gl.getProgramInfoLog(program);
        gl.deleteProgram(program);
        throw new Error(`셰이더 연결 실패: ${log}`);
    }
    const uniforms = {};
    for (const name of [...COMMON_UNIFORMS, ...names]) uniforms[name] = gl.getUniformLocation(program, name);
    return { program, uniforms };
}

// 여러 속성이 한 줄로 이어 담긴 버퍼를 속성 자리에 잇습니다. layout: [[자리, 개수], …]
function bind(gl, buffer, stride, layout, perInstance) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    let offset = 0;
    for (const [location, size] of layout) {
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride * 4, offset * 4);
        gl.vertexAttribDivisor(location, perInstance ? 1 : 0);
        offset += size;
    }
}

// React 개발 모드는 화면을 띄운 직후 한 번 뗐다가 다시 붙입니다. 그때 같은 캔버스의 그리기 맥락을 버리지 않도록,
// 떼어낼 때는 버리기를 잠깐 미루고 곧바로 다시 붙으면 취소합니다.
const PENDING_LOSS = new WeakMap();

export function createRenderer(canvas) {
    clearTimeout(PENDING_LOSS.get(canvas));
    PENDING_LOSS.delete(canvas);
    const gl = canvas.getContext('webgl2', { alpha: true, antialias: false, premultipliedAlpha: true, powerPreference: 'high-performance' });
    if (!gl) return null;

    const state = { brain: null, fixed: null, linkCount: 0, lost: false };
    let res = null;

    const build = () => {
        const cortex = link(gl, CORTEX_VS, CORTEX_FS, ['uCore', 'uAppear', 'uShell', 'uPoint', 'uTone', 'uGlow', 'uTint', 'uScan', 'uCalm', 'uPullAt', 'uPullBy']);
        const ribbon = link(gl, RIBBON_VS, RIBBON_FS, ['uSpark']);
        const node = link(gl, NODE_VS, NODE_FS, ['uIvory', 'uBack']);

        const cortexVao = gl.createVertexArray();
        const cortexBuffer = gl.createBuffer();

        const strip = new Float32Array((SEGMENTS + 1) * 4);
        for (let i = 0; i <= SEGMENTS; i += 1) strip.set([i / SEGMENTS, -1, i / SEGMENTS, 1], i * 4);
        const ribbonVao = gl.createVertexArray();
        const stripBuffer = gl.createBuffer();
        const fixedBuffer = gl.createBuffer();
        const liveBuffer = gl.createBuffer();
        const moveBuffer = gl.createBuffer();
        gl.bindVertexArray(ribbonVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, stripBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, strip, gl.STATIC_DRAW);
        bind(gl, stripBuffer, 2, [[0, 2]], false);
        bind(gl, fixedBuffer, LINK_FIXED, [[1, 3], [2, 3], [3, 3], [4, 3], [5, 3], [6, 4]], true);
        bind(gl, liveBuffer, LINK_LIVE, [[7, 4], [8, 4], [9, 4]], true);
        bind(gl, moveBuffer, LINK_MOVE, [[10, 3], [11, 3], [12, 3]], true);

        const nodeVao = gl.createVertexArray();
        const quadBuffer = gl.createBuffer();
        const nodeBuffer = gl.createBuffer();
        gl.bindVertexArray(nodeVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        bind(gl, quadBuffer, 2, [[0, 2]], false);
        bind(gl, nodeBuffer, NODE_SIZE, [[1, 3], [2, 4], [3, 3], [4, 3], [5, 4], [6, 4]], true);
        gl.bindVertexArray(null);

        gl.disable(gl.DEPTH_TEST);
        gl.enable(gl.BLEND);
        // 색에 진하기를 미리 곱해 둔 값으로 그립니다. alpha 를 0 으로 내면 빛을 더하는(가산) 효과가 됩니다.
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.clearColor(0, 0, 0, 0);

        res = { cortex, ribbon, node, cortexVao, cortexBuffer, ribbonVao, stripBuffer, fixedBuffer, liveBuffer, moveBuffer, nodeVao, quadBuffer, nodeBuffer, liveSize: 0, nodeSize: 0 };
        if (state.brain) uploadBrain();
        if (state.fixed) uploadLinks();
    };

    const uploadBrain = () => {
        const { data, stride } = state.brain;
        gl.bindVertexArray(res.cortexVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, res.cortexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        bind(gl, res.cortexBuffer, stride, [[0, 3], [1, 3], [2, 4]], false);
        gl.bindVertexArray(null);
    };

    const uploadLinks = () => {
        gl.bindBuffer(gl.ARRAY_BUFFER, res.fixedBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, state.fixed, gl.STATIC_DRAW);
        res.liveSize = 0;
        // 끌어당기기 값은 평소 모두 0 입니다. 끄는 동안에만 다시 올립니다.
        gl.bindBuffer(gl.ARRAY_BUFFER, res.moveBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(state.linkCount * LINK_MOVE), gl.DYNAMIC_DRAW);
    };

    const common = (uniforms, frame) => {
        gl.uniformMatrix3fv(uniforms.uRot, true, frame.rot);
        gl.uniform3fv(uniforms.uTarget, frame.target);
        gl.uniform2f(uniforms.uView, frame.w, frame.h);
        gl.uniform2fv(uniforms.uCenter, frame.center);
        gl.uniform1f(uniforms.uScale, frame.scale);
        gl.uniform1f(uniforms.uDist, frame.dist);
        gl.uniform1f(uniforms.uDpr, frame.dpr);
        gl.uniform1f(uniforms.uTime, frame.time);
    };

    const onLost = (event) => {
        event.preventDefault();
        state.lost = true;
        res = null;
    };
    const onRestored = () => {
        state.lost = false;
        try {
            build();
            api.onRestore?.();
        } catch (error) {
            state.lost = true;
        }
    };
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);

    const api = {
        onRestore: null,
        get lost() {
            return state.lost || gl.isContextLost();
        },
        // 피질 점과 장식 섬유(한 번 만든 뒤 바뀌지 않음)
        setBrain(brain) {
            state.brain = brain;
            if (res) uploadBrain();
        },
        // 선의 고정 값(장식 섬유 + 데이터 연결). 그래프가 바뀔 때만 다시 올립니다.
        setLinks(fixed, count) {
            state.fixed = fixed;
            state.linkCount = count;
            if (res) uploadLinks();
        },
        resize(width, height, dpr) {
            const w = Math.max(1, Math.round(width * dpr));
            const h = Math.max(1, Math.round(height * dpr));
            if (canvas.width !== w || canvas.height !== h) {
                canvas.width = w;
                canvas.height = h;
            }
        },
        // frame: 카메라·시간·껍질 상태, live: 선마다 바뀌는 값, nodes: 뉴런 값(뒤에서 앞 순서), nodeCount: 뉴런 수
        // move: 끌어당기기로 선이 움직인 만큼. frame.moved 가 참인 프레임에만 올립니다.
        draw(frame, live, nodes, nodeCount, move) {
            if (!res || api.lost) return;
            gl.viewport(0, 0, canvas.width, canvas.height);
            gl.clear(gl.COLOR_BUFFER_BIT);

            if (state.brain && frame.cortexCount > 0 && frame.shell > 0.001) {
                const { program, uniforms } = res.cortex;
                gl.useProgram(program);
                common(uniforms, frame);
                gl.uniform3fv(uniforms.uCore, CORE);
                gl.uniform1f(uniforms.uAppear, frame.appear);
                gl.uniform1f(uniforms.uShell, frame.shell);
                gl.uniform1f(uniforms.uPoint, frame.point);
                gl.uniform3fv(uniforms.uTone, SHELL);
                gl.uniform1fv(uniforms.uGlow, frame.glow);
                gl.uniform3fv(uniforms.uTint, frame.tint);
                gl.uniform2fv(uniforms.uScan, frame.scan);
                gl.uniform1f(uniforms.uCalm, frame.calm);
                gl.uniform3fv(uniforms.uPullAt, frame.pullAt);
                gl.uniform3fv(uniforms.uPullBy, frame.pullBy);
                gl.bindVertexArray(res.cortexVao);
                gl.drawArrays(gl.POINTS, 0, Math.min(frame.cortexCount, state.brain.count));
            }

            if (state.fixed && state.linkCount > 0) {
                const { program, uniforms } = res.ribbon;
                gl.useProgram(program);
                common(uniforms, frame);
                gl.uniform3fv(uniforms.uSpark, SPARK);
                gl.bindVertexArray(res.ribbonVao);
                gl.bindBuffer(gl.ARRAY_BUFFER, res.liveBuffer);
                if (res.liveSize !== live.length) {
                    gl.bufferData(gl.ARRAY_BUFFER, live, gl.DYNAMIC_DRAW);
                    res.liveSize = live.length;
                } else {
                    gl.bufferSubData(gl.ARRAY_BUFFER, 0, live);
                }
                if (frame.moved && move && move.length === state.linkCount * LINK_MOVE) {
                    gl.bindBuffer(gl.ARRAY_BUFFER, res.moveBuffer);
                    gl.bufferSubData(gl.ARRAY_BUFFER, 0, move);
                }
                gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, (SEGMENTS + 1) * 2, state.linkCount);
            }

            if (nodeCount > 0) {
                const { program, uniforms } = res.node;
                gl.useProgram(program);
                common(uniforms, frame);
                gl.uniform3fv(uniforms.uIvory, IVORY);
                gl.uniform3fv(uniforms.uBack, STAGE);
                gl.bindVertexArray(res.nodeVao);
                gl.bindBuffer(gl.ARRAY_BUFFER, res.nodeBuffer);
                if (res.nodeSize !== nodes.length) {
                    gl.bufferData(gl.ARRAY_BUFFER, nodes, gl.DYNAMIC_DRAW);
                    res.nodeSize = nodes.length;
                } else {
                    gl.bufferSubData(gl.ARRAY_BUFFER, 0, nodes, 0, nodeCount * NODE_SIZE);
                }
                gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, nodeCount);
            }
            gl.bindVertexArray(null);
        },
        dispose() {
            canvas.removeEventListener('webglcontextlost', onLost);
            canvas.removeEventListener('webglcontextrestored', onRestored);
            if (res && !gl.isContextLost()) {
                for (const item of [res.cortex, res.ribbon, res.node]) gl.deleteProgram(item.program);
                for (const buffer of [res.cortexBuffer, res.stripBuffer, res.fixedBuffer, res.liveBuffer, res.moveBuffer, res.quadBuffer, res.nodeBuffer]) gl.deleteBuffer(buffer);
                for (const vao of [res.cortexVao, res.ribbonVao, res.nodeVao]) gl.deleteVertexArray(vao);
            }
            res = null;
            // 화면에서 정말 사라진 경우에만(곧바로 다시 붙지 않았을 때) 그리기 맥락을 돌려줍니다.
            PENDING_LOSS.set(canvas, setTimeout(() => {
                PENDING_LOSS.delete(canvas);
                if (!canvas.isConnected) gl.getExtension('WEBGL_lose_context')?.loseContext();
            }, 200));
        },
    };

    try {
        build();
    } catch (error) {
        // 맥락을 잃은 상태라면 되살아날 때 다시 만들고, 그 밖의 실패(셰이더 미지원 등)는 대체 화면으로 넘깁니다.
        if (!gl.isContextLost()) {
            canvas.removeEventListener('webglcontextlost', onLost);
            canvas.removeEventListener('webglcontextrestored', onRestored);
            return null;
        }
        state.lost = true;
    }
    return api;
}
