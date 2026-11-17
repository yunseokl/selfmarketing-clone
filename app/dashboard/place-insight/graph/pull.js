// 끌어당기기 물리: 점(뉴런)을 잡아 끌면 이어진 점들이 함께 당겨지고, 놓으면 한 번 튕기며 제자리로 돌아갑니다.
// 연결(시냅스)을 잡아 당기면 줄처럼 휘었다가 떨며 돌아갑니다.
// 순수 계산만 합니다(React·WebGL·DOM 없음). 화면 좌표와 그리기는 engine.js 가 맡습니다.
//
// 모형: 점마다 '제자리에서 벗어난 만큼'(변위)만 다룹니다. 배치(제자리)는 바뀌지 않습니다.
//   · 잡은 점은 손에 그대로 붙습니다(늦게 따라오지 않음). '살'은 이웃과 선에서 느껴지게 합니다.
//   · 점은 제자리로 돌아가려는 용수철에 매여 있고, 연결마다 양끝 점의 변위를 서로 맞추려는 용수철이 있습니다.
//   · 잡은 점에 바로 이어진 점은 연결 세기에 맞춘 비율(15~45%)만큼 따라옵니다. 두 다리 건넌 점은 5% 아래.
//     그래서 굵은 선(센 연결)일수록 많이 딸려 오는 것이 눈에 보이고, 덩어리가 뭉개지지 않습니다.
//   · 감쇠는 점의 속도와 연결의 벌어지는 속도 양쪽에 걸어, 놓으면 한 번만 살짝 넘쳤다가(약 7%) 0.6초 안에 섭니다.
//   · 고정(pin): 놓은 자리에 그 점만 남깁니다. 이웃은 그 점이 제자리에 있는 것처럼 돌아갑니다.
// 계산은 1/240초씩 끊어서 하므로 화면 주사율(30·60·120Hz)이 달라도 같은 움직임이 나옵니다.

const H = 1 / 240;
// 한 번에 따라잡는 최대 시간(탭이 멈췄다 돌아온 경우 등): 16칸 = 약 67ms
const MAX_STEPS = 16;

export const PULL_DEFAULTS = {
    // 제자리로 돌아가려는 진동수(rad/s)와, 이웃과의 결합 세기(진동수의 제곱)
    anchor: 10.4,
    coupling: 12,
    // 단계별(0 매장 · 1 묶음 · 2 항목 · 3 세부) 무게 배율: 매장·묶음은 무거워서 덜 끌려 옵니다.
    levelMass: [4, 1.7, 1, 0.9],
    // 소속(가지) 연결의 상대 세기(의미 연결 = 1)
    tree: 0.4,
    // 잡은 점에 바로 이어진 점이 따라오는 비율 = 바닥 + 기울기 × strength
    followCross: [0.15, 0.27],
    followTree: [0.15, 0.15],
    // 감쇠: 점의 속도에 비례(alpha), 용수철이 벌어지는 속도에 비례(beta). 감쇠비 약 0.66 → 넘침 7% 안팎, 튕김 한 번.
    alpha: 9.1,
    beta: 0.045,
    // 연결을 잡아 당겼을 때: 줄의 진동수 범위(rad/s)와 감쇠비, 양끝 점을 끌어오는 세기(제자리 용수철 대비)
    stringRate: [22, 36],
    stringDamping: 0.4,
    stringPull: 0.35,
    // 줄이 손을 따라오는 빠르기(rad/s)
    stringGrab: 90,
    // 팽팽함 1 로 치는 변위 차이(장면 단위)
    tautAt: 0.3,
    // 움직임 줄이기: 놓았을 때 떨림 없이 돌아가는 시간 상수(초)
    calmReturn: 0.04,
    // 이보다 작게 남은 움직임은 멈춘 것으로 봅니다(장면 단위. engine.js 가 화면 0.25px 에 맞춰 넣습니다)
    rest: 6e-4,
};

export function createPull(custom) {
    const opt = { ...PULL_DEFAULTS, ...custom };
    const P = {
        opt,
        count: 0,
        linkCount: 0,
        // 그릴 때 쓰는 값: 점마다 변위(3, 고정된 자리 포함), 연결마다 줄의 휨(3)·팽팽함(0~1)
        offset: new Float32Array(0),
        bow: new Float32Array(0),
        tension: new Float32Array(0),
        awake: false,
        grabbed: -1,
        plucked: -1,
        // 고정된 점의 수
        pins: 0,
        // 움직임 줄이기 설정
        calm: false,
    };

    let n = 0;
    let m = 0;
    let rest = new Float64Array(0);
    // u: 움직이는 몫(고정된 자리 base 를 뺀 변위). 그릴 변위 = u + base
    let u = new Float64Array(0);
    let v = new Float64Array(0);
    let base = new Float64Array(0);
    let pinned = new Uint8Array(0);
    let force = new Float64Array(0);
    let mass = new Float64Array(0);
    let inv = new Float64Array(0);
    let hold = new Float64Array(0); // 제자리 용수철 세기
    let degree = new Float64Array(0); // 달린 연결 세기의 합
    let la = new Int32Array(0);
    let lb = new Int32Array(0);
    let lk = new Float64Array(0); // 평소 세기
    let now = new Float64Array(0); // 지금 세기(잡는 동안 그 점의 연결만 바뀜)
    let follow = new Float64Array(0); // 잡았을 때 따라올 비율
    let span = new Float64Array(0); // 쉬는 길이
    let incStart = new Int32Array(1);
    let incList = new Int32Array(0);
    let bq = new Float64Array(0); // 줄의 휨
    let bv = new Float64Array(0);
    const bows = []; // 지금 떨고 있는 줄(연결 번호)
    let acc = 0;
    let frameTime = H;
    const goal = [0, 0, 0];
    const from = [0, 0, 0];
    let bowLimit = 0.2;
    const bowGoal = [0, 0, 0];
    const bowFrom = [0, 0, 0];

    // nodes: [{ at: [x, y, z], level }], links: [{ a: 번호, b: 번호, cross: 의미 연결인지, strength: 0~1 }]
    P.setGraph = (nodes, links) => {
        n = nodes.length;
        m = links.length;
        P.count = n;
        P.linkCount = m;
        rest = new Float64Array(n * 3);
        u = new Float64Array(n * 3);
        v = new Float64Array(n * 3);
        base = new Float64Array(n * 3);
        pinned = new Uint8Array(n);
        force = new Float64Array(n * 3);
        mass = new Float64Array(n);
        inv = new Float64Array(n);
        hold = new Float64Array(n);
        degree = new Float64Array(n);
        la = new Int32Array(m);
        lb = new Int32Array(m);
        lk = new Float64Array(m);
        now = new Float64Array(m);
        follow = new Float64Array(m);
        span = new Float64Array(m);
        bq = new Float64Array(m * 3);
        bv = new Float64Array(m * 3);
        bows.length = 0;
        P.offset = new Float32Array(n * 3);
        P.bow = new Float32Array(m * 3);
        P.tension = new Float32Array(m);
        P.awake = false;
        P.grabbed = -1;
        P.plucked = -1;
        P.pins = 0;
        acc = 0;

        for (let i = 0; i < n; i += 1) rest.set(nodes[i].at, i * 3);
        const count = new Int32Array(n);
        for (let l = 0; l < m; l += 1) {
            const { a, b, cross, strength } = links[l];
            const s = Math.min(1, Math.max(0, typeof strength === 'number' ? strength : 0.6));
            la[l] = a;
            lb[l] = b;
            lk[l] = (cross ? 1 : opt.tree) * (0.35 + 0.65 * s);
            now[l] = lk[l];
            const curve = cross ? opt.followCross : opt.followTree;
            follow[l] = curve[0] + curve[1] * s;
            span[l] = Math.hypot(rest[a * 3] - rest[b * 3], rest[a * 3 + 1] - rest[b * 3 + 1], rest[a * 3 + 2] - rest[b * 3 + 2]) || 0.1;
            degree[a] += lk[l];
            degree[b] += lk[l];
            count[a] += 1;
            count[b] += 1;
        }
        const wa2 = opt.anchor * opt.anchor;
        for (let i = 0; i < n; i += 1) {
            // 무게 = 달린 연결 세기의 합 ÷ 결합 세기 × 단계별 배율. 많이 이어진 점, 매장·묶음일수록 무겁습니다.
            const level = Math.min(3, Math.max(0, nodes[i].level | 0));
            mass[i] = (degree[i] > 0 ? degree[i] / opt.coupling : 1) * opt.levelMass[level];
            inv[i] = 1 / mass[i];
            hold[i] = mass[i] * wa2;
        }
        // 점마다 달린 연결 목록(잡을 때 그 연결들만 조절하려고)
        incStart = new Int32Array(n + 1);
        for (let i = 0; i < n; i += 1) incStart[i + 1] = incStart[i] + count[i];
        incList = new Int32Array(incStart[n]);
        const fill = incStart.slice(0, n);
        for (let l = 0; l < m; l += 1) {
            incList[fill[la[l]]] = l;
            fill[la[l]] += 1;
            incList[fill[lb[l]]] = l;
            fill[lb[l]] += 1;
        }
    };

    function loosen() {
        const g = P.grabbed;
        if (g < 0) return;
        for (let s = incStart[g]; s < incStart[g + 1]; s += 1) now[incList[s]] = lk[incList[s]];
    }

    /* ───────── 점 잡기 ───────── */

    // index: 잡을 점. 지금 자리에서 이어서 잡습니다(움직이던 점·고정된 점을 낚아채도 튀지 않게).
    P.grab = (index) => {
        if (index < 0 || index >= n) return;
        if (P.grabbed >= 0) P.release();
        P.grabbed = index;
        const o = index * 3;
        if (pinned[index]) {
            // 고정돼 있던 점을 다시 잡으면 고정을 풀고 그 자리에서 이어 갑니다.
            for (let c = 0; c < 3; c += 1) {
                u[o + c] += base[o + c];
                base[o + c] = 0;
            }
            pinned[index] = 0;
            P.pins -= 1;
        }
        for (let c = 0; c < 3; c += 1) {
            goal[c] = u[o + c];
            from[c] = goal[c];
            v[o + c] = 0;
        }
        // 바로 이어진 점이 정해 둔 비율만큼 따라오도록 그 연결의 세기를 맞춥니다.
        // (이웃 j 가 가만히 있는 다른 것들에 붙들린 세기를 A 라 하면, 따라오는 비율 r = k / (A + k) → k = r·A / (1 − r))
        // 같은 이웃과 연결이 여럿이면(예: 순위 관계와 추천 관계가 함께 있음) 가장 센 연결의 비율 하나만 쓰고 나눠 싣습니다.
        const first = incStart[index];
        const last = incStart[index + 1];
        for (let s = first; s < last; s += 1) {
            const l = incList[s];
            const j = la[l] === index ? lb[l] : la[l];
            let shared = 0;
            let sum = 0;
            let r = 0;
            for (let t = first; t < last; t += 1) {
                const other = incList[t];
                if ((la[other] === index ? lb[other] : la[other]) !== j) continue;
                shared += 1;
                sum += lk[other];
                if (follow[other] > r) r = follow[other];
            }
            r = Math.min(0.85, r);
            now[l] = (r * (hold[j] + degree[j] - sum)) / (1 - r) / shared;
        }
        P.awake = true;
    };

    // 잡은 점이 가 있어야 할 자리(장면 좌표). 한계·가장자리 처리는 engine.js 가 화면 기준으로 끝낸 값을 줍니다.
    P.moveTo = (x, y, z) => {
        const g = P.grabbed;
        if (g < 0) return;
        goal[0] = x - rest[g * 3];
        goal[1] = y - rest[g * 3 + 1];
        goal[2] = z - rest[g * 3 + 2];
    };

    // 놓기. pin: 그 자리에 고정할지. 돌려주는 값: { index, far(제자리에서 벗어난 거리, 장면 단위), pinned }
    P.release = (pin) => {
        const g = P.grabbed;
        if (g < 0) return null;
        loosen();
        const o = g * 3;
        const far = Math.hypot(u[o], u[o + 1], u[o + 2]);
        // 던지지 않습니다: 놓은 자리에서 가만히 출발해 한 번만 튕기고 섭니다.
        v[o] = 0;
        v[o + 1] = 0;
        v[o + 2] = 0;
        P.grabbed = -1;
        const keep = Boolean(pin) && far > opt.rest * 4;
        if (keep) {
            for (let c = 0; c < 3; c += 1) {
                base[o + c] = u[o + c];
                u[o + c] = 0;
            }
            pinned[g] = 1;
            P.pins += 1;
        }
        return { index: g, far, pinned: keep };
    };

    // 고정을 모두 풉니다(탄성으로 돌아감). 돌려주는 값: 풀린 점의 수
    P.unpinAll = () => {
        let freed = 0;
        for (let i = 0; i < n; i += 1) {
            if (!pinned[i]) continue;
            for (let c = 0; c < 3; c += 1) {
                u[i * 3 + c] += base[i * 3 + c];
                base[i * 3 + c] = 0;
            }
            pinned[i] = 0;
            freed += 1;
        }
        P.pins = 0;
        if (freed) P.awake = true;
        return freed;
    };

    P.isPinned = (index) => pinned[index] === 1;

    // 한 번 툭 건드리기(키보드 등): 속도를 더해 줍니다. 너무 세게 튀어 나가지 않게 빠르기를 묶어 둡니다.
    P.kick = (index, vx, vy, vz) => {
        if (index < 0 || index >= n || index === P.grabbed) return;
        const o = index * 3;
        v[o] += vx;
        v[o + 1] += vy;
        v[o + 2] += vz;
        const speed = Math.hypot(v[o], v[o + 1], v[o + 2]);
        const top = 2.4;
        if (speed > top) {
            v[o] *= top / speed;
            v[o + 1] *= top / speed;
            v[o + 2] *= top / speed;
        }
        P.awake = true;
    };

    /* ───────── 연결 잡기(줄 튕기기) ───────── */

    // 멀리 당길수록 덜 따라오는 고무줄 한계
    function soften(x, y, z, max, out) {
        const far = Math.hypot(x, y, z);
        if (far < 1e-9) {
            out[0] = 0;
            out[1] = 0;
            out[2] = 0;
            return;
        }
        const k = (max * Math.tanh(far / max)) / far;
        out[0] = x * k;
        out[1] = y * k;
        out[2] = z * k;
    }

    P.pluck = (link, max) => {
        if (link < 0 || link >= m) return;
        if (P.plucked >= 0) P.unpluck();
        P.plucked = link;
        bowLimit = max > 0 ? max : Math.min(0.4, Math.max(0.08, span[link] * 0.45));
        for (let c = 0; c < 3; c += 1) {
            bowGoal[c] = bq[link * 3 + c];
            bowFrom[c] = bowGoal[c];
        }
        if (!bows.includes(link)) bows.push(link);
        P.awake = true;
    };

    // 줄 가운데를 제자리에서 (dx, dy, dz) 만큼 당깁니다(장면 단위).
    P.pluckTo = (dx, dy, dz) => {
        if (P.plucked < 0) return;
        soften(dx, dy, dz, bowLimit, bowGoal);
    };

    P.unpluck = () => {
        const link = P.plucked;
        if (link < 0) return null;
        P.plucked = -1;
        const o = link * 3;
        return { link, a: la[link], b: lb[link], stretch: Math.min(1, Math.hypot(bq[o], bq[o + 1], bq[o + 2]) / bowLimit) };
    };

    /* ───────── 한 칸 계산 ───────── */

    function crit(x, vel, target, rate, h, out) {
        // 튕기지 않고 목표에 닿는 용수철(정확한 해)
        const e = Math.exp(-rate * h);
        const d = x - target;
        const t = (vel + rate * d) * h;
        out[0] = target + (d + t) * e;
        out[1] = (vel - rate * t) * e;
    }

    const pair = [0, 0];

    function substep(h, frac) {
        const g = P.grabbed;
        const calm = P.calm;
        // 1) 잡은 점은 손의 자리 그대로(지난 프레임과 이번 프레임 사이를 곧게 이어 붙임).
        if (g >= 0) {
            for (let c = 0; c < 3; c += 1) {
                u[g * 3 + c] = from[c] + (goal[c] - from[c]) * frac;
                v[g * 3 + c] = (goal[c] - from[c]) / frameTime;
            }
        }
        // 2) 움직임 줄이기에서 아무것도 잡고 있지 않으면: 떨림 없이 곧장 돌아갑니다.
        if (calm && g < 0 && P.plucked < 0) {
            const decay = Math.exp(-h / opt.calmReturn);
            for (let i = 0; i < n * 3; i += 1) {
                u[i] *= decay;
                v[i] = 0;
            }
            for (const l of bows) {
                for (let c = 0; c < 3; c += 1) {
                    bq[l * 3 + c] *= decay;
                    bv[l * 3 + c] = 0;
                }
            }
            return;
        }
        // 3) 힘: 제자리 용수철 + 연결 용수철 + 감쇠(움직임 줄이기에서는 감쇠를 키워 흔들리지 않게)
        const alpha = calm ? opt.alpha * 2.2 : opt.alpha;
        const beta = calm ? opt.beta * 2 : opt.beta;
        for (let i = 0; i < n; i += 1) {
            const k = hold[i];
            const drag = alpha * mass[i];
            const o = i * 3;
            force[o] = -k * (u[o] + beta * v[o]) - drag * v[o];
            force[o + 1] = -k * (u[o + 1] + beta * v[o + 1]) - drag * v[o + 1];
            force[o + 2] = -k * (u[o + 2] + beta * v[o + 2]) - drag * v[o + 2];
        }
        for (let l = 0; l < m; l += 1) {
            const k = now[l];
            const a = la[l] * 3;
            const b = lb[l] * 3;
            const fx = k * (u[b] - u[a] + beta * (v[b] - v[a]));
            const fy = k * (u[b + 1] - u[a + 1] + beta * (v[b + 1] - v[a + 1]));
            const fz = k * (u[b + 2] - u[a + 2] + beta * (v[b + 2] - v[a + 2]));
            force[a] += fx;
            force[a + 1] += fy;
            force[a + 2] += fz;
            force[b] -= fx;
            force[b + 1] -= fy;
            force[b + 2] -= fz;
        }
        // 휜 줄은 양끝 점을 제 쪽으로 조금 끌어옵니다.
        const tug = opt.anchor * opt.anchor * opt.stringPull;
        for (const l of bows) {
            const a = la[l];
            const b = lb[l];
            for (let c = 0; c < 3; c += 1) {
                const q = bq[l * 3 + c];
                force[a * 3 + c] += mass[a] * tug * q;
                force[b * 3 + c] += mass[b] * tug * q;
            }
        }
        // 4) 속도 → 자리(잡은 점은 빼고)
        for (let i = 0; i < n; i += 1) {
            if (i === g) continue;
            const o = i * 3;
            const w = inv[i] * h;
            v[o] += force[o] * w;
            v[o + 1] += force[o + 1] * w;
            v[o + 2] += force[o + 2] * w;
            u[o] += v[o] * h;
            u[o + 1] += v[o + 1] * h;
            u[o + 2] += v[o + 2] * h;
        }
        // 5) 줄: 잡고 있으면 손을 따라오고, 놓으면 떨면서 잦아듭니다(정확한 해).
        for (const l of bows) {
            const o = l * 3;
            if (l === P.plucked) {
                for (let c = 0; c < 3; c += 1) {
                    const target = bowFrom[c] + (bowGoal[c] - bowFrom[c]) * frac;
                    crit(bq[o + c], bv[o + c], target, opt.stringGrab, h, pair);
                    bq[o + c] = pair[0];
                    bv[o + c] = pair[1];
                }
                continue;
            }
            // 짧은 줄일수록 빨리 떱니다.
            const rate = Math.min(opt.stringRate[1], Math.max(opt.stringRate[0], 18 + 7 / span[l]));
            const zeta = calm ? 1 : opt.stringDamping;
            if (zeta >= 1) {
                for (let c = 0; c < 3; c += 1) {
                    crit(bq[o + c], bv[o + c], 0, rate, h, pair);
                    bq[o + c] = pair[0];
                    bv[o + c] = pair[1];
                }
                continue;
            }
            const sigma = zeta * rate;
            const wd = rate * Math.sqrt(1 - zeta * zeta);
            const e = Math.exp(-sigma * h);
            const cos = Math.cos(wd * h);
            const sin = Math.sin(wd * h);
            for (let c = 0; c < 3; c += 1) {
                const x = bq[o + c];
                const vel = bv[o + c];
                bq[o + c] = e * (x * cos + ((vel + sigma * x) / wd) * sin);
                bv[o + c] = e * (vel * cos - ((sigma * vel + rate * rate * x) / wd) * sin);
            }
        }
    }

    function writeOut(lead) {
        const g = P.grabbed;
        for (let i = 0; i < n * 3; i += 1) P.offset[i] = u[i] + v[i] * lead + base[i];
        // 잡은 점은 손의 자리 그대로(앞질러 그리지 않음)
        if (g >= 0) for (let c = 0; c < 3; c += 1) P.offset[g * 3 + c] = goal[c];
        for (const l of bows) {
            for (let c = 0; c < 3; c += 1) P.bow[l * 3 + c] = bq[l * 3 + c] + bv[l * 3 + c] * lead;
        }
    }

    // dt: 지난 프레임부터 흐른 시간(초). 움직이는 것이 남아 있으면 true
    P.step = (dt) => {
        if (!P.awake) return false;
        const frame = Math.min(Math.max(dt, 0), MAX_STEPS * H);
        frameTime = Math.max(frame, H);
        const before = acc;
        acc += frame;
        const steps = Math.floor(acc / H + 1e-9);
        for (let s = 1; s <= steps; s += 1) {
            // 이 칸이 끝나는 때가 지난 프레임과 이번 프레임 사이 어디쯤인지(손의 자리를 그 사이로 이어 붙입니다)
            substep(H, frame > 0 ? Math.min(1, Math.max(0, (s * H - before) / frame)) : 1);
        }
        acc -= steps * H;
        if (acc < 0) acc = 0;
        for (let c = 0; c < 3; c += 1) {
            from[c] = goal[c];
            bowFrom[c] = bowGoal[c];
        }

        // 다 잦아들었는지: 잡고 있는 것이 없고 남은 움직임이 아주 작으면 멈춥니다.
        let moving = P.grabbed >= 0 || P.plucked >= 0;
        if (!moving) {
            const eps = opt.rest;
            const quick = eps * opt.anchor * 2;
            for (let i = 0; i < n * 3 && !moving; i += 1) {
                if (Math.abs(u[i]) > eps || Math.abs(v[i]) > quick) moving = true;
            }
            for (let s = bows.length - 1; s >= 0; s -= 1) {
                const o = bows[s] * 3;
                const still = Math.abs(bq[o]) < eps && Math.abs(bq[o + 1]) < eps && Math.abs(bq[o + 2]) < eps
                    && Math.abs(bv[o]) < eps * 60 && Math.abs(bv[o + 1]) < eps * 60 && Math.abs(bv[o + 2]) < eps * 60;
                if (still) {
                    for (let c = 0; c < 3; c += 1) {
                        bq[o + c] = 0;
                        bv[o + c] = 0;
                        P.bow[o + c] = 0;
                    }
                    bows.splice(s, 1);
                } else {
                    moving = true;
                }
            }
        }
        if (!moving) {
            u.fill(0);
            v.fill(0);
            // 고정된 점은 그 자리에 남습니다.
            for (let i = 0; i < n * 3; i += 1) P.offset[i] = base[i];
            P.bow.fill(0);
            P.tension.fill(0);
            acc = 0;
            P.awake = false;
            return false;
        }

        // 그릴 값: 남은 자투리 시간만큼 앞으로 이어 그려, 주사율과 상관없이 매끈하게 보이게 합니다.
        writeOut(acc);
        // 팽팽함은 '움직이는 몫'으로만 봅니다(고정해 둔 점의 연결은 늘어나 있어도 팽팽해 보이지 않게).
        const taut = 1 / opt.tautAt;
        const g = P.grabbed;
        for (let l = 0; l < m; l += 1) {
            const a = la[l] * 3;
            const b = lb[l] * 3;
            const apart = Math.hypot(u[b] - u[a], u[b + 1] - u[a + 1], u[b + 2] - u[a + 2]);
            const bent = Math.hypot(P.bow[l * 3], P.bow[l * 3 + 1], P.bow[l * 3 + 2]) / (0.35 * span[l] + 0.05);
            // 잡은 점의 연결은 조금만 당겨도 팽팽해 보이게 합니다.
            const mine = g >= 0 && (la[l] === g || lb[l] === g) ? 1.6 : 1;
            P.tension[l] = Math.min(1, apart * taut * mine + bent);
        }
        return true;
    };

    // 모두 제자리로(그래프가 바뀌었거나 화면에서 떠날 때). 고정도 풉니다.
    P.reset = () => {
        loosen();
        P.grabbed = -1;
        P.plucked = -1;
        bows.length = 0;
        u.fill(0);
        v.fill(0);
        base.fill(0);
        pinned.fill(0);
        P.pins = 0;
        bq.fill(0);
        bv.fill(0);
        P.offset.fill(0);
        P.bow.fill(0);
        P.tension.fill(0);
        acc = 0;
        P.awake = false;
    };

    // 확인용: 지금 변위·속도와 남은 에너지
    P.peek = () => ({ u, v, base, bq, bv, mass, hold, now, base0: lk, la, lb, follow, span });
    P.energy = () => {
        let e = 0;
        for (let i = 0; i < n; i += 1) {
            const o = i * 3;
            e += 0.5 * mass[i] * (v[o] * v[o] + v[o + 1] * v[o + 1] + v[o + 2] * v[o + 2]);
            e += 0.5 * hold[i] * (u[o] * u[o] + u[o + 1] * u[o + 1] + u[o + 2] * u[o + 2]);
        }
        for (let l = 0; l < m; l += 1) {
            const a = la[l] * 3;
            const b = lb[l] * 3;
            e += 0.5 * now[l] * ((u[b] - u[a]) ** 2 + (u[b + 1] - u[a + 1]) ** 2 + (u[b + 2] - u[a + 2]) ** 2);
        }
        return e;
    };

    return P;
}
