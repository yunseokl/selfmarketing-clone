// 뇌 형상을 계산으로 만듭니다(그림 파일·외부 모델 없음).
// 타원체 몇 개를 부드럽게 이어 붙인 거리 함수로 좌우 반구·측두엽·소뇌·뇌간을 잡고, 그 표면에 점을 뿌립니다.
// 주름(이랑·고랑)은 잡음 함수 값이 0 을 지나는 자리를 고랑으로 삼아, 고랑은 비워 두고 그 양쪽 어깨에 점을 몰아서 표현합니다.
// 좌표: x = 좌우(가운데 틈이 x = 0), y = 위, z = 앞(이마 쪽이 +). 뇌 앞뒤 길이가 2 가 되도록 잡았습니다.

export function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function hashOf(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    return hash >>> 0;
}

/* ───────── 잡음(펄린) ───────── */

function makeNoise(seed) {
    const rand = mulberry32(seed);
    const perm = new Uint8Array(512);
    for (let i = 0; i < 256; i += 1) perm[i] = i;
    for (let i = 255; i > 0; i -= 1) {
        const j = Math.floor(rand() * (i + 1));
        const t = perm[i];
        perm[i] = perm[j];
        perm[j] = t;
    }
    for (let i = 0; i < 256; i += 1) perm[i + 256] = perm[i];
    const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
    const grad = (hash, x, y, z) => {
        const h = hash & 15;
        const u = h < 8 ? x : y;
        const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
        return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
    };
    return (x, y, z) => {
        const X = Math.floor(x) & 255;
        const Y = Math.floor(y) & 255;
        const Z = Math.floor(z) & 255;
        const fx = x - Math.floor(x);
        const fy = y - Math.floor(y);
        const fz = z - Math.floor(z);
        const u = fade(fx);
        const v = fade(fy);
        const w = fade(fz);
        const A = perm[X] + Y;
        const AA = perm[A] + Z;
        const AB = perm[A + 1] + Z;
        const B = perm[X + 1] + Y;
        const BA = perm[B] + Z;
        const BB = perm[B + 1] + Z;
        const g0 = grad(perm[AA], fx, fy, fz);
        const g1 = grad(perm[AB], fx, fy - 1, fz);
        const g2 = grad(perm[AA + 1], fx, fy, fz - 1);
        const g3 = grad(perm[AB + 1], fx, fy - 1, fz - 1);
        const x1 = g0 + u * (grad(perm[BA], fx - 1, fy, fz) - g0);
        const x2 = g1 + u * (grad(perm[BB], fx - 1, fy - 1, fz) - g1);
        const y1 = x1 + v * (x2 - x1);
        const x3 = g2 + u * (grad(perm[BA + 1], fx - 1, fy, fz - 1) - g2);
        const x4 = g3 + u * (grad(perm[BB + 1], fx - 1, fy - 1, fz - 1) - g3);
        const y2 = x3 + v * (x4 - x3);
        return y1 + w * (y2 - y1);
    };
}

/* ───────── 거리 함수 ───────── */

function ell(x, y, z, cx, cy, cz, rx, ry, rz) {
    const dx = (x - cx) / rx;
    const dy = (y - cy) / ry;
    const dz = (z - cz) / rz;
    return (Math.sqrt(dx * dx + dy * dy + dz * dz) - 1) * Math.min(rx, ry, rz);
}

function smin(a, b, k) {
    const h = Math.max(k - Math.abs(a - b), 0) / k;
    return Math.min(a, b) - h * h * k * 0.25;
}

function smax(a, b, k) {
    return -smin(-a, -b, k);
}

// 가운데 세로 틈(좌우 반구 사이)의 절반 너비
const GAP = 0.036;
// 타원체: [cx, cy, cz, rx, ry, rz]
const FRONTAL = [0.35, 0.16, 0.5, 0.375, 0.56, 0.535];
const PARIETAL = [0.37, 0.27, -0.1, 0.405, 0.6, 0.62];
const OCCIPITAL = [0.31, 0.04, -0.67, 0.315, 0.43, 0.37];
const CEREBELLUM = [0.25, -0.47, -0.6, 0.35, 0.22, 0.31];
const PONS = [0, -0.4, -0.17, 0.2, 0.15, 0.17];
// 측두엽: 앞쪽 끝이 아래로 숙여진 타원체(자기 좌표계에서 [x 중심, 반지름 3개])
const TEMPORAL = { cy: -0.3, cz: 0.12, cx: 0.5, r: [0.255, 0.205, 0.54], cos: Math.cos(0.2), sin: Math.sin(0.2) };
const STEM = { ay: -0.3, az: -0.2, by: -0.9, bz: -0.38, r0: 0.125, taper: 0.035 };

function temporal(ax, y, z) {
    const ty = y - TEMPORAL.cy;
    const tz = z - TEMPORAL.cz;
    const ly = ty * TEMPORAL.cos + tz * TEMPORAL.sin;
    const lz = tz * TEMPORAL.cos - ty * TEMPORAL.sin;
    return ell(ax, ly, lz, TEMPORAL.cx, 0, 0, TEMPORAL.r[0], TEMPORAL.r[1], TEMPORAL.r[2]);
}

// 대뇌(측두엽 제외): 전두·두정·후두를 이어 붙이고 바닥을 깎습니다. 바닥은 이마 쪽으로 갈수록 올라가서,
// 옆에서 보면 측두엽 끝이 전두엽 아래로 엄지처럼 내려와 보입니다.
function dome(ax, y, z) {
    let d = ell(ax, y, z, FRONTAL[0], FRONTAL[1], FRONTAL[2], FRONTAL[3], FRONTAL[4], FRONTAL[5]);
    d = smin(d, ell(ax, y, z, PARIETAL[0], PARIETAL[1], PARIETAL[2], PARIETAL[3], PARIETAL[4], PARIETAL[5]), 0.16);
    d = smin(d, ell(ax, y, z, OCCIPITAL[0], OCCIPITAL[1], OCCIPITAL[2], OCCIPITAL[3], OCCIPITAL[4], OCCIPITAL[5]), 0.14);
    const lift = Math.min(1, Math.max(0, (z - 0.05) / 0.85));
    return smax(d, -0.34 + 0.2 * lift * lift * (3 - 2 * lift) - y, 0.07);
}

function cerebellum(ax, y, z) {
    return ell(ax, y, z, CEREBELLUM[0], CEREBELLUM[1], CEREBELLUM[2], CEREBELLUM[3], CEREBELLUM[4], CEREBELLUM[5]);
}

function stem(x, y, z) {
    // 뇌간: 위(다리뇌)가 굵고 아래로 가늘어지는 기둥
    const vy = STEM.by - STEM.ay;
    const vz = STEM.bz - STEM.az;
    const t = Math.min(1, Math.max(0, ((y - STEM.ay) * vy + (z - STEM.az) * vz) / (vy * vy + vz * vz)));
    const qy = y - (STEM.ay + vy * t);
    const qz = z - (STEM.az + vz * t);
    const capsule = Math.sqrt(x * x + qy * qy + qz * qz) - (STEM.r0 - STEM.taper * t);
    return smin(capsule, ell(x, y, z, PONS[0], PONS[1], PONS[2], PONS[3], PONS[4], PONS[5]), 0.06);
}

function cerebrumDistance(ax, y, z) {
    return smax(smin(dome(ax, y, z), temporal(ax, y, z), 0.045), GAP - ax, 0.035);
}

// 뇌 전체의 거리 함수(안쪽이 음수)
export function brainDistance(x, y, z) {
    const ax = Math.abs(x);
    return Math.min(cerebrumDistance(ax, y, z), cerebellum(ax, y, z), stem(x, y, z));
}

// 표면 점이 어느 부위에 속하는지: 0 대뇌, 1 소뇌, 2 뇌간
function partOf(x, y, z) {
    const ax = Math.abs(x);
    const cerebrum = cerebrumDistance(ax, y, z);
    const cb = cerebellum(ax, y, z);
    const st = stem(x, y, z);
    if (cerebrum <= cb && cerebrum <= st) return 0;
    return cb <= st ? 1 : 2;
}

/* ───────── 엽(묶음이 자리 잡는 곳) ─────────
   hub: 묶음 점이 놓이는 자리(깊은 쪽), c·r: 항목이 놓이는 부피의 중심과 반지름(좌우 대칭).
   side: 묶음 점을 어느 반구 쪽에 둘지(+1 오른쪽, -1 왼쪽) */

export const CORE = [0, 0.03, -0.03];

export const LOBES = {
    search: { name: '전두엽', hub: [0.19, 0.33, 0.4], c: [0.37, 0.3, 0.5], r: [0.25, 0.32, 0.34], side: -1 },
    todo: { name: '전전두엽', hub: [0.17, -0.02, 0.62], c: [0.31, -0.04, 0.74], r: [0.21, 0.15, 0.2], side: 1 },
    rival: { name: '두정엽', hub: [0.19, 0.48, -0.2], c: [0.38, 0.5, -0.2], r: [0.27, 0.25, 0.3], side: 1 },
    pay: { name: '후두엽', hub: [0.15, 0.08, -0.6], c: [0.29, 0.08, -0.75], r: [0.2, 0.26, 0.2], side: -1 },
    voice: { name: '측두엽', hub: [0.36, -0.24, 0.2], c: [0.54, -0.31, 0.2], r: [0.15, 0.13, 0.36], side: -1 },
    geo: { name: '측두·두정 접합부', hub: [0.33, 0.04, -0.3], c: [0.57, 0.03, -0.34], r: [0.14, 0.2, 0.22], side: 1 },
    ops: { name: '소뇌', hub: [0.13, -0.42, -0.5], c: [0.27, -0.48, -0.62], r: [0.23, 0.13, 0.2], side: -1 },
    other: { name: '심부', hub: [0.2, 0.1, 0.1], c: [0.3, 0.08, 0.08], r: [0.16, 0.2, 0.3], side: 1 },
};

export const LOBE_ORDER = ['search', 'todo', 'rival', 'pay', 'voice', 'geo', 'ops', 'other'];

export function lobeOf(group) {
    return LOBES[group] ? group : 'other';
}

// 표면 점이 어느 엽 위에 있는지(껍질이 그 묶음의 발화에 맞춰 은은하게 밝아지는 데 씁니다)
function regionOf(x, y, z, part) {
    if (part === 1) return LOBE_ORDER.indexOf('ops');
    if (part === 2) return LOBE_ORDER.indexOf('other');
    const ax = Math.abs(x);
    let best = 0;
    let nearest = Infinity;
    for (let i = 0; i < LOBE_ORDER.length - 1; i += 1) {
        if (LOBE_ORDER[i] === 'ops') continue;
        const lobe = LOBES[LOBE_ORDER[i]];
        const dx = (ax - lobe.c[0]) / (lobe.r[0] + 0.12);
        const dy = (y - lobe.c[1]) / (lobe.r[1] + 0.12);
        const dz = (z - lobe.c[2]) / (lobe.r[2] + 0.12);
        const d = dx * dx + dy * dy + dz * dz;
        if (d < nearest) {
            nearest = d;
            best = i;
        }
    }
    return best;
}

/* ───────── 표면 점 뿌리기 ─────────
   점은 두 가지입니다. (1) 고랑을 따라 촘촘히 늘어선 '선 점' — 구불구불한 주름이 점선으로 읽힙니다.
   (2) 이랑 위에 듬성듬성 놓인 '면 점' — 표면이 이어져 있다는 느낌만 줍니다.
   분필로 칠판에 뇌를 그릴 때 윤곽과 주름 선만 긋는 것과 같은 방식이라, 적은 점으로도 뇌로 읽힙니다. */

// 점 하나 = [x, y, z, nx, ny, nz, ridge, part, region, seed]
export const BRAIN_STRIDE = 10;

// 품질 단계별 선 점 사이 간격(굵은 것부터)과 후보 개수. 앞 단계의 점만 그려도 고르게 퍼져 있습니다.
const TIERS = {
    full: { radii: [0.03, 0.0205, 0.0145], lines: 13000, faces: 8000 },
    lite: { radii: [0.033, 0.0225], lines: 6500, faces: 4500 },
};
// 면 점은 선 점보다 이만큼 더 벌려 놓습니다(선 둘레가 비어서 선이 또렷해집니다).
const FACE_ROOM = 4.3;

// 후보 점을 뽑을 부위와 그 비율(겉넓이에 대충 비례)
const SOURCES = [
    [FRONTAL, 2.9], [PARIETAL, 3.4], [OCCIPITAL, 1.7], ['temporal', 2.1], [CEREBELLUM, 1.3], ['stem', 0.5], [PONS, 0.25],
];
const SOURCE_TOTAL = SOURCES.reduce((sum, item) => sum + item[1], 0);

// 한 번에 오래 붙잡지 않도록 조금씩 나눠 계산합니다(yield 마다 쉬어 갈 수 있음).
function* brainJob(tier) {
    const config = TIERS[tier] || TIERS.full;
    const rand = mulberry32(20261116);
    const fold = makeNoise(7);
    const warp = makeNoise(19);
    const eps = 0.004;

    // 표면 위로 끌어다 놓기(p 의 자리와 법선을 고칩니다). 표면에 닿으면 true
    const toSurface = (p, steps) => {
        let d = brainDistance(p.x, p.y, p.z);
        for (let step = 0; step < steps; step += 1) {
            let nx = brainDistance(p.x + eps, p.y, p.z) - d;
            let ny = brainDistance(p.x, p.y + eps, p.z) - d;
            let nz = brainDistance(p.x, p.y, p.z + eps) - d;
            const len = Math.hypot(nx, ny, nz) || 1;
            nx /= len;
            ny /= len;
            nz /= len;
            p.x -= nx * d;
            p.y -= ny * d;
            p.z -= nz * d;
            p.nx = nx;
            p.ny = ny;
            p.nz = nz;
            d = brainDistance(p.x, p.y, p.z);
        }
        return Math.abs(d) < 0.006;
    };

    // 부위 표면에서 후보 하나를 뽑아 전체 표면 위에 올립니다.
    const seedPoint = () => {
        let pick = rand() * SOURCE_TOTAL;
        let source = SOURCES[0][0];
        for (const [item, weight] of SOURCES) {
            pick -= weight;
            if (pick <= 0) {
                source = item;
                break;
            }
        }
        const uz = rand() * 2 - 1;
        const angle = rand() * Math.PI * 2;
        const ur = Math.sqrt(1 - uz * uz);
        const ux = ur * Math.cos(angle);
        const uy = ur * Math.sin(angle);
        const p = { x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0 };
        if (source === 'temporal') {
            const ly = uy * TEMPORAL.r[1];
            const lz = uz * TEMPORAL.r[2];
            p.x = TEMPORAL.cx + ux * TEMPORAL.r[0];
            p.y = TEMPORAL.cy + ly * TEMPORAL.cos - lz * TEMPORAL.sin;
            p.z = TEMPORAL.cz + ly * TEMPORAL.sin + lz * TEMPORAL.cos;
        } else if (source === 'stem') {
            const t = rand();
            const radius = STEM.r0 - STEM.taper * t;
            p.x = Math.cos(angle) * radius;
            p.y = STEM.ay + (STEM.by - STEM.ay) * t + Math.sin(angle) * radius * 0.28;
            p.z = STEM.az + (STEM.bz - STEM.az) * t + Math.sin(angle) * radius;
        } else {
            p.x = source[0] + ux * source[3];
            p.y = source[1] + uy * source[4];
            p.z = source[2] + uz * source[5];
        }
        if (source !== 'stem' && source !== PONS && rand() < 0.5) p.x = -p.x;
        const d = brainDistance(p.x, p.y, p.z);
        if (d > 0.09 || d < -0.09) return null;
        return toSurface(p, 2) ? p : null;
    };

    // 주름 무늬: 이 값이 0 인 자리가 고랑입니다. 지문처럼 '서로 나란히 흐르다 굽이치는 줄무늬'로 만듭니다.
    // (줄무늬의 기준 방향을 잡음으로 크게 휘어 놓은 것. 등고선처럼 동그랗게 닫힌 고리가 생기지 않아 뇌 주름에 가깝습니다.)
    // 기준 방향은 대체로 가로(옆에서 볼 때 앞뒤로 흐르는 고랑)이고, 중심고랑 둘레에서는 세로로 바뀝니다.
    const folds = (x, y, z) => {
        const ax = Math.abs(x);
        const shift = x < 0 ? 4.4 : 0;
        const slow = warp(ax * 1.7 + 3.1, y * 1.7, z * 1.7 + shift);
        const fine = fold(ax * 4.1, y * 4.1 + 7.7, z * 4.1 - shift);
        const band = (z + 0.3 * (y - 0.4) + 0.05) / 0.27;
        const upright = Math.exp(-band * band);
        const across = y * 0.9 + ax * 0.62;
        const along = z + 0.3 * y + 0.05;
        return Math.sin(17 * (across * (1 - upright) + along * upright + 0.3 * slow + 0.08 * fine));
    };
    // 중심고랑(전두엽과 두정엽 사이를 위에서 아래로 가르는 골)
    const central = (offset) => (x, y, z) => z + 0.3 * (y - 0.4) + 0.05 - offset;
    // 가쪽 고랑(측두엽 위쪽 경계)
    const lateral = (x, y, z) => dome(Math.abs(x), y, z) - temporal(Math.abs(x), y, z);
    // 소뇌의 가로 결
    const folia = (x, y, z) => Math.sin(y * 58 + z * 20 + warp(x * 3, y * 3, z * 3) * 2.4);

    // 표면을 따라 미끄러져 field = 0 인 선 위로 옮깁니다. 선에 닿으면 true
    const toLine = (p, field, tolerance) => {
        const h = 0.006;
        for (let step = 0; step < 4; step += 1) {
            const f = field(p.x, p.y, p.z);
            if (Math.abs(f) < tolerance) return true;
            let gx = (field(p.x + h, p.y, p.z) - f) / h;
            let gy = (field(p.x, p.y + h, p.z) - f) / h;
            let gz = (field(p.x, p.y, p.z + h) - f) / h;
            const along = gx * p.nx + gy * p.ny + gz * p.nz;
            gx -= along * p.nx;
            gy -= along * p.ny;
            gz -= along * p.nz;
            const g2 = gx * gx + gy * gy + gz * gz;
            if (g2 < 1e-5) return false;
            let move = f / g2;
            const reach = Math.abs(move) * Math.sqrt(g2);
            if (reach > 0.06) move *= 0.06 / reach;
            p.x -= gx * move;
            p.y -= gy * move;
            p.z -= gz * move;
            if (!toSurface(p, 1)) return false;
        }
        return Math.abs(field(p.x, p.y, p.z)) < tolerance * 2;
    };

    const lines = [];
    const faces = [];
    const centralMain = central(0);
    let guard = 0;

    // 1) 선 점: 고랑 위로 옮긴 후보
    while (lines.length < config.lines && guard < config.lines * 12) {
        guard += 1;
        if (guard % 400 === 0) yield;
        const p = seedPoint();
        if (!p) continue;
        const part = partOf(p.x, p.y, p.z);
        const roll = rand();
        let ok = false;
        let ridge = 1;
        if (part === 0) {
            if (roll < 0.07) {
                ok = p.y > -0.08 && toLine(p, centralMain, 0.004) && p.y > -0.06;
            } else if (roll < 0.15) {
                ok = toLine(p, lateral, 0.004);
            } else {
                ok = toLine(p, folds, 0.06);
                ridge = 0.84;
            }
            // 가운데 틈의 안쪽 벽과 바닥에는 주름 선을 긋지 않습니다(틈이 어두운 선으로 읽히도록).
            if (ok && (Math.abs(p.x) < GAP + 0.035 || p.ny < -0.7)) ok = false;
            if (ok && partOf(p.x, p.y, p.z) !== 0) ok = false;
        } else if (part === 1) {
            ok = toLine(p, folia, 0.06) && partOf(p.x, p.y, p.z) === 1;
            ridge = 0.7;
        }
        if (!ok) continue;
        lines.push({ ...p, ridge, room: 1, part, region: regionOf(p.x, p.y, p.z, part), seed: rand() });
    }

    // 2) 면 점: 표면 아무 데나(선에서 떨어진 자리만 살아남습니다)
    guard = 0;
    while (faces.length < config.faces && guard < config.faces * 6) {
        guard += 1;
        if (guard % 800 === 0) yield;
        const p = seedPoint();
        if (!p) continue;
        const part = partOf(p.x, p.y, p.z);
        const inner = part === 0 && Math.abs(p.x) < GAP + 0.03;
        if (inner && rand() < 0.5) continue;
        faces.push({ ...p, ridge: part === 2 ? 0.34 : inner ? 0.2 : 0.4, room: FACE_ROOM * (inner ? 1.3 : 1), part, region: regionOf(p.x, p.y, p.z, part), seed: rand() });
    }

    // 3) 간격을 지키며 고릅니다(굵은 간격부터, 선 점 먼저). 서로 너무 가까운 점을 버려서 얼룩 없이 고른 점밭이 됩니다.
    const cell = config.radii[0] * FACE_ROOM * 1.3;
    const grid = new Map();
    const keyOf = (ix, iy, iz) => ix * 73856093 + iy * 19349663 + iz * 83492791;
    const picked = [];
    const levels = [];
    for (const radius of config.radii) {
        for (const pool of [lines, faces]) {
            for (let i = 0; i < pool.length; i += 1) {
                const p = pool[i];
                if (p.taken) continue;
                if (i % 1500 === 0) yield;
                const reach = radius * p.room;
                const r2 = reach * reach;
                const ix = Math.floor(p.x / cell);
                const iy = Math.floor(p.y / cell);
                const iz = Math.floor(p.z / cell);
                let free = true;
                for (let a = -1; a <= 1 && free; a += 1) {
                    for (let b = -1; b <= 1 && free; b += 1) {
                        for (let c = -1; c <= 1 && free; c += 1) {
                            const bucket = grid.get(keyOf(ix + a, iy + b, iz + c));
                            if (!bucket) continue;
                            for (let k = 0; k < bucket.length; k += 1) {
                                const q = bucket[k];
                                const dx = q.x - p.x;
                                const dy = q.y - p.y;
                                const dz = q.z - p.z;
                                if (dx * dx + dy * dy + dz * dz < r2) {
                                    free = false;
                                    break;
                                }
                            }
                        }
                    }
                }
                if (!free) continue;
                p.taken = true;
                const key = keyOf(ix, iy, iz);
                const bucket = grid.get(key);
                if (bucket) bucket.push(p);
                else grid.set(key, [p]);
                picked.push(p);
            }
        }
        levels.push(picked.length);
    }

    const data = new Float32Array(picked.length * BRAIN_STRIDE);
    picked.forEach((p, i) => {
        data.set([p.x, p.y, p.z, p.nx, p.ny, p.nz, p.ridge, p.part, p.region, p.seed], i * BRAIN_STRIDE);
    });
    return { data, stride: BRAIN_STRIDE, count: picked.length, levels, fibers: buildFibers(picked, rand) };
}

const CACHE = new Map();

// tier: 'full'(데스크톱) | 'lite'(모바일). 계산은 8ms 씩 끊어서 하므로 화면이 멈추지 않습니다. 한 번 만든 뒤에는 바로 돌려줍니다.
export function buildBrain(tier = 'full') {
    if (!CACHE.has(tier)) {
        CACHE.set(tier, new Promise((resolve) => {
            const job = brainJob(tier);
            const slice = () => {
                const until = performance.now() + 8;
                let step = job.next();
                while (!step.done && performance.now() < until) step = job.next();
                if (step.done) resolve(step.value);
                else setTimeout(slice, 0);
            };
            slice();
        }));
    }
    return CACHE.get(tier);
}

/* ───────── 안쪽 섬유 다발(장식) ─────────
   가운데에서 피질로 부채처럼 퍼지는 다발과, 좌우 반구를 잇는 다발입니다. 데이터 연결이 아니라 뇌의 결을 보여 주는 장식이라
   아주 가늘고 옅게만 그립니다. 섬유 하나 = [x0,y0,z0, cx,cy,cz, x1,y1,z1] */
function buildFibers(points, rand) {
    const fibers = [];
    const cortex = points.filter((p) => p.part === 0 && Math.abs(p.x) > 0.2 && p.ny > -0.4);
    const radial = 56;
    for (let i = 0; i < radial && cortex.length; i += 1) {
        const p = cortex[Math.floor(rand() * cortex.length)];
        const side = Math.sign(p.x) || 1;
        const sx = side * (0.07 + rand() * 0.05);
        const sy = CORE[1] + (rand() - 0.5) * 0.14;
        const sz = CORE[2] + (rand() - 0.5) * 0.3;
        const ex = p.x - p.nx * 0.05;
        const ey = p.y - p.ny * 0.05;
        const ez = p.z - p.nz * 0.05;
        // 가운데 가까이에서는 모여 오르다가 피질 쪽에서 펼쳐지도록 굽힘점을 안쪽에 둡니다.
        fibers.push(sx, sy, sz, sx * 1.6 + (ex - sx) * 0.22, sy + (ey - sy) * 0.55, sz + (ez - sz) * 0.4, ex, ey, ez);
    }
    const bridge = 14;
    const upper = cortex.filter((p) => p.x > 0.22 && p.y > 0.05);
    for (let i = 0; i < bridge && upper.length; i += 1) {
        const p = upper[Math.floor(rand() * upper.length)];
        const ex = p.x - p.nx * 0.06;
        const ey = p.y - p.ny * 0.06;
        const ez = p.z - p.nz * 0.06;
        fibers.push(-ex, ey, ez, 0, 0.18 + rand() * 0.06, ez * 0.55, ex, ey, ez);
    }
    return new Float32Array(fibers);
}
