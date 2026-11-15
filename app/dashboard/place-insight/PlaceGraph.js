'use client';

import { forwardRef, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import styles from './PlaceGraph.module.css';

// 단계별 점 크기와 밀어내는 힘(0: 매장, 1: 키워드·묶음, 2: 세부 값)
const RADIUS = [22, 8, 5];
const CHARGE = [2600, 1300, 560];
const LINE_HEIGHT = [18, 15, 14];
const EDGE_PAD = 10;
// 라벨 상자끼리 띄우는 최소 간격
const LABEL_GAP = 5;
// 새 점이 부모 쪽에서 제자리로 퍼져 나가는 시간(ms)과 출발 지점(부모→제자리 거리의 비율)
const BLOOM_MS = 760;
const BLOOM_FROM = 0.3;
// 번짐(글로우) 원의 반지름 여유와 흐림 필터 이름(단계별)
const GLOW_PAD = [5, 2, 1.5];
const GLOW_FILTER = ['glow-store', 'glow-hub', 'glow-leaf'];
// 점 가장자리에서 라벨까지의 거리(단계별). 매장·묶음 점은 둘레 고리 바깥에 라벨을 둡니다.
const LABEL_OFFSET = [17, 7, 5];

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function phaseOf(id) {
    let hash = 0;
    for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) | 0;
    return ((hash >>> 0) % 6283) / 1000;
}

// 그래프 칸이 가로로 넓어서 1단계 점은 원이 아니라 타원 궤도에 놓습니다.
function geometry(w, h) {
    const r2 = clamp(Math.min(w, h) * 0.13, 38, 62);
    return {
        cx: w / 2,
        cy: h / 2,
        r2,
        rx: clamp(w / 2 - r2 - 96, 84, 270),
        ry: clamp(h / 2 - r2 - 34, 78, 220),
    };
}

function orbitRadius(rx, ry, dx, dy) {
    const d = Math.hypot(dx, dy) || 1;
    const c = dx / d;
    const s = dy / d;
    return (rx * ry) / Math.sqrt((ry * c) ** 2 + (rx * s) ** 2);
}

// 처음 놓을 자리: 딸린 점이 많은 묶음일수록 둘레를 넓게 차지하고, 검색 키워드는 위쪽에 모읍니다.
function seedAngles(nodes, childCount) {
    const angles = new Map();
    const level1 = nodes.filter((node) => node.level === 1);
    const weight = (node) => 1.3 + (childCount.get(node.id) || 0) * 0.42;
    const total = level1.reduce((sum, node) => sum + weight(node), 0) || 1;
    const search = level1.filter((node) => node.group === 'search');
    const searchSpan = (search.reduce((sum, node) => sum + weight(node), 0) / total) * Math.PI * 2;
    let cursor = -Math.PI / 2 - searchSpan / 2;
    for (const node of level1) {
        const span = (weight(node) / total) * Math.PI * 2;
        angles.set(node.id, cursor + span / 2);
        cursor += span;
    }
    const children = new Map();
    for (const node of nodes) {
        if (node.level !== 2) continue;
        const list = children.get(node.parent) || [];
        list.push(node);
        children.set(node.parent, list);
    }
    for (const [parent, list] of children) {
        const base = angles.get(parent) ?? 0;
        list.forEach((node, index) => angles.set(node.id, base + (index - (list.length - 1) / 2) * 0.62));
    }
    return angles;
}

// 라벨 자리를 정합니다. 끝 점은 부모에서 바깥쪽으로, 딸린 점이 있는 묶음은 그 방향을 비켜 옆이나 위아래로 둡니다.
// 자리가 프레임마다 뒤집히지 않도록 경계에서는 이전 자리를 유지합니다.
function placeLabels(sim) {
    for (const p of sim.list) {
        const width = Math.max(p.lw, p.sw);
        if (!width) {
            p.box = null;
            continue;
        }
        const height = ((p.lw ? 1 : 0) + (p.sw ? 1 : 0)) * p.lh;
        let side = 'b';
        if (p.level > 0) {
            const origin = p.origin || sim.center;
            let dx = p.x - origin.x;
            let dy = p.y - origin.y;
            const d = Math.hypot(dx, dy) || 1;
            dx /= d;
            dy /= d;
            const horizontal = p.side === 'l' || p.side === 'r';
            if (p.hub) {
                const sideways = Math.abs(dy) > (horizontal ? 0.62 : 0.78);
                if (sideways) side = p.x >= sim.center.x ? 'r' : 'l';
                else side = dy >= 0 ? 'b' : 't';
            } else {
                // 옆으로 뻗는 라벨은 위아래로 촘촘히 쌓여도 안 겹치므로, 거의 수직 방향일 때만 위아래에 둡니다.
                const sideways = Math.abs(dx) > (horizontal ? 0.16 : 0.26);
                if (sideways) side = dx >= 0 ? 'r' : 'l';
                else side = dy >= 0 ? 'b' : 't';
            }
        }
        p.side = side;
        const gap = p.r + LABEL_OFFSET[Math.min(p.level, 2)];
        if (side === 'r') p.box = { x0: gap, x1: gap + width, y0: -height / 2, y1: height / 2 };
        else if (side === 'l') p.box = { x0: -gap - width, x1: -gap, y0: -height / 2, y1: height / 2 };
        else if (side === 't') p.box = { x0: -width / 2, x1: width / 2, y0: -gap - height + 1, y1: -gap + 1 };
        else p.box = { x0: -width / 2, x1: width / 2, y0: gap - 1, y1: gap - 1 + height };
    }
}

function pushApart(p, q, a, b, weight) {
    const ox = Math.min(p.x + a.x1, q.x + b.x1) - Math.max(p.x + a.x0, q.x + b.x0) + LABEL_GAP;
    if (ox <= 0) return;
    const oy = Math.min(p.y + a.y1, q.y + b.y1) - Math.max(p.y + a.y0, q.y + b.y0) + LABEL_GAP;
    if (oy <= 0) return;
    // 속도로 밀고(부드러운 움직임), 자리도 조금씩 직접 옮깁니다(선의 당김에 눌려 겹친 채 멈추지 않게).
    const axis = oy <= ox ? 'y' : 'x';
    const over = Math.min(axis === 'y' ? oy : ox, 14);
    const pMid = axis === 'y' ? p.y + (a.y0 + a.y1) / 2 : p.x + (a.x0 + a.x1) / 2;
    const qMid = axis === 'y' ? q.y + (b.y0 + b.y1) / 2 : q.x + (b.x0 + b.x1) / 2;
    const dir = pMid < qMid ? -1 : 1;
    const force = over * 0.05 * weight;
    const nudge = over * 0.1 * weight;
    const speed = axis === 'y' ? 'vy' : 'vx';
    p[speed] += dir * force;
    q[speed] -= dir * force;
    if (!p.pinned && !p.fixed) p[axis] += dir * nudge;
    if (!q.pinned && !q.fixed) q[axis] -= dir * nudge;
}

// 라벨끼리, 라벨과 다른 점이 겹치면 서로 밀어냅니다.
function separateLabels(sim) {
    const list = sim.list;
    for (let i = 0; i < list.length; i += 1) {
        const p = list[i];
        for (let j = i + 1; j < list.length; j += 1) {
            const q = list[j];
            if (Math.abs(q.x - p.x) > 280 || Math.abs(q.y - p.y) > 96) continue;
            if (p.box && q.box) pushApart(p, q, p.box, q.box, 1);
            if (p.box) pushApart(p, q, p.box, q.dot, 1);
            if (q.box) pushApart(p, q, p.dot, q.box, 1);
        }
    }
}

// 밀어내도 남는 겹침은 낮은 단계 라벨을 숨겨 정리합니다(숨긴 라벨은 점에 올리면 보임).
// 숨긴 라벨은 여유가 생겨야 다시 나타나서 경계에서 깜빡이지 않습니다.
function cullLabels(sim) {
    const shown = [];
    for (const p of sim.order) {
        if (!p.box) {
            p.hidden = false;
            continue;
        }
        const slack = p.hidden ? 4 : -1;
        const x0 = p.x + p.box.x0 - slack;
        const x1 = p.x + p.box.x1 + slack;
        const y0 = p.y + p.box.y0 - slack;
        const y1 = p.y + p.box.y1 + slack;
        let clash = false;
        for (const other of shown) {
            if (x0 < other.x1 && x1 > other.x0 && y0 < other.y1 && y1 > other.y0) {
                clash = true;
                break;
            }
        }
        // 같거나 높은 단계의 다른 점이 라벨 위에 올라와 있어도 숨깁니다(글자가 점에 가려 읽히지 않으므로).
        if (!clash) {
            for (const q of sim.list) {
                if (q === p || q.level > p.level) continue;
                if (x0 < q.x + q.r - 1 && x1 > q.x - q.r + 1 && y0 < q.y + q.r - 1 && y1 > q.y - q.r + 1) {
                    clash = true;
                    break;
                }
            }
        }
        p.hidden = clash;
        if (!clash) shown.push({ x0: p.x + p.box.x0, x1: p.x + p.box.x1, y0: p.y + p.box.y0, y1: p.y + p.box.y1 });
    }
}

function step(sim, time, drift) {
    const list = sim.list;
    const count = list.length;
    for (let i = 0; i < count; i += 1) {
        const p = list[i];
        for (let j = i + 1; j < count; j += 1) {
            const q = list[j];
            let dx = q.x - p.x;
            let dy = q.y - p.y;
            let d2 = dx * dx + dy * dy;
            if (d2 < 0.01) {
                dx = 0.1 * (j - i);
                dy = 0.1;
                d2 = dx * dx + dy * dy;
            }
            if (d2 > 250000) continue;
            const d = Math.sqrt(d2);
            const force = ((p.charge + q.charge) / 2) / d2;
            const fx = (dx / d) * force;
            const fy = (dy / d) * force;
            p.vx -= fx;
            p.vy -= fy;
            q.vx += fx;
            q.vy += fy;
        }
    }
    for (const link of sim.links) {
        const dx = link.b.x - link.a.x;
        const dy = link.b.y - link.a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const len = link.orbit ? orbitRadius(sim.rx, sim.ry, dx, dy) : link.len;
        const k = ((d - len) / d) * 0.08;
        link.a.vx += dx * k * 0.75;
        link.a.vy += dy * k * 0.75;
        link.b.vx -= dx * k * 0.25;
        link.b.vy -= dy * k * 0.25;
    }
    placeLabels(sim);
    separateLabels(sim);
    for (const p of list) {
        if (p.pinned) {
            p.x = sim.center.x;
            p.y = sim.center.y;
            p.vx = 0;
            p.vy = 0;
            continue;
        }
        if (p.fixed) {
            p.vx = 0;
            p.vy = 0;
            continue;
        }
        p.vx += (sim.center.x - p.x) * 0.0012;
        p.vy += (sim.center.y - p.y) * 0.0018;
        // 1단계 점은 처음 정한 방향으로 살짝 당겨 둡니다. 라벨끼리 미는 힘이 한쪽으로 쌓여 그래프 전체가 천천히 도는 것을 막습니다.
        if (p.home !== null) {
            const dx = p.x - sim.center.x;
            const dy = p.y - sim.center.y;
            const d = Math.hypot(dx, dy) || 1;
            let turn = p.home - Math.atan2(dy, dx);
            if (turn > Math.PI) turn -= Math.PI * 2;
            else if (turn < -Math.PI) turn += Math.PI * 2;
            const pull = clamp(turn, -0.7, 0.7) * 0.55;
            p.vx += (-dy / d) * pull;
            p.vy += (dx / d) * pull;
        }
        if (drift) {
            p.vx += Math.cos(time * 0.00052 + p.phase) * 0.02;
            p.vy += Math.sin(time * 0.00041 + p.phase * 1.7) * 0.02;
        }
        p.vx = clamp(p.vx * 0.78, -10, 10);
        p.vy = clamp(p.vy * 0.78, -10, 10);
        // 점뿐 아니라 라벨까지 그래프 칸 안에 들어오게 가장자리를 잡습니다.
        const box = p.box;
        const left = box ? Math.max(p.r, -box.x0) : p.r;
        const right = box ? Math.max(p.r, box.x1) : p.r;
        const top = box ? Math.max(p.r, -box.y0) : p.r;
        const bottom = box ? Math.max(p.r, box.y1) : p.r;
        p.x = clamp(p.x + p.vx, EDGE_PAD + left, Math.max(EDGE_PAD + left, sim.w - EDGE_PAD - right));
        p.y = clamp(p.y + p.vy, EDGE_PAD + top, Math.max(EDGE_PAD + top, sim.h - EDGE_PAD - bottom));
    }
}

function settle(sim, rounds) {
    for (let i = 0; i < rounds; i += 1) step(sim, 0, false);
    placeLabels(sim);
    cullLabels(sim);
}

// 화면에 그릴 자리(sx·sy)를 정합니다. 갓 생긴 점은 부모(1단계는 매장) 쪽에서 제자리로 퍼져 나가고,
// 힘 계산에 쓰는 실제 자리(x·y)는 건드리지 않습니다. 부모가 먼저 계산되도록 단계 순서(sim.order)로 돕니다.
function paint(sim, now = performance.now()) {
    const blooming = !sim.reduced && now < sim.bloomUntil;
    for (const p of sim.order) {
        p.sx = p.x;
        p.sy = p.y;
        if (blooming && p.level > 0) {
            const t = clamp((now - p.born) / BLOOM_MS, 0, 1);
            if (t < 1) {
                const ox = p.origin ? p.origin.sx : sim.center.x;
                const oy = p.origin ? p.origin.sy : sim.center.y;
                const k = BLOOM_FROM + (1 - BLOOM_FROM) * (1 - (1 - t) ** 3);
                p.sx = ox + (p.x - ox) * k;
                p.sy = oy + (p.y - oy) * k;
            }
        }
        if (!p.el) continue;
        p.el.setAttribute('transform', `translate(${p.sx.toFixed(1)},${p.sy.toFixed(1)})`);
        if (p.box && p.side !== p.paintedSide) {
            p.paintedSide = p.side;
            const anchor = p.side === 'r' ? 'start' : p.side === 'l' ? 'end' : 'middle';
            const x = p.side === 'r' ? p.box.x0 : p.side === 'l' ? p.box.x1 : 0;
            let line = 0;
            for (const text of [p.labelEl, p.subEl]) {
                if (!text) continue;
                text.setAttribute('text-anchor', anchor);
                text.setAttribute('x', x.toFixed(1));
                text.setAttribute('y', (p.box.y0 + p.lh * (line + 0.78)).toFixed(1));
                line += 1;
            }
        }
        if (p.hidden !== p.paintedHidden && p.tagEl) {
            p.paintedHidden = p.hidden;
            if (p.hidden) p.tagEl.setAttribute('data-hide', 'true');
            else p.tagEl.removeAttribute('data-hide');
        }
    }
    // 선 묶음의 자식은 그래디언트 1개 + 선 3개(빛 번짐·기본선·흐르는 점)이고, 모두 같은 양 끝 좌표(x1·y1 = 딸린 점, x2·y2 = 부모)를 씁니다.
    for (const link of sim.links) {
        if (!link.el) continue;
        const x1 = link.a.sx.toFixed(1);
        const y1 = link.a.sy.toFixed(1);
        const x2 = link.b.sx.toFixed(1);
        const y2 = link.b.sy.toFixed(1);
        for (const part of link.el.children) {
            part.setAttribute('x1', x1);
            part.setAttribute('y1', y1);
            part.setAttribute('x2', x2);
            part.setAttribute('y2', y2);
        }
    }
}

function measure(sim) {
    for (const p of sim.list) {
        p.lw = p.labelEl ? p.labelEl.getComputedTextLength() : 0;
        p.sw = p.subEl ? p.subEl.getComputedTextLength() : 0;
    }
}

// 옵시디언 그래프 뷰처럼 매장을 가운데 두고 키워드·순위·리뷰·결제 데이터를 점과 선으로 잇습니다.
// 점 위치는 React 렌더 없이 requestAnimationFrame 에서 직접 옮기고, 화면 밖이거나 탭이 숨으면 멈춥니다.
// 바깥(요약·카드)에서는 ref.focus(id) 로 같은 점을 밝히고, onHover 로 지금 가리킨 점을 받습니다.
const PlaceGraph = forwardRef(function PlaceGraph(
    { nodes, links, mode = 'live', label, title = '연결 그래프', legend = [], hint, onSelect, onHover, children },
    ref,
) {
    const wrapRef = useRef(null);
    const svgRef = useRef(null);
    const nodeEls = useRef(new Map());
    const linkEls = useRef(new Map());
    const sim = useRef({ pos: new Map(), list: [], order: [], links: [], w: 720, h: 480, center: { x: 360, y: 240 }, rx: 200, ry: 140, reduced: false, drag: null, frame: 0, bloomUntil: 0 });
    // 한 화면에 그래프가 여러 개여도 필터·그래디언트 이름이 겹치지 않게 합니다.
    const uid = `pg${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
    const hoverCb = useRef(onHover);
    hoverCb.current = onHover;
    const [size, setSize] = useState({ w: 720, h: 480 });
    const [hover, setHover] = useState(null);
    const [linked, setLinked] = useState(null);
    const [linkedGroup, setLinkedGroup] = useState(null);
    const [group, setGroup] = useState(null);
    const [pinnedGroup, setPinnedGroup] = useState(null);
    const [ping, setPing] = useState(null);

    const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
    const childCount = useMemo(() => {
        const map = new Map();
        for (const node of nodes) if (node.parent) map.set(node.parent, (map.get(node.parent) || 0) + 1);
        return map;
    }, [nodes]);
    // 가리킨 점과 함께 밝힐 점: 매장까지 올라가는 길과 바로 딸린 점
    const related = useMemo(() => {
        const map = new Map();
        const kids = new Map();
        for (const node of nodes) {
            if (!node.parent) continue;
            if (!kids.has(node.parent)) kids.set(node.parent, []);
            kids.get(node.parent).push(node.id);
        }
        for (const node of nodes) {
            const set = new Set([node.id, ...(kids.get(node.id) || [])]);
            let parent = node.parent;
            while (parent) {
                set.add(parent);
                parent = nodeById.get(parent)?.parent;
            }
            map.set(node.id, set);
        }
        return map;
    }, [nodes, nodeById]);
    // 나타나는 차례(ms): 매장 → 1단계 → 각 묶음에 딸린 점. 가운데에서 바깥으로 번지듯 보이게 합니다.
    const delays = useMemo(() => {
        const map = new Map();
        const kids = new Map();
        let hubs = 0;
        for (const node of nodes) {
            if (node.level === 0) map.set(node.id, 0);
            if (node.level !== 1) continue;
            map.set(node.id, 120 + hubs * 40);
            hubs += 1;
        }
        for (const node of nodes) {
            if (node.level < 2) continue;
            const nth = kids.get(node.parent) || 0;
            kids.set(node.parent, nth + 1);
            map.set(node.id, (map.get(node.parent) ?? 120) + 170 + nth * 45);
        }
        return map;
    }, [nodes]);

    useImperativeHandle(ref, () => ({
        // 'group:search' 처럼 넘기면 점 하나가 아니라 그 묶음 전체를 밝힙니다.
        focus(id) {
            const groupId = typeof id === 'string' && id.startsWith('group:') ? id.slice(6) : null;
            setLinkedGroup(groupId);
            setLinked(!groupId && id && nodeById.has(id) ? id : null);
        },
        ping(id) {
            if (id && nodeById.has(id)) setPing({ id, at: Date.now() });
        },
    }), [nodeById]);

    useEffect(() => {
        hoverCb.current?.(hover ? nodeById.get(hover) || null : null);
    }, [hover, nodeById]);

    useEffect(() => {
        const el = wrapRef.current;
        if (!el) return undefined;
        const measureBox = () => {
            const rect = el.getBoundingClientRect();
            const w = Math.max(280, Math.round(rect.width));
            const h = Math.max(300, Math.round(rect.height));
            setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
        };
        measureBox();
        if (typeof ResizeObserver === 'undefined') return undefined;
        const observer = new ResizeObserver(measureBox);
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    useLayoutEffect(() => {
        const s = sim.current;
        const { w, h } = size;
        const { cx, cy, rx, ry, r2 } = geometry(w, h);
        // 이 효과는 반복 루프를 거는 효과보다 먼저 돌기 때문에 '움직임 줄이기' 설정을 여기서 읽습니다.
        s.reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
        Object.assign(s, { w, h, rx, ry, center: { x: cx, y: cy } });
        const angles = seedAngles(nodes, childCount);
        const next = new Map();
        const now = performance.now();
        nodes.forEach((node, index) => {
            let p = s.pos.get(node.id);
            if (!p) {
                const angle = angles.get(node.id) ?? 0;
                const parent = node.parent ? next.get(node.parent) : null;
                if (node.level === 2 && parent) p = { x: parent.x + Math.cos(angle) * r2, y: parent.y + Math.sin(angle) * r2 };
                else if (node.level === 1) p = { x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry };
                else p = { x: cx, y: cy };
                // born: 이 점이 화면에 나타나기 시작하는 시각. CSS 등장 애니메이션의 지연(--d)과 같은 값입니다.
                Object.assign(p, { vx: 0, vy: 0, phase: phaseOf(node.id), born: now + (delays.get(node.id) || 0) });
                s.bloomUntil = Math.max(s.bloomUntil, p.born + BLOOM_MS);
            }
            const level = Math.min(node.level, 2);
            const el = nodeEls.current.get(node.id) || null;
            Object.assign(p, {
                index,
                level: node.level,
                r: RADIUS[level],
                lh: LINE_HEIGHT[level],
                charge: CHARGE[level],
                pinned: node.level === 0,
                home: node.level === 1 && angles.has(node.id) ? Math.atan2(Math.sin(angles.get(node.id)) * ry, Math.cos(angles.get(node.id)) * rx) : null,
                hub: node.level === 1 && (childCount.get(node.id) || 0) > 0,
                origin: node.level === 2 ? next.get(node.parent) || null : null,
                dot: { x0: -RADIUS[level] - 1, x1: RADIUS[level] + 1, y0: -RADIUS[level] - 1, y1: RADIUS[level] + 1 },
                el,
                tagEl: el?.querySelector('[data-part="tag"]') || null,
                labelEl: el?.querySelector('[data-part="label"]') || null,
                subEl: el?.querySelector('[data-part="sub"]') || null,
                paintedSide: null,
                paintedHidden: null,
            });
            next.set(node.id, p);
        });
        s.pos = next;
        s.list = [...next.values()];
        s.order = [...s.list].sort((a, b) => a.level - b.level || a.index - b.index);
        s.links = links
            .map((link) => {
                const a = next.get(link.source);
                const b = next.get(link.target);
                if (!a || !b) return null;
                return { a, b, orbit: nodeById.get(link.target)?.level === 0, len: r2, el: linkEls.current.get(link.id) || null };
            })
            .filter(Boolean);
        measure(s);
        settle(s, s.reduced ? 360 : 90);
        paint(s, now);
        // 자리가 정해진 뒤에 점을 보이게 하고 등장 애니메이션을 시작합니다(서버가 그린 화면에서 점이 한쪽 구석에 몰려 보이지 않게).
        svgRef.current?.setAttribute('data-ready', 'true');

        // 웹 글꼴이 늦게 들어오면 글자 폭이 달라지므로 한 번 더 잽니다.
        let cancelled = false;
        document.fonts?.ready?.then(() => {
            if (cancelled) return;
            measure(s);
            for (const p of s.list) p.paintedSide = null;
            if (s.reduced) settle(s, 120);
            paint(s);
        });
        return () => {
            cancelled = true;
        };
    }, [nodes, links, nodeById, childCount, delays, size]);

    useEffect(() => {
        const s = sim.current;
        const el = wrapRef.current;
        if (!el || s.reduced) return undefined;
        let raf = 0;
        let visible = true;
        const loop = (time) => {
            step(s, time, true);
            s.frame += 1;
            if (s.frame % 6 === 0) cullLabels(s);
            paint(s, time);
            raf = requestAnimationFrame(loop);
        };
        const start = () => {
            if (!raf && visible && !document.hidden) raf = requestAnimationFrame(loop);
        };
        const stop = () => {
            cancelAnimationFrame(raf);
            raf = 0;
        };
        const onVisibility = () => (document.hidden ? stop() : start());
        let observer = null;
        if (typeof IntersectionObserver !== 'undefined') {
            observer = new IntersectionObserver(([entry]) => {
                visible = entry.isIntersecting;
                if (visible) start();
                else stop();
            });
            observer.observe(el);
        }
        document.addEventListener('visibilitychange', onVisibility);
        start();
        return () => {
            stop();
            observer?.disconnect();
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, []);

    const toLocal = (event) => {
        const svg = svgRef.current;
        const matrix = svg?.getScreenCTM();
        if (!matrix) return null;
        const point = svg.createSVGPoint();
        point.x = event.clientX;
        point.y = event.clientY;
        return point.matrixTransform(matrix.inverse());
    };

    const onNodeDown = (event, node) => {
        if (event.button !== undefined && event.button !== 0) return;
        sim.current.drag = { id: node.id, node, x: event.clientX, y: event.clientY, moved: false };
        event.currentTarget.setPointerCapture?.(event.pointerId);
    };

    const onPointerMove = (event) => {
        const s = sim.current;
        const drag = s.drag;
        if (!drag) return;
        if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5) return;
        drag.moved = true;
        const p = s.pos.get(drag.id);
        const point = toLocal(event);
        if (!p || p.pinned || !point) return;
        p.x = clamp(point.x, EDGE_PAD + p.r, s.w - EDGE_PAD - p.r);
        p.y = clamp(point.y, EDGE_PAD + p.r, s.h - EDGE_PAD - p.r);
        p.fixed = true;
        // 퍼져 나가는 도중에 잡아도 점이 손가락 아래에 그대로 오게 합니다.
        p.born = 0;
        if (s.reduced) {
            placeLabels(s);
            paint(s);
        }
    };

    const select = (node) => {
        setPing({ id: node.id, at: Date.now() });
        onSelect?.(node);
    };

    const endDrag = (pick) => {
        const s = sim.current;
        const drag = s.drag;
        if (!drag) return;
        s.drag = null;
        const p = s.pos.get(drag.id);
        if (p) p.fixed = false;
        if (s.reduced && drag.moved) {
            settle(s, 160);
            paint(s);
        }
        if (pick && !drag.moved) select(drag.node);
    };

    const onKeyDown = (event, node) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            select(node);
        }
    };

    const active = hover ?? linked;
    const activeNode = active ? nodeById.get(active) : null;
    // 이름 없는 점(빈 화면의 자리 표시)은 부모 이름으로 읽어 줍니다.
    const readNode = activeNode && !(activeNode.full || activeNode.label) ? nodeById.get(activeNode.parent) || activeNode : activeNode;
    const hotSet = activeNode ? related.get(active) : null;
    const shownGroup = activeNode ? null : group ?? linkedGroup ?? pinnedGroup;
    const isHot = (node) => (hotSet ? hotSet.has(node.id) : shownGroup ? node.level === 0 || node.group === shownGroup : false);
    const dimming = Boolean(hotSet || shownGroup);
    const compact = size.w < 560;
    const { cx, cy, rx, ry, r2 } = geometry(size.w, size.h);
    const groups = useMemo(() => new Set(nodes.map((node) => node.group)), [nodes]);

    return (
        <div className={styles.panel} data-mode={mode}>
            <header className={styles.head}>
                <p className={styles.headTitle}>
                    <strong>{title}</strong>
                    <span>점 {nodes.length} · 선 {links.length}</span>
                </p>
                {legend.length > 0 && (
                    <ul className={styles.legend} aria-label="점 색 설명. 누르면 그 묶음만 밝게 봅니다.">
                        {legend.filter((item) => groups.has(item.group)).map((item) => (
                            <li key={item.group}>
                                <button
                                    type="button"
                                    data-group={item.group}
                                    aria-pressed={pinnedGroup === item.group}
                                    onClick={() => setPinnedGroup((prev) => (prev === item.group ? null : item.group))}
                                    onPointerEnter={() => setGroup(item.group)}
                                    onPointerLeave={() => setGroup(null)}
                                    onFocus={() => setGroup(item.group)}
                                    onBlur={() => setGroup(null)}
                                >
                                    {item.label}
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </header>
            <div ref={wrapRef} className={styles.wrap} data-compact={compact ? 'true' : 'false'}>
                <svg
                    ref={svgRef}
                    className={styles.svg}
                    viewBox={`0 0 ${size.w} ${size.h}`}
                    role="group"
                    aria-label={label}
                    onPointerMove={onPointerMove}
                    onPointerUp={() => endDrag(true)}
                    onPointerCancel={() => endDrag(false)}
                >
                    <defs>
                        {/* 점 뒤에 번지는 빛. 점과 같은 색의 원을 흐리게 하므로 필터 하나로 모든 색(상태색 포함)에 맞습니다. */}
                        <filter id={`${uid}-glow-store`} x="-120%" y="-120%" width="340%" height="340%" colorInterpolationFilters="sRGB">
                            <feGaussianBlur stdDeviation="9" />
                        </filter>
                        <filter id={`${uid}-glow-hub`} x="-150%" y="-150%" width="400%" height="400%" colorInterpolationFilters="sRGB">
                            <feGaussianBlur stdDeviation="3.6" />
                        </filter>
                        <filter id={`${uid}-glow-leaf`} x="-200%" y="-200%" width="500%" height="500%" colorInterpolationFilters="sRGB">
                            <feGaussianBlur stdDeviation="2.6" />
                        </filter>
                        <radialGradient id={`${uid}-aura`}>
                            <stop className={styles.auraNear} offset="0" />
                            <stop className={styles.auraFar} offset="1" />
                        </radialGradient>
                        {/* 탐색 부채꼴이 그래프 칸 밖(머리 줄)으로 삐져나가지 않게 자릅니다. */}
                        <clipPath id={`${uid}-frame`}>
                            <rect width={size.w} height={size.h} />
                        </clipPath>
                    </defs>
                    <g className={styles.orbits} aria-hidden="true">
                        <circle className={styles.aura} cx={cx} cy={cy} r={Math.min(rx, ry) * 0.92} fill={`url(#${uid}-aura)`} />
                        <ellipse cx={cx} cy={cy} rx={rx} ry={ry} />
                        <ellipse cx={cx} cy={cy} rx={rx + r2} ry={ry + r2} />
                    </g>
                    {mode === 'loading' && (
                        <g clipPath={`url(#${uid}-frame)`} aria-hidden="true">
                            <g transform={`translate(${cx},${cy})`}>
                                <path className={styles.sweep} d={`M0 0 L${rx + r2} 0 A${rx + r2} ${rx + r2} 0 0 0 ${((rx + r2) * Math.cos(-0.9)).toFixed(1)} ${((rx + r2) * Math.sin(-0.9)).toFixed(1)} Z`} />
                            </g>
                        </g>
                    )}
                    <g>
                        {links.map((link, index) => {
                            const child = nodeById.get(link.source);
                            const touches = hotSet ? hotSet.has(link.source) && hotSet.has(link.target) : shownGroup ? child?.group === shownGroup : false;
                            const cls = [styles.link, dimming && (touches ? styles.hot : styles.dim)].filter(Boolean).join(' ');
                            return (
                                <g
                                    key={link.id}
                                    ref={(el) => {
                                        if (el) linkEls.current.set(link.id, el);
                                        else linkEls.current.delete(link.id);
                                    }}
                                    className={cls}
                                    data-level={child?.level}
                                    data-group={child?.group}
                                    data-tone={child?.tone}
                                    style={{ '--s': `${1.7 + (index % 5) * 0.32}s`, '--d': `${Math.max(0, (delays.get(link.source) || 0) - 40)}ms` }}
                                >
                                    {/* 부모(가운데) 쪽이 진하고 딸린 점 쪽으로 갈수록 옅어지는 선. 수평·수직선에서도 사라지지 않게 실제 좌표 기준으로 둡니다. */}
                                    <linearGradient id={`${uid}-l${index}`} gradientUnits="userSpaceOnUse">
                                        <stop className={styles.stopFar} offset="0" />
                                        <stop className={styles.stopNear} offset="1" />
                                    </linearGradient>
                                    <line className={styles.edgeGlow} stroke={`url(#${uid}-l${index})`} />
                                    <line className={styles.edge} stroke={`url(#${uid}-l${index})`} />
                                    <line className={styles.flow} />
                                </g>
                            );
                        })}
                    </g>
                    <g>
                        {nodes.map((node, index) => {
                            const tier = Math.min(node.level, 2);
                            const r = RADIUS[tier];
                            const hot = isHot(node);
                            const cls = [styles.node, dimming && (hot ? styles.hot : styles.dim), active === node.id && styles.self]
                                .filter(Boolean).join(' ');
                            const focusable = node.level < 2;
                            return (
                                <g
                                    key={node.id}
                                    ref={(el) => {
                                        if (el) nodeEls.current.set(node.id, el);
                                        else nodeEls.current.delete(node.id);
                                    }}
                                    className={cls}
                                    data-level={node.level}
                                    data-group={node.group}
                                    data-tone={node.tone}
                                    data-ghost={node.ghost ? 'true' : undefined}
                                    style={{ '--i': index, '--d': `${delays.get(node.id) || 0}ms`, '--f': `${(3.4 + (index % 5) * 0.32).toFixed(2)}s` }}
                                    tabIndex={focusable ? 0 : undefined}
                                    role={focusable ? 'button' : undefined}
                                    aria-label={focusable ? node.aria || node.label : undefined}
                                    onPointerDown={(event) => onNodeDown(event, node)}
                                    onPointerEnter={() => {
                                        setLinked(null);
                                        setLinkedGroup(null);
                                        setHover(node.id);
                                    }}
                                    onPointerLeave={() => setHover((prev) => (prev === node.id ? null : prev))}
                                    onFocus={() => setHover(node.id)}
                                    onBlur={() => setHover((prev) => (prev === node.id ? null : prev))}
                                    onKeyDown={(event) => onKeyDown(event, node)}
                                >
                                    <circle className={styles.hit} r={Math.max(r + 6, 16)} />
                                    {/* 바깥 g 의 자리(transform)는 스크립트가 매 프레임 옮기므로, 움직임 효과는 안쪽 g 에 나눠 겁니다.
                                        float: 세부 점이 위아래로 떠 있음 · appear: 처음 나타남 · grow: 가리키면 커짐 */}
                                    <g className={styles.float}>
                                        <g className={styles.appear}>
                                            <g className={styles.grow}>
                                                <circle className={styles.glow} r={r + GLOW_PAD[tier]} filter={`url(#${uid}-${GLOW_FILTER[tier]})`} />
                                                {node.level === 0 && (
                                                    <>
                                                        <circle className={`${styles.ring} ${styles.ringOuter}`} r={r + 14} />
                                                        <circle className={styles.ring} r={r + 7} />
                                                        <circle className={styles.base} r={r} />
                                                    </>
                                                )}
                                                {node.level === 1 && <circle className={styles.ring} r={r + 3.5} />}
                                                {ping?.id === node.id && <circle key={ping.at} className={styles.ping} r={r} onAnimationEnd={() => setPing(null)} />}
                                                {node.tone === 'pending' && <circle className={styles.spinner} r={r + 4} />}
                                                <circle className={styles.dot} r={r} />
                                                {node.level === 0 && <circle className={styles.core} r={r - 7} />}
                                            </g>
                                        </g>
                                        {(node.label || node.sub) && (
                                            <g className={styles.tag} data-part="tag">
                                                {node.label && <text className={styles.label} data-part="label">{node.label}</text>}
                                                {node.sub && <text className={styles.sub} data-part="sub" data-tone={node.subTone}>{node.sub}</text>}
                                            </g>
                                        )}
                                    </g>
                                </g>
                            );
                        })}
                    </g>
                </svg>
                {children}
            </div>
            <p className={styles.readout} data-on={readNode ? 'true' : 'false'}>
                {readNode ? (
                    <>
                        <span className={styles.readoutDot} data-group={readNode.group} data-tone={readNode.tone} aria-hidden="true" />
                        <strong>{readNode.full || readNode.label}</strong>
                        {readNode.detail && <span className={styles.readoutText}>{readNode.detail}</span>}
                        {readNode.go && <span className={styles.readoutGo}>{readNode.go}</span>}
                    </>
                ) : (
                    <span className={styles.readoutText}>{hint}</span>
                )}
            </p>
        </div>
    );
});

export default PlaceGraph;
