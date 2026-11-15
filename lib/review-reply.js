// 리뷰 답글 도우미 — 규칙과 문장 조합만 쓰는 순수 함수 모음입니다.
// 외부 서비스 호출, 난수 사용 없음. 같은 입력이면 항상 같은 초안이 나옵니다.

export const MAX_REVIEW_LENGTH = 1000;
export const MIN_REVIEW_LENGTH = 5;
export const MAX_MENTIONS = 3;

export const POLICY_BASIS_DATE = '2026-11';

export const INDUSTRIES = [
    { id: 'restaurant', label: '음식점' },
    { id: 'cafe', label: '카페' },
    { id: 'beauty', label: '뷰티' },
    { id: 'clinic', label: '병원·의원' },
    { id: 'etc', label: '기타' },
];

export const SENTIMENTS = [
    { id: 'praise', label: '칭찬' },
    { id: 'neutral', label: '보통' },
    { id: 'complaint', label: '불만' },
];

export const COMPLAINT_TYPES = [
    { id: 'taste', label: '맛·품질' },
    { id: 'service', label: '서비스 응대' },
    { id: 'wait', label: '대기 시간' },
    { id: 'price', label: '가격' },
    { id: 'hygiene', label: '위생·청결' },
    { id: 'etc', label: '기타' },
];

export const TONES = [
    { id: 'polite', label: '정중하게' },
    { id: 'friendly', label: '친근하게' },
];

export const INCLUDE_OPTIONS = [
    { id: 'thanks', label: '감사 인사' },
    { id: 'apology', label: '사과' },
    { id: 'promise', label: '개선 약속' },
    { id: 'revisit', label: '재방문 인사' },
];

// 화면에 근거로 보여 주는 공식 안내 (확인일 2026-11)
export const POLICY_SOURCES = [
    {
        id: 'place-blog',
        title: 'MY플레이스팀 공식 블로그 · 사장님을 위한 방문자 리뷰 관리 안내 (2020-08-26 게시)',
        url: 'https://m.blog.naver.com/nv_placemy/222071452627',
        summary: '리뷰 답글에 고객의 개인정보성 내용을 추가하면 답글이 통보 없이 삭제되고 스마트플레이스 권한이 회수될 수 있다고 안내합니다.',
    },
    {
        id: 'place-penalty',
        title: 'MY플레이스 고객센터 · 업체 단위 페널티 적용 대상 비정상 행위 안내',
        url: 'https://help.naver.com/service/19485/contents/24961',
        summary: '답글로 욕설·비방·위협 표현을 반복하는 행위, 방문·고객관리 정보로 작성자를 특정하는 행위, 특정 별점·표현을 요구하거나 변경·삭제를 압박하는 행위는 업체 단위 페널티 대상입니다. 단순한 리뷰 작성 안내는 해당하지 않는다고 합니다.',
    },
];

const INDUSTRY_IDS = INDUSTRIES.map((i) => i.id);
const SENTIMENT_IDS = SENTIMENTS.map((s) => s.id);
const COMPLAINT_IDS = COMPLAINT_TYPES.map((c) => c.id);
const TONE_IDS = TONES.map((t) => t.id);

/* ===================== 기본 도구 ===================== */

// FNV-1a 32비트 해시 — 같은 문자열이면 항상 같은 숫자
export function hashString(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i += 1) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
}

function hasBatchim(word) {
    const last = String(word).trim().slice(-1);
    if (!last) return false;
    const code = last.charCodeAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0;
    if (/[0136780-9]/.test(last)) return '013678'.includes(last);
    return 'lmnrLMNR'.includes(last);
}

function hasRieulBatchim(word) {
    const last = String(word).trim().slice(-1);
    const code = last.charCodeAt(0);
    return code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 === 8;
}

// josa('파스타', '을/를') → '를'
export function josa(word, pair) {
    const [withBatchim, without] = pair.split('/');
    if (pair === '으로/로') return hasBatchim(word) && !hasRieulBatchim(word) ? withBatchim : without;
    return hasBatchim(word) ? withBatchim : without;
}

// '{name}' 또는 '{name|이/가}' 형태의 자리표시자를 채웁니다.
function fill(template, vars) {
    return template.replace(/\{(\w+)(?:\|([^}]+))?\}/g, (_, name, pair) => {
        const value = String(vars[name] ?? '');
        if (!pair) return value;
        return value + josa(value, pair);
    });
}

function joinWords(words) {
    if (words.length <= 1) return words[0] || '';
    if (words.length === 2) return `${words[0]}${josa(words[0], '과/와')} ${words[1]}`;
    return words.join(', ');
}

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const charLength = (s) => [...String(s ?? '')].length;

export function countChars(text) {
    return charLength(text);
}

/* ===================== 입력 점검 ===================== */

export function validateReview(text) {
    const value = clean(text);
    const length = charLength(value);
    if (length === 0) return { ok: false, code: 'empty', length, message: '리뷰 본문을 붙여넣어 주세요.' };
    if (length < MIN_REVIEW_LENGTH) {
        return { ok: false, code: 'short', length, message: `리뷰가 너무 짧아요. ${MIN_REVIEW_LENGTH}자 이상 붙여넣어 주세요.` };
    }
    if (length > MAX_REVIEW_LENGTH) {
        return { ok: false, code: 'long', length, message: `리뷰가 ${MAX_REVIEW_LENGTH.toLocaleString('ko-KR')}자를 넘었어요. (현재 ${length.toLocaleString('ko-KR')}자) 줄여서 붙여넣어 주세요.` };
    }
    return { ok: true, code: 'ok', length, message: '' };
}

/* ===================== 성격·유형 추정 ===================== */

// 부정 표현(칭찬 단어를 뒤집는 말)은 먼저 찾아서 지웁니다.
const NEGATED_PATTERNS = [
    /맛이?\s?없/g, /맛없/g, /친절하지\s?않/g, /친절하지\s?못/g, /만족스럽지\s?않/g, /만족스럽지\s?못/g,
    /깔끔하지\s?않/g, /청결하지\s?않/g, /맛있지\s?않/g, /좋지\s?않/g, /괜찮지\s?않/g, /안\s?좋/g, /안\s?친절/g, /안\s?맛있/g,
    /재방문\s?(의사\s?)?(없|안)/g, /추천\s?(안|하지\s?않|못)/g,
];

const STRONG_NEGATIVE = ['최악', '불친절', '실망', '다시는', '다신', '안 갈', '안갈', '쓰레기', '형편없', '엉망', '불쾌', '짜증', '환불', '컴플레인', '클레임', '바가지', '불결'];
const NEGATIVE = [
    '별로', '불편', '아쉬', '더럽', '더러', '지저분', '위생', '머리카락', '이물질', '벌레', '냄새', '기다렸', '오래 걸', '한참', '늦게', '식었', '차갑',
    '짜요', '싱겁', '비싸', '아깝', '무시', '불만', '비추', '별 하나', '1점',
];
const POSITIVE = [
    '최고', '맛있', '맛집', '친절', '만족', '추천', '좋았', '좋아요', '좋은', '감사', '깔끔', '청결', '훌륭', '완벽', '재방문', '또 올', '또올', '다시 올',
    '사랑', '행복', '편안', '힐링', '예뻐', '예쁘', '정성', '존맛', '대박', '단골', '굿', '잘 해', '잘해',
];

const countHits = (text, words) => words.reduce((n, w) => (text.includes(w) ? n + 1 : n), 0);

export function detectSentiment(text) {
    let rest = clean(text);
    let negative = 0;
    NEGATED_PATTERNS.forEach((re) => {
        const found = rest.match(re);
        if (found) {
            negative += found.length * 2;
            rest = rest.replace(re, ' ');
        }
    });
    negative += countHits(rest, STRONG_NEGATIVE) * 2 + countHits(rest, NEGATIVE);
    const positive = countHits(rest, POSITIVE);
    if (negative === 0 && positive === 0) return 'neutral';
    if (negative > positive) return 'complaint';
    if (negative > 0) return 'neutral';
    return 'praise';
}

const COMPLAINT_KEYWORDS = [
    ['hygiene', ['위생', '청결', '더럽', '더러', '지저분', '머리카락', '이물질', '벌레', '냄새', '불결']],
    ['wait', ['기다', '대기', '오래 걸', '한참', '늦게', '지연', '웨이팅']],
    ['price', ['비싸', '가격', '바가지', '아깝', '가성비', '요금']],
    ['service', ['불친절', '응대', '직원', '서비스', '무시', '태도']],
    ['taste', ['맛', '식었', '식어', '차갑', '차가워', '짜요', '싱겁', '품질', '퀄리티', '시술', '결과']],
];

export function detectComplaintType(text) {
    const value = clean(text);
    for (const [id, words] of COMPLAINT_KEYWORDS) {
        if (words.some((w) => value.includes(w))) return id;
    }
    return 'etc';
}

/* ===================== 언급할 내용 ===================== */

export function parseMentions(raw) {
    const list = Array.isArray(raw) ? raw : String(raw ?? '').split(/[,，、\n]/);
    const seen = new Set();
    const out = [];
    list.forEach((item) => {
        const word = clean(item).replace(/^["'‘’“”]+|["'‘’“”]+$/g, '').slice(0, 20);
        if (word && !seen.has(word) && out.length < MAX_MENTIONS) {
            seen.add(word);
            out.push(word);
        }
    });
    return out;
}

const MENTION_STOPWORDS = new Set([
    '너무', '정말', '진짜', '완전', '그리고', '하지만', '그런데', '그냥', '오늘', '어제', '다음', '이번', '항상', '여기', '거기', '저희', '우리',
    '처음', '다시', '아주', '매우', '조금', '많이', '계속', '사실', '그래서', '때문', '정도', '생각', '느낌', '리뷰', '방문', '이용', '다녀',
]);
const PARTICLE_TAIL = /(에서|부터|까지|처럼|보다|이랑|으로|이나|이고|이|가|은|는|을|를|도|만|에|의|와|과|로|랑|나)$/;
const PREDICATE_TAIL = /(니다|어서|아서|해서|하고|인데|은데|는데|지만|거든|네요|에요|예요|이에요|해요|했어|했다|같아|같은|요|다|네|죠|까|서|고|며|면|한|인|된|던|운|른)$/;

// 리뷰 본문에서 눌러서 고를 수 있는 단어 후보 — 사용자가 직접 고른 것만 답글에 들어갑니다.
export function extractMentionCandidates(review, limit = 8) {
    const tokens = clean(review).match(/[가-힣A-Za-z0-9]{2,12}/g) || [];
    const seen = new Set();
    const out = [];
    tokens.forEach((token) => {
        let word = token;
        if (PARTICLE_TAIL.test(word) && word.replace(PARTICLE_TAIL, '').length >= 2) word = word.replace(PARTICLE_TAIL, '');
        if (word.length < 2 || /^\d+$/.test(word)) return;
        if (PREDICATE_TAIL.test(word) || MENTION_STOPWORDS.has(word)) return;
        if (!seen.has(word) && out.length < limit) {
            seen.add(word);
            out.push(word);
        }
    });
    return out;
}

/* ===================== 문장 데이터 ===================== */

const NOUN = {
    restaurant: '음식의 맛과 품질',
    cafe: '음료와 디저트의 맛과 품질',
    beauty: '시술 만족도와 품질',
    clinic: '진료 경험',
    etc: '제품과 서비스의 품질',
};

const QUALITY_ACTION = {
    restaurant: '조리 과정과 맛의 기준',
    cafe: '레시피와 제공 상태',
    beauty: '시술 과정과 마무리 품질',
    clinic: '진료 환경과 안내 과정',
    etc: '품질 기준',
};

const OPEN_STORE = {
    polite: ['안녕하세요, {store}입니다.', '안녕하세요. {store}에서 인사드립니다.', '안녕하세요, {store} 담당자입니다.'],
    friendly: ['안녕하세요! {store|이에요/예요}.', '안녕하세요~ {store}에서 인사드려요.', '안녕하세요, {store} 담당자예요.'],
};
const OPEN_NO_STORE = {
    polite: ['안녕하세요.', '안녕하세요. 남겨 주신 글 잘 읽어 보았습니다.', '안녕하세요, 리뷰 잘 읽었습니다.'],
    friendly: ['안녕하세요!', '안녕하세요~ 남겨 주신 글 잘 읽어 봤어요.', '안녕하세요, 리뷰 잘 읽었어요.'],
};

const THANKS = {
    praise: {
        polite: ['소중한 리뷰를 남겨 주셔서 진심으로 감사드립니다.', '따뜻한 후기를 남겨 주셔서 정말 감사합니다.', '정성껏 리뷰를 남겨 주셔서 감사드립니다.'],
        friendly: ['소중한 리뷰 남겨 주셔서 정말 감사해요.', '따뜻한 후기 덕분에 힘이 나요. 감사합니다.', '리뷰 남겨 주셔서 고마워요.'],
    },
    neutral: {
        polite: ['솔직한 의견을 남겨 주셔서 감사합니다.', '소중한 말씀을 전해 주셔서 감사드립니다.', '꼼꼼하게 평가를 남겨 주셔서 감사합니다.'],
        friendly: ['솔직한 의견 남겨 주셔서 감사해요.', '소중한 말씀 전해 주셔서 고마워요.', '꼼꼼하게 평가 남겨 주셔서 감사해요.'],
    },
    complaint: {
        polite: ['솔직한 의견을 남겨 주셔서 감사합니다.', '소중한 말씀을 전해 주셔서 감사드립니다.', '불편하셨을 텐데 의견을 남겨 주셔서 감사합니다.'],
        friendly: ['솔직한 의견 남겨 주셔서 감사해요.', '소중한 말씀 전해 주셔서 고마워요.', '쉽지 않으셨을 텐데 의견 남겨 주셔서 감사해요.'],
    },
};

const CORE_PRAISE = {
    withMention: {
        polite: ['{m|을/를} 좋게 봐 주셔서 저희도 기쁩니다.', '{m|이/가} 마음에 드셨다니 큰 힘이 됩니다.', '특히 {m|은/는} 좋게 말씀해 주셔서 더욱 보람을 느낍니다.'],
        friendly: ['{m|을/를} 좋게 봐 주셔서 저희도 너무 기뻐요.', '{m|이/가} 마음에 드셨다니 큰 힘이 돼요.', '특히 {m|은/는} 좋게 말씀해 주셔서 보람을 느껴요.'],
    },
    plain: {
        polite: ['좋은 경험이 되셨다니 저희도 기쁩니다.', '만족스러운 시간이 되셨다니 큰 힘이 됩니다.', '이렇게 좋게 말씀해 주셔서 더욱 보람을 느낍니다.'],
        friendly: ['좋은 경험이 되셨다니 저희도 기뻐요.', '만족스러운 시간이었다니 힘이 나요.', '이렇게 좋게 말씀해 주셔서 보람을 느껴요.'],
    },
};

const CORE_NEUTRAL = {
    polite: ['솔직한 평가 잘 읽어 보았습니다. 좋게 봐 주신 부분은 이어 가겠습니다.', '좋았던 점은 이어 가고, 아쉬우셨던 점은 더 살펴보겠습니다.', '기대에 꼭 맞지는 않았을 수 있다는 점을 마음에 새기겠습니다.'],
    friendly: ['솔직한 평가 잘 읽어 봤어요. 좋게 봐 주신 부분은 이어 갈게요.', '좋았던 점은 이어 가고, 아쉬우셨던 점은 더 살펴볼게요.', '기대에 꼭 맞지는 않았을 수 있다는 점, 마음에 새길게요.'],
};

const CORE_COMPLAINT = {
    taste: {
        polite: [
            '말씀해 주신 {noun|이/가} 기대에 미치지 못했다는 점, 가볍게 넘기지 않고 살펴보겠습니다.',
            '{noun}에 대한 아쉬운 의견을 무겁게 받아들이고 있습니다.',
            '{noun|을/를} 기대만큼 채워 드리지 못한 것 같아 마음이 무겁습니다.',
        ],
        friendly: [
            '말씀해 주신 {noun|이/가} 기대에 못 미쳤다는 점, 가볍게 넘기지 않고 살펴볼게요.',
            '{noun}에 대한 아쉬운 의견, 무겁게 받아들이고 있어요.',
            '{noun|을/를} 기대만큼 채워 드리지 못한 것 같아 마음이 무거워요.',
        ],
    },
    service: {
        polite: [
            '응대 과정에서 불편을 느끼셨다는 말씀, 직원들과 함께 돌아보겠습니다.',
            '저희 응대가 기대에 미치지 못한 부분이 있었던 것 같습니다. 말씀해 주신 내용을 모두와 공유하겠습니다.',
            '응대에서 아쉬움을 느끼셨다니 마음이 무겁습니다.',
        ],
        friendly: [
            '응대 과정에서 불편하셨다는 말씀, 직원들과 함께 돌아볼게요.',
            '저희 응대가 기대에 못 미친 부분이 있었던 것 같아요. 말씀해 주신 내용을 모두와 공유할게요.',
            '응대에서 아쉬움을 느끼셨다니 마음이 무거워요.',
        ],
    },
    wait: {
        polite: [
            '기다리시는 시간이 길게 느껴지셨다니 마음이 무겁습니다.',
            '대기 시간으로 불편을 겪으셨다는 말씀, 운영 방식을 다시 살펴보겠습니다.',
            '기다림이 길어 아쉬우셨을 것 같습니다.',
        ],
        friendly: [
            '기다리는 시간이 길게 느껴지셨다니 마음이 무거워요.',
            '대기 시간 때문에 불편하셨다는 말씀, 운영 방식을 다시 살펴볼게요.',
            '기다림이 길어서 아쉬우셨을 것 같아요.',
        ],
    },
    price: {
        polite: [
            '가격 대비 만족스럽지 못하셨다는 의견을 잘 들었습니다.',
            '가격에 비해 아쉬움을 느끼셨다니 마음이 무겁습니다. 말씀해 주신 점을 참고하겠습니다.',
            '합리적인 가치를 드리고 싶었는데 그러지 못했다니 아쉽습니다.',
        ],
        friendly: [
            '가격 대비 만족스럽지 못하셨다는 의견, 잘 들었어요.',
            '가격에 비해 아쉬우셨다니 마음이 무거워요. 말씀해 주신 점을 참고할게요.',
            '합리적인 가치를 드리고 싶었는데 그러지 못했다니 아쉬워요.',
        ],
    },
    hygiene: {
        polite: [
            '위생과 청결은 가장 기본이라고 생각하는데 불편을 느끼셨다니 무겁게 받아들입니다.',
            '청결 상태에 대한 말씀을 가볍게 여기지 않겠습니다.',
            '깨끗하고 쾌적한 공간을 만들어야 하는데 그러지 못한 점을 점검하겠습니다.',
        ],
        friendly: [
            '위생과 청결은 가장 기본이라고 생각하는데 불편하셨다니 무겁게 받아들여요.',
            '청결 상태에 대한 말씀, 가볍게 여기지 않을게요.',
            '깨끗하고 쾌적한 공간을 만들어야 하는데 그러지 못한 점을 점검할게요.',
        ],
    },
    etc: {
        polite: [
            '말씀해 주신 의견을 하나하나 꼼꼼히 확인했습니다.',
            '불편하셨던 점을 솔직하게 적어 주셨는데 잘 읽어 보았습니다.',
            '남겨 주신 의견을 가볍게 넘기지 않고 살펴보겠습니다.',
        ],
        friendly: [
            '말씀해 주신 의견을 하나하나 꼼꼼히 확인했어요.',
            '불편하셨던 점을 솔직하게 적어 주셨는데 잘 읽어 봤어요.',
            '남겨 주신 의견을 가볍게 넘기지 않고 살펴볼게요.',
        ],
    },
};

const MENTION_EXTRA = {
    polite: ['특히 {m} 관련 말씀은 꼼꼼히 확인하겠습니다.', '{m} 관련해 남겨 주신 내용은 따로 살펴보겠습니다.'],
    friendly: ['특히 {m} 관련해서 남겨 주신 말씀은 꼼꼼히 살펴볼게요.', '{m} 관련해 남겨 주신 내용은 따로 살펴볼게요.'],
};

const APOLOGY = {
    praise: {
        polite: ['혹시 아쉬우셨던 부분이 있었다면 너그러이 양해 부탁드립니다.', '부족한 부분이 있었다면 죄송한 마음입니다.', '작은 아쉬움이라도 있으셨다면 죄송한 마음으로 살펴보겠습니다.'],
        friendly: ['혹시 아쉬우셨던 부분이 있었다면 너그러이 이해해 주세요.', '부족한 부분이 있었다면 죄송한 마음이에요.', '작은 아쉬움이라도 있으셨다면 죄송한 마음으로 살펴볼게요.'],
    },
    neutral: {
        polite: ['아쉬움을 드린 부분이 있었다면 죄송합니다.', '기대에 다 미치지 못한 점이 있었다면 죄송한 마음입니다.', '마음에 걸리셨던 부분이 있었다면 사과드립니다.'],
        friendly: ['아쉬움을 드린 부분이 있었다면 죄송해요.', '기대에 다 미치지 못한 점이 있었다면 죄송한 마음이에요.', '마음에 걸리셨던 부분이 있었다면 사과드려요.'],
    },
    complaint: {
        polite: ['불편을 드려 진심으로 죄송합니다.', '기대에 미치지 못해 죄송한 마음입니다.', '마음 불편하게 해 드려 거듭 사과드립니다.'],
        friendly: ['불편하게 해 드려서 정말 죄송해요.', '기대에 못 미쳐서 죄송한 마음이에요.', '마음 불편하셨을 텐데 죄송해요.'],
    },
};

const PROMISE = {
    praise: {
        polite: ['앞으로도 한결같은 모습으로 보답하겠습니다.', '그 마음에 보답할 수 있도록 더 노력하겠습니다.', '이 만족이 이어지도록 정성을 다하겠습니다.'],
        friendly: ['앞으로도 한결같이 보답할게요.', '그 마음에 보답할 수 있게 더 노력할게요.', '이 만족이 이어지도록 정성을 다할게요.'],
    },
    neutral: {
        polite: ['말씀해 주신 점을 참고해 더 나아지겠습니다.', '아쉬우셨던 부분은 꼼꼼히 살펴 개선하겠습니다.', '다음에는 더 만족하실 수 있도록 준비하겠습니다.'],
        friendly: ['말씀해 주신 점을 참고해서 더 나아질게요.', '아쉬우셨던 부분은 꼼꼼히 살펴 개선할게요.', '다음에는 더 만족하실 수 있게 준비할게요.'],
    },
    complaint: {
        taste: {
            polite: ['{qa|을/를} 다시 점검하겠습니다.', '{qa|을/를} 내부에서 함께 확인해 개선하겠습니다.'],
            friendly: ['{qa|을/를} 다시 점검할게요.', '{qa|을/를} 내부에서 함께 확인해 개선할게요.'],
        },
        service: {
            polite: ['응대 방식을 점검하고 교육에 반영하겠습니다.', '같은 불편이 반복되지 않도록 응대 기준을 다시 정리하겠습니다.'],
            friendly: ['응대 방식을 점검하고 교육에 반영할게요.', '같은 불편이 반복되지 않도록 응대 기준을 다시 정리할게요.'],
        },
        wait: {
            polite: ['대기 안내와 운영 방식을 점검해 기다리시는 시간을 줄이도록 노력하겠습니다.', '혼잡한 시간대 운영을 다시 살펴보겠습니다.'],
            friendly: ['대기 안내와 운영 방식을 점검해서 기다리는 시간을 줄이도록 노력할게요.', '혼잡한 시간대 운영을 다시 살펴볼게요.'],
        },
        price: {
            polite: ['구성과 안내를 다시 살펴 만족도를 높일 방법을 고민하겠습니다.', '가격과 구성에 대한 안내가 더 분명해지도록 보완하겠습니다.'],
            friendly: ['구성과 안내를 다시 살펴서 만족도를 높일 방법을 고민할게요.', '가격과 구성에 대한 안내가 더 분명해지도록 보완할게요.'],
        },
        hygiene: {
            polite: ['청결 점검 기준을 다시 확인하고 관리를 더 꼼꼼히 하겠습니다.', '점검 횟수와 방법을 되돌아보고 바로 개선하겠습니다.'],
            friendly: ['청결 점검 기준을 다시 확인하고 관리를 더 꼼꼼히 할게요.', '점검 횟수와 방법을 되돌아보고 바로 개선할게요.'],
        },
        etc: {
            polite: ['내부에서 공유하고 개선 방안을 찾아보겠습니다.', '같은 일이 반복되지 않도록 살펴보겠습니다.'],
            friendly: ['내부에서 공유하고 개선 방안을 찾아볼게요.', '같은 일이 반복되지 않도록 살펴볼게요.'],
        },
    },
};

const REVISIT = {
    generic: {
        polite: ['다음에 또 찾아 주시면 더 좋은 모습으로 맞이하겠습니다.', '기회가 되시면 다시 한번 들러 주세요.', '언제든 편하게 다시 찾아 주세요.'],
        friendly: ['다음에 또 놀러 오세요!', '기회 되실 때 또 들러 주세요.', '언제든 편하게 또 와 주세요.'],
    },
    industry: {
        restaurant: { polite: '다음에도 맛있는 식사를 준비해 두겠습니다.', friendly: '다음에도 맛있는 식사 준비해 둘게요.' },
        cafe: { polite: '편안한 시간을 보내실 수 있도록 준비해 두겠습니다.', friendly: '편안한 시간 보내실 수 있게 준비해 둘게요.' },
        beauty: { polite: '다음에도 만족스러운 모습으로 만나 뵙겠습니다.', friendly: '다음에도 만족스러운 모습으로 만나요.' },
    },
    complaint: {
        polite: ['기회가 주어진다면 더 나아진 모습을 보여 드리겠습니다.', '다시 만나 뵙게 된다면 달라진 모습으로 맞이하겠습니다.', '부족했던 부분을 채워 다시 인사드릴 수 있기를 바랍니다.'],
        friendly: ['기회가 된다면 더 나아진 모습 보여 드릴게요.', '다시 만나게 된다면 달라진 모습으로 맞이할게요.', '부족했던 부분을 채워서 다시 인사드릴 수 있으면 좋겠어요.'],
    },
    clinic: {
        polite: ['궁금하신 점은 언제든 편하게 문의해 주세요.', '필요하실 때 언제든 편하게 연락 주세요.', '더 나은 안내를 드릴 수 있도록 항상 준비하겠습니다.'],
        friendly: ['궁금하신 점은 언제든 편하게 문의해 주세요.', '필요하실 때 언제든 편하게 연락 주세요.', '더 나은 안내를 드릴 수 있게 항상 준비할게요.'],
    },
};

const CLINIC_NOTE = {
    polite: '진료와 관련된 구체적인 내용은 공개 답글로 말씀드리기 어려운 점 양해 부탁드리며, 궁금하신 점은 직접 문의해 주세요.',
    friendly: '진료와 관련된 자세한 이야기는 공개 답글로는 어려워요. 궁금하신 점은 직접 문의해 주세요.',
};

/* ===================== 초안 만들기 ===================== */

export function defaultIncludes(sentiment) {
    if (sentiment === 'praise') return { thanks: true, apology: false, promise: false, revisit: true };
    if (sentiment === 'complaint') return { thanks: true, apology: true, promise: true, revisit: false };
    return { thanks: true, apology: true, promise: true, revisit: true };
}

export function normalizeInput(input = {}) {
    const review = clean(input.review);
    const sentiment = SENTIMENT_IDS.includes(input.sentiment) ? input.sentiment : detectSentiment(review);
    const complaintType = COMPLAINT_IDS.includes(input.complaintType) ? input.complaintType : detectComplaintType(review);
    return {
        industry: INDUSTRY_IDS.includes(input.industry) ? input.industry : 'etc',
        storeName: clean(input.storeName).slice(0, 30),
        review,
        sentiment,
        complaintType,
        tone: TONE_IDS.includes(input.tone) ? input.tone : 'polite',
        include: { ...defaultIncludes(sentiment), ...(input.include || {}) },
        mentions: parseMentions(input.mentions),
    };
}

function stableKey(cfg) {
    return JSON.stringify([
        cfg.industry, cfg.storeName, cfg.review, cfg.sentiment, cfg.complaintType, cfg.tone,
        cfg.include.thanks, cfg.include.apology, cfg.include.promise, cfg.include.revisit, cfg.mentions,
    ]);
}

function buildDraft(cfg, hash, k) {
    const { tone, sentiment, industry, include, mentions, storeName } = cfg;
    const pick = (pool, salt) => pool[(hash + salt * 31 + k) % pool.length];
    const hasMention = mentions.length > 0;
    const vars = {
        store: storeName,
        m: joinWords(mentions),
        noun: NOUN[industry],
        qa: QUALITY_ACTION[industry],
    };
    const say = (pool, salt) => fill(pick(pool, salt), vars);

    const opening = say(storeName ? OPEN_STORE[tone] : OPEN_NO_STORE[tone], 1);
    const thanks = include.thanks ? say(THANKS[sentiment][tone], 2) : '';

    let core;
    if (sentiment === 'praise') {
        core = say(hasMention ? CORE_PRAISE.withMention[tone] : CORE_PRAISE.plain[tone], 3);
    } else if (sentiment === 'neutral') {
        core = say(CORE_NEUTRAL[tone], 3);
    } else {
        core = say(CORE_COMPLAINT[cfg.complaintType][tone], 3);
    }
    const mentionExtra = sentiment !== 'praise' && hasMention ? say(MENTION_EXTRA[tone], 4) : '';

    const apology = include.apology ? say(APOLOGY[sentiment][tone], 5) : '';
    let promise = '';
    if (include.promise) {
        const pool = sentiment === 'complaint' ? PROMISE.complaint[cfg.complaintType][tone] : PROMISE[sentiment][tone];
        promise = say(pool, 6);
    }
    const note = industry === 'clinic' ? CLINIC_NOTE[tone] : '';

    let revisit = '';
    if (include.revisit) {
        let pool;
        if (industry === 'clinic') pool = REVISIT.clinic[tone];
        else if (sentiment === 'complaint') pool = REVISIT.complaint[tone];
        else pool = [...REVISIT.generic[tone], ...(REVISIT.industry[industry] ? [REVISIT.industry[industry][tone]] : [])];
        revisit = say(pool, 7);
    }

    const paragraphs = sentiment === 'complaint'
        ? [[opening], [thanks, core, mentionExtra], [apology, promise, note], [revisit]]
        : [[opening], [core, thanks, mentionExtra], [apology, promise, note], [revisit]];
    return paragraphs
        .map((group) => group.filter(Boolean).join(' '))
        .filter(Boolean)
        .join('\n\n');
}

// 같은 입력이면 항상 같은 초안 3개. 입력이 올바르지 않으면 빈 배열.
export function generateReplies(input) {
    const cfg = normalizeInput(input);
    if (!validateReview(cfg.review).ok) return [];
    const hash = hashString(stableKey(cfg));
    return [0, 1, 2].map((k) => ({
        id: `draft-${k + 1}`,
        label: `초안 ${k + 1}`,
        text: buildDraft(cfg, hash, k),
    }));
}

/* ===================== 정책 점검 ===================== */

const SEVERITY_ORDER = { danger: 0, warn: 1, info: 2 };

export const SEVERITY_LABELS = {
    danger: '삭제·제재 위험',
    warn: '주의',
    info: '안내',
};

const R_PRIVACY = '답글에 개인정보성 내용이 있으면 답글이 통보 없이 삭제되고 스마트플레이스 권한이 회수될 수 있다고 네이버가 안내하고 있어요.';
const R_IDENTIFY = '방문·주문·예약 같은 고객관리 정보로 작성자를 특정하는 표현은 업체 단위 페널티 대상이에요.';
const R_ABUSE = '욕설·비방·위협 표현을 답글로 반복하는 것은 업체 단위 페널티 대상이에요.';
const R_MANIPULATE = '특정 별점·표현을 요구하거나 리뷰 변경·삭제를 압박하는 것은 업체 단위 페널티 대상이에요. (단순한 리뷰 작성 안내는 해당하지 않아요)';

const TIME_WORD = '(?:어제|그제|그저께|엊그제|오늘|지난\\s?[가-힣]{1,3}|이번\\s?주[가-힣]{0,2}|\\d{1,2}월\\s?\\d{1,2}일|\\d{1,2}일|(?:오전|오후|저녁|아침|점심|새벽|밤)?\\s?\\d{1,2}시(?:\\s?\\d{1,2}분)?|오전|오후|저녁|아침|점심|새벽)';
const VISIT_VERB = '(?:오신|오셨|방문하신|방문하셨|예약하신|예약하셨|주문하신|주문하셨|다녀가신|다녀가셨|다녀오신|결제하신|결제하셨|이용하신|이용하셨|드신|드셨|식사하신|식사하셨|받으신|받으셨|계셨던|앉으신|앉으셨)';

const NAME_EXCLUDE = new Set([
    '고객', '손님', '회원', '사장', '원장', '선생', '부모', '어머', '아버', '할머', '할아', '대표', '점장', '직원', '사모', '이모', '실장', '팀장',
    '이용', '방문', '작성', '구매', '주문', '예약', '환자', '보호자', '여러', '선배', '후배', '친구', '가족', '엄마', '아빠', '아들', '딸', '언니', '오빠',
    '정말', '진짜', '이런', '저런', '그런', '항상', '모든', '우리', '저희', '어떤', '하나', '다른', '새로', '처음', '오랜', '소중', '성함',
]);
const SURNAMES = '김이박최정강조윤장임한오서신권황안송류전홍고문양손배백허유남심노하곽성차주우구민진지엄채원천방공현함변염여추석설마길연위왕맹탁국은편봉';

function findNames(text) {
    const found = [];
    const patterns = [
        /(^|[^가-힣])([가-힣]{2,3})\s?(?:고객님|손님|회원님|학부모님|님)(?![가-힣])/g,
    ];
    patterns.forEach((re) => {
        for (const m of text.matchAll(re)) {
            const token = m[2];
            if (NAME_EXCLUDE.has(token) || !SURNAMES.includes(token[0])) continue;
            const start = m.index + m[1].length;
            found.push({ start, end: m.index + m[0].length, phrase: m[0].slice(m[1].length).trim() });
        }
    });
    return found;
}

// kind: 'regex' 는 한 번에 찾고, 'custom' 은 직접 찾는 함수를 씁니다.
const RULES = [
    {
        id: 'phone', category: 'privacy', severity: 'danger',
        re: [/(?<!\d)0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)/g, /(?<!\d)1[5-9]\d{2}[-.]\d{4}(?!\d)/g],
        reason: `전화번호 형태의 숫자가 있어요. ${R_PRIVACY}`,
    },
    {
        id: 'email', category: 'privacy', severity: 'danger',
        re: [/[\w.+-]+@[\w-]+\.[\w.-]+/g],
        reason: `이메일 주소가 있어요. ${R_PRIVACY}`,
    },
    {
        id: 'account', category: 'privacy', severity: 'danger',
        re: [
            /(?<!\d)\d{3,6}-\d{2,6}-\d{3,8}(?!\d)/g,
            /(?:국민|신한|우리|하나|농협|기업|카카오뱅크|토스뱅크|케이뱅크|새마을|우체국|수협|SC제일|씨티)(?:은행)?\s?\d{6,}/g,
            /계좌(?:번호)?\s?[:：]?\s?\d[\d-]{7,}/g,
        ],
        skipIfOverlap: ['phone'],
        reason: `계좌번호처럼 보이는 숫자열이 있어요. ${R_PRIVACY}`,
    },
    {
        id: 'name-placeholder', category: 'privacy', severity: 'warn',
        re: [/(?:^|[^가-힣])([○◯Oo0ㅇXx×*＊]{2,3}\s?님)/g],
        group: 1,
        reason: `이름 자리를 표시한 문구가 남아 있어요. 실제 이름은 넣지 말고 지워 주세요. ${R_PRIVACY}`,
    },
    {
        id: 'name', category: 'privacy', severity: 'danger',
        custom: findNames,
        reason: `실명으로 보이는 호칭이에요. 이름 대신 '고객님'처럼 부르세요. ${R_PRIVACY}`,
    },
    {
        id: 'visit-time', category: 'identify', severity: 'danger',
        re: [new RegExp(`${TIME_WORD}[^.!?\\n]{0,14}?${VISIT_VERB}`, 'g')],
        reason: `방문 일시로 작성자를 알아볼 수 있는 표현이에요. ${R_IDENTIFY}`,
    },
    {
        id: 'seat', category: 'identify', severity: 'danger',
        re: [/\d{1,3}\s?번\s?(?:테이블|좌석|자리|룸|방|베드|침대|대기|주문|손님|고객|창구|번호표)|(?:테이블|좌석|자리|룸|주문\s?번호|대기\s?번호|예약\s?번호|번호표)\s?\d{1,4}\s?번?/g],
        reason: `좌석·번호로 작성자를 특정할 수 있는 표현이에요. ${R_IDENTIFY}`,
    },
    {
        id: 'order-detail', category: 'identify', severity: 'warn',
        re: [/(?:주문하신|주문하셨던|시키신|시키셨던|결제하신|예약하신|예약하셨던|구매하신|구매하셨던)\s+(?!메뉴|음식|상품|제품|서비스|내용|부분|것|건|물품|시술|내역)[가-힣A-Za-z0-9]{1,12}/g],
        reason: `주문 내역을 구체적으로 짚으면 작성자를 특정하는 표현이 될 수 있어요. ${R_IDENTIFY}`,
    },
    {
        id: 'record', category: 'identify', severity: 'danger',
        re: [/(?:주문|예약|결제|방문|진료|시술|이용|구매)\s?(?:내역|기록|이력)|(?:CCTV|씨씨티비)(?:\s?(?:를|을))?\s?(?:확인|돌려|돌려보)/gi],
        reason: `고객관리 기록이나 영상으로 확인했다는 표현이에요. ${R_IDENTIFY}`,
    },
    {
        id: 'medical-record', category: 'identify', severity: 'warn',
        re: [/(?:진료|치료|수술|시술|처방|검사|상담)\s?(?:을\s?|를\s?)?(?:받으신|받으셨|받으셨던|하신|하셨)|내원하(?:신|셨)|입원하(?:신|셨)/g],
        reason: `진료·시술을 받았다는 사실이 드러나면 작성자를 특정하거나 개인 정보를 노출하는 표현이 될 수 있어요. ${R_IDENTIFY}`,
    },
    {
        id: 'abuse', category: 'abuse', severity: 'danger',
        re: [/거짓말|거짓|진상|악의적|악의|허위|사기꾼|날조|억지|뻔뻔|헛소리|몰상식|블랙컨슈머|악성\s?(?:리뷰|고객|손님)|쓰레기|미친\s?(?:놈|년|소리|짓|사람|인간|리뷰|고객|손님)|병신|또라이|양아치|씨발|시발|꺼져|경쟁\s?업체/g],
        reason: `감정적이거나 비방으로 읽힐 수 있는 표현이에요. ${R_ABUSE}`,
    },
    {
        id: 'threat', category: 'abuse', severity: 'danger',
        re: [/신고\s?(?:하|할|조치|접수)|고소\s?(?:장|조치|를|하겠|할\s?(?:것|거|예정)|예정|진행|당)|고발|법적\s?(?:조치|대응|책임)|소송|명예\s?훼손|손해\s?배상|경찰|형사|블랙리스트/g],
        reason: `위협으로 읽힐 수 있는 표현이에요. ${R_ABUSE}`,
    },
    {
        id: 'blame', category: 'abuse', severity: 'warn',
        re: [/오해하(?:신|셨|시)|착각하(?:신|셨|시)|잘못\s?(?:알|아신|생각하|이해하)(?:고|신|셨|시)|(?:고객님|손님|작성자)\s?(?:탓|잘못|실수)|예민하(?:신|셔|시)|까다로우(?:신|셔|시)|트집|본인\s?(?:탓|잘못)|제대로\s?(?:읽|보|확인하)(?:지|고|셨|신)/g],
        reason: '작성자를 탓하는 것으로 읽힐 수 있어요. 공개 답글에서는 먼저 공감하고 사과·해결 방안을 말하는 편이 안전해요.',
    },
    {
        id: 'reward-for-edit', category: 'manipulation', severity: 'danger', priority: 3,
        re: [
            /(?:삭제|수정|변경|철회|재작성)[^.!?\n]{0,14}(?:환불|쿠폰|무료|할인|보상|상품권|적립|사은품|증정|서비스\s?(?:를\s?)?(?:드리|제공)|드리겠|드릴게)/g,
            /(?:환불|쿠폰|무료|할인|보상|상품권|적립|사은품|증정)[^.!?\n]{0,14}(?:삭제|수정|변경|철회)/g,
        ],
        reason: `리뷰를 고치거나 지우는 대가를 약속하는 표현이에요. ${R_MANIPULATE}`,
    },
    {
        id: 'score-request', category: 'manipulation', severity: 'danger', priority: 2,
        re: [/(?:별점|평점)\s?[^.!?\n]{0,8}?[1-5]\s?점|[1-5]\s?점\s?(?:을|를|으로|만|이상)?\s?(?:부탁|주세요|주시|남겨|달아|올려)|(?:높은|좋은|후한)\s?(?:별점|평점)|(?:별점|평점)\s?(?:을\s?)?(?:올려|높여|잘\s?줘|잘\s?주|좋게|많이)|(?:별점|평점)\s?만점|만점\s?(?:을|으로|부탁|주세요)|별\s?[1-5]\s?개\s?(?:만|로|부탁)/g],
        reason: `특정 별점을 요구하는 표현이에요. ${R_MANIPULATE}`,
    },
    {
        id: 'edit-request', category: 'manipulation', severity: 'danger', priority: 1,
        re: [/(?:리뷰|후기|별점|평점|글|내용)(?:을|를|도|은|는)?\s?[^.!?\n]{0,12}?(?:수정|삭제|철회|변경|재작성|내려|지워|지우|비공개|바꿔|고쳐)/g],
        reason: `리뷰나 별점을 고치거나 지워 달라는 표현이에요. ${R_MANIPULATE}`,
    },
    {
        id: 'refund-promise', category: 'promise', severity: 'warn',
        re: [/환불|보상|배상|전액|무상|재시술|재제작|재시공|재진행|쿠폰\s?(?:을\s?)?(?:드리|지급|발송|보내)|(?:무료|공짜)\s?(?:로\s?)?(?:제공|교환|재방문|서비스|시술|리터치|수정|쿠폰|이용권)|서비스\s?(?:로\s?)?(?:드리|제공)|(?:할인|적립)\s?(?:해\s?|을\s?|를\s?)?(?:드리|해드|지급)|돌려\s?드리|교환\s?해\s?드/g],
        reason: '환불·보상을 공개 답글로 약속하면 나중에 분쟁이 될 수 있어요. 구체적인 보상은 연락해서 따로 안내하는 편이 안전해요. (네이버 규정이 아니라 일반적인 주의 사항이에요)',
    },
    {
        id: 'medical-effect', category: 'medical', severity: 'warn', clinicOnly: true,
        re: [/완치|100\s?%|백\s?퍼센트|반드시\s?(?:낫|좋아|호전|효과)|확실(?:히|한|하게)\s?(?:효과|치료|낫|좋아|호전)|틀림없이|(?:효과|치료|결과)(?:가|는|를|은)?\s?(?:보장|확실)|보장(?:해|합|드)|부작용(?:이|은|도)?\s?(?:전혀\s?|하나도\s?)?없|통증(?:이|은|도)?\s?(?:전혀\s?)?(?:없|사라)|낫게\s?(?:해|됩|될)|좋아지(?:십니다|실\s?거|실\s?겁|실\s?것)|나으(?:실|십니다)|치료(?:가|는)?\s?됩니다|호전(?:됩|되실|될)|효과(?:를|가)?\s?(?:보실|볼\s?수\s?있|있습니다|입니다|나타)|완벽(?:히|한|하게)|무조건/g],
        reason: '치료 효과를 보장하거나 단정하는 표현으로 읽힐 수 있어요. 의료 관련 답글에서는 특히 조심하세요. (네이버 규정이 아니라 일반적인 주의 사항이에요)',
    },
];

function overlaps(a, b) {
    return a.start < b.end && b.start < a.end;
}

// 글 한 편을 점검해 걸린 문구와 이유를 돌려줍니다.
export function checkPolicy(text, { industry = 'etc' } = {}) {
    const value = String(text ?? '');
    const findings = [];

    RULES.forEach((rule) => {
        if (rule.clinicOnly && industry !== 'clinic') return;
        if (rule.custom) {
            rule.custom(value).forEach((hit) => {
                findings.push({ ...hit, ruleId: rule.id, id: rule.id, category: rule.category, severity: rule.severity, priority: rule.priority || 0, reason: rule.reason });
            });
            return;
        }
        rule.re.forEach((re) => {
            for (const m of value.matchAll(re)) {
                const phrase = rule.group ? m[rule.group] : m[0];
                if (!phrase || !phrase.trim()) continue;
                const offset = rule.group ? m[0].indexOf(phrase) : 0;
                const start = m.index + Math.max(offset, 0);
                findings.push({
                    id: rule.id, ruleId: rule.id, category: rule.category, severity: rule.severity,
                    priority: rule.priority || 0, phrase: phrase.trim(), start, end: start + phrase.length, reason: rule.reason,
                });
            }
        });
    });

    // 같은 자리를 다른 규칙이 이미 잡았으면 덜 구체적인 쪽을 뺍니다.
    const kept = findings.filter((f, i) => {
        const rule = RULES.find((r) => r.id === f.ruleId);
        if (rule?.skipIfOverlap && findings.some((o) => rule.skipIfOverlap.includes(o.ruleId) && overlaps(f, o))) return false;
        if (f.category === 'manipulation') {
            return !findings.some((o, j) => j !== i && o.category === 'manipulation' && o.priority > f.priority && overlaps(f, o));
        }
        return findings.findIndex((o) => o.ruleId === f.ruleId && o.start === f.start && o.end === f.end) === i;
    });

    kept.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.start - b.start);

    const result = kept.map(({ id, category, severity, phrase, reason }) => ({ id, category, severity, phrase, reason }));
    if (industry === 'clinic') {
        result.push({
            id: 'medical-notice', category: 'medical', severity: 'info', phrase: '',
            reason: '의료 관련 답글은 반드시 직접 검토한 뒤 등록하세요. 진료 사실이나 내용이 드러나지 않는지, 효과를 단정하지 않는지 한 번 더 확인해 주세요.',
        });
    }
    return result;
}
