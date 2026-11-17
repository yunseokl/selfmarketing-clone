// 그래프 무대의 색. 묶음 색은 밝기·채도를 맞춘 차분한 안료 색(세이지·황토·주홍·녹청·군청·연보라·흑연)이고,
// 평소에는 뉴런의 테와 연결선에 옅게만 쓰입니다. 선명한 쪽(vivid)은 지금 발화하는 뉴런과 신호에만 씁니다.
// 색은 OKLCH(밝기, 채도, 색상)로 정해 두고 화면용 값으로 바꿉니다.

function oklch(l, c, h) {
    const a = c * Math.cos((h * Math.PI) / 180);
    const b = c * Math.sin((h * Math.PI) / 180);
    const l1 = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m1 = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s1 = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const linear = [
        4.0767416621 * l1 - 3.3077115913 * m1 + 0.2309699292 * s1,
        -1.2684380046 * l1 + 2.6097574011 * m1 - 0.3413193965 * s1,
        -0.0041960863 * l1 - 0.7034186147 * m1 + 1.707614701 * s1,
    ];
    return linear.map((v) => {
        const x = Math.min(1, Math.max(0, v));
        return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
    });
}

function toHex(rgb) {
    return `#${rgb.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;
}

// [밝기, 채도, 색상]. 색각 이상에서도 갈리도록 헷갈리기 쉬운 색끼리 밝기를 다르게 두었습니다
// (적·녹·청 색각 이상 시뮬레이션에서 가장 가까운 두 색의 OKLab 거리 0.059 이상). 묶음은 색 말고도 뇌 안의 자리와 이름표로 구분됩니다.
const HUES = {
    store: [0.95, 0.03, 88],
    search: [0.79, 0.105, 150],
    voice: [0.88, 0.1, 86],
    todo: [0.7, 0.13, 28],
    pay: [0.87, 0.07, 198],
    rival: [0.66, 0.11, 256],
    geo: [0.8, 0.1, 318],
    ops: [0.62, 0.016, 255],
    other: [0.62, 0.016, 255],
};

function make([l, c, h]) {
    const soft = oklch(l, c, h);
    const vivid = oklch(Math.min(0.9, l + 0.05), c * 1.55 + 0.012, h);
    return { soft, vivid, hex: toHex(soft), vividHex: toHex(vivid) };
}

export const GROUPS = Object.fromEntries(Object.entries(HUES).map(([group, value]) => [group, make(value)]));

export function colorOf(group) {
    return GROUPS[group] || GROUPS.other;
}

export const IVORY = [0.953, 0.929, 0.878];
export const IVORY_HEX = '#F3EDE0';
// 껍질(피질 점)의 색: 데이터인 뉴런(따뜻한 상아색)과 갈리도록 차가운 회청색 한 가지
export const SHELL = [0.66, 0.72, 0.82];
export const STAGE = [0.043, 0.051, 0.071];
export const SPARK = [1, 0.985, 0.95];

// 상태 색(라벨·인스펙터의 글자에만 씁니다)
export const TONES = {
    good: '#8FD3A6',
    warn: '#E9C46A',
    bad: '#F0907A',
    ink: '#F3EDE0',
    muted: '#8C95A3',
    pending: '#8C95A3',
};
