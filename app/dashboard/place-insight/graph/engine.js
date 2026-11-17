// 그래프 장면: 점·선의 상태, 카메라, 신경 발화, 라벨 자리를 프레임마다 계산해 renderer 에 넘깁니다.
// React 와는 떨어져 있어서(렌더 없음) 화면이 60번씩 다시 그려져도 컴포넌트는 가만히 있습니다.

import { LOBES, LOBE_ORDER, lobeOf, hashOf, brainDistance } from './brain';
import { placeNodes, bendOf } from './layout';
import { colorOf, IVORY, SHELL } from './palette';
import { createPull } from './pull';
import { LINK_FIXED, LINK_LIVE, LINK_MOVE, NODE_SIZE } from './renderer';

const TAU = Math.PI * 2;
// 처음 보이는 각도: 왼쪽 앞에서 살짝 내려다봅니다(옆모습의 윤곽과 좌우 반구의 틈이 함께 보이는 각도).
export const HOME = { yaw: 1.12, pitch: 0.2, zoom: 1, target: [0, -0.02, 0] };
const DIST = 5.2;
// 가만히 둘 때 좌우로 도는 폭(±약 21°)과 한 번 오가는 시간(초)
// 한 번에 띄우는 관계 이름표의 최대 수(PlaceGraph 가 이만큼 자리를 만들어 둡니다)
export const TAG_MAX = 9;
// 저절로 도는 폭(rad). 이름표를 겨눌 수 있도록 작게 둡니다.
const SWAY = 0.18;
const SWAY_PERIOD = 26;
// 저절로 도는 동안 위아래로 끄덕이는 폭(rad). 크면 앞뒤로 떨어진 점들이 서로 가렸다 말았다 합니다.
const NOD = 0.005;
const ZOOM_MIN = 0.8;
const ZOOM_MAX = 2.6;
// 신호가 선을 따라가는 빠르기(장면 단위/초)
const SIGNAL_SPEED = 1.35;
// 저절로 신호가 출발하는 간격(초, 앞뒤로 조금씩 달라짐)
const BEAT = 1.5;

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function unit(seed, salt) {
    let v = (seed ^ Math.imul(salt + 1, 0x9E3779B1)) >>> 0;
    v = Math.imul(v ^ (v >>> 16), 0x85EBCA6B);
    v = Math.imul(v ^ (v >>> 13), 0xC2B2AE35);
    return ((v ^ (v >>> 16)) >>> 0) / 4294967296;
}

// 튕기지 않고 목표에 닿는 용수철(임계 감쇠). s = { x, v, to }
function spring(s, omega, dt) {
    const e = Math.exp(-omega * dt);
    const d = s.x - s.to;
    const t = (s.v + omega * d) * dt;
    s.x = s.to + (d + t) * e;
    s.v = (s.v - omega * t) * e;
}

function make(value) {
    return { x: value, v: 0, to: value };
}

function nearAngle(from, to) {
    let diff = (to - from) % TAU;
    if (diff > Math.PI) diff -= TAU;
    if (diff < -Math.PI) diff += TAU;
    return from + diff;
}

export function createEngine(renderer) {
    const E = {
        renderer,
        w: 0, h: 0, dpr: 1, fit: 200, lite: false, coarse: false, reduced: false,
        mode: 'live', time: 0, last: 0,
        brain: null, cortexLevel: 0, appear: 0, shell: 0.6, scanAt: 0,
        list: [], byId: new Map(), links: [], spots: new Map(), order: [], hubs: [],
        fixed: new Float32Array(0), live: new Float32Array(0), nodeData: new Float32Array(0), fiberCount: 0,
        glow: new Float32Array(8), tint: new Float32Array(24), rot: new Float32Array(9),
        cam: {
            yaw: make(HOME.yaw), pitch: make(HOME.pitch), zoom: make(1),
            tx: make(HOME.target[0]), ty: make(HOME.target[1]), tz: make(HOME.target[2]),
            ox: make(0), oy: make(0),
            sway: 1, swayTo: 1, phase: 0, held: false, spin: 0, restAt: 0, moved: false,
        },
        view: { yaw: HOME.yaw, cx: 0, cy: 0, scale: 200 },
        selfId: null, selectedId: null, focusId: null, hotSet: null, group: null, linkHotId: null,
        events: [], beatAt: 1.2, fiberAt: 1,
        relations: {}, relation: null, klass: null, tags: [], onTags: null, titleOf: null,
        labels: { metrics: new Map(), blocks: [], shown: [] },
        center: null, fiberPulse: new Float32Array(0), homeYaw: HOME.yaw, swayAmp: SWAY,
        slow: 0, fast: 0, ema: 16, lowered: 0, dprCap: 2,
        onFrame: null, invalidate: null,
        // 끌어당기기: 물리(pull), 잡고 있는 점(grab)·줄(string), 길게 누르기 예고(charge), 선이 움직인 만큼(moveData)
        pull: createPull(), grab: null, string: null, charge: null, bulge: -1,
        moveData: new Float32Array(0), moving: false, moved: false,
        // 실제로 흐른 시간(움직임 줄이기에서도 흐름)과, 보고 있는 대상이 마지막으로 바뀐 때
        clock: 0, focusAt: -9, beatLast: 0,
        // 무대에서 카드·시트·버튼이 덮지 않는 영역 [x0, y0, x1, y1] 과, 그 안에 맞춰 보고 있는 것(framing)
        safe: [0, 0, 0, 0], framing: null, refitAt: null, tall: false, homeZoom: 1,
        // 포인터·손가락이 무대 위에 있는지(있으면 저절로 흔들리지 않음), 시범 끌기, 고정해 둔 점들, 방금 놓은 점
        pointerOn: false, auto: null, pins: [], lastPull: null, settledAt: 0,
    };

    for (let i = 0; i < LOBE_ORDER.length; i += 1) E.tint.set(colorOf(LOBE_ORDER[i]).vivid, i * 3);
    // 자리가 없어 숨긴 관계 이름표의 수를 적는 쪽지("연결 종류 +3"), 관계 묶음의 전체 수, 걸러 보기로 다가가는 중인지
    E.more = { n: 0, w: 0, h: 0, x: 0, y: 0, a: 0, on: false };
    E.tagTotal = 0;
    E.arriving = false;
    // 손가락으로 톡 해서 이름만 띄워 둔 점(카드는 열지 않은 상태)
    E.peekId = null;

    /* ───────── 그래프 맞추기 ───────── */

    E.setGraph = (nodes, links) => {
        const now = E.time;
        const fresh = E.list.length === 0;
        E.spots = placeNodes(nodes, E.spots);
        const byId = new Map();
        const list = [];
        const kidsOf = new Map();
        for (const node of nodes) {
            if (!node.parent) continue;
            if (!kidsOf.has(node.parent)) kidsOf.set(node.parent, []);
            kidsOf.get(node.parent).push(node.id);
        }
        nodes.forEach((node, index) => {
            const seed = hashOf(node.id);
            const level = clamp(Math.round(node.level) || 0, 0, 3);
            const prev = E.byId.get(node.id);
            const p = prev || {
                id: node.id, seed, born: Infinity, shown: 0, fire: 0, hot: 0, dim: 0, tHot: 0, tDim: 0,
                ringAt: -9, sel: 0, focus: 0, sx: 0, sy: 0, sz: 0, k: 1, rr: 4, front: 0,
                over: 0,
                // 이름표: 점에서의 어긋남(rx·ry)이 목표(tx·ty)로 미끄러져 갑니다. dir: 쓰고 있는 자리 번호
                lab: { on: false, a: 0, x: 0, y: 0, ax: 0, ay: 0, bx: 0, by: 0, rx: 0, ry: 0, tx: 0, ty: 0, dir: -1, mode: 0, lead: false, loose: false, size: null, want: -1, retryAt: 0 },
            };
            const weight = typeof node.weight === 'number' ? clamp(node.weight, 0, 1) : [1, 0.8, 0.5, 0.3][level];
            Object.assign(p, {
                node, index, level, weight,
                group: node.group || 'other',
                lobe: LOBE_ORDER.indexOf(lobeOf(node.group)),
                at: E.spots.get(node.id).at,
                color: colorOf(node.group),
                ghost: Boolean(node.ghost),
                pending: node.tone === 'pending',
                base: [11.5, 5.4, 2.7 + 1.7 * weight, 2 + 0.9 * weight][level],
                links: [], kids: [], parent: null, isNew: !prev,
            });
            // 그릴 자리 = 제자리(at) + 끌려 나온 만큼. 그래프가 바뀌면 끌어당기기는 처음부터 다시입니다.
            p.pos = [p.at[0], p.at[1], p.at[2]];
            byId.set(node.id, p);
            list.push(p);
        });
        for (const p of list) {
            p.parent = p.node.parent ? byId.get(p.node.parent) || null : null;
            if (p.parent) p.parent.kids.push(p);
            // 쉬는 화면에서 먼저 이름을 띄울 순서(1부터). 데이터가 정해 주지 않으면 아래에서 중요한 항목 순으로 매깁니다.
            p.spot = typeof p.node.spot === 'number' && p.node.spot > 0 ? p.node.spot : 0;
        }
        if (!list.some((p) => p.spot)) {
            list.filter((p) => p.level === 2 && !p.ghost && !p.pending && (p.node.label || p.node.full))
                .sort((a, b) => b.weight - a.weight || a.index - b.index)
                .slice(0, 8)
                .forEach((p, i) => {
                    p.spot = i + 1;
                });
        }
        spreadForHome(list);
        for (const p of list) p.pos = [p.at[0], p.at[1], p.at[2]];

        // 나타나는 순서: 핵 → 묶음(차례로) → 항목 → 세부. 다 합쳐 1.6초 안팎에 끝나게 간격을 줄입니다.
        const ranked = [...list].sort((a, b) => a.level - b.level || a.index - b.index);
        const hubs = ranked.filter((p) => p.level === 1);
        const hubGap = Math.min(0.07, 0.5 / Math.max(1, hubs.length));
        let hubIndex = 0;
        for (const p of ranked) {
            if (!p.isNew) continue;
            if (E.reduced) {
                p.born = -1;
                p.shown = 1;
            } else if (p.level === 0) {
                p.born = now + (fresh ? 0.1 : 0);
            } else if (p.level === 1) {
                p.born = now + 0.16 + hubIndex * hubGap;
                hubIndex += 1;
            } else {
                const parent = p.parent;
                const nth = parent ? parent.kids.indexOf(p) : 0;
                const gap = Math.min(0.04, 0.55 / Math.max(1, parent ? parent.kids.length : 1));
                const from = parent && parent.born !== Infinity ? Math.max(parent.born, now) : now;
                p.born = from + (p.level === 2 ? 0.3 : 0.2) + nth * gap;
            }
        }

        const prevLinks = new Map(E.links.map((line) => [line.id, line]));
        const pairs = new Map();
        const lines = [];
        for (const link of links) {
            const s = byId.get(link.source);
            const t = byId.get(link.target);
            if (!s || !t || s === t) continue;
            const cross = link.kind === 'cross';
            // a 가 가운데 쪽(부모), b 가 바깥쪽(자식). 선은 a 에서 b 로 자라납니다.
            const [a, b] = !cross && s.level > t.level ? [t, s] : [s, t];
            const old = prevLinks.get(link.id);
            const line = old || { id: link.id, shown: 0, hot: 0, dim: 0, tHot: 0, tDim: 0, p1: [0, 0, 0], p2: [0, 0, 0] };
            const strength = typeof link.strength === 'number' ? clamp(link.strength, 0, 1) : cross ? 0.5 : 0.7;
            // 관계(rel): 주어(source) → 목적어(target). 가지 연결은 '소속'(자식 → 부모)입니다.
            const rel = link.rel || (cross ? '' : 'partOf');
            Object.assign(line, {
                link, a, b, cross, strength, rel,
                subject: s, object: t,
                family: E.relations[rel]?.family || (cross ? '' : 'structure'),
                seed: unit(hashOf(link.id), 3),
                length: Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1], a.at[2] - b.at[2]) || 0.1,
            });
            // 같은 두 점 사이에 관계가 둘 이상이면(예: 등록함 + 검색 상위에 있음) 몇 번째인지 적어 두고, 그릴 때 서로 벌려 놓습니다.
            const pair = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
            line.twin = pairs.get(pair) || 0;
            pairs.set(pair, line.twin + 1);
            line.index = lines.length;
            a.links.push(line);
            b.links.push(line);
            lines.push(line);
        }
        // 끌어당기기 물리에도 같은 그래프를 넘깁니다(점·연결의 번호가 여기와 같습니다).
        E.grab = null;
        E.string = null;
        E.charge = null;
        E.bulge = -1;
        E.pull.setGraph(
            list.map((p) => ({ at: p.at, level: p.level })),
            lines.map((line) => ({ a: line.a.index, b: line.b.index, cross: line.cross, strength: line.strength })),
        );

        E.list = list;
        E.byId = byId;
        E.links = lines;
        E.order = [...list];
        E.hubs = hubs;
        E.center = ranked.find((p) => p.level === 0) || null;
        E.events = E.events.filter((event) => byId.get(event.to.id) === event.to && lines.includes(event.line));
        if (E.selectedId && !byId.has(E.selectedId)) E.selectedId = null;
        if (E.selfId && !byId.has(E.selfId)) E.selfId = null;
        E.pins = [];
        E.auto = null;
        E.lastPull = null;
        E.settledAt = 0;
        buildFixed();
        applyFocus();
        measureHome();
    };

    // 쉬는 자세에서 점끼리 서로 가리지 않게, 겹쳐 보이는 점들을 화면 평면 위에서 조금씩 벌립니다.
    // 쉬는 동안 뇌가 좌우로 돌기 때문에(±swayAmp) 앞쪽 점은 뒤쪽 점 위를 옆으로 지나갑니다. 그래서 한 자세가 아니라
    // '도는 길 전체'에서 두 점이 가장 가까워지는 때를 봅니다(왼쪽 끝·가운데·오른쪽 끝 세 자세를 이은 길).
    //  - 가장 가까워지는 자리에서 서로 멀어지는 쪽으로 밉니다. 서로 지나치는 쌍이면 그 방향이 위아래가 됩니다
    //    (높이는 돌아도 변하지 않으므로, 위아래로 떨어진 점은 지나쳐도 겹치지 않습니다).
    //  - 지나치는 때가 도는 범위의 끝 가까이면, 옆으로 밀어 범위 밖으로 내보내는 편이 덜 옮깁니다. 덜 옮기는 쪽을 고릅니다.
    // 매장·묶음 중심 점은 그대로 두고 항목 점만 옮기며, 뇌 밖으로는 내보내지 않습니다. 옮긴 자리는 그대로 기억됩니다(E.spots 의 at).
    function spreadForHome(list) {
        if (!E.w || list.length < 3) return;
        const began = typeof performance !== 'undefined' ? performance.now() : 0;
        // 이 그래프를 처음 자세에서 볼 때의 배율로 잽니다(폰에서는 1.2~1.3배로 보므로 그만큼 자리가 넓습니다).
        const scale = E.fit * homeZoomOf(list);
        const size = clamp(E.fit / 230, 0.64, 1.16);
        const n = list.length;
        const cp = Math.cos(HOME.pitch);
        const sp = Math.sin(HOME.pitch);
        // 세 자세에서 화면의 오른쪽·위쪽·앞쪽이 장면에서 가리키는 방향
        const poses = [E.homeYaw - E.swayAmp, E.homeYaw, E.homeYaw + E.swayAmp].map((yaw) => {
            const cy = Math.cos(yaw);
            const sy = Math.sin(yaw);
            return { right: [cy, 0, sy], up: [sp * sy, cp, -sp * cy], front: [-cp * sy, sp, cp * cy] };
        });
        const X = poses.map(() => new Float32Array(n));
        const Y = poses.map(() => new Float32Array(n));
        const radius = new Float32Array(n);
        const depth = new Float32Array(n);
        const kHome = new Float32Array(n);
        const fixed = [];
        // 점 하나의 세 자세 화면 자리와 반지름(그리는 식과 같음. 앞쪽 점은 원근으로 조금 더 큼)
        const place = (i) => {
            const p = list[i];
            const x = p.at[0] - HOME.target[0];
            const y = p.at[1] - HOME.target[1];
            const z = p.at[2] - HOME.target[2];
            let r = p.level >= 3 ? 3.5 : p.level === 2 ? 4.5 : 0;
            for (let s = 0; s < 3; s += 1) {
                const { right, up, front } = poses[s];
                const pz = front[0] * x + front[1] * y + front[2] * z;
                const k = DIST / Math.max(0.4, DIST - pz);
                X[s][i] = (right[0] * x + right[2] * z) * k * scale;
                Y[s][i] = (up[0] * x + up[1] * y + up[2] * z) * k * scale;
                r = Math.max(r, p.base * size * (1 + (k - 1) * 0.85));
                if (s === 1) {
                    depth[i] = pz;
                    kHome[i] = k;
                }
            }
            // 매장·묶음 점은 신호가 닿을 때 조금 커지므로 그만큼 넉넉히 봅니다.
            radius[i] = p.level < 2 ? r * 1.05 : r;
        };
        for (let i = 0; i < n; i += 1) {
            place(i);
            if (list[i].level < 2) fixed.push(i);
        }
        // 가운데 자세의 화면에서 (dx, dy) 만큼 옮깁니다(깊이는 그대로). 뇌 밖으로 나가면 옮기지 않습니다.
        const shift = (i, dx, dy) => {
            const p = list[i];
            const { right, up } = poses[1];
            const step = 1 / (scale * kHome[i]);
            let x = p.at[0] + (right[0] * dx + up[0] * dy) * step;
            let y = p.at[1] + (right[1] * dx + up[1] * dy) * step;
            let z = p.at[2] + (right[2] * dx + up[2] * dy) * step;
            // 뇌 가장자리를 넘으면 가운데 쪽으로 조금씩 당겨 넣습니다(겉면을 따라 미끄러지는 셈). 그래도 안 되면 옮기지 않습니다.
            for (let tries = 0; brainDistance(x, y, z) > -0.04; tries += 1) {
                if (tries === 5) return false;
                x += (HOME.target[0] - x) * 0.035;
                y += (HOME.target[1] - y) * 0.035;
                z += (HOME.target[2] - z) * 0.035;
            }
            p.at[0] = x;
            p.at[1] = y;
            p.at[2] = z;
            place(i);
            return true;
        };
        // 도는 길(세 자세를 이은 두 선분)에서 j 가 i 에 가장 가까워지는 때를 잽니다. 간격이 모자라면 true, 잰 값은 M 에 둡니다.
        //  best: 가장 가까운 거리, (cx, cy): 그때 i 에서 본 j 의 자리, lo~hi: 도는 동안 가로 어긋남의 범위, low: 세로 어긋남의 최소
        const M = { best: 0, need: 0, cx: 0, cy: 0, lo: 0, hi: 0, low: 0, nod: 0 };
        const tooClose = (i, j, gap) => {
            const need = radius[i] + radius[j] + gap;
            // 끄덕임(위아래 ±NOD)으로 앞뒤 점의 높이가 어긋나는 만큼은 여유로 둡니다.
            const nod = Math.abs(depth[j] - depth[i]) * scale * NOD;
            const dy1 = Y[1][j] - Y[1][i];
            if (dy1 > need + nod + 4 || dy1 < -need - nod - 4) return false;
            const dx0 = X[0][j] - X[0][i];
            const dx1 = X[1][j] - X[1][i];
            const dx2 = X[2][j] - X[2][i];
            const lo = Math.min(dx0, dx1, dx2);
            const hi = Math.max(dx0, dx1, dx2);
            if (lo > need || hi < -need) return false;
            const dy0 = Y[0][j] - Y[0][i];
            const dy2 = Y[2][j] - Y[2][i];
            let best = Infinity;
            let cx = 0;
            let cy = 0;
            for (let s = 0; s < 2; s += 1) {
                const ax = s ? dx1 : dx0;
                const ay = s ? dy1 : dy0;
                const ex = (s ? dx2 : dx1) - ax;
                const ey = (s ? dy2 : dy1) - ay;
                const len = ex * ex + ey * ey;
                const t = len > 1e-9 ? clamp(-(ax * ex + ay * ey) / len, 0, 1) : 0;
                const qx = ax + ex * t;
                const qy = ay + ey * t;
                const far = Math.hypot(qx, Math.max(0, Math.abs(qy) - nod));
                if (far < best) {
                    best = far;
                    cx = qx;
                    cy = qy;
                }
            }
            if (best >= need) return false;
            M.best = best;
            M.need = need;
            M.cx = cx;
            M.cy = cy;
            M.lo = lo;
            M.hi = hi;
            M.low = Math.max(0, Math.min(Math.abs(dy0), Math.abs(dy1), Math.abs(dy2)) - nod);
            M.nod = nod;
            return true;
        };
        const clearOfFixed = (i, gap) => {
            for (const f of fixed) if (f !== i && tooClose(f, i, gap)) return false;
            return true;
        };
        // 확인용 기록(화면에는 쓰지 않음): 돈 바퀴 수, 바퀴마다 남은 쌍, 끝내 못 옮긴 쌍, 걸린 시간
        const stat = { rounds: 0, left: [], stuck: 0, ms: 0 };
        E.spreadStat = stat;
        const relax = (gap, rounds) => {
            let least = Infinity;
            let since = 0;
            for (let round = 0; round < rounds; round += 1) {
                let touching = 0;
                stat.rounds += 1;
                stat.stuck = 0;
                for (let i = 0; i < n; i += 1) {
                    const a = list[i];
                    for (let j = i + 1; j < n; j += 1) {
                        const b = list[j];
                        if (a.level < 2 && b.level < 2) continue;
                        if (!tooClose(i, j, gap)) continue;
                        touching += 1;
                        const { best, need, cx, cy, lo, hi, low, nod } = M;
                        // ① 가장 가까운 자리에서 서로 멀어지는 쪽
                        let ux = cx;
                        let uy = Math.sign(cy) * Math.max(0, Math.abs(cy) - nod);
                        const far = Math.hypot(ux, uy);
                        // 지금 j 가 i 의 위쪽인지 아래쪽인지(정확히 포개졌으면 점마다 늘 같은 쪽으로 정해 둠)
                        const side = cy > 0.01 || (cy > -0.01 && (a.seed + b.seed) % 2 === 0) ? 1 : -1;
                        if (far < 0.05) {
                            ux = 0;
                            uy = side;
                        } else {
                            ux /= far;
                            uy /= far;
                        }
                        // ② 옆으로 밀어, 도는 내내 한쪽에만 있게(지나치지 않게) 하려면 필요한 만큼
                        const reach = Math.sqrt(Math.max(0, need * need - low * low));
                        if (a.level < 2 || b.level < 2) {
                            // 한쪽이 움직이지 않는 점(매장·묶음)이면 항목만 다 옮깁니다. 덜 옮기는 쪽부터 해 보고,
                            // 옮긴 자리가 다른 매장·묶음 점에 또 걸리면 그다음 쪽(반대편·옆)을 봅니다.
                            const item = a.level < 2 ? j : i;
                            const turn = a.level < 2 ? 1 : -1;
                            const p = list[item];
                            const from = [p.at[0], p.at[1], p.at[2]];
                            const ways = [
                                [need - best, ux, uy],
                                [need + nod + Math.abs(cy), 0, -side],
                                [reach - lo, 1, 0],
                                [reach + hi, -1, 0],
                            ].sort((one, other) => one[0] - other[0]);
                            let done = false;
                            for (const [amount, wx, wy] of ways) {
                                const push = amount * 1.04 + 0.1;
                                if (!shift(item, turn * wx * push, turn * wy * push)) continue;
                                if (clearOfFixed(item, gap)) {
                                    done = true;
                                    break;
                                }
                                p.at[0] = from[0];
                                p.at[1] = from[1];
                                p.at[2] = from[2];
                                place(item);
                            }
                            if (!done && !shift(item, turn * ways[0][1] * (ways[0][0] * 1.04 + 0.1), turn * ways[0][2] * (ways[0][0] * 1.04 + 0.1))) stat.stuck += 1;
                            continue;
                        }
                        let amount = need - best;
                        if (reach - lo < amount) {
                            amount = reach - lo;
                            ux = 1;
                            uy = 0;
                        }
                        if (reach + hi < amount) {
                            amount = reach + hi;
                            ux = -1;
                            uy = 0;
                        }
                        // 둘이 반씩. 한쪽이 뇌 가장자리에 막히면 다른 쪽이 그 몫까지 갑니다.
                        const push = amount * 0.52 + 0.05;
                        const movedA = shift(i, -ux * push, -uy * push);
                        const movedB = shift(j, ux * push * (movedA ? 1 : 2), uy * push * (movedA ? 1 : 2));
                        if (movedA && !movedB) shift(i, -ux * push, -uy * push);
                        if (!movedA && !movedB) stat.stuck += 1;
                    }
                }
                stat.left.push(touching);
                if (!touching) return 0;
                // 열여섯 바퀴를 돌아도 더 줄지 않으면(자리가 모자란 빽빽한 곳) 그만둡니다.
                if (touching < least) {
                    least = touching;
                    since = 0;
                } else {
                    since += 1;
                    if (since >= 16) break;
                }
            }
            return stat.left[stat.left.length - 1];
        };
        // 먼저 넉넉한 간격(2.5px)으로 풀고, 빽빽해서 다 풀리지 않은 곳은 '겹치지만 않게'(0.8px) 다시 풉니다.
        if (relax(2.5, 30)) relax(0.8, 60);
        // 그래도 남은 쌍은(빽빽한 곳에서 서로 밀다 끝난 것), 덜 중요한 항목부터 가까운 빈 자리를 둘레로 훑어 찾아 옮깁니다.
        const clearOfAll = (i, gap) => {
            for (let j = 0; j < n; j += 1) if (j !== i && tooClose(j, i, gap)) return false;
            return true;
        };
        const order = [];
        for (let i = 0; i < n; i += 1) if (list[i].level >= 2) order.push(i);
        order.sort((a, b) => list[b].level - list[a].level || list[a].weight - list[b].weight || a - b);
        stat.moved = 0;
        stat.final = 0;
        for (const i of order) {
            if (clearOfAll(i, 0.8)) continue;
            const p = list[i];
            const from = [p.at[0], p.at[1], p.at[2]];
            let done = false;
            for (let far = 3; far <= 42 && !done; far += 3) {
                for (let turn = 0; turn < 12 && !done; turn += 1) {
                    const angle = (turn / 12) * TAU + (p.seed % 7);
                    p.at[0] = from[0];
                    p.at[1] = from[1];
                    p.at[2] = from[2];
                    place(i);
                    done = shift(i, Math.cos(angle) * far, Math.sin(angle) * far) && clearOfAll(i, 0.8);
                }
            }
            if (done) stat.moved += 1;
            else {
                p.at[0] = from[0];
                p.at[1] = from[1];
                p.at[2] = from[2];
                place(i);
                stat.final += 1;
            }
        }
        stat.ms = began ? Math.round(performance.now() - began) : 0;
    }

    // 선마다 바뀌지 않는 값(자리·색·굵기)을 한 번에 올립니다. 앞쪽은 장식 섬유, 그 뒤가 데이터 연결입니다.
    function buildFixed() {
        const fibers = E.brain ? E.brain.fibers : new Float32Array(0);
        const fiberCount = fibers.length / 9;
        const total = fiberCount + E.links.length;
        const fixed = new Float32Array(total * LINK_FIXED);
        for (let i = 0; i < fiberCount; i += 1) {
            const o = i * LINK_FIXED;
            fixed.set(fibers.subarray(i * 9, i * 9 + 9), o);
            fixed.set(SHELL, o + 9);
            fixed.set(SHELL, o + 12);
            fixed.set([0.7, 0.075, 0, 1], o + 15);
        }
        E.links.forEach((line, i) => {
            const o = (fiberCount + i) * LINK_FIXED;
            const { a, b } = line;
            const bend = bendOf(a.at, b.at, line.cross, line.seed);
            if (line.twin) {
                // 겹치는 선은 옆으로 벌립니다(두 점을 잇는 방향과 위쪽에 모두 수직인 쪽으로).
                const dx = b.at[0] - a.at[0];
                const dz = b.at[2] - a.at[2];
                const side = Math.hypot(dx, dz) || 1;
                const push = line.length * 0.26 * (line.twin % 2 ? 1 : -1) * Math.ceil(line.twin / 2);
                bend[0] += (dz / side) * push;
                bend[1] += Math.abs(push) * 0.5;
                bend[2] -= (dx / side) * push;
            }
            line.bend = bend;
            fixed.set(a.at, o);
            fixed.set(bend, o + 3);
            fixed.set(b.at, o + 6);
            // 휘어진 선 위의 세 자리(가운데·앞쪽·뒤쪽): 관계 이름표를 달 후보
            line.spots = [0.5, 0.36, 0.64, 0.25, 0.75].map((t) => [0, 1, 2].map((c) => (1 - t) * (1 - t) * a.at[c] + 2 * (1 - t) * t * bend[c] + t * t * b.at[c]));
            line.mid = line.spots[0];
            // 선의 색은 묶음 색을 상아색에 섞어 차분하게(신호가 지날 때만 선명해집니다)
            const from = a.level === 0 ? b.color.soft : a.color.soft;
            const to = b.color.soft;
            for (let c = 0; c < 3; c += 1) {
                fixed[o + 9 + c] = IVORY[c] + (from[c] - IVORY[c]) * 0.62;
                fixed[o + 12 + c] = IVORY[c] + (to[c] - IVORY[c]) * 0.62;
            }
            const ghost = a.ghost || b.ghost;
            // 가지(소속)는 조용한 뼈대로, 가로지르는 연결(의미 관계)이 주인공입니다. 중요한(strength 높은) 관계일수록 또렷합니다.
            const width = line.cross ? 0.85 + 0.55 * line.strength : a.level === 0 ? 1.15 : b.level >= 3 ? 0.7 : 0.85;
            const alpha = (line.cross ? 0.05 + 0.3 * line.strength * line.strength : a.level === 0 ? 0.17 : b.level >= 3 ? 0.1 : 0.14) * (ghost ? 0.85 : 1);
            // 연결의 갈래는 선의 무늬로(shaders.js 의 무늬 번호): 경쟁 = 긴 점선, 할 일 = 짧은 점선, 같은 것 = 긴 줄·점,
            // 근거 = 두 줄, AI = 긴 줄·점·점, 등록·구조 = 실선
            const pattern = { competition: 1, action: 2, same: 3, evidence: 4, ai: 5 }[line.family] || 0;
            fixed.set([width, alpha, pattern, line.length * (line.cross ? 1.25 : 1.1)], o + 15);
        });
        E.fixed = fixed;
        E.fiberCount = fiberCount;
        E.live = new Float32Array(total * LINK_LIVE);
        E.moveData = new Float32Array(total * LINK_MOVE);
        E.fiberPulse = new Float32Array(fiberCount * 3);
        if (E.nodeData.length < E.list.length * NODE_SIZE) E.nodeData = new Float32Array(Math.max(64, E.list.length + 16) * NODE_SIZE);
        renderer?.setLinks(fixed, total);
    }

    E.setBrain = (brain) => {
        E.brain = brain;
        E.cortexLevel = brain.levels.length - 1;
        renderer?.setBrain(brain);
        buildFixed();
        if (E.reduced) E.appear = 1;
    };

    E.setSize = (w, h, dpr) => {
        const before = E.w ? { fit: E.fit, w: E.w, h: E.h } : null;
        // 가려지지 않는 영역은 PlaceGraph 가 곧 다시 알려 줍니다. 그때까지는 늘어난·줄어든 만큼만 맞춰 둡니다.
        E.safe = before ? [E.safe[0], E.safe[1], E.safe[2] + w - E.w, E.safe[3] + h - E.h] : [0, 0, w, h];
        E.w = w;
        E.h = h;
        E.dpr = dpr;
        E.lite = E.coarse || w < 480;
        // 뇌가 칸을 꽉 채우도록: 가로는 옆모습 길이(돌 때 가장 넓어지는 폭), 세로는 정수리에서 뇌간 끝까지
        // 칸이 정사각형에 가깝거나 세로로 길면(요약 칸 옆의 좁은 그래프 칸, 휴대폰) 옆모습보다 조금 앞쪽에서 봅니다.
        // 그 각도에서는 뇌의 가로 폭이 줄어 같은 칸에 더 크게 들어가고, 좌우 반구가 함께 보입니다.
        const tall = w / h < 1.3;
        const homeYaw = tall ? 0.88 : HOME.yaw;
        if (!E.cam.moved && homeYaw !== E.homeYaw) {
            E.cam.yaw.to = homeYaw;
            // 아직 한 장도 그리기 전이면 돌아가는 움직임 없이 바로 그 각도에서 시작합니다.
            if (!E.last) E.cam.yaw.x = homeYaw;
        }
        E.homeYaw = homeYaw;
        E.tall = tall;
        // 세로로 긴 좁은 무대(폰)에서는 점이 훨씬 빽빽합니다. 도는 폭을 줄여, 앞쪽 점이 뒤쪽 점 위를 지나치는 구간을 줄입니다.
        E.swayAmp = tall ? SWAY * 0.5 : SWAY;
        E.fit = Math.min(w / (tall ? 2.42 : 2.32), h / 2.06);
        if (before && E.last) {
            // 무대 크기가 바뀌어도(걸러 보기 띠가 뜨고 지는 등) 보이는 크기와 자리가 툭 바뀌지 않게, 그 차이를 카메라 값에 넘겨 부드럽게 잇습니다.
            E.cam.zoom.x *= before.fit / E.fit;
            E.cam.ox.x += (before.w - w) / 2;
            E.cam.oy.x += (before.h - h) / 2;
        }
        measureHome();
        reframe();
        renderer?.resize(w, h, dpr);
    };

    E.setMode = (mode) => {
        if (mode === E.mode) return;
        E.mode = mode;
        E.events.length = 0;
        E.beatAt = E.time + 0.9;
        // 새로 불러오기 시작하거나 빈 화면으로 돌아가면 처음 보던 각도로 되돌립니다. 끌어당기던 것도 놓습니다.
        if (mode !== 'live') {
            E.pullEnd(true);
            E.pluckEnd(true);
            E.charge = null;
            E.home();
        }
    };

    /* ───────── 밝힘·물러남 ───────── */

    // self: 지금 보고 있는 점(올렸거나 선택). 그다음은 관계 필터(relation) → 종류 필터(klass) → 묶음 필터(group) 순으로 봅니다.
    // 이어진 점과 선만 밝히고 나머지는 물립니다.
    function applyFocus() {
        const self = E.selfId ? E.byId.get(E.selfId) : null;
        let hot = null;
        if (self) {
            hot = new Set([self.id]);
            for (const line of self.links) {
                hot.add(line.a.id);
                hot.add(line.b.id);
            }
            // 매장까지 올라가는 길도 함께
            let up = self.parent;
            while (up) {
                hot.add(up.id);
                up = up.parent;
            }
        } else if (E.relation) {
            hot = new Set();
            for (const line of E.links) {
                if (line.rel !== E.relation) continue;
                hot.add(line.a.id);
                hot.add(line.b.id);
            }
        } else if (E.klass) {
            hot = new Set();
            // 같은 종류 이름이 여러 묶음에 있을 수 있으므로, 걸러 보는 묶음 안의 것만 밝힙니다.
            for (const p of E.list) if (p.level === 0 || (p.node.type === E.klass && (!E.group || p.group === E.group))) hot.add(p.id);
        } else if (E.group) {
            hot = new Set();
            for (const p of E.list) if (p.level === 0 || p.group === E.group) hot.add(p.id);
        }
        E.hotSet = hot;
        for (const p of E.list) {
            const on = hot ? hot.has(p.id) : false;
            p.tHot = on && (self ? true : p.level > 0) ? 1 : 0;
            p.tDim = hot && !on ? 1 : 0;
        }
        for (const line of E.links) {
            let on = false;
            if (self) on = line.a === self || line.b === self || (!line.cross && isAncestor(line.b, self));
            else if (E.relation) on = line.rel === E.relation;
            else if (hot) on = hot.has(line.a.id) && hot.has(line.b.id);
            line.tHot = on ? 1 : 0;
            line.tDim = hot && !on ? 1 : 0;
        }
        if (E.linkHotId) {
            // 인스펙터에서 '연결된 항목' 하나에 올렸을 때: 그 연결 하나만 남기고 나머지 연결은 물립니다.
            for (const line of E.links) {
                const pick = line.id === E.linkHotId;
                line.tHot = pick ? 1 : 0;
                line.tDim = pick ? 0 : 1;
            }
        }
        buildTags(self);
    }

    function isAncestor(a, self) {
        let up = self;
        while (up) {
            if (up === a) return true;
            up = up.parent;
        }
        return false;
    }

    // 관계 이름표: 고른 점에서 뻗은 연결을 관계별로 묶어, 묶음마다 대표 연결(가장 중요한 것) 위에 이름을 하나씩 답니다.
    // 이름은 살펴보기 카드의 묶음 제목과 같은 말을 씁니다(E.titleOf — PlaceGraph 가 card-model 의 함수를 넣어 줌).
    // 그 함수가 없으면: 이 점이 주어면 forward(없으면 label), 목적어면 inverse 를 씁니다. 구조 관계(quiet)에는 이름표를 달지 않습니다.
    function buildTags(self) {
        const groups = new Map();
        if (self) {
            for (const line of self.links) {
                const relation = E.relations[line.rel];
                if (!relation || relation.quiet) continue;
                const asSubject = line.subject === self;
                const phrase = (E.titleOf && E.titleOf(line.rel, asSubject)) || (asSubject || relation.symmetric ? relation.forward || relation.label : relation.inverse || relation.label);
                if (!phrase) continue;
                const group = groups.get(phrase);
                if (!group) groups.set(phrase, { phrase, count: 1, line });
                else {
                    group.count += 1;
                    if (line.strength > group.line.strength) group.line = line;
                }
            }
        }
        E.tagTotal = groups.size;
        const old = new Map(E.tags.map((tag) => [`${tag.line.id}|${tag.text}`, tag]));
        E.tags = [...groups.values()]
            .sort((x, y) => (y.line.cross ? 1 : 0) - (x.line.cross ? 1 : 0) || y.count - x.count)
            .slice(0, TAG_MAX)
            .map((group) => {
                const text = group.count > 1 ? `${group.phrase} ${group.count}` : group.phrase;
                return old.get(`${group.line.id}|${text}`) || { text, line: group.line, w: 0, h: 0, x: 0, y: 0, a: 0, on: false, spot: 0 };
            });
        E.onTags?.(E.tags);
    }

    E.setSelf = (id) => {
        const next = id && E.byId.has(id) ? id : null;
        if (next === E.selfId) return;
        E.selfId = next;
        E.focusAt = E.clock;
        applyFocus();
        E.beatLast = E.time + 0.1;
        if (next && !E.reduced && E.mode === 'live') radiate(E.byId.get(next));
    };

    E.setGroup = (group) => {
        if (group === E.group) return;
        E.group = group;
        E.focusAt = E.clock;
        applyFocus();
    };

    // 관계 필터: 그 관계의 연결만 밝힙니다(예: '근거가 됨'만 켜면 리뷰에서 키워드로 가는 길이 한 번에 드러남).
    E.setRelation = (rel) => {
        if (rel === E.relation) return;
        E.relation = rel;
        E.focusAt = E.clock;
        E.beatAt = E.time + 0.2;
        applyFocus();
    };

    // 종류 필터: 그 종류(클래스)의 개체만 밝힙니다.
    E.setKlass = (type) => {
        if (type === E.klass) return;
        E.klass = type;
        E.focusAt = E.clock;
        applyFocus();
    };

    E.setLinkHot = (id) => {
        if (id === E.linkHotId) return;
        E.linkHotId = id;
        applyFocus();
        const line = id ? E.links.find((item) => item.id === id) : null;
        if (line && !E.reduced) send(line, line.object, 1, 0, 9);
    };

    /* ───────── 신경 발화 ─────────
       신호는 언제나 주어에서 목적어로 흐릅니다(가지 연결 '소속'은 자식 → 부모). 그래서 신호가 가는 방향이 곧 관계의 방향입니다. */

    // 선 위로 신호 하나를 보냅니다. to: 도착할 점. 도착하면 그 점이 발화합니다.
    function send(line, to, strength, delay, depth) {
        const start = E.time + delay;
        // 끌어당겨 팽팽해진 연결에서는 신호가 더 빨리 지나갑니다.
        const taut = E.moving ? E.pull.tension[line.index] : 0;
        const duration = clamp(line.length / SIGNAL_SPEED, 0.26, 0.95) / (1 + 1.2 * taut);
        const slot = E.time > line.p1[0] + line.p1[1] * 1.5 || line.p1[1] === 0 ? line.p1 : line.p2;
        slot[0] = start;
        slot[1] = duration;
        slot[2] = (to === line.b ? 1 : -1) * clamp(strength, 0.2, 1);
        E.events.push({ at: start + duration, line, to, strength, depth });
    }

    // ring: 고리를 한 번 퍼뜨릴지. 사람이 고른 점과, 신호가 매장에 닿았을 때만 씁니다(닿을 때마다 고리가 뜨면 어지럽습니다).
    function flash(p, strength, ring) {
        p.fire = Math.max(p.fire, strength);
        if (ring) p.ringAt = E.time;
        // 묶음 점이 발화할 때만 그 엽의 껍질이 살짝 밝아집니다(항목마다 밝히면 껍질이 계속 번쩍입니다).
        if (p.lobe >= 0 && p.level === 1) E.glow[p.lobe] = Math.min(0.8, E.glow[p.lobe] + strength * 0.55);
    }

    function weighted(lines) {
        let total = 0;
        for (const line of lines) total += line.strength * line.strength + 0.02;
        let pick = Math.random() * total;
        for (const line of lines) {
            pick -= line.strength * line.strength + 0.02;
            if (pick <= 0) return line;
        }
        return lines[lines.length - 1];
    }

    // 고른 점: 나가는 관계는 이 점에서 상대로, 들어오는 관계는 상대에서 이 점으로 신호가 흐릅니다.
    function radiate(p) {
        flash(p, 1, true);
        p.links.forEach((line, i) => {
            if (line.a.shown < 0.9 || line.b.shown < 0.9) return;
            send(line, line.object, 0.8, 0.04 + Math.min(i, 12) * 0.025, 9);
        });
    }

    // 연쇄: p 가 주어인 관계를 따라 목적어로 번집니다. 의미 관계가 있으면 그중 하나로, 없으면 '소속'을 따라 위로 — 결국 매장에 모입니다.
    function fireFrom(p, strength, chain, cameBy, depth = 0) {
        flash(p, strength, chain && p.level === 0);
        if (!chain) return;
        const next = strength * 0.82;
        if (next < 0.2 || depth > 5) return;
        const out = p.links.filter((line) => line !== cameBy && line.subject === p && line.a.shown > 0.9 && line.b.shown > 0.9 && !line.tDim);
        if (!out.length) return;
        const crosses = out.filter((line) => line.cross);
        const trees = out.filter((line) => !line.cross);
        const pool = crosses.length && (Math.random() < 0.65 || !trees.length) ? crosses : trees;
        const line = weighted(pool);
        send(line, line.object, next, 0.05, depth + 1);
    }

    function tickSignals(dt) {
        const now = E.time;
        for (let i = E.events.length - 1; i >= 0; i -= 1) {
            const event = E.events[i];
            if (event.at > now) continue;
            E.events.splice(i, 1);
            fireFrom(event.to, event.strength, event.depth < 9, event.line, event.depth);
        }
        for (let i = 0; i < 8; i += 1) E.glow[i] *= Math.exp(-dt / 0.75);
        if (E.mode !== 'live' || E.reduced) return;
        // 점을 보고 있는 동안에는 그 점의 연결로 신호가 되풀이해 흐릅니다(주어 → 목적어). 그래서 관계의 방향이 계속 읽힙니다.
        if (E.selfId) {
            // 끌어당기는 동안에는 세게 당길수록 더 잦게 흐릅니다.
            const every = 1.7 / (1 + 2.2 * stretchNow());
            if (now >= E.beatLast + every) {
                E.beatLast = now;
                const self = E.byId.get(E.selfId);
                if (self) {
                    self.links.forEach((line, i) => {
                        if (line.a.shown > 0.9 && line.b.shown > 0.9 && !line.tDim) send(line, line.object, 0.62, Math.min(i, 14) * 0.03, 9);
                    });
                }
            }
            return;
        }
        // 1~2초마다 관계 하나에서 신호가 출발합니다(중요한 관계일수록 자주). 관계 필터 중에는 그 관계에서만 출발합니다.
        // 의미 관계가 없는 그래프(예전 데이터)는 끝 점에서 출발해 묶음을 거쳐 매장으로 모입니다.
        if (now >= E.beatAt && E.center && E.center.shown > 0.95) {
            E.beatAt = now + BEAT * (0.75 + Math.random() * 0.6);
            if (E.selfId || E.events.length > 9) return;
            const ready = (line) => line.a.shown > 0.95 && line.b.shown > 0.95 && !line.tDim;
            let starts = E.links.filter((line) => ready(line) && (E.relation ? line.rel === E.relation : line.cross));
            if (!starts.length) starts = E.links.filter((line) => ready(line) && !line.cross && line.b.kids.length === 0);
            if (!starts.length) return;
            const line = weighted(starts);
            flash(line.subject, 0.85, false);
            send(line, line.object, 0.85, 0.06, 1);
        }
    }

    E.ping = (id) => {
        const p = E.byId.get(id);
        if (!p) return;
        if (E.reduced) p.ringAt = -9;
        else radiate(p);
    };

    /* ───────── 끌어당기기 ─────────
       점을 잡아 끌면 이어진 점들이 함께 당겨지고(연결이 셀수록 많이), 놓으면 한 번 튕기며 제자리로 돌아갑니다.
       밝혀진 연결은 줄처럼 잡아 튕길 수 있습니다. 계산은 pull.js 가 하고, 여기서는 화면 좌표와 이어 줍니다. */

    const Q = [0, 0, 0];
    const Q2 = [0, 0, 0];
    const NONE = new Float32Array(3);
    // 시범(점 하나가 저절로 한 번 당겨졌다 돌아감)을 이미 보여 준 매장. 같은 매장을 다시 열어도 되풀이하지 않습니다.
    const shownDemo = createEngine.shownDemo || (createEngine.shownDemo = new Set());

    // 화면 자리 → 장면 속 자리(project 의 역). depth: 카메라에서 본 깊이(project 가 돌려주는 세 번째 값)
    E.unproject = (sx, sy, depth, out) => {
        const r = E.rot;
        const cam = E.cam;
        const k = DIST / Math.max(0.4, DIST - depth);
        const px = (sx - E.view.cx) / (E.view.scale * k);
        const py = -(sy - E.view.cy) / (E.view.scale * k);
        out[0] = r[0] * px + r[3] * py + r[6] * depth + cam.tx.x;
        out[1] = r[1] * px + r[4] * py + r[7] * depth + cam.ty.x;
        out[2] = r[2] * px + r[5] * py + r[8] * depth + cam.tz.x;
        return out;
    };

    // 끌려간 만큼 옮긴 선 위의 점(셰이더 RIBBON_VS 의 bez 와 같은 식). t: 0(a 쪽) ~ 1(b 쪽)
    function curveAt(line, t, out) {
        const { a, b } = line;
        const taut = E.moving ? 0.55 * Math.min(1, E.pull.tension[line.index]) : 0;
        const bow = E.moving ? E.pull.bow : NONE;
        const o = E.moving ? line.index * 3 : 0;
        const m = 1 - t;
        for (let c = 0; c < 3; c += 1) {
            const base = line.bend[c] + 0.5 * (a.pos[c] - a.at[c] + b.pos[c] - b.at[c]);
            const mid = 0.5 * (a.pos[c] + b.pos[c]);
            const ctrl = base + (mid - base) * taut + 2 * bow[o + c];
            out[c] = m * m * a.pos[c] + 2 * m * t * ctrl + t * t * b.pos[c];
        }
        return out;
    }

    // 지금 얼마나 당기고 있는지(0~1)
    function stretchNow() {
        const g = E.grab;
        if (!g || !E.moving) return 0;
        const p = g.p;
        return clamp(Math.hypot(p.pos[0] - p.at[0], p.pos[1] - p.at[1], p.pos[2] - p.at[2]) / g.reach, 0, 1);
    }

    // 물리를 깨우기 전에: 움직임 줄이기 설정을 넘기고, '멈춘 것으로 볼 크기'를 화면 0.25px 에 맞춥니다.
    function readyPull() {
        E.pull.calm = E.reduced;
        E.pull.opt.rest = 0.25 / Math.max(60, E.view.scale);
    }

    // 점 잡기. (x, y): 캔버스 안의 포인터 자리.
    // how.touch: 손가락으로 잡음(손가락에 가리지 않게 점을 위로 빼냄). how.auto: 시범(사람이 잡은 것이 아님)
    E.pullStart = (id, x, y, how) => {
        const p = E.byId.get(id);
        if (!p || E.mode !== 'live' || p.ghost) return false;
        if (E.auto && !(how && how.auto)) E.pullEnd(true);
        if (E.string) E.pluckEnd(true);
        if (E.grab) E.pullEnd(true);
        const touch = Boolean(how && how.touch);
        // 당길 수 있는 거리: 120px 과 무대 짧은 변의 25% 가운데 작은 쪽. 그보다 멀리 끌면 그 자리에서 버팁니다.
        const reachPx = Math.min(120, 0.25 * Math.min(E.w, E.h));
        E.project(p.pos, P);
        // 손가락으로 잡으면 점을 손가락 위 50px 로 빼냅니다. 무대 맨 위에서는 옆으로 뺍니다.
        let lx = 0;
        let ly = 0;
        if (touch) {
            if (y - 50 < E.safe[1] + 20) lx = x < E.w / 2 ? 50 : -50;
            else ly = -50;
        }
        E.grab = {
            p, x, y, touch, reachPx,
            // 잡은 순간에는 점이 있던 자리 그대로(튀지 않게), 곧 포인터 바로 밑(또는 빼낸 자리)으로 붙습니다.
            ox: P[0] - x, oy: P[1] - y, lx, ly,
            depth: P[2], reach: reachPx / E.view.scale, hadLabel: p.lab.on, at: E.clock,
        };
        readyPull();
        E.pull.grab(p.index);
        E.bulge = p.index;
        E.cam.spin = 0;
        return true;
    };

    E.pullMove = (x, y) => {
        if (!E.grab) return;
        E.grab.x = x;
        E.grab.y = y;
    };

    // 놓기. cancel: 손을 뗀 것이 아니라 끊긴 경우(Esc·무대 밖·스크롤로 넘어감) — 돌아가되 신호는 터뜨리지 않습니다.
    // pin: 놓은 자리에 그 점만 남깁니다(Shift 를 누른 채 놓음).
    E.pullEnd = (cancel, pin) => {
        const grab = E.grab;
        if (!grab) return null;
        E.grab = null;
        E.auto = null;
        const info = E.pull.release(Boolean(pin) && !cancel);
        if (!info) return null;
        info.stretch = clamp(info.far / grab.reach, 0, 1);
        info.id = grab.p.id;
        E.pins = E.list.filter((p) => E.pull.isPinned(p.index));
        E.lastPull = { p: grab.p, at: E.clock, touch: grab.touch, hadLabel: grab.hadLabel };
        if (!cancel && !E.reduced && info.stretch > 0.08) {
            // 놓는 순간 그 점에서 관계 방향(주어 → 목적어)으로 신호가 한 번 터집니다.
            const p = grab.p;
            flash(p, 0.6 + 0.4 * info.stretch, true);
            p.links.forEach((line, i) => {
                if (line.a.shown > 0.9 && line.b.shown > 0.9) send(line, line.object, 0.4 + 0.55 * info.stretch, Math.min(i, 12) * 0.02, 9);
            });
            E.beatLast = E.time;
        }
        return info;
    };

    // 고정해 둔 점을 모두 풉니다(탄성으로 돌아감).
    E.unpinAll = () => {
        if (!E.pull.unpinAll()) return 0;
        const freed = E.pins.length;
        E.pins = [];
        readyPull();
        return freed;
    };

    // 밝혀진 연결(올렸거나 고른 점의 연결, 관계 필터로 켠 연결) 가운데 포인터에 가장 가까운 것.
    // 전체 보기의 옅은 연결은 너무 촘촘해서 잡지 않습니다.
    E.pickLink = (x, y, reach) => {
        if (!E.hotSet || E.mode !== 'live') return null;
        let best = null;
        let nearest = reach;
        for (const line of E.links) {
            if (!line.tHot || line.shown < 0.9) continue;
            let px = 0;
            let py = 0;
            for (let s = 0; s <= 12; s += 1) {
                curveAt(line, s / 12, Q);
                E.project(Q, P);
                if (s > 0) {
                    const vx = P[0] - px;
                    const vy = P[1] - py;
                    const along = clamp(((x - px) * vx + (y - py) * vy) / (vx * vx + vy * vy || 1), 0, 1);
                    const cx = px + vx * along;
                    const cy = py + vy * along;
                    const d = Math.hypot(x - cx, y - cy);
                    // 양끝 12px 안쪽은 점의 자리로 남겨 둡니다(점을 잡으려다 줄이 잡히지 않게).
                    if (d < nearest && Math.hypot(cx - line.a.sx, cy - line.a.sy) > 12 && Math.hypot(cx - line.b.sx, cy - line.b.sy) > 12) {
                        nearest = d;
                        best = line;
                    }
                }
                px = P[0];
                py = P[1];
            }
        }
        return best;
    };

    // 줄 잡기: 연결의 가운데를 포인터가 움직인 만큼 당깁니다.
    E.pluckStart = (line, x, y) => {
        if (!line || E.mode !== 'live') return false;
        if (E.grab) E.pullEnd(true);
        if (E.string) E.pluckEnd(true);
        curveAt(line, 0.5, Q);
        E.project(Q, P);
        const o = line.index * 3;
        const bow = E.pull.bow;
        E.string = { line, x, y, x0: x, y0: y, depth: P[2], base: [bow[o], bow[o + 1], bow[o + 2]] };
        readyPull();
        E.pull.pluck(line.index);
        E.cam.spin = 0;
        return true;
    };

    E.pluckMove = (x, y) => {
        if (!E.string) return;
        E.string.x = x;
        E.string.y = y;
    };

    E.pluckEnd = (cancel) => {
        const string = E.string;
        if (!string) return null;
        E.string = null;
        const info = E.pull.unpluck();
        if (info && !cancel && !E.reduced && info.stretch > 0.1) {
            // 줄 가운데에서 양끝으로 신호가 갈라져 갑니다.
            const { line } = string;
            const duration = clamp(line.length / SIGNAL_SPEED, 0.26, 0.95) * 0.8;
            const power = clamp(0.45 + 0.5 * info.stretch, 0.2, 1);
            line.p1[0] = E.time - duration / 2;
            line.p1[1] = duration;
            line.p1[2] = power;
            line.p2[0] = E.time - duration / 2;
            line.p2[1] = duration;
            line.p2[2] = -power;
            E.events.push({ at: E.time + duration / 2, line, to: line.a, strength: power * 0.8, depth: 9 });
            E.events.push({ at: E.time + duration / 2, line, to: line.b, strength: power * 0.8, depth: 9 });
        }
        return info;
    };

    // 길게 누르는 동안의 예고: 그 점 둘레의 고리가 ms 동안 차오릅니다. id 가 없으면 지웁니다.
    E.setCharge = (id, ms) => {
        E.charge = id && E.byId.has(id) ? { id, t0: performance.now(), ms: ms || 260 } : null;
    };

    // 키보드 화살표가 갈 곳이 없을 때의 반응: 점이 그 방향(화면 기준 dx·dy)으로 살짝 밀렸다 돌아옵니다.
    E.bump = (id, dx, dy) => {
        const p = E.byId.get(id);
        if (!p || E.mode !== 'live' || p.ghost || E.reduced || E.grab) return;
        const r = E.rot;
        const push = 0.75;
        readyPull();
        E.pull.kick(p.index, (r[0] * dx - r[3] * dy) * push, (r[1] * dx - r[4] * dy) * push, (r[2] * dx - r[5] * dy) * push);
        E.bulge = p.index;
    };

    // 시범: 그래프가 처음 자리 잡으면 점 하나가 저절로 한 번 당겨졌다 돌아갑니다("이 점들은 당겨진다"를 보여 줌).
    // 매장당 한 번, 움직임 줄이기에서는 하지 않고, 사람이 무대에 손을 대고 있으면 미룹니다.
    function tryDemo() {
        const key = E.center ? `${E.center.node.full || E.center.node.label || E.center.id}` : '';
        if (!key || shownDemo.has(key) || E.reduced || E.mode !== 'live' || E.grab || E.pointerOn) return;
        if (E.appear < 1 || E.selfId || E.selectedId || E.group || E.klass || E.relation || E.focusId || E.cam.moved) return;
        let best = null;
        let top = -Infinity;
        for (const p of E.list) {
            if (p.level < 2 || p.ghost || p.shown < 0.97 || p.front < 0.62) continue;
            if (p.sx < E.safe[0] + 90 || p.sx > E.safe[2] - 90 || p.sy < E.safe[1] + 70 || p.sy > E.safe[3] - 70) continue;
            const cross = p.links.filter((line) => line.cross).length;
            const score = Math.min(cross, 6) + (p.node.spot ? 6 - Math.min(p.node.spot, 6) * 0.5 : 0) + (p.lab.on ? 3 : 0) + p.front * 2;
            if (cross > 0 && score > top) {
                top = score;
                best = p;
            }
        }
        if (!best) return;
        shownDemo.add(key);
        // 매장에서 멀어지는 방향으로 당깁니다.
        const cx = E.center ? E.center.sx : E.w / 2;
        const cy = E.center ? E.center.sy : E.h / 2;
        const far = Math.hypot(best.sx - cx, best.sy - cy) || 1;
        if (!E.pullStart(best.id, best.sx, best.sy, { auto: true })) return;
        E.auto = { x0: best.sx, y0: best.sy, dx: (best.sx - cx) / far, dy: (best.sy - cy) / far, at: E.clock };
    }

    // 한 프레임치 끌어당기기: 손의 자리를 장면 좌표로 바꿔 넘기고, 점·선이 움직인 만큼을 그릴 값에 옮깁니다.
    function stepPull(real) {
        const pull = E.pull;
        if (E.auto && E.grab) {
            // 시범: 0.42초 동안 46px 당겼다가 잠깐 머물고 놓습니다.
            const t = E.clock - E.auto.at;
            const s = clamp(t / 0.42, 0, 1);
            const eased = s * s * (3 - 2 * s);
            E.grab.x = E.auto.x0 + E.auto.dx * 46 * eased;
            E.grab.y = E.auto.y0 + E.auto.dy * 46 * eased;
            if (t > 0.6 || E.pointerOn) E.pullEnd(E.pointerOn);
        }
        if (E.grab) {
            const g = E.grab;
            // 잡은 자리와 점 중심의 어긋남은 0.05초 만에 사라집니다(점이 포인터에 붙음). 손가락이면 빼낸 자리로 갑니다.
            const stick = 1 - Math.exp(-real / 0.05);
            g.ox += (g.lx - g.ox) * stick;
            g.oy += (g.ly - g.oy) * stick;
            let tx = g.x + g.ox;
            let ty = g.y + g.oy;
            // 제자리에서 reachPx 의 85% 까지는 포인터에 붙어 다니고, 그 뒤로는 뚝 멈추지 않고 당길수록 조금씩만 더 늘어납니다
            // (고무줄처럼 점점 뻑뻑해짐. 두 배를 당겨도 한계의 1.2배쯤).
            E.project(g.p.at, P);
            const dx = tx - P[0];
            const dy = ty - P[1];
            const far = Math.hypot(dx, dy);
            const knee = g.reachPx * 0.85;
            if (far > knee) {
                const give = g.reachPx * 0.2;
                const soft = knee + give * Math.log(1 + (far - knee) / give);
                tx = P[0] + (dx * soft) / far;
                ty = P[1] + (dy * soft) / far;
            }
            // 카드·띠·버튼이 덮은 곳으로는 들어가지 않습니다.
            tx = clamp(tx, E.safe[0] + 10, E.safe[2] - 10);
            ty = clamp(ty, E.safe[1] + 10, E.safe[3] - 10);
            g.tx = tx;
            g.ty = ty;
            // 잡은 순간의 깊이를 지킨 채 화면 평면 위에서만 움직입니다.
            E.unproject(tx, ty, g.depth, Q);
            pull.moveTo(Q[0], Q[1], Q[2]);
        }
        if (E.string) {
            const s = E.string;
            E.unproject(s.x, s.y, s.depth, Q);
            E.unproject(s.x0, s.y0, s.depth, Q2);
            pull.pluckTo(s.base[0] + Q[0] - Q2[0], s.base[1] + Q[1] - Q2[1], s.base[2] + Q[2] - Q2[2]);
        }
        const was = E.moving;
        E.moving = pull.awake ? pull.step(real) : false;
        // 멈춘 첫 프레임에도 한 번 더 옮겨서 모두 제자리(고정된 점은 그 자리)로 맞춥니다.
        E.moved = E.moving || was;
        if (!E.moved) return;
        const off = pull.offset;
        for (const p of E.list) {
            const o = p.index * 3;
            p.pos[0] = p.at[0] + off[o];
            p.pos[1] = p.at[1] + off[o + 1];
            p.pos[2] = p.at[2] + off[o + 2];
        }
        const move = E.moveData;
        const bow = pull.bow;
        const first = E.fiberCount;
        for (let i = 0; i < E.links.length; i += 1) {
            const line = E.links[i];
            const o = (first + i) * LINK_MOVE;
            const a = line.a.index * 3;
            const b = line.b.index * 3;
            move[o] = off[a];
            move[o + 1] = off[a + 1];
            move[o + 2] = off[a + 2];
            move[o + 3] = off[b];
            move[o + 4] = off[b + 1];
            move[o + 5] = off[b + 2];
            move[o + 6] = bow[i * 3];
            move[o + 7] = bow[i * 3 + 1];
            move[o + 8] = bow[i * 3 + 2];
        }
    }

    /* ───────── 카메라 ─────────
       무대에서 카드·시트·버튼이 덮지 않는 영역(E.safe)을 PlaceGraph 가 알려 줍니다.
       점을 고르거나 묶음·종류·관계를 걸러 보면, 밝아진 점들이 그 영역 안에 들어오도록 확대와 화면 이동을 맞춥니다.
       돌리는 것은 꼭 필요한 만큼만 합니다(옆모습이 유지되고, 눈이 따라갈 수 있게). */

    // 점(또는 자리)이 화면 앞쪽을 향하도록 돌릴 각도. cone: 정면에서 이만큼 벗어나는 것까지는 그대로 둡니다.
    // most: 한 번에 이보다 많이 돌리지 않습니다.
    function faceTo(at, cone, most) {
        const x = at[0];
        const z = at[2];
        if (Math.hypot(x, z) < 0.08) return E.cam.yaw.to;
        // 저절로 돌던 만큼(멈춘 자리의 각도)을 더한 것이 실제로 보이는 각도입니다.
        const drift = E.swayAmp * Math.sin(E.cam.phase);
        const seen = E.cam.yaw.to + drift;
        const facing = nearAngle(seen, Math.atan2(-x, z));
        const off = facing - seen;
        if (Math.abs(off) <= cone) return E.cam.yaw.to;
        const turn = off - Math.sign(off) * cone;
        return E.cam.yaw.to + (most ? clamp(turn, -most, most) : turn);
    }

    const R2 = new Float32Array(9);

    // 점들의 상자가 E.safe 의 fill 비율을 차지하도록 확대(least~most)와 화면 이동을 정합니다.
    // 카메라가 가 있을 각도(yaw.to·pitch.to)를 기준으로 계산합니다. 여기서는 돌리지 않습니다.
    function fitTo(points, fill, least, most) {
        if (!points.length || !E.w) return;
        const cam = E.cam;
        const yaw = cam.yaw.to + E.swayAmp * Math.sin(cam.phase);
        const cy = Math.cos(yaw);
        const sy = Math.sin(yaw);
        const cp = Math.cos(cam.pitch.to);
        const sp = Math.sin(cam.pitch.to);
        R2.set([cy, 0, sy, sp * sy, cp, -sp * cy, -cp * sy, sp, cp * cy]);
        let x0 = Infinity;
        let x1 = -Infinity;
        let y0 = Infinity;
        let y1 = -Infinity;
        for (const p of points) {
            const x = p.at[0] - cam.tx.to;
            const y = p.at[1] - cam.ty.to;
            const z = p.at[2] - cam.tz.to;
            const k = DIST / Math.max(0.4, DIST - (R2[6] * x + R2[7] * y + R2[8] * z));
            const px = (R2[0] * x + R2[1] * y + R2[2] * z) * k;
            const py = (R2[3] * x + R2[4] * y + R2[5] * z) * k;
            if (px < x0) x0 = px;
            if (px > x1) x1 = px;
            if (py < y0) y0 = py;
            if (py > y1) y1 = py;
        }
        const safe = E.safe;
        const sw = Math.max(80, safe[2] - safe[0]);
        const sh = Math.max(80, safe[3] - safe[1]);
        // 점이 한두 개뿐이어도 지나치게 당겨 보지 않도록 상자에 최소 크기를 둡니다.
        const zoom = clamp(Math.min((fill * sw) / (Math.max(x1 - x0, 0.3) * E.fit), (fill * sh) / (Math.max(y1 - y0, 0.24) * E.fit)), least, most);
        const scale = E.fit * zoom;
        cam.zoom.to = zoom;
        cam.ox.to = (safe[0] + safe[2]) / 2 - E.w / 2 - ((x0 + x1) / 2) * scale;
        cam.oy.to = (safe[1] + safe[3]) / 2 - E.h / 2 + ((y0 + y1) / 2) * scale;
    }

    // 지금 보고 있는 것(고른 점 / 걸러 본 점들)에 맞춰 확대·이동을 다시 잡습니다.
    function reframe() {
        const view = E.framing;
        if (!view) return;
        if (view.kind === 'node') {
            const p = E.byId.get(view.id);
            if (!p) return;
            const points = [p];
            for (const line of p.links) points.push(line.a === p ? line.b : line.a);
            // 이웃이 멀리 흩어져 있으면 전체가 다 보이는 배율로, 가까이 모여 있으면 조금 당겨 봅니다.
            fitTo(points, 0.7, E.homeZoom, p.level === 0 ? E.homeZoom : Math.max(E.homeZoom, 1.6));
            // 고른 점은 어떤 경우에도 가려지지 않는 영역 안에 있어야 합니다.
            keepInside(p, 34);
            return;
        }
        // 걸러 본 점들: 올려 둔 점과 상관없이, 걸러 본 기준(연결 종류 → 항목 종류 → 묶음)으로 고릅니다.
        let lit = [];
        if (view.relation) {
            const seen = new Set();
            for (const line of E.links) {
                if (line.rel !== view.relation) continue;
                seen.add(line.a);
                seen.add(line.b);
            }
            lit = [...seen];
        } else if (view.klass) {
            lit = E.list.filter((p) => p.node.type === view.klass && (!view.group || p.group === view.group));
        } else if (view.group) {
            lit = E.list.filter((p) => p.group === view.group);
        }
        // 밝아진 점들의 상자가 가려지지 않는 영역의 3분의 2쯤을 차지하게(이름표가 놓일 여백을 남김). 상한은 2.6배.
        // 폰처럼 좁은 무대에서는 여백을 덜 남기고 더 크게 봅니다(이름표가 놓일 자리를 벌리려고).
        if (!lit.length) return;
        fitTo(lit, E.tall ? 0.84 : 0.66, Math.min(E.homeZoom, 1), ZOOM_MAX);
        // 묶음·종류를 걸러 볼 때는 매장 점도 밝은 채로 남습니다. 그 점이 무대 밖이나 단추 밑으로 가면 매장까지 넣어 다시 맞춥니다.
        const store = E.center;
        if (store && !view.relation && !lit.includes(store)) {
            whereAtTarget(store, P);
            const safe = E.safe;
            if (P[0] < safe[0] + 18 || P[0] > safe[2] - 18 || P[1] < safe[1] + 18 || P[1] > safe[3] - 18) {
                fitTo([...lit, store], E.tall ? 0.9 : 0.8, Math.min(E.homeZoom, 1), ZOOM_MAX);
            }
        }
    }

    // 카메라가 가 있을 자리(목표값)에서 이 점이 화면 어디에 놓이는지. out = [x, y]
    function whereAtTarget(p, out) {
        const cam = E.cam;
        const yaw = cam.yaw.to + E.swayAmp * Math.sin(cam.phase);
        const cy = Math.cos(yaw);
        const sy = Math.sin(yaw);
        const cp = Math.cos(cam.pitch.to);
        const sp = Math.sin(cam.pitch.to);
        const x = p.at[0] - cam.tx.to;
        const y = p.at[1] - cam.ty.to;
        const z = p.at[2] - cam.tz.to;
        const k = DIST / Math.max(0.4, DIST - (-cp * sy * x + sp * y + cp * cy * z));
        const scale = E.fit * cam.zoom.to;
        out[0] = E.w / 2 + cam.ox.to + (cy * x + sy * z) * k * scale;
        out[1] = E.h / 2 + cam.oy.to - (sp * sy * x + cp * y - sp * cy * z) * k * scale;
        return out;
    }

    // 저절로 돌던 만큼을 보는 각도에 넘기고 흔들림을 0 으로 되돌립니다(보이는 것은 그대로).
    // 걸러 보기는 늘 같은 각도에서 보게 되어, 같은 묶음이면 이름표가 놓이는 자리도 매번 같습니다.
    function absorbSway() {
        const cam = E.cam;
        const drift = E.swayAmp * Math.sin(cam.phase);
        if (!drift) return;
        cam.yaw.x += drift;
        cam.phase = 0;
    }

    // 점 하나가 E.safe 안쪽(가장자리에서 margin 이상)에 오도록 화면 이동만 고칩니다.
    function keepInside(p, margin) {
        const cam = E.cam;
        const yaw = cam.yaw.to + E.swayAmp * Math.sin(cam.phase);
        const cy = Math.cos(yaw);
        const sy = Math.sin(yaw);
        const cp = Math.cos(cam.pitch.to);
        const sp = Math.sin(cam.pitch.to);
        const x = p.at[0] - cam.tx.to;
        const y = p.at[1] - cam.ty.to;
        const z = p.at[2] - cam.tz.to;
        const k = DIST / Math.max(0.4, DIST - (-cp * sy * x + sp * y + cp * cy * z));
        const scale = E.fit * cam.zoom.to;
        const sx = E.w / 2 + cam.ox.to + (cy * x + sy * z) * k * scale;
        const syy = E.h / 2 + cam.oy.to - (sp * sy * x + cp * y - sp * cy * z) * k * scale;
        const safe = E.safe;
        const mx = Math.min(margin, (safe[2] - safe[0]) / 2 - 1);
        const my = Math.min(margin, (safe[3] - safe[1]) / 2 - 1);
        cam.ox.to += clamp(sx, safe[0] + mx, safe[2] - mx) - sx;
        cam.oy.to += clamp(syy, safe[1] + my, safe[3] - my) - syy;
    }

    // 가려지지 않는 영역이 바뀌면(카드가 열림·닫힘, 시트가 접힘, 띠가 뜸) 보던 것을 다시 맞춥니다.
    E.setSafe = (x0, y0, x1, y1) => {
        const safe = E.safe;
        if (Math.abs(safe[0] - x0) < 1 && Math.abs(safe[1] - y0) < 1 && Math.abs(safe[2] - x1) < 1 && Math.abs(safe[3] - y1) < 1) return;
        E.safe = [x0, y0, x1, y1];
        // 끌어당기는 중에는 장면을 움직이지 않습니다(놓은 뒤에 맞춥니다).
        if (E.grab || E.string) E.refitAt = E.time;
        else if (E.framing) reframe();
        else {
            // 쉬는 화면: 바뀐 영역의 가운데로 옮기고, 그 넓이에 맞는 처음 배율을 다시 잽니다.
            measureHome();
            E.cam.ox.to = restX();
            E.cam.oy.to = restY();
            if (!E.last) {
                E.cam.ox.x = E.cam.ox.to;
                E.cam.oy.x = E.cam.oy.to;
            }
        }
    };

    // 점을 골랐을 때: 그 점과 이웃이 보이는 자리로.
    E.lookAt = (id) => {
        const p = id ? E.byId.get(id) : null;
        const cam = E.cam;
        if (!p) return;
        // 뒤쪽에 있던 점만 앞으로 돌려 옵니다. 한 번에 40°(0.7rad)까지만 돌리고, 나머지는 확대와 이동으로 맞춥니다.
        if (p.level !== 0) cam.yaw.to = faceTo(p.at, 0.82, 0.7);
        cam.pitch.to = clamp(0.16 + p.at[1] * 0.3, -0.05, 0.5);
        cam.spin = 0;
        cam.moved = true;
        E.framing = { kind: 'node', id };
        reframe();
    };

    // 묶음을 걸러 볼 때: 그 엽이 보이는 쪽으로 돌리고, 밝아진 점들을 화면에 채웁니다.
    E.lookAtGroup = (group) => {
        const cam = E.cam;
        if (!E.list.some((p) => p.group === group)) return;
        absorbSway();
        E.arriving = true;
        const lobe = LOBES[lobeOf(group)];
        // 엽은 좌우 양쪽에 걸쳐 있으므로, 지금 보는 쪽 반구의 엽 중심을 바라봅니다.
        const side = Math.sin(cam.yaw.to) > 0 ? -1 : 1;
        cam.yaw.to = faceTo([lobe.c[0] * side, lobe.c[1], lobe.c[2]], 0.42, 1.1);
        cam.pitch.to = clamp(0.16 + lobe.c[1] * 0.3, -0.05, 0.5);
        cam.spin = 0;
        cam.moved = true;
        E.framing = { kind: 'lit', group };
        reframe();
    };

    // 종류·연결 종류를 걸러 볼 때: 돌리지 않고, 밝아진 점들을 화면에 채웁니다. view: { relation } 또는 { klass }
    E.lookAtLit = (view) => {
        absorbSway();
        E.arriving = true;
        E.cam.spin = 0;
        E.cam.moved = true;
        E.framing = { kind: 'lit', ...view };
        reframe();
    };

    // 바깥(본문 카드·키보드)에서 가리킨 점이 뒤쪽에 있으면 보이는 쪽으로 천천히 돌려 줍니다(당겨 보지는 않음).
    E.turnTo = (id) => {
        const p = id ? E.byId.get(id) : null;
        if (!p || p.level === 0 || E.cam.held) return;
        E.cam.yaw.to = faceTo(p.at, 1.05, 1.1);
        E.cam.spin = 0;
    };

    // 살펴보기를 마쳤을 때: 보는 방향은 그대로 두고 당겨 본 것만 풉니다.
    E.release = () => {
        const cam = E.cam;
        E.framing = null;
        cam.zoom.to = Math.min(cam.zoom.to, E.homeZoom);
        cam.ox.to = restX();
        cam.oy.to = restY();
    };

    // 쉬는 화면에서 뇌를 둘 자리: 단추 줄·시트가 덮지 않는 영역의 한가운데(무대 가운데에서 벗어난 만큼)
    function restX() {
        return (E.safe[0] + E.safe[2]) / 2 - E.w / 2;
    }

    function restY() {
        return (E.safe[1] + E.safe[3]) / 2 - E.h / 2;
    }

    E.home = () => {
        const cam = E.cam;
        cam.yaw.to = nearAngle(cam.yaw.x, E.homeYaw);
        cam.pitch.to = HOME.pitch;
        cam.zoom.to = E.homeZoom;
        E.framing = null;
        cam.ox.to = restX();
        cam.oy.to = restY();
        cam.spin = 0;
        cam.moved = false;
        cam.restAt = 0;
        // 고정해 둔 점도 모두 제자리로 돌려보냅니다.
        E.unpinAll();
    };

    E.zoomBy = (factor) => {
        const cam = E.cam;
        cam.zoom.to = clamp(cam.zoom.to * factor, ZOOM_MIN, ZOOM_MAX);
        cam.moved = true;
    };

    // 폰처럼 좁은 무대에서는 처음부터 조금 당겨 보아 점들이 퍼져 보이게 합니다(뇌 껍질의 양옆은 잘려도 점은 다 들어오게).
    function measureHome() {
        const zoom = homeZoomOf(E.list);
        if (Math.abs(zoom - E.homeZoom) < 0.01) return;
        const atHome = !E.cam.moved && !E.framing;
        E.homeZoom = zoom;
        if (atHome) {
            E.cam.zoom.to = zoom;
            if (!E.last) E.cam.zoom.x = zoom;
        }
    }

    // 이 점들을 처음 자세에서 볼 때의 배율(넓은 화면은 1, 세로로 긴 화면은 점 구름이 무대를 채우도록 1~1.3)
    function homeZoomOf(list) {
        let zoom = 1;
        const points = list.filter((p) => p.level > 0 && !p.pending);
        if (E.tall && E.w && points.length > 3) {
            const cy = Math.cos(E.homeYaw);
            const sy = Math.sin(E.homeYaw);
            const cp = Math.cos(HOME.pitch);
            const sp = Math.sin(HOME.pitch);
            let x0 = Infinity;
            let x1 = -Infinity;
            let y0 = Infinity;
            let y1 = -Infinity;
            for (const p of points) {
                const x = p.at[0] - HOME.target[0];
                const y = p.at[1] - HOME.target[1];
                const z = p.at[2] - HOME.target[2];
                const k = DIST / Math.max(0.4, DIST - (-cp * sy * x + sp * y + cp * cy * z));
                const px = (cy * x + sy * z) * k;
                const py = (sp * sy * x + cp * y - sp * cy * z) * k;
                if (px < x0) x0 = px;
                if (px > x1) x1 = px;
                if (py < y0) y0 = py;
                if (py > y1) y1 = py;
            }
            // 점 구름이 (단추 줄을 뺀) 무대 폭의 90%, 높이의 92% 를 넘지 않는 한도에서 크게. 뇌의 윤곽이 남도록 1.3배까지만.
            const roomW = E.safe[2] - E.safe[0] > 80 ? E.safe[2] - E.safe[0] : E.w;
            const roomH = E.safe[3] - E.safe[1] > 80 ? E.safe[3] - E.safe[1] : E.h;
            zoom = clamp(Math.min((0.9 * roomW) / ((x1 - x0) * E.fit), (0.92 * roomH) / ((y1 - y0) * E.fit)), 1, 1.3);
        }
        return zoom;
    }

    // 끌어서 돌리기: 끄는 동안은 손을 그대로 따라가고, 놓으면 돌던 힘이 남아 서서히 멈춥니다.
    E.dragStart = () => {
        const cam = E.cam;
        cam.held = true;
        cam.spin = 0;
        cam.yaw.to = cam.yaw.x;
        cam.yaw.v = 0;
        cam.pitch.to = cam.pitch.x;
        cam.pitch.v = 0;
    };

    E.dragMove = (dx, dy, dt) => {
        const cam = E.cam;
        const turn = dx * 0.0055;
        cam.yaw.x += turn;
        cam.yaw.to = cam.yaw.x;
        cam.pitch.x = clamp(cam.pitch.x + dy * 0.004, -0.75, 0.95);
        cam.pitch.to = cam.pitch.x;
        if (dt > 0) cam.spin = cam.spin * 0.6 + (turn / dt) * 0.4;
        cam.moved = true;
    };

    // still: 돌던 힘을 남기지 않고 그 자리에 세웁니다.
    E.dragEnd = (still) => {
        const cam = E.cam;
        cam.held = false;
        cam.spin = E.reduced || still ? 0 : clamp(cam.spin, -3, 3);
        cam.restAt = E.time + 2.4;
        // 고른 점·걸러 본 점들이 돌린 뒤 카드나 띠 밑으로 들어갔으면, 회전이 잦아든 뒤 다시 맞춥니다.
        if (E.framing) E.refitAt = E.time + 0.15;
    };

    function tickCamera(dt) {
        const cam = E.cam;
        if (E.refitAt !== null && !cam.held && !E.grab && !E.string && E.time >= E.refitAt && Math.abs(cam.spin) < 0.25) {
            E.refitAt = null;
            cam.spin = 0;
            cam.yaw.to = cam.yaw.x;
            reframe();
        }
        if (E.reduced) {
            for (const key of ['yaw', 'pitch', 'zoom', 'tx', 'ty', 'tz', 'ox', 'oy']) {
                cam[key].x = cam[key].to;
                cam[key].v = 0;
            }
            cam.sway = 0;
            return;
        }
        if (!cam.held) {
            if (Math.abs(cam.spin) > 0.002) {
                cam.yaw.x += cam.spin * dt;
                cam.yaw.to = cam.yaw.x;
                cam.spin *= Math.exp(-dt * 4.2);
            } else {
                spring(cam.yaw, 5.2, dt);
            }
            spring(cam.pitch, 5.2, dt);
        }
        spring(cam.zoom, 6.5, dt);
        spring(cam.tx, 5.6, dt);
        spring(cam.ty, 5.6, dt);
        spring(cam.tz, 5.6, dt);
        spring(cam.ox, 6, dt);
        spring(cam.oy, 6, dt);
        // 무언가를 보고 있거나, 손으로 돌리거나, 포인터·손가락이 무대 위에 있는 동안에는 저절로 도는 움직임을 멈춥니다
        // (겨누는 동안 표적이 움직이지 않게).
        const busy = cam.held || E.pointerOn || E.grab || E.string || E.moving || E.selfId || E.selectedId || E.group || E.klass || E.relation || E.focusId || E.peekId
            || E.time < cam.restAt || E.mode === 'loading';
        cam.swayTo = busy ? 0 : 1;
        cam.sway += (cam.swayTo - cam.sway) * (1 - Math.exp(-dt / (busy ? 0.22 : 1.4)));
        cam.phase += dt * cam.sway * (TAU / SWAY_PERIOD);
    }

    function updateView() {
        const cam = E.cam;
        // 저절로 도는 각도는 '지금 도는 중인 만큼'만 더해서, 멈출 때도 되돌아가지 않고 그 자리에서 섭니다.
        const yaw = cam.yaw.x + E.swayAmp * Math.sin(cam.phase);
        const pitch = cam.pitch.x + NOD * Math.sin(cam.phase * 1.7 + 0.6);
        const cy = Math.cos(yaw);
        const sy = Math.sin(yaw);
        const cp = Math.cos(pitch);
        const sp = Math.sin(pitch);
        E.rot.set([cy, 0, sy, sp * sy, cp, -sp * cy, -cp * sy, sp, cp * cy]);
        E.view.yaw = yaw;
        E.view.scale = E.fit * cam.zoom.x;
        E.view.cx = E.w / 2 + cam.ox.x;
        E.view.cy = E.h / 2 + cam.oy.x;
    }

    // 장면 속 자리 → 화면 자리. out = [x, y, 깊이(앞이 +), 원근 배율]
    E.project = (at, out) => {
        const r = E.rot;
        const cam = E.cam;
        const x = at[0] - cam.tx.x;
        const y = at[1] - cam.ty.x;
        const z = at[2] - cam.tz.x;
        const px = r[0] * x + r[1] * y + r[2] * z;
        const py = r[3] * x + r[4] * y + r[5] * z;
        const pz = r[6] * x + r[7] * y + r[8] * z;
        const k = DIST / Math.max(0.4, DIST - pz);
        out[0] = E.view.cx + px * E.view.scale * k;
        out[1] = E.view.cy - py * E.view.scale * k;
        out[2] = pz;
        out[3] = k;
        return out;
    };

    /* ───────── 한 프레임 ───────── */

    const P = [0, 0, 0, 0];

    E.frame = (now) => {
        if (!E.w) return;
        const raw = E.last ? now - E.last : 16;
        E.last = now;
        // 움직임 줄이기에서는 장면의 시간(E.time)이 흐르지 않습니다. 끌어당기기만 실제 시간(real)으로 계산합니다.
        const real = clamp(raw, 0, 50) / 1000;
        const dt = E.reduced ? 0 : real;
        E.time += dt;
        E.clock += real;
        if (!E.reduced && raw < 200) adapt(raw);

        tickCamera(dt);
        updateView();
        stepPull(real);
        tickSignals(dt);

        // 껍질: 처음 한 번 가운데에서 바깥으로 떠오르고, 데이터가 들어오면 또렷해집니다.
        const quick = (tau) => (E.reduced ? 1 : 1 - Math.exp(-dt / tau));
        if (E.brain) E.appear = E.reduced ? 1 : Math.min(1, E.appear + dt / 1.5);
        const zoomed = clamp((E.cam.zoom.x - 1.15) / 1.2, 0, 1);
        // 무언가를 밝혀 보는 동안에는 껍질이 물러납니다. 걸러 보는 중에는 더 많이(껍질의 점이 점선 무늬의 연결과 섞이지 않게).
        const filtering = E.group || E.klass || E.relation;
        const shellTo = (E.mode === 'live' ? 1 : E.mode === 'loading' ? 0.8 : 0.62) * (1 - 0.5 * zoomed) * (E.hotSet ? (filtering ? 0.3 : 0.5) : 1);
        E.shell += (shellTo - E.shell) * quick(0.5);

        const scale = clamp(E.fit / 230, 0.64, 1.16);
        const loading = E.mode === 'loading' && !E.reduced;
        const idle = E.mode !== 'live';
        const alive = !idle;
        for (const p of E.list) {
            E.project(p.pos, P);
            p.sx = P[0];
            p.sy = P[1];
            p.sz = P[2];
            p.k = P[3];
            p.front = clamp(0.5 + P[2] * 0.6, 0, 1);
            const age = E.reduced ? 1 : clamp((E.time - p.born) / 0.5, 0, 1);
            const shown = 1 - (1 - age) ** 3;
            if (shown >= 1 && p.shown < 1 && !E.reduced && E.mode === 'live') flash(p, p.level <= 1 ? 0.9 : 0.55, p.level <= 1);
            p.shown = shown;
            p.hot += (p.tHot - p.hot) * quick(0.11);
            p.dim += (p.tDim - p.dim) * quick(0.16);
            p.sel += ((p.id === E.selectedId ? 1 : 0) - p.sel) * quick(0.12);
            p.focus += ((p.id === E.focusId ? 1 : 0) - p.focus) * quick(0.08);
            p.fire = E.reduced ? 0 : p.fire * Math.exp(-dt / 0.34);
            // 포인터를 올린 점은 2px 커지고 고리가 생깁니다("잡힌다"는 표시).
            p.over = (p.over || 0) + (((p.id === E.selfId || p.id === E.peekId) && alive && !p.ghost ? 1 : 0) - (p.over || 0)) * quick(0.07);
            // 작은 점도 겨눌 수 있게 최소 크기를 둡니다(세부 3.5px, 항목 4.5px).
            const still = Math.max(p.base * scale * (1 + (P[3] - 1) * 0.85), p.level >= 3 ? 3.5 : p.level === 2 ? 4.5 : 0);
            p.rr = (still * (1 + 0.16 * p.hot + 0.1 * p.fire) + 2 * p.over) * (0.4 + 0.6 * shown);
            // 다 나타났을 때의 반지름(이름표가 '곧 나타날 점'의 자리도 비워 두게)
            p.full = still;
        }
        // 그래프가 다 자리 잡고 조금 지나면, 점 하나가 저절로 한 번 당겨졌다 돌아가는 시범을 보입니다.
        if (alive && E.appear >= 1 && E.center && E.center.shown >= 1) {
            if (!E.settledAt) E.settledAt = E.clock + 1.3;
            else if (E.clock >= E.settledAt) {
                E.settledAt = E.clock + 0.5;
                tryDemo();
            }
        }
        // 잡고 있는 뉴런은 계속 발화합니다(세게 당길수록 밝게).
        const held = E.grab ? E.grab.p : null;
        if (held && !E.reduced) held.fire = Math.max(held.fire, 0.5 + 0.5 * stretchNow());
        const charge = E.charge ? clamp((now - E.charge.t0) / E.charge.ms, 0, 1) : 0;

        // 뉴런은 뒤에 있는 것부터 그립니다. 잡고 있는 점은 맨 앞에 그립니다.
        E.order.sort((a, b) => (a === held) - (b === held) || a.sz - b.sz);
        const data = E.nodeData;
        let count = 0;
        for (const p of E.order) {
            if (p.shown <= 0.01) continue;
            const o = count * NODE_SIZE;
            data[o] = p.pos[0];
            data[o + 1] = p.pos[1];
            data[o + 2] = p.pos[2];
            data[o + 3] = p.rr;
            data[o + 4] = p.pending ? 2 : p.ghost ? 1 : 0;
            data[o + 5] = p.level;
            data[o + 6] = (p.seed % 1000) / 1000;
            data.set(p.color.soft, o + 7);
            data.set(p.color.vivid, o + 10);
            const blink = loading && p.level > 0 ? 0.2 + 0.2 * Math.sin(E.time * 3.4 - p.index * 0.5) : 0;
            data[o + 13] = Math.max(p.fire, blink);
            data[o + 14] = p.hot;
            data[o + 15] = Math.max(p.dim, idle && !loading ? 0.3 : 0);
            data[o + 16] = p.shown;
            const ring = (E.time - p.ringAt) / 0.75;
            data[o + 17] = ring >= 0 && ring < 1 ? ring : -1;
            // 잡은 점에는 고른 점과 같은 고리를, 올린 점·고정해 둔 점에는 옅은 고리를 두릅니다. 길게 누르는 동안에는 고리가 차오릅니다.
            data[o + 18] = p === held ? 1 : Math.max(p.sel, 0.55 * p.over, E.pins.length && E.pull.isPinned(p.index) ? 0.5 : 0);
            data[o + 19] = p.focus;
            data[o + 20] = charge > 0 && p.id === E.charge.id ? charge : 0;
            count += 1;
        }

        // 선: 장식 섬유(가끔 옅은 신호가 지나감) → 데이터 연결
        const live = E.live;
        const fibers = E.fiberCount;
        if (!E.reduced && E.time >= E.fiberAt && fibers) {
            E.fiberAt = E.time + (E.mode === 'idle' ? 1.5 : 0.55) + Math.random() * 0.7;
            const i = Math.floor(Math.random() * fibers);
            E.fiberPulse.set([E.time, 0.9 + Math.random() * 0.5, (Math.random() < 0.5 ? 1 : -1) * 0.34], i * 3);
        }
        const fiberDim = E.hotSet ? 0.6 : 0;
        for (let i = 0; i < fibers; i += 1) {
            const o = i * LINK_LIVE;
            live[o] = E.appear >= 1 ? 1 : clamp(E.appear * 1.4 - 0.2, 0, 1);
            live[o + 1] = 0;
            live[o + 2] = fiberDim;
            live[o + 4] = E.fiberPulse[i * 3];
            live[o + 5] = E.fiberPulse[i * 3 + 1];
            live[o + 6] = E.fiberPulse[i * 3 + 2];
        }
        E.links.forEach((line, i) => {
            const o = (fibers + i) * LINK_LIVE;
            const reveal = line.cross ? Math.min(line.a.shown, line.b.shown) : line.b.shown;
            line.shown = reveal;
            line.hot += (line.tHot - line.hot) * quick(0.11);
            line.dim += (line.tDim - line.dim) * quick(0.16);
            live[o] = reveal >= 1 ? 1 : reveal * 1.04;
            live[o + 1] = line.hot;
            live[o + 2] = Math.max(line.dim, idle && !loading ? 0.35 : 0);
            live[o + 3] = E.moving ? E.pull.tension[i] : 0;
            live[o + 4] = line.p1[0];
            live[o + 5] = line.p1[1];
            live[o + 6] = line.p1[2];
            live[o + 8] = line.p2[0];
            live[o + 9] = line.p2[1];
            live[o + 10] = line.p2[2];
        });

        if (loading) E.scanAt = ((E.time * 0.62) % 1.25);
        // 끌려 나온 뉴런 둘레의 껍질이 조금 따라 늘어나도록, 그 점의 제자리와 끌려 나온 만큼을 넘깁니다.
        const tugged = E.moving && E.bulge >= 0 && E.bulge < E.list.length ? E.list[E.bulge] : null;
        const frame = {
            w: E.w, h: E.h, dpr: E.dpr, rot: E.rot,
            target: [E.cam.tx.x, E.cam.ty.x, E.cam.tz.x],
            center: [E.view.cx, E.view.cy], scale: E.view.scale, dist: DIST, time: E.time,
            appear: E.appear, shell: E.shell, point: 2.05 * clamp(E.view.scale / 240, 0.74, 1.28),
            glow: E.glow, tint: E.tint,
            scan: [1.2 - E.scanAt * 2.1, loading ? 1 : 0], calm: E.reduced ? 1 : 0,
            cortexCount: E.brain ? E.brain.levels[E.cortexLevel] : 0,
            moved: E.moved,
            pullAt: tugged ? tugged.at : NONE,
            pullBy: tugged ? [tugged.pos[0] - tugged.at[0], tugged.pos[1] - tugged.at[1], tugged.pos[2] - tugged.at[2]] : NONE,
        };
        renderer?.draw(frame, live, data, count, E.moveData);
        solveLabels(dt);
        E.onFrame?.(E);
    };

    // 프레임이 예산(약 60fps)을 넘기면 피질 점 수와 해상도를 낮추고, 넉넉하면 다시 올립니다.
    function adapt(raw) {
        E.ema += (raw - E.ema) * 0.06;
        if (E.ema > 21) {
            E.slow += 1;
            E.fast = 0;
        } else if (E.ema < 13) {
            E.fast += 1;
            E.slow = 0;
        } else {
            E.slow = Math.max(0, E.slow - 1);
            E.fast = 0;
        }
        if (E.slow > 45) {
            E.slow = 0;
            if (E.dpr > 1.5) {
                E.dprCap = 1.5;
                E.setSize(E.w, E.h, 1.5);
            } else if (E.cortexLevel > 0) {
                E.cortexLevel -= 1;
            } else if (E.dpr > 1) {
                E.dprCap = 1;
                E.setSize(E.w, E.h, 1);
            }
            E.lowered += 1;
        } else if (E.fast > 360 && E.brain && E.cortexLevel < E.brain.levels.length - 1 && E.lowered < 2) {
            E.fast = 0;
            E.cortexLevel += 1;
        }
    }

    /* ───────── 고르기 ───────── */

    // 포인터 자리에서 고를 점: 화면에서 중심이 가장 가까운 점입니다(같으면 앞쪽). 겹쳐 보이는 점들 가운데 엉뚱한 것이 잡히지 않습니다.
    // 걸러 보느라 흐려진 점은 대상이 아니고, 뒤쪽을 향한 점은 포인터가 그 점 위에 있을 때만 잡힙니다.
    // reach: 점 바깥으로 이만큼까지는 그 점으로 칩니다(px, 중심에서 잰 거리).
    E.pick = (x, y, reach) => {
        let best = null;
        let nearest = Infinity;
        const filtering = E.group || E.klass || E.relation;
        for (const p of E.list) {
            if (p.shown < 0.5 || (filtering && p.tDim)) continue;
            const d = Math.hypot(x - p.sx, y - p.sy);
            if (d > (p.front < 0.25 ? p.rr + 1.5 : Math.max(p.rr + 4, reach))) continue;
            if (d < nearest - 0.75 || (d < nearest + 0.75 && best && p.sz > best.sz)) {
                nearest = Math.min(nearest, d);
                best = p;
            }
        }
        return best;
    };

    // 손가락으로 누른 자리의 점. 이름이 떠 있는 점·묶음·매장은 넉넉하게(22px), 이름이 꺼진 점은 원판에서 6px 안일 때만 잡습니다
    // (빽빽한 뇌 한가운데를 스치기만 해도 이름 모를 점의 카드가 열리지 않게). 손가락이 원판 위에 있으면 그 점이 먼저입니다.
    E.pickTouch = (x, y) => {
        let best = null;
        let bestScore = Infinity;
        const filtering = E.group || E.klass || E.relation;
        for (const p of E.list) {
            if (p.shown < 0.5 || (filtering && p.tDim)) continue;
            const d = Math.hypot(x - p.sx, y - p.sy);
            const named = p.level <= 1 || (p.lab.on && p.lab.a > 0.5);
            const reach = p.front < 0.25 ? p.rr + 1.5 : named ? Math.max(p.rr + 4, 22) : p.rr + 6;
            if (d > reach) continue;
            // 원판 위 → 이름 있는 점 → 이름 없는 점 순으로, 같은 급에서는 가까운 것
            const score = (d <= p.rr + 1 ? 0 : named ? 1000 : 2000) + d;
            if (score < bestScore) {
                bestScore = score;
                best = p;
            }
        }
        return best;
    };

    // 보이는 이름표(점 이름·묶음 이름) 상자 위인지. 사람은 점보다 글자를 누르려 하므로, 글자를 누르면 그 점을 고른 것으로 칩니다.
    // pad: 상자 바깥으로 이만큼까지(px). 여럿이 걸리면 상자 가운데가 가까운 쪽.
    E.pickLabel = (x, y, pad) => {
        let best = null;
        let nearest = Infinity;
        for (const p of E.list) {
            const lab = p.lab;
            if (!lab.on || lab.a < 0.5 || !lab.size) continue;
            if (x < lab.x - pad || x > lab.x + lab.size.w + pad || y < lab.y - pad || y > lab.y + lab.size.h + pad) continue;
            const d = Math.hypot(x - lab.x - lab.size.w / 2, y - lab.y - lab.size.h / 2);
            if (d < nearest) {
                nearest = d;
                best = p;
            }
        }
        return best;
    };

    /* ───────── 라벨 ─────────
       무엇에 이름을 띄울지는 '상태'가 정합니다(카메라가 조금 도는 것으로는 바뀌지 않음 — 그래서 깜빡이지 않습니다).
         · 쉬는 화면: 매장, 묶음 이름, 그리고 먼저 볼 것으로 정해 둔 항목(node.spot 순서) 몇 개.
         · 점을 올리거나 고르거나 걸러 보는 동안: 밝아진 점 전부.
       우선순위가 높은 이름표부터 자리를 잡고, 이미 놓인 이름표·밝은 점과 겹치는 자리는 쓰지 않습니다.
       쓰던 자리가 막히면 껐다 켜지 않고 빈 자리로 미끄러져 옮겨 갑니다. */

    // 이름표를 놓아 볼 방향(점에서 바깥쪽을 0 으로 한 각도). 가까운 방향부터 차례로 보고, 그다음 그 사이사이 방향을 봅니다
    // (빽빽한 곳에서도 점을 덮지 않는 자리를 찾을 수 있게 스물네 방향).
    const ANGLES = [
        0, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4, 1.95, -1.95, 2.5, -2.5, Math.PI,
        0.225, -0.225, 0.675, -0.675, 1.15, -1.15, 1.675, -1.675, 2.225, -2.225, 2.82, -2.82,
    ];
    // 관계 이름표를 놓아 볼 자리(연결 가운데에서의 어긋남, px)
    const TAG_SPOTS = [[0, 0], [0, -15], [0, 15], [0, -29], [0, 29], [-46, -15], [46, -15], [-46, 15], [46, 15]];
    // 이름표를 다는 선 위의 세 자리(buildFixed 의 line.spots 와 같은 순서)
    const TAG_AT = [0.5, 0.36, 0.64, 0.25, 0.75];
    // 이름표 사이의 최소 간격(px): 남의 값이 내 것처럼 붙어 읽히지 않게
    const LABEL_GAP = 12;
    const TAG_GAP = 7;

    function overlaps(x0, y0, x1, y1, boxes, pad) {
        for (let i = 0; i < boxes.length; i += 1) {
            const b = boxes[i];
            if (x0 < b[2] + pad && x1 > b[0] - pad && y0 < b[3] + pad && y1 > b[1] - pad) return true;
        }
        return false;
    }

    // 이름표 상자에서 점에 가장 가까운 자리로 지시선을 긋습니다(이름표가 점에서 떨어져 있을 때만).
    function leadOf(p, lab) {
        const nx = clamp(p.sx, lab.x, lab.x + lab.size.w);
        const ny = clamp(p.sy, lab.y, lab.y + lab.size.h);
        const far = Math.hypot(nx - p.sx, ny - p.sy);
        lab.lead = !lab.loose && far > p.rr + 12;
        if (!lab.lead) return;
        const dx = (nx - p.sx) / far;
        const dy = (ny - p.sy) / far;
        lab.ax = p.sx + dx * (p.rr + 2.5);
        lab.ay = p.sy + dy * (p.rr + 2.5);
        lab.bx = nx - dx * 3;
        lab.by = ny - dy * 3;
    }

    // 이름표를 제 점에 붙여 옮기고(자리가 바뀌면 0.2초에 걸쳐 미끄러짐), 나타남·사라짐을 진행합니다.
    // frozen: 끌어당기는 중 — 새로 띄우거나 지우지 않고, 사라지던 것은 바로 숨깁니다.
    function settleLabels(dt, frozen) {
        const fade = E.reduced ? 1 : 1 - Math.exp(-dt / 0.07);
        const slide = E.reduced ? 1 : 1 - Math.exp(-dt / 0.06);
        // 마우스로 잡은 점의 이름·값은 그 점 옆 12px 자리에 붙어 다닙니다. 한계보다 멀리 당겨 점이 포인터를 따라오지 못할 때도
        // 이름은 점 곁에 남습니다(포인터와 점은 가는 선으로 잇습니다).
        const held = E.grab && !E.auto && !E.grab.touch ? E.grab : null;
        for (const p of E.list) {
            const lab = p.lab;
            if (!lab.size) continue;
            lab.loose = false;
            if (held && p === held.p) {
                lab.on = true;
                lab.loose = true;
                // 점의 네 귀퉁이 쪽 가운데 다른 이름표와 겹치지 않는 쪽에 둡니다(쓰던 쪽이 괜찮으면 그대로).
                const { w, h } = lab.size;
                const sides = [[12, 14], [12, -h - 10], [-w - 12, 14], [-w - 12, -h - 10]];
                const fits = (side) => {
                    const x0 = p.sx + side[0];
                    const y0 = p.sy + side[1];
                    if (x0 < 6 || y0 < 6 || x0 + w > E.w - 6 || y0 + h > E.h - 6) return false;
                    for (const q of E.list) {
                        const other = q.lab;
                        if (q === p || !(other.a > 0.3) || !other.size) continue;
                        if (x0 < other.x + other.size.w + 5 && x0 + w > other.x - 5 && y0 < other.y + other.size.h + 5 && y0 + h > other.y - 5) return false;
                    }
                    return true;
                };
                if (!(held.side >= 0 && fits(sides[held.side]))) {
                    const found = sides.findIndex(fits);
                    held.side = found >= 0 ? found : held.side >= 0 ? held.side : 0;
                }
                const tx = clamp(p.sx + sides[held.side][0], 6, Math.max(6, E.w - w - 6)) - p.sx;
                const ty = clamp(p.sy + sides[held.side][1], 6, Math.max(6, E.h - h - 6)) - p.sy;
                if (!held.placed) {
                    held.placed = true;
                    lab.rx = tx;
                    lab.ry = ty;
                } else {
                    lab.rx += (tx - lab.rx) * slide;
                    lab.ry += (ty - lab.ry) * slide;
                }
                if (!held.hadLabel) {
                    lab.tx = lab.rx;
                    lab.ty = lab.ry;
                }
                lab.a = 1;
            } else if (lab.on && lab.a <= 0.004) {
                // 새로 뜨는 이름표는 제자리에서 바로 나타납니다.
                lab.rx = lab.tx;
                lab.ry = lab.ty;
            } else {
                lab.rx += (lab.tx - lab.rx) * slide;
                lab.ry += (lab.ty - lab.ry) * slide;
            }
            if (frozen && !lab.on) lab.a = 0;
            else lab.a += ((lab.on ? 1 : 0) - lab.a) * fade;
            if (lab.a < 0.004) lab.a = 0;
            lab.x = p.sx + lab.rx;
            lab.y = p.sy + lab.ry;
            // 끌려가는 점의 이름이 무대 가장자리에서 잘리지 않게 안쪽에 붙잡아 둡니다.
            if (frozen && lab.a > 0) {
                lab.x = clamp(lab.x, 4, Math.max(4, E.w - lab.size.w - 4));
                lab.y = clamp(lab.y, 4, Math.max(4, E.h - lab.size.h - 4));
            }
            if (lab.a > 0) leadOf(p, lab);
        }
        // 끌려가다 다른 이름표와 부딪친 이름표는 그 끌기가 끝날 때까지 숨깁니다(덜 중요한 쪽을. 글자가 포개져 둘 다 못 읽게 되지 않게).
        // 손으로 잡고 있는 동안만 그렇게 합니다(놓은 뒤 제자리로 돌아가는 0.5초 동안에는 껐다 켜지 않습니다).
        if (frozen && E.grab && !E.auto) {
            const seen = [];
            const order = E.list.filter((p) => p.lab.on && p.lab.a > 0.02 && p.lab.size).sort((a, b) => (b.lab.loose ? 1e4 : b.lab.want) - (a.lab.loose ? 1e4 : a.lab.want));
            for (const p of order) {
                const lab = p.lab;
                if (overlaps(lab.x, lab.y, lab.x + lab.size.w, lab.y + lab.size.h, seen, 2)) {
                    lab.on = false;
                    lab.a = 0;
                } else seen.push([lab.x, lab.y, lab.x + lab.size.w, lab.y + lab.size.h]);
            }
        }
    }

    // 끌어당기는 동안: 관계 이름표는 자리를 다시 잡지 않고 끌려간 선을 그대로 따라다닙니다.
    // 따라가다가 점 이름·밝은 점·다른 관계 이름표와 부딪치거나 무대 밖으로 나가면, 그 끌기가 끝날 때까지 숨깁니다(다시 켜지 않음 — 깜빡이지 않게).
    // 손으로 당기는 동안에는 둘까지만 남깁니다(움직이는 것 위에 글자가 많으면 읽을 수 없으므로).
    function followTags(dt) {
        const rate = E.reduced ? 1 : 1 - Math.exp(-dt / 0.07);
        const most = E.grab && !E.auto ? 2 : TAG_MAX;
        const kept = [];
        for (const tag of E.tags) {
            if (!tag.on) continue;
            const shift = TAG_SPOTS[tag.spot % TAG_SPOTS.length];
            curveAt(tag.line, TAG_AT[Math.floor(tag.spot / TAG_SPOTS.length)] ?? 0.5, Q);
            E.project(Q, P);
            tag.x = P[0] + shift[0] - tag.w / 2;
            tag.y = P[1] + shift[1] - tag.h / 2;
            if (!tag.cut) {
                const x0 = tag.x;
                const y0 = tag.y;
                const x1 = x0 + tag.w;
                const y1 = y0 + tag.h;
                let bad = kept.length >= most || x0 < 6 || y0 < 6 || x1 > E.w - 6 || y1 > E.h - 6 || overlaps(x0, y0, x1, y1, kept, 4);
                for (let i = 0; i < E.list.length && !bad; i += 1) {
                    const p = E.list[i];
                    const lab = p.lab;
                    if (lab.a > 0.3 && lab.size && x0 < lab.x + lab.size.w + 4 && x1 > lab.x - 4 && y0 < lab.y + lab.size.h + 4 && y1 > lab.y - 4) bad = true;
                    else if (p.shown > 0.5 && p.dim < 0.5 && p.rr > 2) {
                        const nx = clamp(p.sx, x0, x1);
                        const ny = clamp(p.sy, y0, y1);
                        const reach = p.rr + (p.level === 0 ? 4.5 : 1.5);
                        if ((p.sx - nx) * (p.sx - nx) + (p.sy - ny) * (p.sy - ny) < reach * reach) bad = true;
                    }
                }
                if (bad) tag.cut = true;
                else kept.push([x0, y0, x1, y1]);
            }
            tag.a += ((tag.cut ? 0 : 1) - tag.a) * rate;
            if (tag.cut && tag.a < 0.02) tag.a = 0;
        }
    }

    // 저절로 도는 길의 양 끝 자세에서 각 점이 화면 어디에 놓이는지(p.sw = [왼쪽 끝 x, y, 오른쪽 끝 x, y]).
    // 끄덕임은 1px 안팎이라 뺍니다.
    function projectSweep() {
        const cam = E.cam;
        const cp = Math.cos(cam.pitch.x);
        const sp = Math.sin(cam.pitch.x);
        for (let side = 0; side < 2; side += 1) {
            const yaw = cam.yaw.x + (side ? E.swayAmp : -E.swayAmp);
            const cy = Math.cos(yaw);
            const sy = Math.sin(yaw);
            for (const p of E.list) {
                const x = p.pos[0] - cam.tx.x;
                const y = p.pos[1] - cam.ty.x;
                const z = p.pos[2] - cam.tz.x;
                const k = DIST / Math.max(0.4, DIST - (-cp * sy * x + sp * y + cp * cy * z));
                if (!p.sw) p.sw = new Float32Array(4);
                p.sw[side * 2] = E.view.cx + (cy * x + sy * z) * E.view.scale * k;
                p.sw[side * 2 + 1] = E.view.cy - (sp * sy * x + cp * y - sp * cy * z) * E.view.scale * k;
            }
        }
    }

    function solveLabels(dt) {
        if (E.moving && E.clock > E.focusAt + 0.3) {
            settleLabels(dt, true);
            followTags(dt);
            E.more.on = false;
            E.more.a = 0;
            E.restAt = null;
            return;
        }
        // 포인터가 점들 위를 스쳐 지나가는 동안(올린 지 0.12초가 안 됨)에는 이름표를 바꾸지 않습니다.
        // 지나가는 길에 있는 점마다 이름표가 켜졌다 꺼지면 어지럽고, 누르러 가던 이름표가 달아납니다.
        if (E.clock - E.focusAt < 0.12) {
            settleLabels(dt, false);
            return;
        }
        const { metrics, blocks } = E.labels;
        const placed = [];
        for (const block of blocks) placed.push(block);
        E.project(HOME.target, P);
        const bx = P[0];
        const by = P[1];
        const self = E.selfId || E.selectedId || E.focusId;
        const selfP = self ? E.byId.get(self) : null;
        const zoom = E.cam.zoom.x;
        // 뇌가 화면에서 차지하는 타원(대략). 옆에 여백이 넉넉하면 매장·묶음 라벨을 뇌 바깥으로 빼서 도해의 주석처럼 답니다.
        const yaw = E.view.yaw;
        const rx = E.view.scale * (1.03 * Math.abs(Math.sin(yaw)) + 0.76 * Math.abs(Math.cos(yaw))) + 10;
        const ry = E.view.scale * 0.84 + 8;
        const roomy = E.w / 2 - rx > 104 && !E.selectedId && !E.framing && zoom < 1.12;
        // 방금 놓은 점의 이름은 잠깐 더 보여 줍니다.
        const justPulled = E.lastPull && E.clock - E.lastPull.at < 0.9 ? E.lastPull.p : null;
        // 쉬는 화면에서 띄울 항목 이름의 수: 무대가 넓을수록 많이(4~8)
        const maxSpot = clamp(Math.round((E.w * E.h) / 60000), 4, 8);
        // 보는 자리가 아직 움직이는 중인지(걸러 보기로 다가가는 중 등). 그동안에는 점들이 화면에서 움직입니다.
        const cam = E.cam;
        const settling = Math.abs(cam.zoom.to - cam.zoom.x) > 0.02 * cam.zoom.to || Math.abs(cam.ox.to - cam.ox.x) > 2
            || Math.abs(cam.oy.to - cam.oy.x) > 2 || Math.abs(cam.yaw.to - cam.yaw.x) > 0.012;
        // 세로로 긴 무대(폰)의 쉬는 화면: 뇌가 폭을 꽉 채워 옆 여백이 없으므로, 이름은 점 구름의 위·아래 여백으로 뺍니다.
        const upright = E.tall && !E.selectedId && !E.framing && !E.hotSet && zoom < E.homeZoom * 1.12;
        // 카드·시트가 열려 그래프가 좁은 띠로만 보이는 때(폰의 아래 시트). 이때는 고른 점과 이어진 것만 이름을 답니다.
        const narrow = Boolean(E.selectedId) && (E.safe[3] - E.safe[1] < 220 || E.safe[2] - E.safe[0] < 280);
        // 카드·시트·단추에 가려진 점(이름을 달지 않습니다)
        const hiddenUnder = (p) => {
            for (let i = 0; i < blocks.length; i += 1) {
                const b = blocks[i];
                if (p.sx > b[0] && p.sx < b[2] && p.sy > b[1] && p.sy < b[3]) return true;
            }
            return false;
        };
        // 고른 점의 고리(폰에서는 손잡이 고리). 이 원 안에는 어떤 이름표도 두지 않습니다.
        const ringP = E.selectedId ? E.byId.get(E.selectedId) || null : null;
        const ringR = ringP ? Math.max(ringP.rr + 9, E.handleR || 0) : 0;
        // 걸러 보는 중인지, 그리고 걸러 본 자리로 다가가는 중인지. 다가가는 동안에는 항목 이름을 띄우지 않고, 자리가 잡힌 뒤에
        // 중요한 순서대로 한꺼번에 놓습니다(그래야 같은 묶음이면 매번 같은 이름이 같은 자리에 뜹니다).
        const filterOn = Boolean(E.group || E.klass || E.relation);
        // 도착은 '거의 다 왔다'가 아니라 사실상 멈췄을 때로 봅니다(0.3px·0.2% 안). 그래야 이름표를 놓는 순간의 화면이 매번 같습니다.
        if (E.arriving && !settling && Math.abs(cam.zoom.to - cam.zoom.x) < 0.002 * cam.zoom.to && Math.abs(cam.ox.to - cam.ox.x) < 0.3
            && Math.abs(cam.oy.to - cam.oy.x) < 0.3 && Math.abs(cam.yaw.to - cam.yaw.x) < 0.0015 && Math.abs(cam.pitch.to - cam.pitch.x) < 0.0015) E.arriving = false;
        const waiting = E.arriving && filterOn && !self;
        // 다가가는 동안에는 남아 있는 이름표(매장·묶음)도 전에 쓰던 자리를 잊고 매번 처음부터 다시 놓습니다
        // (어떤 화면에서 넘어왔는지에 따라 자리가 달라지지 않게).
        if (waiting) for (const p of E.list) p.lab.dir = -1;

        const ranked = [];
        let growing = false;
        // 사라지는 중인 라벨의 자리. 새로 뜨는 라벨은 이 자리가 다 비워질 때까지 기다립니다(겹쳐 보이는 순간이 없도록).
        const fading = [];
        // 지금 보이는 라벨의 자리. 새로 뜨는 관계 이름표는 이 자리도 피합니다.
        const showing = [];
        for (const p of E.list) {
            const lab = p.lab;
            const size = metrics.get(p.id);
            lab.was = lab.on;
            if (size) lab.size = size;
            if (size && !lab.on && lab.a > 0.06) fading.push([lab.x, lab.y, lab.x + size.w, lab.y + size.h, p]);
            else if (size && lab.on) showing.push([lab.x, lab.y, lab.x + size.w, lab.y + size.h]);
            let rank = -1;
            if (size && p.shown >= 0.75) {
                if (p.level === 0) rank = 1000;
                else if (p.id === self) rank = 900;
                else if (p === justPulled) rank = 880;
                // 무언가를 밝혀 보는 동안에는 밝아진 점 전부에 이름을 답니다.
                // (자리가 모자라면 대표키워드와 경쟁 매장이 먼저입니다.)
                else if (E.hotSet && E.hotSet.has(p.id)) rank = p.level === 1 ? 700 + p.weight * 50 : 500 + (p.node.type === 'keyword' || p.node.type === 'rival' ? 40 : 0) + p.weight * 40;
                // 묶음 이름은 늘 켜 두고, 무엇을 밝혀 보든 제자리를 먼저 지킵니다
                // (마우스가 점들 위를 지나가는 동안 묶음 이름이 밀려나면, 그 이름을 누르러 가던 손이 허탕을 칩니다).
                // 다만 좁은 띠에서는 고른 점과 상관없는(흐려진) 묶음 이름을 숨깁니다. 몰려서 고른 점을 가리기 때문입니다.
                // 폰의 걸러 보기에서도 숨깁니다(좁은 무대에서 밝은 이름표와 붙어 읽히기 때문입니다).
                else if (p.level === 1 && !narrow && !(E.lite && filterOn)) rank = 700 + p.weight * 10;
                // 쉬는 화면: 먼저 볼 것으로 정해 둔 항목만, 정해 둔 순서대로.
                else if (!E.hotSet && p.spot && p.spot <= maxSpot) rank = 400 - p.spot;
                // 손가락으로 톡 해서 이름만 띄운 점: 맨 나중에, 다른 이름표가 다 놓인 뒤 남은 자리에 놓습니다(남의 자리를 밀어내지 않게).
                if (rank < 0 && size && p.id === E.peekId && p.shown >= 0.75) rank = 30;
                // 카드·시트·단추에 가려진 점에는 이름을 달지 않습니다(고른 점은 늘 보이는 곳에 있습니다).
                if (rank >= 0 && p.id !== self && hiddenUnder(p)) rank = -1;
                if (rank >= 0 && waiting && p.level >= 2) {
                    rank = -1;
                    lab.dir = -1;
                }
                // 이미 보이는 라벨이 자리를 먼저 지킵니다.
                if (rank >= 0 && lab.on) rank += 20;
            }
            lab.want = rank;
            // 아직 나타나는 중인 점이 있는지(다 나타난 뒤부터 '쉬는 화면이 자리 잡은 시간'을 셉니다)
            if (p.shown < 0.75 && p.born !== Infinity) growing = true;
            if (rank >= 0) ranked.push(p);
        }
        ranked.sort((a, b) => b.lab.want - a.lab.want);

        // 관계 이름표: 그 관계의 대표 연결 위(가운데·앞·뒤 세 자리 가운데 빈 곳)에 답니다.
        // 매장·고른 점의 라벨 다음으로 자리를 잡아서, 이웃 점의 라벨이 관계 이름을 피해 가게 합니다(관계가 먼저 읽히도록).
        const tagRate = E.reduced ? 1 : 1 - Math.exp(-dt / 0.07);
        let tagsDone = false;
        const placeTags = () => {
            tagsDone = true;
            for (const tag of E.tags) {
                let done = false;
                tag.cut = false;
                if (tag.w && tag.line.spots && tag.line.shown > 0.9) {
                    const count = tag.line.spots.length * TAG_SPOTS.length;
                    for (let step = 0; step < count && !done; step += 1) {
                        // 쓰던 자리를 먼저 다시 써 봅니다.
                        const index = (tag.spot + step) % count;
                        const shift = TAG_SPOTS[index % TAG_SPOTS.length];
                        E.project(tag.line.spots[Math.floor(index / TAG_SPOTS.length)], P);
                        const x0 = P[0] + shift[0] - tag.w / 2;
                        const y0 = P[1] + shift[1] - tag.h / 2;
                        if (x0 < 8 || y0 < 6 || x0 + tag.w > E.w - 8 || y0 + tag.h > E.h - 6) continue;
                        if (overlaps(x0, y0, x0 + tag.w, y0 + tag.h, placed, TAG_GAP) || overlaps(x0, y0, x0 + tag.w, y0 + tag.h, fading, 4)) continue;
                        // 보이는 이름표와 밝은 점(매장 점 포함)은 덮지 않습니다. 그런 자리가 없으면 이 이름표는 띄우지 않고 수만 적습니다.
                        if (overlaps(x0, y0, x0 + tag.w, y0 + tag.h, showing, 4)) continue;
                        if (dotsUnder(x0, y0, x0 + tag.w, y0 + tag.h, null, 1.5, 1)) continue;
                        // 고른 점 바로 옆(16px 안)에는 두지 않습니다. 점과 그 고리를 가리지 않게.
                        if (selfP) {
                            const nx = clamp(selfP.sx, x0, x0 + tag.w);
                            const ny = clamp(selfP.sy, y0, y0 + tag.h);
                            if (Math.hypot(nx - selfP.sx, ny - selfP.sy) < selfP.rr + 16) continue;
                        }
                        tag.spot = index;
                        tag.x = x0;
                        tag.y = y0;
                        placed.push([x0, y0, x0 + tag.w, y0 + tag.h]);
                        done = true;
                    }
                }
                // 자리를 잃으면 바로 사라지고(다른 라벨과 겹쳐 보이지 않게), 자리를 얻으면 스르륵 나타납니다.
                tag.on = done;
                tag.a = done ? tag.a + (1 - tag.a) * tagRate : 0;
            }
        };

        // 글자가 밝은 점 위에 걸치면 읽기 어려우므로("115명"이 "1●5명"으로), 보이는 점(물러난 점 제외)의 원판을 피해서 놓습니다.
        // 매장과 고른 점은 고리까지 피합니다.
        const dots = [];
        // 점 구름의 위·아래 끝(화면)
        let cloudTop = Infinity;
        let cloudBottom = -Infinity;
        for (const p of E.list) {
            // 아직 나타나는 중인 점도 넣습니다(곧 그 자리에 점이 생기므로).
            if (!(p.dim < 0.5 && p.full > 2) || p.born === Infinity) continue;
            dots.push(p);
            if (p.sy - p.full < cloudTop) cloudTop = p.sy - p.full;
            if (p.sy + p.full > cloudBottom) cloudBottom = p.sy + p.full;
        }
        // 상자가 덮는 점의 수. most 를 넘으면 더 세지 않습니다.
        const dotsUnder = (x0, y0, x1, y1, own, margin, most) => {
            let found = 0;
            for (let i = 0; i < dots.length; i += 1) {
                const d = dots[i];
                if (d === own) continue;
                const nx = clamp(d.sx, x0, x1);
                const ny = clamp(d.sy, y0, y1);
                const reach = Math.max(d.rr, d.full) + (d.level === 0 || d === selfP ? margin + 3 : margin);
                if ((d.sx - nx) * (d.sx - nx) + (d.sy - ny) * (d.sy - ny) < reach * reach) {
                    found += 1;
                    if (found >= most) return found;
                }
            }
            return found;
        };

        // 쉬는 화면에서는 뇌가 좌우로 돌아, 지금은 빈 자리에도 조금 뒤 점이 들어옵니다(앞쪽 점과 뒤쪽 점이 서로 지나침).
        // 이름표는 제 점을 따라 움직이므로, '제 점에서 본 다른 점의 길'(왼쪽 끝 → 지금 → 오른쪽 끝)이 상자를 지나는지 봅니다.
        const sweeping = !E.hotSet && !E.reduced && E.mode === 'live' && E.swayAmp > 0;
        if (sweeping) projectSweep();
        // 보는 자리가 가만히 있는 쉬는 화면(손으로 돌리는 중·자리를 옮기는 중이 아님)
        const steady = sweeping && !settling && !cam.held;
        // 쉬는 화면이 자리 잡은 지 2초가 지나면 새 항목 이름표를 더 띄우지 않습니다. 뇌가 도는 각도에 따라 뒤늦게 자리가 나서
        // 한참 뒤에 이름 하나가 불쑥 뜨는 일이 없게(쉬는 화면의 이름표는 처음 놓인 그대로 있습니다). 무언가를 올리거나 고르면 다시 셉니다.
        if (!steady || growing) E.restAt = null;
        else if (E.restAt === null || E.restAt === undefined) E.restAt = E.clock;
        const closed = E.restAt !== null && E.restAt !== undefined && E.clock - E.restAt > 2;
        // 제 점을 따라 움직이는 동안 상자가 무대 밖으로 나가는지
        const sweptOut = (x0, y0, x1, y1, own) => {
            for (let side = 0; side < 2; side += 1) {
                const mx = own.sw[side * 2] - own.sx;
                const my = own.sw[side * 2 + 1] - own.sy;
                if (x0 + mx < 8 || y0 + my < 6 || x1 + mx > E.w - 8 || y1 + my > E.h - 6) return true;
            }
            return false;
        };
        const sweptUnder = (x0, y0, x1, y1, own, margin, most) => {
            const rx0 = x0 - own.sx;
            const ry0 = y0 - own.sy;
            const rx1 = x1 - own.sx;
            const ry1 = y1 - own.sy;
            let found = 0;
            for (let i = 0; i < dots.length; i += 1) {
                const d = dots[i];
                if (d === own) continue;
                const reach = Math.max(d.rr, d.full) + margin;
                const ax = d.sw[0] - own.sw[0];
                const ay = d.sw[1] - own.sw[1];
                const mx = d.sx - own.sx;
                const my = d.sy - own.sy;
                const cx = d.sw[2] - own.sw[2];
                const cy = d.sw[3] - own.sw[3];
                if (Math.max(ax, mx, cx) < rx0 - reach || Math.min(ax, mx, cx) > rx1 + reach || Math.max(ay, my, cy) < ry0 - reach || Math.min(ay, my, cy) > ry1 + reach) continue;
                // 길을 따라 4px 간격으로 짚어 봅니다.
                let hit = false;
                for (let s = 0; s < 2 && !hit; s += 1) {
                    const fx = s ? mx : ax;
                    const fy = s ? my : ay;
                    const gx = (s ? cx : mx) - fx;
                    const gy = (s ? cy : my) - fy;
                    const steps = Math.max(1, Math.ceil(Math.hypot(gx, gy) / 4));
                    for (let t = 0; t <= steps; t += 1) {
                        const qx = fx + (gx * t) / steps;
                        const qy = fy + (gy * t) / steps;
                        const nx = clamp(qx, rx0, rx1);
                        const ny = clamp(qy, ry0, ry1);
                        if ((qx - nx) * (qx - nx) + (qy - ny) * (qy - ny) < reach * reach) {
                            hit = true;
                            break;
                        }
                    }
                }
                if (hit) {
                    found += 1;
                    if (found >= most) return found;
                }
            }
            return found;
        };

        // 이름표끼리도 마찬가지입니다. 이름표는 제 점을 따라 움직이므로, 깊이가 다른 두 점의 이름표는 뇌가 도는 동안 서로 다가옵니다.
        // 이미 놓인 상자(placed: 다른 이름표는 [4] 에 그 점, 단추·카드는 화면에 고정)가 내 상자에 대해 움직이는 길을 따라가 봅니다.
        const sweptClash = (x0, y0, x1, y1, own, pad) => {
            for (let i = 0; i < placed.length; i += 1) {
                const b = placed[i];
                const q = b[4];
                if (q === own) continue;
                for (let side = 0; side < 2; side += 1) {
                    const mx = (q ? q.sw[side * 2] - q.sx : 0) - (own.sw[side * 2] - own.sx);
                    const my = (q ? q.sw[side * 2 + 1] - q.sy : 0) - (own.sw[side * 2 + 1] - own.sy);
                    const far = Math.hypot(mx, my);
                    if (far < 1) continue;
                    if (x0 > Math.max(b[2], b[2] + mx) + pad || x1 < Math.min(b[0], b[0] + mx) - pad || y0 > Math.max(b[3], b[3] + my) + pad || y1 < Math.min(b[1], b[1] + my) - pad) continue;
                    const steps = Math.ceil(far / 4);
                    for (let t = 1; t <= steps; t += 1) {
                        const ox = (mx * t) / steps;
                        const oy = (my * t) / steps;
                        if (x0 < b[2] + ox + pad && x1 > b[0] + ox - pad && y0 < b[3] + oy + pad && y1 > b[1] + oy - pad) return true;
                    }
                }
            }
            return false;
        };

        const shown = [];
        for (const p of ranked) {
            const lab = p.lab;
            if (!tagsDone && lab.want < 880) placeTags();
            // 매장·고른 점·묶음 이름은 빈 자리가 없으면 점을 덮는 자리라도 씁니다. 나머지는 점을 덮지 않는 자리에만 놓습니다.
            // 밝혀 본 점이 40개 이하일 때는 그 점들도 모두 이름이 붙어야 하므로 같은 대우를 합니다.
            if (closed && !lab.was && lab.want >= 100 && lab.want < 500) {
                lab.on = false;
                continue;
            }
            const lit = lab.want >= 500 && lab.want < 650;
            // 좁은 띠에서는 고른 점의 이름만 그렇게 하고, 나머지는 자리가 될 때만 띄웁니다.
            // 톡 해서 띄운 이름은 점 곁에 있어야 하므로, 빽빽한 곳에서는 점을 덮는 자리라도 씁니다(이름표·고리와는 겹치지 않게. 자리가 없으면 띄우지 않습니다).
            const peeked = p.id === E.peekId && lab.want < 100;
            const strong = narrow ? p === ringP : peeked || lab.want >= 650 || (lit && E.hotSet && E.hotSet.size <= 42);
            // 걸러 보기로 다가가는 동안에는 새 이름을 띄우지 않습니다. 자리가 잡힌 뒤에, 점을 덮지 않는 곳에만 띄웁니다
            // (다가가는 중에 띄우면 점들이 그 밑으로 들어와 이름이 점을 덮게 됩니다).
            if (lit && !strong && settling && !lab.was) {
                lab.on = false;
                continue;
            }
            const { w, h } = lab.size;
            // 바깥(뇌 가운데에서 멀어지는 쪽)으로 지시선을 뽑습니다. 매장·묶음은 뇌 바깥 여백까지 길게 뽑습니다.
            let ux = p.sx - bx;
            let uy = p.sy - by;
            const far = Math.hypot(ux, uy);
            if (far < 6) {
                ux = -0.55;
                uy = 0.83;
            } else {
                ux /= far;
                uy /= far;
            }
            if (p.level === 0) {
                ux = 0.42;
                uy = 0.9;
            }
            const callout = p.level <= 1 && roomy;
            const outside = !callout && upright && p !== justPulled && !peeked && cloudBottom > cloudTop;
            // 점 가까이부터 놓아 보고, 빽빽한 곳에서는 지시선을 길게 뽑아 빈 곳에 놓습니다(점을 덮지 않게).
            let gaps = [p.rr + 8, p.rr + 18, p.rr + 30, p.rr + 46, p.rr + 64, p.rr + 86, p.rr + 110];
            if (outside) {
                // 위쪽 절반의 점은 위 여백으로, 아래쪽 절반과 매장은 아래 여백으로(옆으로는 조금만 벌어지게).
                const below = p.level === 0 || p.sy >= by;
                ux = clamp((p.sx - bx) / Math.max(1, E.w / 2), -1, 1) * 0.3;
                uy = below ? 1 : -1;
                const long = Math.hypot(ux, uy);
                ux /= long;
                uy /= long;
                const out = Math.max(p.rr + 10, (below ? cloudBottom - p.sy : p.sy - cloudTop) / Math.abs(uy) + 8);
                gaps = [out, out + 24, out + 48, p.rr + 11, p.rr + 22, p.rr + 36, p.rr + 52, p.rr + 70, p.rr + 92];
            } else if (callout) {
                // 뇌 가운데에서 이 점을 지나 타원 밖으로 나가는 거리
                const edge = 1 / Math.sqrt((ux / rx) ** 2 + (uy / ry) ** 2);
                const out = Math.max(p.rr + 12, edge - far + 6);
                gaps = [out, out + 20, p.rr + 12, p.rr + 26, p.rr + 44, p.rr + 64, p.rr + 88];
            } else if (p.level <= 1) {
                gaps = [p.rr + 11, p.rr + 22, p.rr + 36, p.rr + 52, p.rr + 70, p.rr + 92, p.rr + 116];
                // 걸러 보느라 점들이 빽빽이 모였을 때는 묶음 이름도 더 멀리 빼서 점을 덮지 않게 합니다.
                if (E.hotSet) gaps.push(p.rr + 144, p.rr + 176);
            } else if (lit) {
                // 걸러 본 점들은 빽빽하게 모여 있으므로, 둘레의 빈 곳까지 지시선을 길게 뽑을 수 있게 합니다.
                gaps.push(p.rr + 138, p.rr + 170, p.rr + 206);
            }
            // 고른 점의 이름은 고리 밖에서 시작합니다.
            if (p === ringP) {
                const extra = Math.max(0, ringR + 3 - (p.rr + 8));
                if (extra) gaps = gaps.map((gap) => gap + extra);
            }
            // 사라지는 중인 라벨은 다 사라진 뒤에 새 자리를 찾습니다. 방금 자리를 못 찾은 라벨은 조금 있다가 다시 찾습니다.
            if (!lab.was && (lab.a > 0.06 || E.clock < lab.retryAt)) {
                lab.on = false;
                continue;
            }
            const count = ANGLES.length * gaps.length;
            // 쓰던 자리부터 다시 확인합니다. 그 자리가 막혔으면 다음 빈 자리로 옮겨 갑니다(껐다 켜지 않음).
            const mode = callout ? 1 : outside ? 2 : 0;
            const kept = lab.was && lab.dir >= 0 && lab.mode === mode;
            // 꺼졌다 다시 뜨는 이름표도 전에 있던 자리부터 찾습니다(같은 이름표가 매번 다른 곳에 뜨지 않게).
            const start = lab.dir >= 0 && lab.mode === mode ? lab.dir % count : 0;
            // 이미 떠 있는 이름표는 제 점에 붙은 그대로 둡니다(점과 함께 움직임). 그래야 쉬는 화면에서 '도는 동안 무엇과도 부딪치지 않는 자리'가
            // 계속 그런 자리로 남고, 점에 올리거나 고를 때 이름표가 몇 px 씩 옮겨 가지 않습니다(이름표 위에 올린 포인터가 빗나가지 않게).
            // 손으로 돌리는 중이거나 보는 자리가 바뀌는 중에는 방향에 맞춰 다시 놓습니다.
            const rigid = kept && !settling && !cam.held;
            let done = false;
            // 자리 고르기: 점을 덮지 않는 자리 가운데, 쓰던 자리가 있으면 거기서 가장 가까운 곳(멀리 날아가지 않게).
            // 늘 보여야 하는 이름(매장·묶음·고른 점, 40개 이하로 걸러 본 점)은 점을 피할 자리가 하나도 없으면 가장 덜 덮는 자리에 둡니다.
            // 나머지는 점을 덮지 않는 자리가 있을 때만 띄웁니다(걸러 보기로 다가가는 동안에는 이미 떠 있는 이름을 끄지 않고 기다립니다).
            const fallback = strong || (kept && lit && settling);
            // 폰에서는 이름표 사이를 조금 좁혀(8px) 더 많은 점에 이름을 답니다.
            const pad = E.lite ? 8 : LABEL_GAP;
            let pick = -1;
            let pickX = 0;
            let pickY = 0;
            let pickCost = Infinity;
            let least = Infinity;
            let leastIndex = -1;
            let leastX = 0;
            let leastY = 0;
            let leastCost = Infinity;
            for (let step = rigid ? -1 : 0; step < count; step += 1) {
                // step -1: 지금 붙어 있는 자리 그대로
                let index = lab.dir;
                let x0 = p.sx + lab.tx;
                let y0 = p.sy + lab.ty;
                if (step >= 0) {
                    index = (start + step) % count;
                    const angle = ANGLES[index % ANGLES.length];
                    const gap = gaps[Math.floor(index / ANGLES.length)];
                    const cos = Math.cos(angle);
                    const sin = Math.sin(angle);
                    const dx = ux * cos - uy * sin;
                    const dy = ux * sin + uy * cos;
                    x0 = p.sx + dx * gap - w / 2 + dx * (w / 2);
                    y0 = p.sy + dy * gap - h / 2 + dy * (h / 2);
                }
                // 쓰던 자리인지(점이 조금 스치는 정도로는 버리지 않음), 그리고 도는 길까지 확인해 둔 자리인지
                const same = kept && step === (rigid ? -1 : 0);
                const trusted = same && (!sweeping || lab.swept);
                if (x0 < 8 || y0 < 6 || x0 + w > E.w - 8 || y0 + h > E.h - 6) continue;
                if (overlaps(x0, y0, x0 + w, y0 + h, placed, pad)) continue;
                // 고른 점의 고리 위에는 얹지 않습니다(고른 점 자신의 이름도 고리 밖에 둡니다).
                if (ringP) {
                    const nx = clamp(ringP.sx, x0, x0 + w);
                    const ny = clamp(ringP.sy, y0, y0 + h);
                    if ((nx - ringP.sx) * (nx - ringP.sx) + (ny - ringP.sy) * (ny - ringP.sy) < (ringR + 2) * (ringR + 2)) continue;
                }
                if (!lab.was && fading.some((b) => b[4] !== p && x0 < b[2] + 4 && x0 + w > b[0] - 4 && y0 < b[3] + 4 && y0 + h > b[1] - 4)) continue;
                // 톡 해서 띄운 이름은 쪽지 모양(바탕이 있음)이라 다른 점 위에 놓여도 읽힙니다. 점 바로 곁의 첫 자리를 쓰되, 제 점은 덮지 않습니다.
                if (peeked) {
                    const nx = clamp(p.sx, x0, x0 + w);
                    const ny = clamp(p.sy, y0, y0 + h);
                    if ((nx - p.sx) * (nx - p.sx) + (ny - p.sy) * (ny - p.sy) < (p.rr + 5) * (p.rr + 5)) continue;
                }
                let covered = peeked ? 0 : dotsUnder(x0, y0, x0 + w, y0 + h, p, same ? 0.5 : 3, fallback ? least + 1 : 1);
                // 쉬는 화면: 지금은 비어 있어도, 뇌가 도는 동안 점이 밑으로 들어오거나 다른 이름표·단추·무대 끝과 부딪칠 자리는 쓰지 않습니다.
                if (sweeping && !trusted && !peeked) {
                    if (covered === 0) covered = sweptUnder(x0, y0, x0 + w, y0 + h, p, same ? 1.5 : 3.5, fallback ? least + 1 : 1);
                    if (sweptOut(x0, y0, x0 + w, y0 + h, p) || sweptClash(x0, y0, x0 + w, y0 + h, p, pad + (same ? 0 : 3))) {
                        // 늘 보여야 하는 이름은 그런 자리라도 후보로 남깁니다(더 나은 자리가 없을 때만 씀).
                        if (!strong) continue;
                        covered += 2;
                    }
                }
                // 쓰던 자리에서 얼마나 옮겨 가야 하는지. 새로 뜨는 이름표는 점에 가까운 자리부터(찾는 순서대로).
                const cost = kept ? Math.hypot(x0 - p.sx - lab.tx, y0 - p.sy - lab.ty) : step;
                if (covered === 0) {
                    if (cost < pickCost) {
                        pickCost = cost;
                        pick = index;
                        pickX = x0;
                        pickY = y0;
                    }
                    // 쓰던 자리가 그대로 좋거나, 새로 뜨는 이름표가 첫 자리를 찾았으면 더 보지 않습니다.
                    if (!kept || same) break;
                } else if (fallback && (covered < least || (covered === least && cost < leastCost))) {
                    least = covered;
                    leastIndex = index;
                    leastX = x0;
                    leastY = y0;
                    leastCost = cost;
                }
            }
            // 도는 길까지 확인한 자리인지 적어 둡니다(확인하지 못한 자리는 쉬는 화면에서 다시 확인합니다).
            let checked = steady;
            // (폰의 걸러 보기에서는 점을 둘 이상 덮어야만 놓을 수 있는 이름은 띄우지 않습니다. 좁은 무대에서 이름이 점 줄을 통째로 덮기 때문입니다.)
            // 걸러 본 항목이 열두 개쯤 이하면 그 규칙 없이 전부 이름을 답니다.
            if (pick < 0 && fallback && leastIndex >= 0 && !(E.lite && lit && least > 1 && E.hotSet && E.hotSet.size > 14)) {
                pick = leastIndex;
                pickX = leastX;
                pickY = leastY;
                checked = false;
            }
            if (pick >= 0) {
                lab.dir = pick;
                lab.mode = mode;
                lab.tx = pickX - p.sx;
                lab.ty = pickY - p.sy;
                lab.swept = checked;
                placed.push([pickX, pickY, pickX + w, pickY + h, p]);
                done = true;
            }
            lab.on = done;
            if (done) shown.push(p);
            else lab.retryAt = E.clock + 0.25;
        }
        // 이번 프레임에 막 꺼진 라벨 자리와 겹치는 새 라벨은 한 박자 늦춥니다.
        const closing = [];
        for (const p of E.list) {
            const lab = p.lab;
            if (lab.want < 0) lab.on = false;
            if (lab.was && !lab.on && lab.size) closing.push([lab.x, lab.y, lab.x + lab.size.w, lab.y + lab.size.h]);
        }
        if (closing.length && !E.reduced) {
            for (const p of shown) {
                const lab = p.lab;
                if (!lab.was && overlaps(p.sx + lab.tx, p.sy + lab.ty, p.sx + lab.tx + lab.size.w, p.sy + lab.ty + lab.size.h, closing, 4)) lab.on = false;
            }
        }
        if (!tagsDone) placeTags();
        // 자리가 없어 숨긴 관계 이름표의 수를 고른(올린) 점의 이름 옆에 적습니다("연결 종류 +3").
        const more = E.more;
        more.n = selfP ? Math.max(0, E.tagTotal - E.tags.reduce((sum, tag) => sum + (tag.on ? 1 : 0), 0)) : 0;
        more.on = false;
        if (more.n > 0 && more.w && selfP.lab.on && selfP.lab.size) {
            const lx = selfP.sx + selfP.lab.tx;
            const ly = selfP.sy + selfP.lab.ty;
            const { w, h } = selfP.lab.size;
            const tries = [[lx + w + 6, ly + (h - more.h) / 2], [lx - more.w - 6, ly + (h - more.h) / 2], [lx, ly + h + 5], [lx, ly - more.h - 5]];
            for (const [x0, y0] of tries) {
                if (x0 < 8 || y0 < 6 || x0 + more.w > E.w - 8 || y0 + more.h > E.h - 6) continue;
                if (overlaps(x0, y0, x0 + more.w, y0 + more.h, placed, 4) || dotsUnder(x0, y0, x0 + more.w, y0 + more.h, null, 1.5, 1)) continue;
                more.x = x0;
                more.y = y0;
                more.on = true;
                placed.push([x0, y0, x0 + more.w, y0 + more.h]);
                break;
            }
        }
        more.a = more.on ? more.a + (1 - more.a) * tagRate : 0;
        settleLabels(dt, false);
        E.labels.shown = shown;
    }

    E.dispose = () => {
        E.onFrame = null;
        E.events.length = 0;
        E.grab = null;
        E.string = null;
        E.charge = null;
        E.pull.reset();
    };

    return E;
}
