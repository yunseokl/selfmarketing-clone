// 업종별 어휘 풀 + 템플릿 조합으로 마케팅 문구를 생성하는 결정론적 엔진 (외부 API 불필요)

const INDUSTRIES = {
    restaurant: {
        label: '음식점',
        emojis: ['🍽️', '😋', '🔥', '👍', '✨'],
        nouns: ['맛집', '한상', '메뉴', '식사'],
        hashtags: ['맛집', '맛스타그램', '먹스타그램', '오늘뭐먹지', '맛집투어', '데이트맛집', '동네맛집', '맛집추천', '푸드스타그램', '존맛탱'],
    },
    cafe: {
        label: '카페',
        emojis: ['☕', '🍰', '🌿', '😌', '✨'],
        nouns: ['커피', '디저트', '분위기', '휴식'],
        hashtags: ['카페스타그램', '카페투어', '커피스타그램', '디저트맛집', '감성카페', '분위기카페', '카페추천', '커피한잔', '데이트카페', '동네카페'],
    },
    beauty: {
        label: '뷰티',
        emojis: ['💄', '✨', '💖', '🌸', '👑'],
        nouns: ['피부', '뷰티', '케어', '광채'],
        hashtags: ['뷰티스타그램', '뷰티템', '스킨케어', '뷰티추천', '데일리뷰티', '뷰티그램', '피부관리', '메이크업', '뷰티팁', '뷰티맛집'],
    },
    fashion: {
        label: '패션',
        emojis: ['👗', '🛍️', '✨', '😎', '🔥'],
        nouns: ['스타일', '코디', '룩', '아이템'],
        hashtags: ['패션스타그램', '오늘의코디', '데일리룩', '패션추천', '스타일링', '옷스타그램', '패션잇템', '코디스타그램', '트렌드', '신상'],
    },
    living: {
        label: '생활용품',
        emojis: ['🏠', '✨', '💡', '👍', '🌟'],
        nouns: ['생활', '리빙', '아이디어', '필수템'],
        hashtags: ['생활용품', '리빙템', '집꾸미기', '살림템', '필수템', '생활꿀팁', '리빙스타그램', '홈스타일링', '가성비템', '추천템'],
    },
    etc: {
        label: '기타',
        emojis: ['✨', '👍', '🔥', '😊', '🌟'],
        nouns: ['제품', '서비스', '브랜드', '경험'],
        hashtags: ['추천', '신상', '데일리', '인생템', '가성비', '만족도최고', '재구매각', '입소문', '핫아이템', '지금이순간'],
    },
};

const TONES = {
    friendly: {
        label: '친근한',
        closers: ['꼭 한번 만나보세요 😊', '지금 만나볼까요?', '어때요? 마음에 드실 거예요'],
    },
    professional: {
        label: '전문적인',
        closers: ['지금 확인해보세요.', '자세한 정보를 안내해드립니다.', '차이를 직접 경험해보세요.'],
    },
    humorous: {
        label: '유머러스한',
        closers: ['안 써본 사람은 있어도 한 번만 쓴 사람은 없어요 ㅋㅋ', '이거 완전 실화입니다', '고민할 시간에 일단 확인 고고'],
    },
    emotional: {
        label: '감성적인',
        closers: ['그 순간을 선물해드릴게요.', '작은 행복을 전해드립니다.', '마음까지 채워드릴게요.'],
    },
};

export const INDUSTRY_OPTIONS = Object.entries(INDUSTRIES).map(([value, v]) => ({ value, label: v.label }));
export const TONE_OPTIONS = Object.entries(TONES).map(([value, v]) => ({ value, label: v.label }));

const HOOK_BUILDERS = [
    (c) => `${c.emoji} ${c.name}의 ${c.keyword1} ${c.noun}`,
    (c) => `${c.keyword1} 하나로 완성되는 ${c.name}`,
    (c) => `${c.name}에서만 느낄 수 있는 ${c.keyword1}`,
    (c) => `오늘의 추천, ${c.name} ${c.noun} ${c.emoji}`,
    (c) => `${withParticle(c.keyword1, '과', '와')} ${c.keyword2} 사이, ${c.name}`,
    (c) => `${c.name}의 ${c.noun} 이야기 ${c.emoji}`,
];

const CAPTION_BUILDERS = [
    (c, closer) => `${c.emoji} ${c.name} 이야기\n\n${c.keyword1}, ${c.keyword2}까지 놓치지 마세요.\n${closer}\n\n${c.emoji2} 지금 바로 만나보세요.`,
    (c, closer) => `${withParticle(c.name, '을', '를')} 특별하게 만드는 것, 바로 ${c.keyword1} ${c.emoji}\n${withParticle(c.keyword2, '과', '와')} ${c.keyword3}도 함께 확인해보세요.\n${closer}`,
    (c, closer) => `${c.emoji} 오늘 소개할 이야기는 ${c.name}\n${c.keyword1} 하나로 시작해서 ${c.keyword2}까지, 이유가 궁금하다면?\n${closer}`,
];

const BLOG_TITLE_BUILDERS = [
    (c) => `${c.name} ${c.noun}, ${c.keyword1} 제대로 즐기는 방법`,
    (c) => `${c.keyword1} 찾는다면? ${c.name} 추천 이유 3가지`,
    (c) => `${c.name}에서 발견한 ${c.keyword1}의 매력`,
    (c) => `${c.keyword1}부터 ${c.keyword2}까지, ${c.name} 완벽 가이드`,
    (c) => `요즘 핫한 ${c.name}, ${c.keyword1} 후기`,
    (c) => `${c.name} ${c.noun} 총정리 – ${c.keyword1} 편`,
];

function hasBatchim(text) {
    const lastChar = (text || '').trim().slice(-1);
    const code = lastChar.charCodeAt(0);
    if (code < 0xAC00 || code > 0xD7A3) return false;
    return (code - 0xAC00) % 28 !== 0;
}

// 받침 유무에 따라 조사를 붙입니다 (예: withParticle('카페', '을', '를') → '카페를').
function withParticle(text, withBatchim, withoutBatchim) {
    return `${text}${hasBatchim(text) ? withBatchim : withoutBatchim}`;
}

function hashString(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
    }
    return hash >>> 0;
}

function mulberry32(seed) {
    let t = seed >>> 0;
    return function random() {
        t += 0x6D2B79F5;
        let r = Math.imul(t ^ (t >>> 15), 1 | t);
        r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}

function shuffle(rng, arr) {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

function pickN(rng, arr, n) {
    return shuffle(rng, arr).slice(0, n);
}

function pick(rng, arr) {
    return arr[Math.floor(rng() * arr.length)];
}

function toHashtag(text) {
    return text.replace(/\s+/g, '');
}

// 업종/상품명/키워드/톤을 조합해 SNS 문구, 인스타 캡션+해시태그, 블로그 제목을 생성합니다.
// seed가 같으면 항상 같은 결과를 반환하는 결정론적 함수이며, seed를 올리면("다시 생성") 변형 세트를 얻습니다.
export function generateCopy(input = {}) {
    const industryKey = INDUSTRIES[input.industry] ? input.industry : 'etc';
    const industry = INDUSTRIES[industryKey];
    const toneKey = TONES[input.tone] ? input.tone : 'friendly';
    const tone = TONES[toneKey];
    const name = (input.name || '우리 브랜드').trim() || '우리 브랜드';
    const keywords = (input.keywords || []).map(k => (k || '').trim()).filter(Boolean);
    const seed = Number.isFinite(input.seed) ? input.seed : 0;

    const rng = mulberry32(hashString(`${industryKey}|${toneKey}|${name}|${keywords.join(',')}|${seed}`));

    const [noun, noun2] = pickN(rng, industry.nouns, 2);
    const [emoji, emoji2] = pickN(rng, industry.emojis, 2);
    // 키워드가 3개 미만이면 서로 다른 업종 명사로 채워 같은 단어가 반복되지 않게 합니다.
    const keyword1 = keywords[0] || noun;
    const keyword2 = keywords[1] || noun2;
    const keyword3 = keywords[2] || noun;
    const ctx = { name, noun, emoji, emoji2, keyword1, keyword2, keyword3 };

    // SNS 홍보문구 3개
    const hookFns = pickN(rng, HOOK_BUILDERS, 3);
    const closers = pickN(rng, tone.closers, tone.closers.length);
    const snsPhrases = hookFns.map((fn, idx) => `${fn(ctx)}. ${closers[idx % closers.length]}`);

    // 인스타 캡션 1개 + 해시태그 10개
    const captionBuilder = pick(rng, CAPTION_BUILDERS);
    const caption = captionBuilder(ctx, pick(rng, tone.closers));

    const keywordTags = [name, ctx.keyword1, ctx.keyword2, ctx.keyword3, `${industry.label}추천`]
        .map(toHashtag)
        .filter(Boolean);
    const industryTags = pickN(rng, industry.hashtags, industry.hashtags.length);

    const hashtags = [];
    const seenTags = new Set();
    [...keywordTags, ...industryTags].forEach((tag) => {
        const clean = `#${tag}`;
        if (!seenTags.has(clean) && hashtags.length < 10) {
            seenTags.add(clean);
            hashtags.push(clean);
        }
    });

    // 블로그 제목 3개
    const titleFns = pickN(rng, BLOG_TITLE_BUILDERS, 3);
    const blogTitles = titleFns.map(fn => fn(ctx));

    return {
        snsPhrases,
        instagram: { caption, hashtags },
        blogTitles,
    };
}
