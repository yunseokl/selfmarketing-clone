// WebGL2 셰이더. 세 가지를 그립니다: 피질 점(장식 껍질), 선(데이터 연결 + 안쪽 장식 섬유), 뉴런(데이터 점).
// 화면 자리 계산(toCam·persp·toScreen)은 engine.js 의 project() 와 같은 식입니다. 한쪽을 고치면 다른 쪽도 고쳐야 합니다.

const COMMON = `
uniform mat3 uRot;      // 장면 회전
uniform vec3 uTarget;   // 화면 가운데에 올 장면 속 자리
uniform vec2 uView;     // 그리는 칸의 크기(CSS px)
uniform vec2 uCenter;   // uTarget 이 놓일 화면 자리(CSS px)
uniform float uScale;   // 장면 1 단위가 화면에서 차지하는 px
uniform float uDist;    // 카메라까지의 거리
uniform float uDpr;
uniform float uTime;    // 초

vec3 toCam(vec3 p) { return uRot * (p - uTarget); }
float persp(float z) { return uDist / max(0.4, uDist - z); }
vec2 toScreen(vec3 c) { return uCenter + vec2(c.x, -c.y) * (uScale * persp(c.z)); }
vec4 toClip(vec2 s) { return vec4(s.x / uView.x * 2.0 - 1.0, 1.0 - s.y / uView.y * 2.0, 0.0, 1.0); }
`;

/* ───────── 피질 점 ───────── */

export const CORTEX_VS = `#version 300 es
precision highp float;
${COMMON}
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec4 aInfo;   // 밝기(이랑 1 ~ 면 0.4), 부위, 엽 번호, 무작위 값

uniform vec3 uCore;
uniform float uAppear;     // 0 → 1: 가운데에서 바깥으로 떠오름
uniform float uShell;      // 껍질 전체의 진하기
uniform float uPoint;      // 점 기본 크기(px)
uniform vec3 uTone;        // 껍질의 기본 색
uniform float uGlow[8];    // 엽마다의 밝아짐(그 묶음이 발화했을 때)
uniform vec3 uTint[8];     // 엽마다의 묶음 색
uniform vec2 uScan;        // 불러오는 중: 앞뒤로 훑는 파동의 자리(z)와 세기
uniform float uCalm;       // 1 이면 숨쉬기·반짝임 없음
uniform vec3 uPullAt;      // 끌어당기는 점의 제자리
uniform vec3 uPullBy;      // 그 점이 끌려 나온 만큼(없으면 0)

out vec4 vColor;

void main() {
    int region = int(aInfo.z + 0.5);
    vec3 fromCore = aPos - uCore;
    float reach = length(fromCore);
    float shown = smoothstep(0.0, 1.0, (uAppear * 2.1 - reach * 0.8) / 0.5);
    float breath = 1.0 + (1.0 - uCalm) * 0.0045 * sin(uTime * 0.85 + reach * 2.4);
    vec3 p = uCore + fromCore * breath * mix(0.86, 1.0, shown);
    // 뉴런을 끌어당기면 그 둘레의 껍질이 막처럼 조금 따라 늘어납니다(가까울수록 많이).
    vec3 away = aPos - uPullAt;
    p += uPullBy * (0.42 * exp(-dot(away, away) / 0.075));

    vec3 c = toCam(p);
    vec3 n = uRot * aNormal;
    float k = persp(c.z);
    float front = smoothstep(-0.2, 0.3, n.z);
    float rim = 1.0 - abs(n.z);
    float light = 0.6 + 0.4 * max(0.0, dot(n, vec3(-0.3, 0.58, 0.755)));
    float glow = uGlow[region];
    float wave = exp(-pow((aPos.z - uScan.x) / 0.1, 2.0)) * uScan.y;
    float twinkle = 1.0 - (1.0 - uCalm) * 0.12 * (0.5 + 0.5 * sin(uTime * (0.5 + aInfo.w * 0.9) + aInfo.w * 53.0));

    // 깊이: 먼 쪽(뒤 반구)은 훨씬 어둡고 작게, 가까운 쪽은 또렷하게 — 멈춘 화면에서도 부피가 읽히도록
    float near = smoothstep(0.0, 1.0, clamp(0.5 + c.z * 0.62, 0.0, 1.0));
    float size = uPoint * k * (0.66 + 0.5 * aInfo.x) * mix(0.72, 1.0, front) * mix(0.62, 1.12, near) * (1.0 + 0.14 * glow + 0.5 * wave);
    float alpha = (0.2 + 0.8 * aInfo.x) * light * mix(0.2, 1.0, front) * mix(0.22, 1.08, near) * (1.0 + 1.1 * rim * rim) * twinkle;
    alpha *= shown * uShell * (1.0 + 0.45 * glow + 2.0 * wave);
    // 1px 보다 작아지는 점은 크기 대신 진하기를 낮춥니다(깜빡거림 방지).
    float px = size * uDpr;
    alpha *= min(1.0, px * px);

    // 엽의 묶음이 발화하면 그 위 껍질이 묶음 색으로 아주 살짝 물듭니다(장식이 데이터처럼 튀지 않을 만큼만).
    vec3 color = mix(uTone, uTint[region], clamp(glow * 0.4, 0.0, 0.32));
    color = mix(color, vec3(0.93, 0.95, 1.0), clamp(wave * 0.7, 0.0, 0.7));
    vColor = vec4(color, clamp(alpha, 0.0, 1.0));
    gl_PointSize = max(1.0, px);
    gl_Position = toClip(toScreen(c));
}
`;

export const CORTEX_FS = `#version 300 es
precision mediump float;
in vec4 vColor;
out vec4 outColor;
void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = vColor.a * smoothstep(1.0, 0.62, d);
    outColor = vec4(vColor.rgb * a, a);
}
`;

/* ───────── 선(연결·섬유) ─────────
   선 하나를 띠(삼각형 줄) 한 벌로 그립니다. 휘어진 모양과 그 위를 달리는 신호는 모두 여기서 계산합니다. */

export const RIBBON_VS = `#version 300 es
precision highp float;
${COMMON}
layout(location = 0) in vec2 aAlong;    // 선 위의 자리(0~1), 띠의 어느 쪽(-1·+1)
layout(location = 1) in vec3 iA;        // 시작(가운데 쪽)
layout(location = 2) in vec3 iC;        // 굽힘점
layout(location = 3) in vec3 iB;        // 끝
layout(location = 4) in vec3 iColorA;
layout(location = 5) in vec3 iColorB;
layout(location = 6) in vec4 iStyle;    // 굵기(px), 진하기, 종류(0 가지, 1 가로지름, 2 장식), 길이
layout(location = 7) in vec4 iState;    // 그려진 정도(0~1), 밝힘, 물러남, 팽팽함(0~1)
layout(location = 8) in vec4 iPulse1;   // 신호: 출발 시각, 걸리는 시간, 세기(음수면 끝→시작), 0
layout(location = 9) in vec4 iPulse2;
layout(location = 10) in vec3 iMoveA;   // 끌어당기기: 시작 점이 제자리에서 벗어난 만큼
layout(location = 11) in vec3 iMoveB;   // 끝 점이 벗어난 만큼
layout(location = 12) in vec3 iBow;     // 줄을 잡아 당긴 만큼(가운데 점의 휨)

out float vSide;
out float vHalf;
out float vT;
out vec4 vTone;      // rgb, 진하기
out vec3 vSignal;    // 신호 세기, 선 무늬(0 실선 · 1 긴 점선 · 2 짧은 점선 · 3 긴 줄·점 · 4 두 줄 · 5 긴 줄·점·점), 그려진 정도
out float vRun;      // 시작점에서부터의 길이(점선 무늬용)

// 끌려간 양끝을 따라 선이 움직이고, 팽팽해질수록 곧게 펴집니다(engine.js 의 curveAt 과 같은 식).
vec3 bez(float t) {
    vec3 a = iA + iMoveA;
    vec3 b = iB + iMoveB;
    vec3 c = iC + 0.5 * (iMoveA + iMoveB);
    c = mix(c, 0.5 * (a + b), 0.55 * clamp(iState.w, 0.0, 1.0)) + 2.0 * iBow;
    float m = 1.0 - t;
    return m * m * a + 2.0 * m * t * c + t * t * b;
}

float signalAt(vec4 wave, float t) {
    if (wave.y <= 0.0) return 0.0;
    float u = (uTime - wave.x) / wave.y;
    if (u < 0.0 || u > 1.5) return 0.0;
    float dir = wave.z < 0.0 ? -1.0 : 1.0;
    float head = dir > 0.0 ? u : 1.0 - u;
    float x = (t - head) * dir;                 // 양수: 머리보다 앞
    float shape = x > 0.0 ? exp(-x * x / 0.0009) : exp(x / 0.2);
    return abs(wave.z) * shape * (1.0 - smoothstep(1.0, 1.5, u));
}

void main() {
    float t = aAlong.x;
    float t0 = min(t, 0.97);
    vec3 c0 = toCam(bez(t0));
    vec3 c1 = toCam(bez(t0 + 0.03));
    vec3 c = toCam(bez(t));
    vec2 s0 = toScreen(c0);
    vec2 s1 = toScreen(c1);
    vec2 dir = s1 - s0;
    float len = length(dir);
    dir = len > 0.0001 ? dir / len : vec2(1.0, 0.0);
    vec2 normal = vec2(-dir.y, dir.x);

    float signal = signalAt(iPulse1, t) + signalAt(iPulse2, t);
    float k = persp(c.z);
    // 팽팽해진 선은 가늘고 밝아집니다.
    float taut = clamp(iState.w, 0.0, 1.0);
    float width = iStyle.x * mix(1.0, k, 0.7) * (1.0 + 0.3 * iState.y + 1.3 * min(signal, 1.2));
    // 밝혀진 선은 약한 연결이라도 따라갈 수 있는 굵기를 갖습니다. '두 줄' 무늬(근거)는 가운데가 비어 보일 만큼 넓게 둡니다.
    width = max(width, 1.8 * iState.y);
    if (iStyle.z > 3.5 && iStyle.z < 4.5) width = max(width * 1.5, 3.4);
    // 당겨져 팽팽해진 선은 가늘어집니다(고무줄이 늘어나듯).
    width *= 1.0 - 0.34 * taut;
    float halfWidth = max(width, 0.8) * 0.5;
    vec2 s = toScreen(c) + normal * aAlong.y * (halfWidth + 1.0);

    float depth = clamp(0.62 + c.z * 0.4, 0.3, 1.0);
    // 밝혀진 선의 진하기에는 바닥을 둡니다(약한 연결도 걸러 보면 또렷이 보이게).
    float strength = max(iStyle.y * (1.0 + 1.6 * iState.y), 0.66 * iState.y);
    // 밝혀진 선은 뒤쪽에 있어도 덜 흐려집니다(끝까지 따라갈 수 있게).
    float alpha = min(1.0, strength * mix(depth, 1.0, 0.55 * iState.y) * (1.0 - 0.86 * iState.z) * (1.0 + 0.9 * taut)) * min(1.0, width / 0.8);
    vSide = aAlong.y * (halfWidth + 1.0);
    vHalf = halfWidth;
    vT = t;
    vTone = vec4(mix(iColorA, iColorB, t), alpha);
    vSignal = vec3(signal * (1.0 - 0.7 * iState.z), iStyle.z, iState.x);
    vRun = t * iStyle.w;
    gl_Position = toClip(s);
}
`;

export const RIBBON_FS = `#version 300 es
precision mediump float;
in float vSide;
in float vHalf;
in float vT;
in vec4 vTone;
in vec3 vSignal;
in float vRun;
uniform vec3 uSpark;   // 신호의 가장 밝은 색
out vec4 outColor;

// 한 마디(0~1) 안에서 a~b 구간만 켭니다.
float seg(float q, float a, float b) {
    return smoothstep(a, a + 0.05, q) * (1.0 - smoothstep(b, b + 0.05, q));
}

void main() {
    float edge = 1.0 - smoothstep(vHalf - 0.5, vHalf + 0.5, abs(vSide));
    // 연결의 갈래는 색이 아니라 선의 무늬로 구분합니다. 뇌 껍질의 점과 헷갈리는 '점만 찍힌 선'은 쓰지 않습니다.
    //   0 실선(등록·구조) · 1 긴 점선(경쟁) · 2 짧은 점선(할 일) · 3 긴 줄·점(같은 것) · 4 두 줄(근거) · 5 긴 줄·점·점(AI)
    // 연결 종류 목록의 견본(PlaceGraph.module.css)도 같은 무늬를 씁니다.
    float pattern = vSignal.y;
    if (pattern > 4.5) {
        float q = fract(vRun / 0.13);
        edge *= max(seg(q, 0.0, 0.42), max(seg(q, 0.55, 0.66), seg(q, 0.79, 0.9)));
    } else if (pattern > 3.5) {
        edge *= mix(0.08, 1.0, smoothstep(0.28, 0.7, abs(vSide) / max(vHalf, 0.001)));
    } else if (pattern > 2.5) {
        float q = fract(vRun / 0.11);
        edge *= max(seg(q, 0.0, 0.5), seg(q, 0.68, 0.83));
    } else if (pattern > 1.5) {
        edge *= seg(fract(vRun / 0.046), 0.0, 0.5);
    } else if (pattern > 0.5) {
        edge *= seg(fract(vRun / 0.1), 0.0, 0.62);
    }
    // 그려지는 중: 시작 쪽에서 끝 쪽으로 자랍니다.
    float drawn = 1.0 - smoothstep(vSignal.z - 0.04, vSignal.z + 0.001, vT);
    if (vSignal.z >= 0.999) drawn = 1.0;
    float signal = vSignal.x;
    float base = vTone.a * edge * drawn;
    // 신호는 선의 색에서 흰빛으로 올라갑니다. 신호 부분은 빛을 더하고(가산), 나머지는 보통처럼 덮어 그립니다.
    vec3 lit = mix(vTone.rgb, uSpark, clamp(signal * 0.75, 0.0, 0.85));
    float glow = signal * edge * drawn;
    outColor = vec4(vTone.rgb * base + lit * glow * 0.9, base);
}
`;

/* ───────── 뉴런(데이터 점) ───────── */

export const NODE_VS = `#version 300 es
precision highp float;
${COMMON}
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec3 iPos;
layout(location = 2) in vec4 iShape;   // 반지름(px), 종류(0 속찬 점, 1 빈 자리, 2 확인 중), 단계(0~3), 무작위 값
layout(location = 3) in vec3 iColor;   // 묶음 색(차분한 쪽)
layout(location = 4) in vec3 iVivid;   // 묶음 색(선명한 쪽)
layout(location = 5) in vec4 iState;   // 발화(0~1), 밝힘, 물러남, 나타남
layout(location = 6) in vec4 iMark;    // 퍼지는 고리(0~1, 없으면 음수), 선택·잡음, 키보드 초점, 길게 누르기 예고(0~1)

out vec2 vLocal;
out vec4 vShape;
out vec3 vColor;
out vec3 vVivid;
out vec4 vState;
out vec4 vMark;
out float vDepth;

void main() {
    vec3 c = toCam(iPos);
    float k = persp(c.z);
    // 반지름은 engine.js 가 다 계산해서 넘깁니다(원근·나타남·밝힘·최소 크기 포함). 고르기 판정과 그림이 같은 값을 씁니다.
    float r = iShape.x;
    float reach = r * 4.6 + 26.0;
    vLocal = aCorner * reach;
    vShape = vec4(r, iShape.yzw);
    vColor = iColor;
    vVivid = iVivid;
    vState = iState;
    vMark = iMark;
    vDepth = clamp(0.9 + c.z * 0.24, 0.7, 1.0);
    gl_Position = toClip(toScreen(c) + vLocal);
}
`;

export const NODE_FS = `#version 300 es
precision mediump float;
in vec2 vLocal;
in vec4 vShape;
in vec3 vColor;
in vec3 vVivid;
in vec4 vState;
in vec4 vMark;
in float vDepth;
uniform highp float uDpr;
uniform highp float uTime;
uniform vec3 uIvory;
uniform vec3 uBack;
out vec4 outColor;

float ring(float d, float radius, float width, float aa) {
    return 1.0 - smoothstep(width * 0.5 - aa, width * 0.5 + aa, abs(d - radius));
}

void main() {
    float d = length(vLocal);
    float r = vShape.x;
    float kind = vShape.y;
    float level = vShape.z;
    float fire = vState.x;
    float hot = vState.y;
    float dim = vState.z;
    float shown = vState.w;
    float aa = 0.6 / uDpr + 0.25;
    float seen = (1.0 - 0.8 * dim) * shown;
    float depth = mix(vDepth, 1.0, max(hot, fire));

    vec3 rgb = vec3(0.0);
    float alpha = 0.0;

    // 발화: 묶음 색의 빛이 번졌다 사그라듭니다(빛을 더하는 부분이라 alpha 는 올리지 않습니다).
    float haloReach = r * (level < 0.5 ? 2.3 : 3.0) + 5.0;
    float halo = exp(-d * d / (haloReach * haloReach * 0.32));
    float rest = level < 0.5 ? 0.2 : 0.0;
    rgb += vVivid * halo * (rest + 0.6 * fire + 0.05 * hot + 0.22 * vMark.y) * seen;

    if (kind < 0.5) {
        // 속이 찬 점: 상아색 몸에 묶음 색을 살짝. 가장자리로 갈수록 조금 어두워 둥글게 보입니다.
        float body = 1.0 - smoothstep(r - aa, r + aa, d);
        // 매장·묶음처럼 큰 점만 둥글게 음영을 주고, 작은 항목 점은 또렷한 납작한 점으로 둡니다.
        float shade = level < 1.5 ? 1.0 - 0.2 * smoothstep(0.35, 1.0, d / max(r, 0.001)) : 1.0;
        vec3 skin = mix(uIvory, vColor, level < 0.5 ? 0.04 : level < 1.5 ? 0.16 : 0.26) * shade * depth;
        skin = mix(skin, vec3(1.0), clamp(0.55 * fire + 0.2 * hot, 0.0, 0.8));
        skin = mix(skin, vec3(dot(skin, vec3(0.3, 0.55, 0.15))) * 0.55, dim * 0.85);
        float a = body * seen;
        rgb = rgb * (1.0 - a) + skin * a;
        alpha = alpha * (1.0 - a) + a;
        // 묶음 점(1단계)은 가는 테를 하나 두릅니다.
        if (level > 0.5 && level < 1.5) {
            float band = ring(d, r + 3.2, 1.1, aa) * (0.5 + 0.4 * hot) * seen * depth;
            rgb += vColor * band;
            alpha += band * 0.6;
        }
    } else {
        // 빈 자리(아직 데이터 없음)·확인 중: 테만 그립니다.
        float inner = (1.0 - smoothstep(r - aa, r + aa, d)) * 0.55 * shown;
        rgb = rgb * (1.0 - inner) + uBack * inner;
        alpha = alpha * (1.0 - inner) + inner;
        float band = ring(d, r - 0.6, 1.2, aa);
        if (kind > 1.5) {
            float angle = atan(vLocal.y, vLocal.x) + uTime * 1.6;
            band *= 0.35 + 0.65 * smoothstep(-0.2, 0.2, sin(angle * 3.0));
        }
        float a = band * (kind > 1.5 ? 0.9 : 0.5) * seen * depth;
        rgb += mix(uIvory, vColor, 0.35) * a;
        alpha += a * 0.8;
    }

    // 눌렀을 때·신호가 닿았을 때 한 번 퍼지는 고리
    if (vMark.x >= 0.0) {
        float q = vMark.x;
        float grown = 1.0 - (1.0 - q) * (1.0 - q);
        float wave = ring(d, r + 2.0 + grown * (r * 1.9 + 16.0), 1.4, aa + 0.4) * (1.0 - q) * (1.0 - q);
        rgb += mix(vVivid, vec3(1.0), 0.35) * wave * 0.85;
    }
    // 선택한 점: 또렷한 상아색 고리 / 키보드 초점: 고리 두 겹
    if (vMark.y > 0.01) {
        float band = ring(d, r + 5.0, 1.4, aa) * vMark.y;
        rgb = rgb * (1.0 - band) + uIvory * band;
        alpha = alpha * (1.0 - band) + band;
    }
    if (vMark.z > 0.01) {
        float band = max(ring(d, r + 5.0, 1.6, aa), ring(d, r + 8.5, 1.0, aa) * 0.7) * vMark.z;
        rgb = rgb * (1.0 - band) + vec3(1.0) * band;
        alpha = alpha * (1.0 - band) + band;
    }
    // 길게 누르는 동안: 고리가 12시에서 시계 방향으로 차오릅니다(다 차면 잡힌 것).
    if (vMark.w > 0.001) {
        float turn = fract(atan(vLocal.x, -vLocal.y) / 6.2831853 + 1.0);
        float band = ring(d, r + 5.0, 1.6, aa) * (1.0 - smoothstep(vMark.w - 0.02, vMark.w + 0.005, turn));
        rgb = rgb * (1.0 - band) + uIvory * band;
        alpha = alpha * (1.0 - band) + band;
    }
    outColor = vec4(rgb, clamp(alpha, 0.0, 1.0));
}
`;
