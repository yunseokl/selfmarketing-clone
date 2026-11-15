'use client';

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import styles from './PlaceGraph.module.css';

const TAU = Math.PI * 2;
// 단계별 점 크기(0: 매장, 1: 키워드·묶음, 2: 세부 값)와 점 가장자리에서 라벨까지의 거리
const RADIUS = [21, 8.5, 4.8];
const LABEL_OFFSET = [21, 8, 6];
const LABEL_GAP = 4;
// 라벨 자리를 잡을 때 그래프 칸 좌우에 남기는 여백(장면이 기울며 점이 밀리는 만큼의 여유)
const EDGE = 10;
const TEXT = [
    { label: '700 15px', sub: '500 11.5px', lh: 18.5 },
    { label: '600 12.5px', sub: '700 12px', lh: 15.5 },
    { label: '500 11.5px', sub: '500 11px', lh: 14.5 },
];
// 깊이감: 카메라에서 화면까지의 거리와 점이 앞뒤로 놓이는 범위(px)
const CAMERA = 820;
const DEPTH = 105;
const STEP = 1000 / 60;
const BEAT_MS = 1900;
// 새 점이 부모에서 뻗어 나오는 시간(ms, 단계별)
const GROW_MS = [520, 680, 540];
const TRAIL = 5;
const ORB_PAD = 96 / 88;

const GROUP_COLOR = {
    store: '#00E5FF',
    search: '#00E676',
    voice: '#FF9100',
    pay: '#E040FB',
    todo: '#FF5252',
    ops: '#90A4AE',
    geo: '#448AFF',
};
const TONE_COLOR = { good: '#00E676', warn: '#FFC400', bad: '#FF5252', ink: '#E4ECF5', muted: '#78909C', pending: '#90A4AE' };
const SUB_COLOR = { good: '#69F0AE', warn: '#FFD54F', bad: '#FF8A80', ink: '#EAF1F8', muted: '#8C9DAF', pending: '#8C9DAF' };
const INK = '#EAF1F8';
const INK_2 = '#B7C4D3';
const HALO = 'rgba(5, 9, 15, 0.9)';
const BACK = '#0A1321';
const DUST = '#8FB4E8';

const SIDES = [
    ['r', 0], ['br', Math.PI / 4], ['b', Math.PI / 2], ['bl', Math.PI * 0.75],
    ['l', Math.PI], ['tl', -Math.PI * 0.75], ['t', -Math.PI / 2], ['tr', -Math.PI / 4],
];

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function hashOf(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    return hash >>> 0;
}

// 같은 입력에는 늘 같은 0~1 값을 돌려줍니다(점마다 박자·휘어짐을 다르게 주되 다시 그려도 그대로이게).
function unit(seed, salt) {
    let v = (seed ^ Math.imul(salt + 1, 0x9E3779B1)) >>> 0;
    v = Math.imul(v ^ (v >>> 16), 0x85EBCA6B);
    v = Math.imul(v ^ (v >>> 13), 0xC2B2AE35);
    return ((v ^ (v >>> 16)) >>> 0) / 4294967296;
}

function angleGap(a, b) {
    const gap = Math.abs(a - b) % TAU;
    return gap > Math.PI ? TAU - gap : gap;
}

function channels(hex) {
    const value = parseInt(hex.slice(1), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function rgba(hex, alpha) {
    const [r, g, b] = channels(hex);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function mix(hex, other, amount, alpha = 1) {
    const a = channels(hex);
    const b = channels(other);
    return `rgba(${a.map((value, i) => Math.round(value + (b[i] - value) * amount)).join(', ')}, ${alpha})`;
}

function colorOf(node) {
    return TONE_COLOR[node.tone] || GROUP_COLOR[node.group] || GROUP_COLOR.ops;
}

/* ───────── 미리 그려 두는 빛·구슬 그림 ─────────
   shadowBlur 를 매 프레임 쓰면 느려서, 색마다 한 번만 그려 두고 프레임에서는 그림을 찍기만 합니다. */

const SPRITES = new Map();

const PAINT = {
    glow(g, m, color) {
        const halo = g.createRadialGradient(m, m, 0, m, m, m);
        halo.addColorStop(0, rgba(color, 0.5));
        halo.addColorStop(0.22, rgba(color, 0.26));
        halo.addColorStop(0.55, rgba(color, 0.07));
        halo.addColorStop(1, rgba(color, 0));
        g.fillStyle = halo;
        g.fillRect(0, 0, m * 2, m * 2);
        g.shadowColor = color;
        g.shadowBlur = m * 0.34;
        g.fillStyle = rgba(color, 0.42);
        g.beginPath();
        g.arc(m, m, m * 0.13, 0, TAU);
        g.fill();
    },
    orb(g, m, color) {
        const r = m / ORB_PAD;
        const body = g.createRadialGradient(m - r * 0.3, m - r * 0.34, r * 0.04, m, m, r);
        body.addColorStop(0, '#FFFFFF');
        body.addColorStop(0.24, mix(color, '#FFFFFF', 0.5));
        body.addColorStop(0.66, color);
        body.addColorStop(1, mix(color, '#03070D', 0.5));
        g.fillStyle = body;
        g.beginPath();
        g.arc(m, m, r, 0, TAU);
        g.fill();
        g.lineWidth = 2;
        g.strokeStyle = 'rgba(255, 255, 255, 0.28)';
        g.beginPath();
        g.arc(m, m, r - 1.2, 0, TAU);
        g.stroke();
    },
    spark(g, m, color) {
        const core = g.createRadialGradient(m, m, 0, m, m, m);
        core.addColorStop(0, 'rgba(255, 255, 255, 1)');
        core.addColorStop(0.16, mix(color, '#FFFFFF', 0.55, 0.95));
        core.addColorStop(0.46, rgba(color, 0.34));
        core.addColorStop(1, rgba(color, 0));
        g.fillStyle = core;
        g.fillRect(0, 0, m * 2, m * 2);
    },
};

const SPRITE_SIZE = { glow: 160, orb: 96, spark: 48 };

function sprite(kind, color) {
    const key = `${kind}${color}`;
    let image = SPRITES.get(key);
    if (!image) {
        image = document.createElement('canvas');
        image.width = SPRITE_SIZE[kind];
        image.height = SPRITE_SIZE[kind];
        PAINT[kind](image.getContext('2d'), SPRITE_SIZE[kind] / 2, color);
        SPRITES.set(key, image);
    }
    return image;
}

/* ───────── 장면 상태 ───────── */

function createSim() {
    return {
        canvas: null, ctx: null, bg: null, family: 'sans-serif',
        w: 0, h: 0, dpr: 1, cx: 0, cy: 0, rx: 0, ry: 0, r2: 0,
        pos: new Map(), linkById: new Map(), keys: new Map(),
        list: [], order: [], depth: [], links: [], sources: [], sparks: [], dust: [], pings: [],
        center: null, hotSet: null, selfId: null, focusId: null, drag: null,
        mode: 'live', reduced: false, coarse: false, lite: false, running: false,
        last: 0, clock: 0, lag: 0, sway: 0,
        tiltX: 0, tiltY: 0, aimX: 0, aimY: 0, cosX: 1, sinX: 0, cosY: 1, sinY: 0,
        invalidate: null,
    };
}

// React 가 넘긴 점·선을 장면에 맞춥니다. 이미 있던 점은 자리·움직임을 그대로 이어 갑니다.
function syncGraph(sim, nodes, links) {
    const now = performance.now();
    const next = new Map();
    const delays = new Map();
    const nth = new Map();
    let hubs = 0;
    nodes.forEach((node, index) => {
        const level = Math.min(node.level, 2);
        let delay = 0;
        if (level === 1) {
            delay = 150 + hubs * 46;
            hubs += 1;
        } else if (level === 2) {
            const order = nth.get(node.parent) || 0;
            nth.set(node.parent, order + 1);
            delay = (delays.get(node.parent) ?? 150) + 420 + order * 56;
        }
        delays.set(node.id, delay);
        let p = sim.pos.get(node.id);
        if (!p) {
            const seed = hashOf(node.id);
            p = {
                id: node.id, seed, fresh: true, arrived: false, born: now + delay,
                x: 0, y: 0, z: 0, vx: 0, vy: 0,
                lx: 0, ly: 0, lz: 0, ox: 0, oy: 0, oz: 0, rest: 0, angle: 0, inner: false,
                sx: 0, sy: 0, ss: 1, zn: 0, px: 0, py: 0, rr: 0, e: 0,
                dim: 0, hot: 0, self: 0, fire: 0, calm: 1, labA: 0, tDim: 0, tHot: 0, tSelf: 0,
                f1: 0.0006 + unit(seed, 1) * 0.0005, f2: 0.0009 + unit(seed, 2) * 0.0005, f3: 0.0005 + unit(seed, 3) * 0.0004,
                a1: unit(seed, 4) * TAU, a2: unit(seed, 5) * TAU, a3: unit(seed, 6) * TAU,
                held: false, lab: null, up: null, parent: null, kids: [],
            };
        }
        const color = colorOf(node);
        Object.assign(p, {
            node, index, level, color,
            r: RADIUS[level],
            ghost: Boolean(node.ghost),
            pending: node.tone === 'pending',
            hollow: Boolean(node.ghost) || node.tone === 'pending',
            glow: sprite('glow', color),
            orb: sprite('orb', color),
            parent: null, up: null, kids: [],
        });
        next.set(node.id, p);
    });
    for (const p of next.values()) {
        const parent = p.node.parent ? next.get(p.node.parent) : null;
        if (!parent) continue;
        p.parent = parent;
        parent.kids.push(p);
    }
    sim.pos = next;
    sim.list = [...next.values()];
    sim.order = [...sim.list].sort((a, b) => a.level - b.level || a.index - b.index);
    sim.depth = [...sim.list];
    sim.center = sim.order.find((p) => p.level === 0) || null;

    const linkById = new Map();
    sim.links = [];
    for (const link of links) {
        const a = next.get(link.source);
        const b = next.get(link.target);
        if (!a || !b) continue;
        let line = sim.linkById.get(link.id);
        if (!line) {
            const seed = hashOf(link.id);
            line = {
                id: link.id, seed: unit(seed, 1) * TAU, turn: unit(seed, 2) < 0.5 ? -1 : 1, curl: unit(seed, 3), pace: 0.82 + unit(seed, 4) * 0.5,
                x0: 0, y0: 0, cx: 0, cy: 0, qx: 0, qy: 0, x1: 0, y1: 0, len: 1, dim: 0, hot: 0, depthA: 1, depthS: 1,
            };
        }
        const leaf = a.level >= 2;
        Object.assign(line, {
            a, b, dead: false,
            bend: (leaf ? 0.12 + line.curl * 0.16 : 0.08 + line.curl * 0.12) * line.turn,
            color: a.color,
            near: rgba(a.color, leaf ? 0.52 : 0.8),
            far: rgba(a.color, leaf ? 0.16 : 0.26),
            lit: mix(a.color, '#FFFFFF', 0.55),
            spark: sprite('spark', a.color),
        });
        if (!a.up) a.up = line;
        linkById.set(link.id, line);
        sim.links.push(line);
    }
    for (const [id, line] of sim.linkById) if (!linkById.has(id)) line.dead = true;
    sim.linkById = linkById;
    // 신호는 끝 점에서 출발해 묶음을 거쳐 매장으로 모입니다.
    sim.sources = sim.links.filter((line) => line.a.kids.length === 0);
}

// 그래프 칸이 가로로 넓어서 1단계 점은 원이 아니라 타원 위에 놓습니다.
// 딸린 점이 많은 묶음일수록 둘레를 넓게 차지하고, 검색 키워드는 위쪽에 모읍니다.
function layout(sim) {
    const { w, h } = sim;
    const r2 = clamp(Math.min(w, h) * 0.125, 36, 60);
    // 묶음(타원의 0.94배 자리)에서 딸린 점이 가장 멀리 뻗는 거리(r2 × 1.3)까지 그래프 칸 안에 들어오게 잡습니다.
    // 넓은 화면은 옆에 세부 값 라벨 자리를 남기고, 좁은 화면은 그 자리까지 써서 점을 넓게 폅니다.
    const room = w < 560 ? 14 : clamp(w * 0.11, 60, 100);
    const rx = clamp((w / 2 - room - r2 * 1.3) / 0.94, 82, 280);
    // 위아래로는 가장 먼 딸린 점 바깥에 라벨 한 줄이 들어갈 자리(34px)를 남깁니다.
    const ry = clamp(Math.min(h / 2 - 52, (h / 2 - 34 - r2 * 1.3) / 0.94), 76, 220);
    Object.assign(sim, { cx: w / 2, cy: h / 2, rx, ry, r2 });

    const hubs = sim.order.filter((p) => p.level > 0 && (!p.parent || p.parent.level === 0));
    const weight = (p) => 1.3 + p.kids.length * 0.42;
    const total = hubs.reduce((sum, p) => sum + weight(p), 0) || 1;
    const searchSpan = (hubs.filter((p) => p.node.group === 'search').reduce((sum, p) => sum + weight(p), 0) / total) * TAU;
    let cursor = -Math.PI / 2 - searchSpan / 2;
    for (const p of hubs) {
        const span = (weight(p) / total) * TAU;
        p.angle = cursor + span / 2;
        p.inner = false;
        cursor += span;
    }
    // 딸린 점 없는 점(키워드)이 촘촘하게 이어지면 한 칸씩 안쪽으로 들여 라벨 자리를 냅니다.
    let run = [];
    const stagger = () => {
        if (run.length > 1) {
            let tight = Infinity;
            for (let i = 1; i < run.length; i += 1) {
                tight = Math.min(tight, Math.hypot(
                    (Math.cos(run[i].angle) - Math.cos(run[i - 1].angle)) * rx,
                    (Math.sin(run[i].angle) - Math.sin(run[i - 1].angle)) * ry,
                ));
            }
            if (tight < 124) run.forEach((p, i) => { p.inner = i % 2 === 1; });
        }
        run = [];
    };
    for (const p of hubs) {
        if (p.kids.length === 0) run.push(p);
        else stagger();
    }
    stagger();

    if (sim.center) Object.assign(sim.center, { lx: 0, ly: 0, lz: 0 });
    for (const p of hubs) {
        const reach = p.kids.length ? 0.94 : p.inner ? 0.7 : 1;
        p.lx = Math.cos(p.angle) * rx * reach;
        p.ly = Math.sin(p.angle) * ry * reach;
        p.lz = DEPTH * clamp(0.52 * Math.sin(p.angle + 0.7) + 0.36 * Math.sin(p.angle * 2 - 0.5) - (p.inner ? 0.28 : 0), -1, 1);
    }
    // 딸린 점은 부모에서 바깥쪽으로 부채꼴로 펼치고, 앞뒤로도 번갈아 놓습니다.
    for (const p of sim.order) {
        const count = p.kids.length;
        if (p.level === 0 || count === 0) continue;
        const out = Math.atan2(p.ly - (p.parent ? p.parent.ly : 0), p.lx - (p.parent ? p.parent.lx : 0));
        const stepAngle = count > 1 ? Math.min(0.62, 1.9 / (count - 1)) : 0;
        p.kids.forEach((kid, i) => {
            const angle = out + (i - (count - 1) / 2) * stepAngle;
            const reach = r2 * (count > 3 && i % 2 === 1 ? 1.3 : 1);
            kid.lx = clamp(p.lx + Math.cos(angle) * reach, 14 - w / 2, w / 2 - 14);
            kid.ly = clamp(p.ly + Math.sin(angle) * reach, 14 - h / 2, h / 2 - 14);
            kid.lz = clamp(p.lz + DEPTH * 0.4 * (i % 2 ? 1 : -1) * (0.55 + 0.45 * unit(kid.seed, 7)), -DEPTH, DEPTH);
        });
    }
    // lx·ly 는 가만히 있을 때 화면에 보일 자리입니다. 깊이(lz)만큼 원근이 걸리므로 실제 좌표는 거꾸로 계산해 둡니다.
    for (const p of sim.order) {
        const scale = CAMERA / (CAMERA - p.lz);
        const wx = p.lx / scale;
        const wy = p.ly / scale;
        p.wx = wx;
        p.wy = wy;
        p.ox = wx - (p.parent ? p.parent.wx : 0);
        p.oy = wy - (p.parent ? p.parent.wy : 0);
        p.oz = p.lz - (p.parent ? p.parent.lz : 0);
        p.rest = p.r * scale * (1 + 0.14 * (p.lz / DEPTH));
        if (p.fresh || sim.reduced) {
            Object.assign(p, { x: wx, y: wy, z: p.lz, vx: 0, vy: 0, fresh: false });
        }
    }
}

/* ───────── 라벨 ───────── */

function measureLabels(sim) {
    const ctx = sim.ctx;
    for (const p of sim.list) {
        const { label, sub, subTone } = p.node;
        if (!label && !sub) {
            p.lab = null;
            continue;
        }
        const type = TEXT[p.level];
        const lines = [];
        if (label) {
            const font = `${type.label} ${sim.family}`;
            ctx.font = font;
            lines.push({ text: label, font, color: p.level === 2 ? INK_2 : INK, w: ctx.measureText(label).width });
        }
        if (sub) {
            const font = `${type.sub} ${sim.family}`;
            ctx.font = font;
            lines.push({ text: sub, font, color: SUB_COLOR[subTone] || INK_2, w: ctx.measureText(sub).width });
        }
        const prev = p.lab;
        p.lab = {
            lines,
            w: Math.max(...lines.map((line) => line.w)),
            h: lines.length * type.lh,
            lh: type.lh,
            side: prev ? prev.side : 'b',
            home: prev ? prev.home : 'b',
            fixed: prev ? prev.fixed : false,
            on: prev ? prev.on : false,
        };
    }
}

// 점 가운데를 기준으로 한 라벨 상자. align 은 글자를 붙일 쪽(-1 왼쪽 정렬, 0 가운데, 1 오른쪽 정렬)입니다.
function labelBox(side, gap, lab, out) {
    const { w, h } = lab;
    const d = gap * 0.74;
    if (side === 'r') Object.assign(out, { x0: gap, y0: -h / 2, align: -1 });
    else if (side === 'l') Object.assign(out, { x0: -gap - w, y0: -h / 2, align: 1 });
    else if (side === 't') Object.assign(out, { x0: -w / 2, y0: -gap - h, align: 0 });
    else if (side === 'b') Object.assign(out, { x0: -w / 2, y0: gap, align: 0 });
    else if (side === 'tr') Object.assign(out, { x0: d, y0: -d - h + 3, align: -1 });
    else if (side === 'br') Object.assign(out, { x0: d, y0: d - 3, align: -1 });
    else if (side === 'tl') Object.assign(out, { x0: -d - w, y0: -d - h + 3, align: 1 });
    else Object.assign(out, { x0: -d - w, y0: d - 3, align: 1 });
    out.x1 = out.x0 + w;
    out.y1 = out.y0 + h;
    return out;
}

function restBox(sim, p, side) {
    const box = labelBox(side, p.rest + LABEL_OFFSET[p.level], p.lab, {});
    const x = sim.cx + p.lx;
    const y = sim.cy + p.ly;
    return { x0: x + box.x0, x1: x + box.x1, y0: y + box.y0, y1: y + box.y1 };
}

function overlaps(a, b) {
    return a.x0 < b.x1 + LABEL_GAP && a.x1 > b.x0 - LABEL_GAP && a.y0 < b.y1 + LABEL_GAP && a.y1 > b.y0 - LABEL_GAP;
}

// 라벨을 둘 쪽의 우선순위: 부모에서 바깥쪽을 먼저 보고, 딸린 점·부모로 가는 선이 지나는 쪽은 뒤로 미룹니다.
function sideOrder(p) {
    if (p.level === 0) return ['b', 't'];
    const out = Math.atan2(p.ly - (p.parent ? p.parent.ly : 0), p.lx - (p.parent ? p.parent.lx : 0));
    const busy = p.kids.map((kid) => Math.atan2(kid.ly - p.ly, kid.lx - p.lx));
    busy.push(out + Math.PI);
    return SIDES
        .map(([side, angle]) => {
            let cost = angleGap(angle, out) + (side.length > 1 ? 0.4 : 0);
            for (const dir of busy) {
                const gap = angleGap(angle, dir);
                if (gap < 0.7) cost += (0.7 - gap) * 5;
            }
            return [side, cost];
        })
        .sort((a, b) => a[1] - b[1])
        .map(([side]) => side);
}

function findSpot(sim, p, placed, discs) {
    const px = sim.cx + p.lx;
    const py = sim.cy + p.ly;
    const own = (p.rest + 2) ** 2;
    for (const side of sideOrder(p)) {
        const box = restBox(sim, p, side);
        if (box.y0 < 5 || box.y1 > sim.h - 5) continue;
        // 옆으로 넘치는 라벨은 칸 안으로 밀어 넣어 봅니다(그릴 때도 같은 식으로 밀립니다). 밀려서 제 점을 덮게 되면 그 자리는 쓰지 않습니다.
        const shift = clamp(box.x0, EDGE, Math.max(EDGE, sim.w - EDGE - (box.x1 - box.x0))) - box.x0;
        if (shift) {
            box.x0 += shift;
            box.x1 += shift;
            if ((px - clamp(px, box.x0, box.x1)) ** 2 + (py - clamp(py, box.y0, box.y1)) ** 2 < own) continue;
        }
        if (placed.some((other) => overlaps(box, other))) continue;
        const blocked = discs.some((disc) => {
            if (disc.p === p) return false;
            const nx = clamp(disc.x, box.x0, box.x1);
            const ny = clamp(disc.y, box.y0, box.y1);
            return (disc.x - nx) ** 2 + (disc.y - ny) ** 2 < disc.r * disc.r;
        });
        if (!blocked) return { side, box };
    }
    return null;
}

function discsOf(sim, only) {
    const discs = [];
    for (const p of sim.list) {
        if (only && !only.has(p.id)) continue;
        discs.push({ p, x: sim.cx + p.lx, y: sim.cy + p.ly, r: p.rest + 3 });
    }
    return discs;
}

// 늘 보이는 라벨(매장·1단계)의 자리를 정합니다. 자리가 없으면 숨겨 두고 점을 가리킬 때만 띄웁니다.
function settleLabels(sim) {
    const placed = [];
    const discs = discsOf(sim, null);
    for (const p of sim.order) {
        const lab = p.lab;
        if (!lab) continue;
        if (p.level >= 2) {
            lab.fixed = false;
            lab.home = sideOrder(p)[0];
            continue;
        }
        if (p.level === 0) {
            // 매장 이름은 자리가 비좁아도 늘 보입니다. 다른 라벨이 이 자리를 피해 갑니다.
            lab.fixed = true;
            lab.home = 'b';
            lab.box = restBox(sim, p, 'b');
            placed.push(lab.box);
            continue;
        }
        const spot = findSpot(sim, p, placed, discs);
        lab.fixed = Boolean(spot);
        lab.home = spot ? spot.side : sideOrder(p)[0];
        lab.box = spot ? spot.box : null;
        if (spot) placed.push(spot.box);
    }
}

// 지금 밝힌 점에 맞춰 라벨을 켜고 끕니다. 세부 값 라벨은 밝힌 동안에만 빈 자리를 찾아 띄우고,
// 그 자리와 겹치는 흐린 라벨은 잠시 숨깁니다. 켜져 있던 라벨의 자리는 옮기지 않습니다(글자가 튀지 않게).
function showLabels(sim) {
    const hot = sim.hotSet;
    const placed = [];
    const rest = [];
    const discs = hot ? discsOf(sim, hot) : [];
    for (const p of sim.order) {
        const lab = p.lab;
        if (!lab) continue;
        if (hot && !hot.has(p.id)) {
            rest.push(p);
            continue;
        }
        if (lab.fixed) {
            lab.side = lab.home;
            lab.on = true;
            placed.push(lab.box);
            continue;
        }
        if (!hot) {
            lab.on = false;
            continue;
        }
        const spot = findSpot(sim, p, placed, discs);
        if (!spot && p.id !== sim.selfId) {
            lab.on = false;
            continue;
        }
        lab.side = spot ? spot.side : lab.home;
        lab.on = true;
        placed.push(spot ? spot.box : restBox(sim, p, lab.side));
    }
    for (const p of rest) {
        const lab = p.lab;
        if (!lab.fixed) {
            lab.on = false;
            continue;
        }
        lab.on = !placed.some((other) => overlaps(lab.box, other));
    }
}

/* ───────── 빛 입자·먼지·바탕 ───────── */

function respawn(sim, spark, wait) {
    const pool = sim.sources.length ? sim.sources : sim.links;
    spark.link = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
    spark.u = 0;
    spark.wait = wait ?? Math.random() * 1100;
    spark.speed = 64 + Math.random() * 46;
    spark.size = 9.5 + Math.random() * 4;
}

// 선을 따라 흐르는 빛 입자는 넉넉한 화면에서도 26개, 좁은 화면·터치 기기에서는 12개까지만 둡니다.
function seedSparks(sim) {
    const cap = sim.reduced ? 0 : Math.min(sim.lite ? 12 : 26, Math.round(sim.links.length * (sim.lite ? 0.45 : 0.85)));
    while (sim.sparks.length < cap) {
        const spark = {};
        respawn(sim, spark, Math.random() * 2200);
        sim.sparks.push(spark);
    }
    sim.sparks.length = cap;
}

function seedDust(sim) {
    const count = sim.lite ? 10 : 22;
    sim.dust = Array.from({ length: count }, (_, i) => {
        const near = i % 7 === 6;
        return {
            x: (unit(i, 1) - 0.5) * sim.w * 1.25,
            y: (unit(i, 2) - 0.5) * sim.h * 1.2,
            z: near ? 150 + unit(i, 3) * 110 : -160 - unit(i, 3) * 320,
            size: near ? 110 + unit(i, 4) * 90 : 11 + unit(i, 4) * 18,
            alpha: near ? 0.06 : 0.14 + unit(i, 5) * 0.26,
            phase: unit(i, 6) * TAU,
        };
    });
}

// 움직이지 않는 바탕(어두운 바탕색·색 안개·점 모눈·가장자리 어둠)은 크기가 바뀔 때만 다시 그려 둡니다.
function paintBackdrop(sim) {
    const { w, h, dpr } = sim;
    if (!sim.bg) sim.bg = document.createElement('canvas');
    sim.bg.width = Math.round(w * dpr);
    sim.bg.height = Math.round(h * dpr);
    const g = sim.bg.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const far = Math.hypot(w, h) / 2;
    const base = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, far);
    base.addColorStop(0, '#111D30');
    base.addColorStop(0.5, '#0A1322');
    base.addColorStop(1, '#05080F');
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    const mist = (x, y, radius, color) => {
        const cloud = g.createRadialGradient(x, y, 0, x, y, radius);
        cloud.addColorStop(0, rgba(color, 0.075));
        cloud.addColorStop(1, rgba(color, 0));
        g.fillStyle = cloud;
        g.fillRect(0, 0, w, h);
    };
    mist(w * 0.16, h * 0.86, far * 0.7, GROUP_COLOR.search);
    mist(w * 0.86, h * 0.12, far * 0.72, GROUP_COLOR.geo);
    g.fillStyle = 'rgba(170, 200, 240, 0.16)';
    for (let x = (w / 2) % 22; x < w; x += 22) {
        for (let y = (h / 2) % 22; y < h; y += 22) g.fillRect(x - 0.6, y - 0.6, 1.2, 1.2);
    }
    const shade = g.createRadialGradient(w / 2, h / 2, far * 0.3, w / 2, h / 2, far);
    shade.addColorStop(0, 'rgba(5, 8, 15, 0)');
    shade.addColorStop(1, 'rgba(5, 8, 15, 0.86)');
    g.fillStyle = shade;
    g.fillRect(0, 0, w, h);
}

function arrange(sim) {
    if (!sim.w || !sim.ctx) return;
    layout(sim);
    measureLabels(sim);
    settleLabels(sim);
    showLabels(sim);
    seedSparks(sim);
    seedDust(sim);
    // 키보드·화면 낭독기용 버튼을 점 자리에 맞춰 둡니다.
    for (const [id, el] of sim.keys) {
        const p = sim.pos.get(id);
        if (p) el.style.transform = `translate(${Math.round(sim.cx + p.lx - 22)}px, ${Math.round(sim.cy + p.ly - 22)}px)`;
    }
}

/* ───────── 움직임 ───────── */

// 심장 박동처럼 '쿵-쿵' 두 번 뛰고 쉽니다(0~1).
function heartbeat(now) {
    const phase = (now % BEAT_MS) / BEAT_MS;
    const lub = (phase - 0.06) / 0.05;
    const dub = (phase - 0.24) / 0.065;
    return Math.exp(-lub * lub) + 0.55 * Math.exp(-dub * dub);
}

// 점마다 제자리(부모 자리 + 떨어진 거리)로 당기는 용수철에 느린 흔들림을 더합니다.
// 부모가 움직이면 딸린 점이 한 박자 늦게 따라옵니다.
function drift(sim) {
    const t = sim.clock;
    for (const p of sim.order) {
        if (p.level === 0) continue;
        const parent = p.parent;
        if (p.held && sim.drag) {
            p.x += (sim.drag.lx - p.sx) / p.ss;
            p.y += (sim.drag.ly - p.sy) / p.ss;
            p.vx = 0;
            p.vy = 0;
            continue;
        }
        const amp = (p.level === 1 ? 4.6 : 3) * p.calm;
        const tx = (parent ? parent.x : 0) + p.ox + (Math.sin(t * p.f1 + p.a1) + 0.5 * Math.sin(t * p.f2 + p.a2)) * amp;
        const ty = (parent ? parent.y : 0) + p.oy + (Math.cos(t * p.f2 + p.a3) + 0.5 * Math.sin(t * p.f3 + p.a1)) * amp;
        const tz = (parent ? parent.z : 0) + p.oz + Math.sin(t * p.f3 + p.a2) * 10 * p.calm;
        p.vx = (p.vx + (tx - p.x) * 0.03) * 0.86;
        p.vy = (p.vy + (ty - p.y) * 0.03) * 0.86;
        p.x += p.vx;
        p.y += p.vy;
        p.z += (tz - p.z) * 0.06;
    }
}

// 부모(x0·y0)에서 딸린 점(x1·y1)으로 가는 휜 선. 새 점은 이 선을 따라 뻗어 나오므로 끝(x1·y1)이 자라는 중의 자리입니다.
function curve(sim, line, now) {
    const a = line.a;
    const x0 = line.b.px;
    const y0 = line.b.py;
    const dx = a.sx - x0;
    const dy = a.sy - y0;
    const bend = line.bend * (sim.reduced ? 1 : 1 + 0.22 * Math.sin(now * 0.0008 + line.seed));
    line.x0 = x0;
    line.y0 = y0;
    line.cx = x0 + dx * 0.5 - dy * bend;
    line.cy = y0 + dy * 0.5 + dx * bend;
    line.len = Math.hypot(dx, dy);
    if (a.e < 1 && a.up === line) {
        const k = a.e;
        const m = 1 - k;
        line.qx = x0 + (line.cx - x0) * k;
        line.qy = y0 + (line.cy - y0) * k;
        line.x1 = m * m * x0 + 2 * m * k * line.cx + k * k * a.sx;
        line.y1 = m * m * y0 + 2 * m * k * line.cy + k * k * a.sy;
    } else {
        line.qx = line.cx;
        line.qy = line.cy;
        line.x1 = a.sx;
        line.y1 = a.sy;
    }
}

function drawAmbient(sim, now, beat) {
    const ctx = sim.ctx;
    const ax = sim.center ? sim.center.px : sim.cx;
    const ay = sim.center ? sim.center.py : sim.cy;
    ctx.globalCompositeOperation = 'lighter';
    const aura = Math.min(sim.rx, sim.ry) * 1.55;
    ctx.globalAlpha = (sim.mode === 'idle' ? 0.14 : 0.3) + beat * 0.07;
    ctx.drawImage(sprite('glow', GROUP_COLOR.store), ax - aura, ay - aura, aura * 2, aura * 2);

    // 불러오는 동안 매장을 중심으로 도는 탐색 빛
    if (sim.mode === 'loading' && !sim.reduced) {
        const radius = Math.max(sim.rx, sim.ry) + sim.r2 + 48;
        const angle = (now * 0.0026) % TAU;
        // 앞쪽이 밝고 뒤로 갈수록 옅어지는 부채꼴을 얇은 조각으로 나눠 칠합니다(바깥으로 갈수록 사라짐).
        const beam = ctx.createRadialGradient(ax, ay, 0, ax, ay, radius);
        beam.addColorStop(0, 'rgba(0, 229, 255, 1)');
        beam.addColorStop(0.62, 'rgba(0, 229, 255, 0.72)');
        beam.addColorStop(1, 'rgba(0, 229, 255, 0)');
        ctx.fillStyle = beam;
        ctx.strokeStyle = beam;
        const slices = 26;
        const width = 1.35 / slices;
        for (let i = 0; i < slices; i += 1) {
            ctx.globalAlpha = 0.2 * (1 - i / slices) ** 1.7;
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.arc(ax, ay, radius, angle - (i + 1) * width, angle - i * width);
            ctx.fill();
        }
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax + Math.cos(angle) * radius, ay + Math.sin(angle) * radius);
        ctx.stroke();
    }

    // 멀리(또는 아주 가까이) 떠 있는 먼지. 점보다 크게 밀려 보여서 앞뒤 거리가 느껴집니다.
    const speck = sprite('glow', DUST);
    for (const d of sim.dust) {
        const wob = sim.reduced ? d.phase : sim.sway * 0.00016 + d.phase;
        const x = d.x + Math.sin(wob) * 14;
        const y = d.y + Math.cos(wob * 1.3) * 10;
        const x1 = x * sim.cosY + d.z * sim.sinY;
        const z1 = d.z * sim.cosY - x * sim.sinY;
        const y1 = y * sim.cosX - z1 * sim.sinX;
        const scale = CAMERA / (CAMERA - (z1 * sim.cosX + y * sim.sinX));
        const size = d.size * scale;
        ctx.globalAlpha = d.alpha * (0.72 + 0.28 * Math.sin(wob * 3.1));
        ctx.drawImage(speck, sim.cx + x1 * scale - size / 2, sim.cy + y1 * scale - size / 2, size, size);
    }
}

// 가리킨 점에 이어진 선 위로 전기가 흐르듯 떨리는 밝은 줄을 한 겹 더 얹습니다.
function drawSurge(sim, line, now) {
    const ctx = sim.ctx;
    const dx = line.x1 - line.x0;
    const dy = line.y1 - line.y0;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const amp = Math.min(3, len * 0.035) * line.hot;
    // 물결 수는 선 길이에 맞춥니다(짧은 선에서 물결이 꺾여 보이지 않게).
    const waves = len / 15;
    const parts = clamp(Math.round(len / 7), 10, 36);
    ctx.beginPath();
    for (let i = 0; i <= parts; i += 1) {
        const u = i / parts;
        const m = 1 - u;
        const wobble = (Math.sin(u * waves + now * 0.013 + line.seed) + 0.4 * Math.sin(u * waves * 2.3 - now * 0.021)) * Math.sin(Math.PI * u) * amp;
        const x = m * m * line.x0 + 2 * m * u * line.cx + u * u * line.x1 + nx * wobble;
        const y = m * m * line.y0 + 2 * m * u * line.cy + u * u * line.y1 + ny * wobble;
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
    }
    ctx.shadowColor = line.color;
    ctx.shadowBlur = 12 * sim.dpr;
    ctx.strokeStyle = line.lit;
    ctx.lineWidth = 1.25;
    ctx.globalAlpha = 0.9 * line.hot * line.depthA;
    ctx.stroke();
    ctx.shadowBlur = 0;
}

function drawLinks(sim, now) {
    const ctx = sim.ctx;
    const tone = sim.mode === 'idle' ? 0.6 : 1;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const line of sim.links) {
        const { a, b } = line;
        if (a.up !== line) curve(sim, line, now);
        line.dim = Math.max(a.dim, b.dim);
        line.hot = Math.min(a.hot, b.hot);
        line.depthA = 0.72 + 0.14 * (a.zn + b.zn);
        line.depthS = (a.ss + b.ss) / 2;
        if (a.e <= 0.01) continue;
        const leaf = a.level >= 2;
        const alpha = tone * line.depthA * (1 - 0.86 * line.dim) * Math.min(1, a.e * 2.2);
        const paint = ctx.createLinearGradient(line.x0, line.y0, line.x1, line.y1);
        paint.addColorStop(0, line.near);
        paint.addColorStop(1, line.far);
        ctx.strokeStyle = paint;
        ctx.beginPath();
        ctx.moveTo(line.x0, line.y0);
        ctx.quadraticCurveTo(line.qx, line.qy, line.x1, line.y1);
        ctx.globalAlpha = alpha * (0.16 + 0.22 * line.hot);
        ctx.lineWidth = (leaf ? 5 : 7) * line.depthS;
        ctx.stroke();
        ctx.globalAlpha = alpha;
        ctx.lineWidth = ((leaf ? 1.05 : 1.5) + 0.5 * line.hot) * line.depthS;
        ctx.stroke();
        if (a.e < 1) {
            // 뻗어 나가는 끝의 불빛
            const tip = 16 * line.depthS;
            ctx.globalAlpha = Math.min(1, a.e * 3) * (1 - a.e) * 1.6;
            ctx.drawImage(line.spark, line.x1 - tip / 2, line.y1 - tip / 2, tip, tip);
        } else if (line.hot > 0.03 && !sim.reduced) {
            drawSurge(sim, line, now);
        }
    }
}

function drawSparks(sim, dt) {
    const ctx = sim.ctx;
    const idle = sim.mode === 'idle';
    const rate = sim.mode === 'loading' ? 2.3 : idle ? 0.6 : 1;
    const active = idle ? Math.ceil(sim.sparks.length * 0.5) : sim.sparks.length;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < active; i += 1) {
        const spark = sim.sparks[i];
        const line = spark.link;
        if (!line || line.dead || line.a.e < 1) {
            respawn(sim, spark);
            continue;
        }
        if (spark.wait > 0) {
            spark.wait -= dt;
            continue;
        }
        const len = Math.max(line.len, 24);
        spark.u += (spark.speed * line.pace * rate * (1 + 1.5 * line.hot) * dt) / (1000 * len);
        if (spark.u >= 1) {
            // 신호가 닿은 점은 잠깐 밝아지고, 신호는 대개 다음 선을 타고 매장 쪽으로 이어집니다.
            line.b.fire = 1;
            const onward = line.b.up;
            if (onward && Math.random() < 0.72) {
                spark.link = onward;
                spark.u = 0;
            } else {
                respawn(sim, spark);
            }
            continue;
        }
        const alpha = (idle ? 0.55 : 1) * (1 - 0.9 * line.dim) * line.depthA * Math.min(1, spark.u * 7);
        for (let k = 0; k < TRAIL; k += 1) {
            const u = spark.u - (k * 6.5) / len;
            if (u < 0) break;
            const t = 1 - u;
            const m = 1 - t;
            const x = m * m * line.x0 + 2 * m * t * line.cx + t * t * line.x1;
            const y = m * m * line.y0 + 2 * m * t * line.cy + t * t * line.y1;
            const size = spark.size * (1 - k * 0.16) * line.depthS;
            ctx.globalAlpha = alpha * (1 - k / TRAIL) ** 1.6;
            ctx.drawImage(line.spark, x - size / 2, y - size / 2, size, size);
        }
    }
}

function byDepth(a, b) {
    return a.zn - b.zn;
}

function ringAt(ctx, x, y, radius) {
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.1, radius), 0, TAU);
    ctx.stroke();
}

function drawNodes(sim, now, beat) {
    const ctx = sim.ctx;
    const still = sim.reduced;
    const loading = sim.mode === 'loading' && !still;
    const phase = (now % BEAT_MS) / BEAT_MS;
    sim.depth.sort(byDepth);
    for (const p of sim.depth) {
        if (p.e <= 0.01) continue;
        const { px: x, py: y, rr: r } = p;
        const front = (p.zn + 1) / 2;
        // 뒤쪽 점은 어둡게 가라앉히되 상태색은 읽히게 남기고, 밝힌 점은 깊이와 상관없이 또렷하게 올립니다.
        const fog = 0.62 + 0.38 * Math.max(front, p.hot);
        const born = Math.min(1, p.e * 1.6);
        const blink = loading && p.level > 0 ? 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(now * 0.0058 - p.index * 0.55)) : 1;
        const vis = (1 - 0.84 * p.dim) * born * blink;
        const lift = 0.5 * p.hot + 0.5 * p.self + 0.6 * p.fire + (p.level === 0 ? 0.5 * beat : 0);

        ctx.globalCompositeOperation = 'lighter';
        const halo = r * (p.level === 0 ? 7.2 : 6.6) * (1.28 - 0.28 * front);
        ctx.globalAlpha = Math.min(1, (p.hollow ? 0.24 : 0.62) * fog * vis * (1 + lift));
        ctx.drawImage(p.glow, x - halo / 2, y - halo / 2, halo, halo);

        ctx.strokeStyle = p.color;
        if (p.level === 0) {
            const k = r / RADIUS[0];
            ctx.lineWidth = 1.4;
            ctx.globalAlpha = (0.55 - 0.2 * beat) * vis;
            ringAt(ctx, x, y, r + 7 * k + beat * 1.5);
            ctx.lineWidth = 1;
            ctx.globalAlpha = (0.26 - 0.08 * beat) * vis;
            ringAt(ctx, x, y, r + 14 * k + beat * 3);
            if (!still && !p.ghost) {
                // 박동마다 바깥으로 번져 나가는 고리
                const q = phase / 0.86;
                if (q < 1) {
                    ctx.lineWidth = 1.5;
                    ctx.globalAlpha = 0.34 * (1 - q) ** 2 * vis;
                    ringAt(ctx, x, y, r + 10 + 78 * (1 - (1 - q) ** 3));
                }
            }
        } else if (p.level === 1 && !p.pending) {
            ctx.lineWidth = 1;
            ctx.globalAlpha = (0.3 + 0.3 * p.hot + 0.2 * p.self) * fog * vis;
            ringAt(ctx, x, y, r * (1 + 0.08 * p.self) + 3.5 * p.ss);
        }

        // 점 밑받침: 뒤에 깔린 선이 비치지 않게 가립니다(흐려진 점은 투명해지는 대신 어두워집니다).
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = born;
        ctx.fillStyle = BACK;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fill();
        if (p.hollow) {
            ctx.globalAlpha = (p.ghost ? 0.78 : 0.9) * fog * vis;
            ctx.lineWidth = p.level === 0 ? 1.8 : 1.4;
            ringAt(ctx, x, y, r - ctx.lineWidth / 2);
            if (p.pending && !still) {
                ctx.setLineDash([3, 3.2]);
                ctx.lineDashOffset = -now * 0.022;
                ctx.globalAlpha = 0.8 * vis;
                ringAt(ctx, x, y, r + 4);
                ctx.setLineDash([]);
            }
        } else {
            const size = r * 2 * ORB_PAD;
            ctx.globalAlpha = fog * vis;
            ctx.drawImage(p.orb, x - size / 2, y - size / 2, size, size);
            if (p.level === 0) {
                ctx.globalAlpha = 0.9 * vis;
                ctx.strokeStyle = '#FFFFFF';
                ctx.lineWidth = 2 * (r / RADIUS[0]);
                ringAt(ctx, x, y, r * 0.62);
            }
        }
        if (sim.focusId === p.id) {
            ctx.globalAlpha = 1;
            ctx.strokeStyle = '#FFFFFF';
            ctx.lineWidth = 2;
            ringAt(ctx, x, y, r + 5);
        }
    }

    // 점을 눌렀을 때 한 번 퍼지는 고리
    if (still) sim.pings.length = 0;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = sim.pings.length - 1; i >= 0; i -= 1) {
        const ping = sim.pings[i];
        const p = sim.pos.get(ping.id);
        const q = (now - ping.at) / 700;
        if (!p || q >= 1) {
            sim.pings.splice(i, 1);
            continue;
        }
        if (q < 0) continue;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.9 * (1 - q);
        ringAt(ctx, p.px, p.py, p.rr * (1 + 2.4 * (1 - (1 - q) ** 2)));
    }
}

const BOX = {};

function drawLabels(sim, ease) {
    const ctx = sim.ctx;
    const fade = ease(110);
    ctx.globalCompositeOperation = 'source-over';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3.4;
    ctx.strokeStyle = HALO;
    for (const p of sim.order) {
        const lab = p.lab;
        if (!lab) continue;
        p.labA += ((lab.on && p.e > 0.72 ? 1 : 0) - p.labA) * fade;
        if (p.labA < 0.02) continue;
        const alpha = p.labA * (1 - 0.8 * p.dim) * (0.82 + 0.09 * (p.zn + 1));
        const box = labelBox(lab.side, p.rr + LABEL_OFFSET[p.level], lab, BOX);
        // 장면이 기울어도 글자가 그래프 칸 밖으로 잘리지 않게 안쪽으로 밀어 둡니다.
        const left = clamp(p.px + box.x0, EDGE, Math.max(EDGE, sim.w - EDGE - lab.w));
        const top = clamp(p.py + box.y0, 3, Math.max(3, sim.h - 3 - lab.h));
        const anchor = box.align < 0 ? left : box.align > 0 ? left + lab.w : left + lab.w / 2;
        ctx.textAlign = box.align < 0 ? 'left' : box.align > 0 ? 'right' : 'center';
        ctx.globalAlpha = alpha;
        lab.lines.forEach((line, i) => {
            const y = top + lab.lh * (i + 0.77);
            ctx.font = line.font;
            ctx.strokeText(line.text, anchor, y);
            ctx.fillStyle = i === 0 && p.hot > 0.5 ? '#FFFFFF' : line.color;
            ctx.fillText(line.text, anchor, y);
        });
    }
}

// 한 프레임: 움직임 계산 → 화면 자리(원근) → 바탕·빛·선·입자·점·라벨 순으로 그립니다.
function frame(sim, now) {
    const ctx = sim.ctx;
    if (!ctx || !sim.bg || !sim.w) return;
    const still = sim.reduced;
    const dt = still ? 0 : clamp(now - sim.last, 0, 64);
    sim.last = now;
    const ease = (tau) => (still ? 1 : 1 - Math.exp(-dt / tau));
    const beat = still ? 0 : heartbeat(now);
    const busy = Boolean(sim.selfId || sim.drag);

    // 장면 전체가 천천히 좌우로 흔들리고 포인터 쪽으로 살짝 기웁니다. 점을 가리키는 동안은 멈춰서 점이 포인터 밑에 머뭅니다.
    if (still) {
        sim.tiltX = 0;
        sim.tiltY = 0;
    } else {
        const follow = busy ? 0 : ease(320);
        sim.tiltX += (sim.aimX - sim.tiltX) * follow;
        sim.tiltY += (sim.aimY - sim.tiltY) * follow;
        if (!busy) sim.sway += dt;
    }
    const rotY = still ? 0 : Math.sin(sim.sway * 0.00024) * 0.075 + sim.tiltY;
    const rotX = still ? 0 : Math.sin(sim.sway * 0.00017 + 1.1) * 0.035 + sim.tiltX;
    sim.cosY = Math.cos(rotY);
    sim.sinY = Math.sin(rotY);
    sim.cosX = Math.cos(rotX);
    sim.sinX = Math.sin(rotX);

    // 화면 주사율(60·120Hz)과 상관없이 같은 빠르기로 움직이도록 1/60초씩 끊어 계산합니다.
    if (!still) {
        sim.lag += dt;
        let steps = 0;
        while (sim.lag >= STEP && steps < 4) {
            drift(sim);
            sim.clock += STEP;
            sim.lag -= STEP;
            steps += 1;
        }
        if (steps === 4) sim.lag = 0;
    }

    const quick = ease(130);
    for (const p of sim.order) {
        const x1 = p.x * sim.cosY + p.z * sim.sinY;
        const z1 = p.z * sim.cosY - p.x * sim.sinY;
        const y1 = p.y * sim.cosX - z1 * sim.sinX;
        const z2 = z1 * sim.cosX + p.y * sim.sinX;
        p.ss = CAMERA / (CAMERA - z2);
        p.sx = sim.cx + x1 * p.ss;
        p.sy = sim.cy + y1 * p.ss;
        p.zn = clamp(z2 / DEPTH, -1, 1);

        const raw = still ? 1 : clamp((now - p.born) / GROW_MS[p.level], 0, 1);
        p.e = raw >= 1 ? 1 : 1 - (1 - raw) ** 3;
        if (p.e >= 1 && !p.arrived) {
            p.arrived = true;
            if (!still) p.fire = 1;
        }
        p.dim += (p.tDim - p.dim) * quick;
        p.hot += (p.tHot - p.hot) * quick;
        p.self += (p.tSelf - p.self) * quick;
        p.calm += ((p.tSelf || p.held ? 0.1 : 1) - p.calm) * ease(220);
        p.fire = still ? 0 : p.fire * Math.exp(-dt / 280);

        if (p.up) {
            curve(sim, p.up, now);
            p.px = p.up.x1;
            p.py = p.up.y1;
        } else {
            p.px = p.sx;
            p.py = p.sy;
        }
        p.rr = p.r * p.ss * (1 + 0.14 * p.zn) * (0.3 + 0.7 * p.e) * (1 + 0.15 * p.self + 0.06 * p.fire)
            * (p.level === 0 ? 1 + 0.055 * beat : 1);
    }

    ctx.setTransform(sim.dpr, 0, 0, sim.dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(sim.bg, 0, 0, sim.w, sim.h);
    drawAmbient(sim, now, beat);
    drawLinks(sim, now);
    if (!still) drawSparks(sim, dt);
    drawNodes(sim, now, beat);
    drawLabels(sim, ease);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
}

function pickNode(sim, x, y, reach) {
    let found = null;
    let nearest = Infinity;
    for (const p of sim.list) {
        if (p.e < 0.4) continue;
        const distance = Math.hypot(x - p.px, y - p.py);
        if (distance > Math.max(p.rr + 7, reach)) continue;
        if (distance - p.rr < nearest) {
            nearest = distance - p.rr;
            found = p;
        }
    }
    return found;
}

// 매장을 가운데 두고 키워드·순위·리뷰·결제 데이터를 신경망처럼 잇는 그래프입니다.
// 점·선·빛 입자는 캔버스 한 장에 requestAnimationFrame 으로 그리고(React 렌더 없음), 화면 밖이거나 탭이 숨으면 멈춥니다.
// 바깥(요약·카드)에서는 ref.focus(id) 로 같은 점을 밝히고, onHover 로 지금 가리킨 점을 받습니다.
const PlaceGraph = forwardRef(function PlaceGraph(
    { nodes, links, mode = 'live', label, title = '연결 그래프', legend = [], hint, onSelect, onHover, children },
    ref,
) {
    const wrapRef = useRef(null);
    const canvasRef = useRef(null);
    const simRef = useRef(null);
    if (!simRef.current) simRef.current = createSim();
    const hoverCb = useRef(onHover);
    hoverCb.current = onHover;
    const [ready, setReady] = useState(false);
    const [hover, setHover] = useState(null);
    const [linked, setLinked] = useState(null);
    const [linkedGroup, setLinkedGroup] = useState(null);
    const [group, setGroup] = useState(null);
    const [pinnedGroup, setPinnedGroup] = useState(null);

    const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
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

    const active = hover ?? linked;
    const activeNode = active ? nodeById.get(active) : null;
    // 이름 없는 점(빈 화면의 자리 표시)은 부모 이름으로 읽어 줍니다.
    const readNode = activeNode && !(activeNode.full || activeNode.label) ? nodeById.get(activeNode.parent) || activeNode : activeNode;
    const shownGroup = activeNode ? null : group ?? linkedGroup ?? pinnedGroup;
    const hotIds = useMemo(() => {
        if (activeNode) return related.get(activeNode.id) || null;
        if (!shownGroup) return null;
        return new Set(nodes.filter((node) => node.level === 0 || node.group === shownGroup).map((node) => node.id));
    }, [activeNode, related, shownGroup, nodes]);
    const groups = useMemo(() => new Set(nodes.map((node) => node.group)), [nodes]);

    useImperativeHandle(ref, () => ({
        // 'group:search' 처럼 넘기면 점 하나가 아니라 그 묶음 전체를 밝힙니다.
        focus(id) {
            const groupId = typeof id === 'string' && id.startsWith('group:') ? id.slice(6) : null;
            setLinkedGroup(groupId);
            setLinked(!groupId && id && nodeById.has(id) ? id : null);
        },
        ping(id) {
            const sim = simRef.current;
            if (!id || !nodeById.has(id)) return;
            sim.pings.push({ id, at: performance.now() });
            sim.invalidate?.();
        },
    }), [nodeById]);

    useEffect(() => {
        hoverCb.current?.(hover ? nodeById.get(hover) || null : null);
    }, [hover, nodeById]);

    // 캔버스 준비: 크기·해상도 맞추기, 화면에 보일 때만 도는 반복 그리기, '움직임 줄이기' 설정 따르기
    useEffect(() => {
        const sim = simRef.current;
        const wrap = wrapRef.current;
        const canvas = canvasRef.current;
        if (!wrap || !canvas) return undefined;
        const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
        sim.canvas = canvas;
        sim.ctx = canvas.getContext('2d');
        sim.family = getComputedStyle(wrap).fontFamily || 'sans-serif';
        sim.reduced = motion.matches;
        sim.coarse = window.matchMedia('(pointer: coarse)').matches;

        let raf = 0;
        let visible = true;
        let disposed = false;
        const tick = (now) => {
            raf = 0;
            frame(sim, now);
            if (sim.running) raf = requestAnimationFrame(tick);
        };
        const start = () => {
            if (sim.running || sim.reduced || !visible || document.hidden) return;
            sim.running = true;
            sim.last = performance.now();
            if (!raf) raf = requestAnimationFrame(tick);
        };
        const stop = () => {
            sim.running = false;
            cancelAnimationFrame(raf);
            raf = 0;
        };
        // 반복 그리기가 멈춰 있을 때(움직임 줄이기·화면 밖)에도 바뀐 내용을 한 번은 그립니다.
        sim.invalidate = () => {
            if (!raf) raf = requestAnimationFrame(tick);
        };

        const resize = () => {
            const rect = wrap.getBoundingClientRect();
            const w = Math.max(240, Math.round(rect.width));
            const h = Math.max(240, Math.round(rect.height));
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            if (w === sim.w && h === sim.h && dpr === sim.dpr) return;
            Object.assign(sim, { w, h, dpr, lite: sim.coarse || w < 560 });
            canvas.width = Math.round(w * dpr);
            canvas.height = Math.round(h * dpr);
            paintBackdrop(sim);
            arrange(sim);
            // 크기를 바꾸면 캔버스가 지워지므로 같은 순간에 바로 다시 그립니다(깜빡임 방지).
            frame(sim, performance.now());
        };
        // 웹 글꼴이 늦게 들어오면 글자 폭이 달라지므로 다시 재고 자리를 잡습니다.
        const refit = () => {
            if (disposed) return;
            sim.family = getComputedStyle(wrap).fontFamily || 'sans-serif';
            arrange(sim);
            sim.invalidate();
        };
        const onMotion = () => {
            sim.reduced = motion.matches;
            if (sim.reduced) stop();
            arrange(sim);
            sim.invalidate();
            start();
        };
        const onVisibility = () => (document.hidden ? stop() : start());
        // 점 위에서 시작한 터치는 끌기로 쓰고, 빈 곳에서 시작한 터치는 페이지 스크롤로 둡니다.
        const onTouchStart = (event) => {
            if (sim.reduced || event.touches.length !== 1) return;
            const rect = canvas.getBoundingClientRect();
            const p = pickNode(sim, event.touches[0].clientX - rect.left, event.touches[0].clientY - rect.top, 16);
            if (p && p.level > 0) event.preventDefault();
        };

        resize();
        setReady(true);
        const sizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
        sizeObserver?.observe(wrap);
        const viewObserver = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting;
            if (visible) start();
            else stop();
        });
        viewObserver?.observe(wrap);
        window.addEventListener('resize', resize);
        document.addEventListener('visibilitychange', onVisibility);
        motion.addEventListener?.('change', onMotion);
        canvas.addEventListener('touchstart', onTouchStart, { passive: false });
        document.fonts?.ready?.then(refit);
        document.fonts?.addEventListener?.('loadingdone', refit);
        start();
        sim.invalidate();
        return () => {
            disposed = true;
            stop();
            sim.invalidate = null;
            sizeObserver?.disconnect();
            viewObserver?.disconnect();
            window.removeEventListener('resize', resize);
            document.removeEventListener('visibilitychange', onVisibility);
            motion.removeEventListener?.('change', onMotion);
            canvas.removeEventListener('touchstart', onTouchStart);
            document.fonts?.removeEventListener?.('loadingdone', refit);
        };
    }, []);

    useEffect(() => {
        const sim = simRef.current;
        syncGraph(sim, nodes, links);
        arrange(sim);
        sim.invalidate?.();
    }, [nodes, links]);

    useEffect(() => {
        const sim = simRef.current;
        sim.mode = mode;
        sim.invalidate?.();
    }, [mode]);

    // 밝힐 점·흐릴 점을 장면에 알립니다. 실제 밝기는 프레임마다 부드럽게 따라갑니다.
    useEffect(() => {
        const sim = simRef.current;
        sim.hotSet = hotIds;
        sim.selfId = activeNode ? activeNode.id : null;
        for (const p of sim.list) {
            const on = hotIds ? hotIds.has(p.id) : false;
            p.tHot = on ? 1 : 0;
            p.tDim = hotIds && !on ? 1 : 0;
            p.tSelf = p.id === sim.selfId ? 1 : 0;
        }
        showLabels(sim);
        sim.invalidate?.();
    }, [hotIds, activeNode, nodes, links]);

    const localPoint = (event) => {
        const rect = canvasRef.current.getBoundingClientRect();
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    const select = (node) => {
        const sim = simRef.current;
        sim.pings.push({ id: node.id, at: performance.now() });
        sim.invalidate?.();
        onSelect?.(node);
    };

    const pointAt = (id) => {
        setLinked(null);
        setLinkedGroup(null);
        setHover(id);
    };

    const onPointerDown = (event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        const sim = simRef.current;
        const touch = event.pointerType === 'touch';
        const { x, y } = localPoint(event);
        const p = pickNode(sim, x, y, touch ? 22 : 13);
        if (!p) return;
        sim.drag = { p, x: event.clientX, y: event.clientY, lx: x, ly: y, moved: false, touch };
        event.currentTarget.setPointerCapture?.(event.pointerId);
        if (touch) pointAt(p.id);
    };

    const onPointerMove = (event) => {
        const sim = simRef.current;
        const { x, y } = localPoint(event);
        const drag = sim.drag;
        if (drag) {
            if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5) return;
            drag.moved = true;
            drag.lx = clamp(x, 10, sim.w - 10);
            drag.ly = clamp(y, 10, sim.h - 10);
            // 매장 점은 가운데에 고정이고, '움직임 줄이기'에서는 끌어도 곧바로 제자리로 돌아가므로 끌기를 받지 않습니다.
            if (drag.p.level > 0 && !sim.reduced) {
                drag.p.held = true;
                drag.p.born = 0;
                event.currentTarget.style.cursor = 'grabbing';
            }
            return;
        }
        if (event.pointerType === 'touch') return;
        sim.aimY = (x / sim.w - 0.5) * 0.16;
        sim.aimX = -(y / sim.h - 0.5) * 0.09;
        const p = pickNode(sim, x, y, 13);
        event.currentTarget.style.cursor = p && mode !== 'loading' ? 'pointer' : '';
        const id = p ? p.id : null;
        if (id !== hover) {
            if (id) pointAt(id);
            else setHover(null);
        }
    };

    const endDrag = (event, pick) => {
        const sim = simRef.current;
        const drag = sim.drag;
        if (!drag) return;
        sim.drag = null;
        drag.p.held = false;
        event.currentTarget.style.cursor = '';
        if (drag.touch) setHover(null);
        if (pick && !drag.moved) select(drag.p.node);
    };

    const onPointerLeave = () => {
        const sim = simRef.current;
        sim.aimX = 0;
        sim.aimY = 0;
        if (!sim.drag) setHover(null);
    };

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
                                    style={{ '--c': GROUP_COLOR[item.group] || GROUP_COLOR.ops }}
                                    aria-pressed={pinnedGroup === item.group}
                                    onClick={() => setPinnedGroup((prev) => (prev === item.group ? null : item.group))}
                                    onPointerEnter={(event) => {
                                        if (event.pointerType !== 'touch') setGroup(item.group);
                                    }}
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
            <div ref={wrapRef} className={styles.wrap} data-ready={ready ? 'true' : 'false'} role="group" aria-label={label}>
                <canvas
                    ref={canvasRef}
                    className={styles.canvas}
                    aria-hidden="true"
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={(event) => endDrag(event, true)}
                    onPointerCancel={(event) => endDrag(event, false)}
                    onPointerLeave={onPointerLeave}
                />
                {/* 캔버스가 그려지기 전(서버가 그린 화면)에 매장 자리에서 뛰는 불빛 */}
                <div className={styles.placeholder} aria-hidden="true">
                    <span />
                </div>
                {/* 캔버스 안의 점은 키보드·화면 낭독기가 닿지 못하므로, 보이지 않는 버튼을 같은 자리에 겹쳐 둡니다. */}
                <ul className={styles.keys}>
                    {nodes.filter((node) => node.level < 2).map((node) => (
                        <li key={node.id}>
                            <button
                                type="button"
                                ref={(el) => {
                                    if (el) simRef.current.keys.set(node.id, el);
                                    else simRef.current.keys.delete(node.id);
                                }}
                                aria-label={node.aria || node.label}
                                onFocus={() => {
                                    simRef.current.focusId = node.id;
                                    pointAt(node.id);
                                }}
                                onBlur={() => {
                                    simRef.current.focusId = null;
                                    setHover((prev) => (prev === node.id ? null : prev));
                                }}
                                onClick={() => select(node)}
                            />
                        </li>
                    ))}
                </ul>
                {children}
            </div>
            <p className={styles.readout} data-on={readNode ? 'true' : 'false'}>
                {readNode ? (
                    <>
                        <span className={styles.readoutDot} style={{ '--c': colorOf(readNode) }} aria-hidden="true" />
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
