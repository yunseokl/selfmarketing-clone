// 데이터 점(뉴런)이 뇌 안 어디에 놓일지 정합니다.
// 매장 = 한가운데 핵, 묶음(1단계) = 엽의 깊은 쪽, 항목(2·3단계) = 자기 묶음의 엽 안 피질 가까이.
// 그래서 매장 → 묶음 → 항목으로 가는 선이 가운데에서 피질로 부채처럼 퍼집니다(실제 뇌의 투사 섬유와 같은 모양).
// 이미 자리 잡은 점은 그대로 두고 새로 생긴 점만 빈 곳에 넣으므로, 데이터가 조금씩 도착해도 뇌 전체가 흔들리지 않습니다.

import { CORE, LOBES, lobeOf, brainDistance, mulberry32, hashOf } from './brain';

const TRIES = 30;

function nearest(x, y, z, placed) {
    let best = Infinity;
    for (let i = 0; i < placed.length; i += 1) {
        const p = placed[i];
        const d = (p[0] - x) ** 2 + (p[1] - y) ** 2 + (p[2] - z) ** 2;
        if (d < best) best = d;
    }
    return Math.sqrt(best);
}

// 타원체 안의 고른 점(가운데에 몰리지 않게 세제곱근으로 편다)
function inEllipsoid(rand, center, radii, scale) {
    const uz = rand() * 2 - 1;
    const angle = rand() * Math.PI * 2;
    const ur = Math.sqrt(1 - uz * uz);
    const reach = Math.cbrt(rand()) * scale;
    return [
        center[0] + ur * Math.cos(angle) * radii[0] * reach,
        center[1] + ur * Math.sin(angle) * radii[1] * reach,
        center[2] + uz * radii[2] * reach,
    ];
}

// nodes: 그래프 점 목록, kept: 지난번 자리(Map id → { key, at }). 돌려주는 값도 같은 꼴의 Map 입니다.
export function placeNodes(nodes, kept) {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const order = nodes.map((node, index) => ({ node, index })).sort((a, b) => a.node.level - b.node.level || a.index - b.index);
    const groupSize = new Map();
    const hubCount = new Map();
    for (const node of nodes) {
        const lobe = lobeOf(node.group);
        groupSize.set(lobe, (groupSize.get(lobe) || 0) + 1);
        if (node.level === 1) hubCount.set(lobe, (hubCount.get(lobe) || 0) + 1);
    }

    const next = new Map();
    const placed = [];
    // 지난번 자리를 먼저 채워 둡니다(새 점이 그 사이 빈 곳을 찾도록).
    for (const { node } of order) {
        const key = `${node.level}|${node.group}|${node.parent || ''}|${node.type || ''}`;
        const old = kept?.get(node.id);
        if (old && old.key === key) {
            next.set(node.id, old);
            placed.push(old.at);
        }
    }

    let coreTaken = false;
    const hubSeen = new Map();
    for (const { node } of order) {
        if (next.has(node.id)) {
            if (node.level === 0) coreTaken = true;
            if (node.level === 1) hubSeen.set(lobeOf(node.group), (hubSeen.get(lobeOf(node.group)) || 0) + 1);
            continue;
        }
        const key = `${node.level}|${node.group}|${node.parent || ''}|${node.type || ''}`;
        const rand = mulberry32(hashOf(node.id));
        const lobeName = lobeOf(node.group);
        const lobe = LOBES[lobeName];
        let at = null;

        if (node.level === 0 && !coreTaken) {
            coreTaken = true;
            at = [...CORE];
        } else if (node.level <= 1) {
            const nth = hubSeen.get(lobeName) || 0;
            hubSeen.set(lobeName, nth + 1);
            const many = (hubCount.get(lobeName) || 0) > 1;
            if (!many) {
                at = [lobe.hub[0] * lobe.side, lobe.hub[1], lobe.hub[2]];
            } else {
                // 같은 묶음에 1단계 점이 여럿이면(예: 키워드들) 엽의 깊은 쪽에 좌우 번갈아 벌려 놓습니다.
                let score = -Infinity;
                for (let i = 0; i < TRIES; i += 1) {
                    const p = inEllipsoid(rand, lobe.hub, [lobe.r[0] * 0.75, lobe.r[1] * 0.8, lobe.r[2] * 0.85], 1);
                    p[0] = Math.max(0.09, Math.abs(p[0])) * (rand() < 0.5 ? -1 : 1);
                    if (brainDistance(p[0], p[1], p[2]) > -0.09) continue;
                    const value = Math.min(nearest(p[0], p[1], p[2], placed), 0.3);
                    if (value > score) {
                        score = value;
                        at = p;
                    }
                }
                if (!at) at = [lobe.hub[0] * (nth % 2 ? 1 : -1), lobe.hub[1], lobe.hub[2]];
            }
        } else {
            const parent = next.get(node.parent);
            const from = parent ? parent.at : [lobe.hub[0] * lobe.side, lobe.hub[1], lobe.hub[2]];
            const deep = node.level >= 3 || (parent && byId.get(node.parent)?.level >= 2);
            const size = Math.min(1.12, Math.max(0.72, Math.cbrt((groupSize.get(lobeName) || 1) / 16)));
            // 같은 종류(type)의 개체는 엽 안에서도 한데 모입니다: 종류마다 엽 안에 정해진 자리가 있고 그쪽으로 끌립니다.
            const kindSeed = node.type ? hashOf(node.type) : 0;
            const home = node.type ? [
                lobe.c[0] + ((kindSeed % 97) / 96 - 0.5) * lobe.r[0] * 0.9,
                lobe.c[1] + (((kindSeed >>> 8) % 97) / 96 - 0.5) * lobe.r[1] * 1.1,
                lobe.c[2] + (((kindSeed >>> 16) % 97) / 96 - 0.5) * lobe.r[2] * 1.1,
            ] : null;
            let score = -Infinity;
            for (let i = 0; i < TRIES; i += 1) {
                let p;
                if (deep) {
                    // 세부·근거(3단계)는 제 부모 바로 곁에
                    p = inEllipsoid(rand, from, [0.17, 0.17, 0.17], 1);
                } else {
                    p = inEllipsoid(rand, lobe.c, lobe.r, size);
                    // 좌우 반구 어느 쪽에 둘지: 부모가 한쪽에 치우쳐 있으면 그쪽을 더 자주 고릅니다.
                    const lean = from[0] > 0.05 ? 0.68 : from[0] < -0.05 ? 0.32 : 0.5;
                    p[0] = Math.abs(p[0]) * (rand() < lean ? 1 : -1);
                }
                const depth = brainDistance(p[0], p[1], p[2]);
                if (depth > -0.05 || depth < -0.36) continue;
                const gap = nearest(p[0], p[1], p[2], placed);
                const away = Math.hypot(p[0] - from[0], p[1] - from[1], p[2] - from[2]);
                const toHome = home && !deep ? Math.hypot(Math.abs(p[0]) - home[0], p[1] - home[1], p[2] - home[2]) : 0;
                const value = Math.min(gap, deep ? 0.11 : 0.2) - away * (deep ? 0.22 : 0.07) + (deep ? depth * 0.2 : 0) - toHome * 0.2;
                if (value > score) {
                    score = value;
                    at = p;
                }
            }
            if (!at) at = [from[0] + (rand() - 0.5) * 0.12, from[1] + (rand() - 0.5) * 0.12, from[2] + (rand() - 0.5) * 0.12];
        }
        const entry = { key, at };
        next.set(node.id, entry);
        placed.push(at);
    }
    return next;
}

// 선이 휘는 굽힘점. 가지(부모-자식)는 살짝만 휘고, 가로지르는 연결은 뇌 안쪽으로 깊게 휘어 연합 섬유처럼 지나갑니다.
// 좌우 반구를 건너는 연결은 가운데 위(뇌들보 자리)를 넘어갑니다.
export function bendOf(a, b, cross, seed) {
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    const mz = (a[2] + b[2]) / 2;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (!cross) {
        // 가운데에서 바깥을 향하는 쪽으로 조금 부풀립니다.
        const ox = mx - CORE[0];
        const oy = my - CORE[1];
        const oz = mz - CORE[2];
        const norm = Math.hypot(ox, oy, oz) || 1;
        // 곧은 바큇살처럼 보이지 않도록 섬유처럼 넉넉히 휘고, 선마다 휘는 쪽을 다르게 둡니다.
        const swing = (seed - 0.5) * 0.9;
        const amount = length * (0.16 + 0.16 * seed);
        return [mx + (ox / norm) * amount + swing * length * 0.3, my + (oy / norm) * amount + Math.abs(swing) * length * 0.16, mz + (oz / norm) * amount - swing * length * 0.3];
    }
    if (a[0] * b[0] < -0.01) {
        return [0, Math.max(my, 0.12) + 0.14 + 0.08 * seed, mz * 0.7];
    }
    const pull = 0.38 + 0.22 * seed;
    return [mx + (CORE[0] - mx) * pull, my + (CORE[1] + 0.1 - my) * pull, mz + (CORE[2] - mz) * pull];
}
