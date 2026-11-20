// AI 답변 확인 도우미 — 사장님이 AI에 직접 물어볼 질문 세트를 만들고, 붙여 넣은 답변을 읽고, 실측 기록을 추이·리포트로 바꾸는 순수 함수 모음.
//
// 2026-11 GEO·AEO 대화 정리에서 옮긴 것:
//  - 타겟 질문 목록과 "쿼리 팬아웃"(AI가 추천 질문을 조건별 세부 질문으로 나눠 찾는다) → buildPromptSet
//  - som_tracker 의 순위 판정과 v2 의 인용 출처 수집 → analyzeAnswer (순위는 place-geo.js 의 evaluateAnswerRank 를 그대로 씀)
//  - 텔레그램 리포트·대시보드 추이·내보내기 → somReportText · somTrend · somCsv
// 대화의 코드는 AI 회사 API를 주기적으로 불렀지만 여기에는 네트워크 요청이 없습니다. 사장님이 직접 묻고 붙여 넣은 글만 읽습니다.
// 대화에 있던 "여러 계정으로 같은 질문 반복"·"경쟁 매장 깎아내리는 문장"은 넣지 않았습니다(place-geo.js 의 GEO_DONTS).

import { buildCsv, formatDateTimeKST } from './csv.js';
import {
    PLATFORMS, SOM_MENTION, SOM_NONE, SOM_PROMPT_SUFFIX,
    buildFanout, categoryLabel, searchCategory, evaluateAnswerRank, isSomRank, measurePrompts, placeArea, placeCriteria, shareOfModel,
    somPoints, somRankLabel, targetQuestion,
} from './place-geo.js';

// 질문 종류. rank 만 점유율(Share of Model)에 기록하고 나머지는 확인용입니다.
export const PROMPT_KINDS = [
    { key: 'rank', label: '추천 순위', note: '몇 번째로 추천되는지 봅니다. 점유율에 기록하는 질문입니다.' },
    { key: 'source', label: '출처', note: 'AI가 어떤 글을 보고 답하는지 봅니다.' },
    { key: 'fact', label: '내 매장 사실', note: 'AI가 영업시간·가격을 맞게 알고 있는지 봅니다.' },
    { key: 'followup', label: '이어 묻기', note: '추천 다음에 오는 질문에도 내 매장 정보로 답하는지 봅니다.' },
];

// AI마다 묻는 방법이 다릅니다. ask: 'keyword' 는 문장 대신 검색어를 넣는 곳(네이버).
// prefill: 질문을 주소에 실어 열 수 있는 곳. 열리지 않아도 질문은 함께 복사되므로 붙여 넣으면 됩니다.
// tips: 그 AI에 물을 때 늘 지킬 것 · rankTips: 순위 질문일 때만 덧붙이는 안내
export const AI_GUIDES = {
    naver: {
        ask: 'keyword',
        site: '네이버 검색',
        home: 'https://search.naver.com/search.naver?query=',
        prefill: true,
        tips: ['문장 대신 검색어만 넣습니다.'],
        rankTips: ['맨 위 AI 브리핑에 내 매장이 나오는 순서를 봅니다. 브리핑이 없으면 플레이스 목록 순서를 봅니다.'],
        paste: 'AI 브리핑 글(없으면 플레이스 목록의 매장 이름)을 위에서부터 복사해 붙여 넣으세요.',
    },
    chatgpt: {
        ask: 'sentence',
        site: 'ChatGPT',
        home: 'https://chatgpt.com/?hints=search&q=',
        prefill: true,
        tips: ['새 채팅에서 검색을 켠 상태로 묻습니다.', '답변 아래 출처 링크까지 함께 복사하면 출처도 읽어 드립니다.'],
        paste: '답변 전체를 출처 링크까지 복사해 붙여 넣으세요.',
    },
    gemini: {
        ask: 'sentence',
        site: 'Gemini',
        home: 'https://gemini.google.com/app',
        prefill: false,
        tips: ['새 채팅을 열고 복사한 질문을 붙여 넣습니다.'],
        rankTips: ['구글 지도 카드가 함께 나오면 카드에 나온 순서를 봅니다.'],
        paste: '답변 전체를 복사해 붙여 넣으세요.',
    },
    claude: {
        ask: 'sentence',
        site: 'Claude',
        home: 'https://claude.ai/new?q=',
        prefill: true,
        tips: ['새 채팅에서 웹 검색을 켠 상태로 묻습니다.'],
        paste: '답변 전체를 출처 링크까지 복사해 붙여 넣으세요.',
    },
    perplexity: {
        ask: 'sentence',
        site: 'Perplexity',
        home: 'https://www.perplexity.ai/search?q=',
        prefill: true,
        tips: ['새 스레드에서 묻습니다.', '[1]·[2] 출처 번호의 링크까지 함께 복사하세요.'],
        paste: '답변 전체를 출처 링크까지 복사해 붙여 넣으세요.',
    },
};

function list(value) {
    return Array.isArray(value) ? value.filter(Boolean) : [];
}

function compact(text) {
    return String(text || '').replace(/\s+/g, '').toLowerCase();
}

function topMenu(place) {
    return list(place?.reviewMenus)[0]?.label || list(place?.detail?.pos?.popularMenus)[0]?.name || null;
}

// "주차되는, 예약 가능한 강남구청역 한식 추천해줘. 추천하는 곳을 …" → "주차되는 예약 가능한 강남구청역 한식 추천"
export function naverQuery(text) {
    return String(text || '')
        .replace(SOM_PROMPT_SUFFIX, '')
        .replace(/해줘\.?\s*$/, '')
        .replace(/[,?]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

// 그 AI 화면을 여는 주소. 질문을 실어 열 수 있는 곳은 실어 줍니다(누른 사람의 브라우저에서만 열립니다).
export function aiOpenUrl(platformKey, text) {
    const guide = AI_GUIDES[platformKey];
    if (!guide) return null;
    if (!guide.prefill) return guide.home;
    const value = String(text || '').trim();
    return value ? `${guide.home}${encodeURIComponent(value)}` : guide.home.replace(/[?&][a-z]+=$/, '').replace(/\?hints=search$/, '');
}

// 사장님이 AI에 물어볼 질문 세트.
// id · kind · label · text(문장) · naver(네이버 검색어, 네이버에서 쓸 수 없으면 null) · look(답변에서 볼 것)
// core: 매번 재는 기본 질문 · facts: 답과 대조할 실제 정보 [{ label, value }]
export function buildPromptSet(place, activity = null) {
    if (!place) return [];
    const name = place.name || '내 매장';
    const area = placeArea(place);
    const category = categoryLabel(place);
    const question = targetQuestion(place);
    const where = area ? `${area} ` : '';
    const base = measurePrompts(place);
    const criteria = placeCriteria(place);
    // measurePrompts 가 조건 질문에 쓰는 순서와 같습니다(역 거리는 뒤로).
    const ordered = [...criteria.filter((c) => c.key !== 'walk'), ...criteria.filter((c) => c.key === 'walk')];
    const menu = topMenu(place);
    const prompts = [];

    prompts.push({
        id: 'rank-basic', kind: 'rank', core: true, label: '기본 질문',
        text: base[0], naver: question,
        look: '내 매장이 추천 목록의 몇 번째인지 봅니다.',
    });
    if (base[1]) {
        prompts.push({
            id: 'rank-combo', kind: 'rank', core: true, label: '조건을 붙인 질문',
            text: base[1], naver: naverQuery(base[1]),
            look: '조건을 붙였을 때도 추천되는지 봅니다. 등록해 둔 조건(주차·예약 등)이 AI에 전해졌는지 알 수 있습니다.',
        });
    }
    if (menu && !compact(question).includes(compact(menu))) {
        const text = `${area ? `${area}에서 ` : ''}${menu} 잘하는 곳 추천해줘. ${SOM_PROMPT_SUFFIX}`;
        prompts.push({
            id: 'rank-menu', kind: 'rank', core: false, label: '대표 메뉴로 묻는 질문',
            text, naver: `${where}${menu} 잘하는 곳`,
            look: `손님이 업종 대신 메뉴(${menu})로 물을 때 추천되는지 봅니다.`,
        });
    }
    const extra = ordered[2];
    if (extra) {
        const text = `${extra.ask} ${where}${searchCategory(place)} 추천해줘. ${SOM_PROMPT_SUFFIX}`;
        prompts.push({
            id: `rank-${extra.key}`, kind: 'rank', core: false, label: `'${extra.ask}' 조건 질문`,
            text, naver: naverQuery(text),
            look: `"${extra.ask}" 조건 하나만 붙였을 때 추천되는지 봅니다.`,
        });
    }

    prompts.push({
        id: 'source-cite', kind: 'source', core: false, label: '출처 링크를 함께 받는 질문',
        text: `${question}해줘. 추천 근거로 삼은 글의 제목과 링크도 함께 알려줘.`,
        naver: null,
        naverNote: 'AI 브리핑 아래 출처 카드와, 같은 검색어 1페이지의 블로그·카페 글을 봅니다.',
        look: '링크 3~5개를 적어 두세요. 내 매장 정보가 빠졌거나 옛 내용인 글의 운영자에게 사실 정보 갱신을 요청하는 것이 가장 빠른 길입니다.',
    });

    const context = [area, place.category ? category : null].filter(Boolean).join(' ');
    const fanout = buildFanout(place, activity);
    const facts = ['location', 'hours', 'price', 'parking']
        .map((key) => fanout.find((item) => item.key === key))
        .filter((item) => item && item.answer)
        .map((item) => ({ label: FACT_LABELS[item.key], value: item.answer }));
    prompts.push({
        id: 'fact-info', kind: 'fact', core: false, label: '영업시간·가격·주차를 묻는 질문',
        text: `${name}${context ? `(${context})` : ''} 영업시간이랑 위치, 가격대, 주차 여부 알려줘. 확실하지 않은 건 모른다고 말해줘.`,
        naver: `${name} 영업시간`,
        look: 'AI가 말한 내용이 아래 실제 정보와 같은지 봅니다. 다르면 그 정보가 실린 출처 글부터 고칩니다.',
        facts,
    });
    prompts.push({
        id: 'fact-know', kind: 'fact', core: false, label: '내 매장을 아는지 묻는 질문',
        text: `${name}${context ? `(${context})` : ''} 어떤 곳이야? 대표 메뉴랑 특징을 알려줘.`,
        naver: name,
        look: '매장을 모르거나 다른 매장과 헷갈리면, 상호·주소·전화 표기를 여러 곳에 똑같이 올리는 일이 먼저입니다.',
    });

    prompts.push({
        id: 'follow-price', kind: 'followup', core: false, label: '가격·예약을 이어 묻는 질문',
        text: `${name} 가격대는 어느 정도고 예약은 어떻게 해?`,
        naver: null,
        naverNote: '네이버는 이어 묻기가 없어 건너뜁니다.',
        look: '추천 질문을 한 같은 대화에서 이어 묻습니다. 내 매장 정보로 답하는지, 다른 매장으로 넘어가는지 봅니다.',
    });
    prompts.push({
        id: 'follow-visit', kind: 'followup', core: false, label: '주차·마감 시간을 이어 묻는 질문',
        text: `${name} 주차 돼? 오늘 몇 시까지 해?`,
        naver: null,
        naverNote: '네이버는 이어 묻기가 없어 건너뜁니다.',
        look: '주차·마감 시간을 맞게 답하는지 봅니다. 모른다고 하면 플레이스에 그 정보를 글자로 등록하세요.',
    });

    return prompts;
}

const FACT_LABELS = { location: '위치', hours: '영업시간', price: '가격', parking: '주차·편의' };

// 그 AI에 넣을 글. 네이버는 문장 대신 검색어, 쓸 수 없는 질문이면 text 가 null 이고 note 에 대신 볼 곳을 적습니다.
export function promptFor(prompt, platformKey) {
    if (!prompt) return { text: null, note: null, keyword: false };
    if (platformKey !== 'naver') return { text: prompt.text, note: null, keyword: false };
    return { text: prompt.naver || null, note: prompt.naver ? null : prompt.naverNote || null, keyword: true };
}

// ---------------------------------------------------------------------------
// 붙여 넣은 답변 읽기
// ---------------------------------------------------------------------------

// place-geo.js 의 evaluateAnswerRank 와 같은 규칙으로 목록 항목을 나눕니다(그 함수는 순위만 돌려줘 항목 이름을 따로 읽습니다).
const NUMBER_MARK = /^(?:\d{1,2}\s*[.)|]|\d{1,2}\s*(?:순위|위)(?=[\s:.,)\-–—]|$)|\d{1,2}\s*번\s*[:.)]|[①-⑩]|\d️?⃣)/;
const BULLET_MARK = /^[-•*·▪●]\s+/;

function stripLineMarks(line) {
    return String(line).replace(/^[#>|\s]+/, '').replace(/^(?:\*\*|__)/, '').trim();
}

function listItems(body) {
    const lines = String(body).split(/\r?\n/);
    const numbered = lines.filter((line) => NUMBER_MARK.test(stripLineMarks(line))).length >= 2;
    const isItem = (line) => NUMBER_MARK.test(line) || (!numbered && BULLET_MARK.test(line));
    const items = [];
    let current = null;
    let gap = false;
    for (const raw of lines) {
        const line = stripLineMarks(raw);
        if (!line) {
            gap = true;
            continue;
        }
        if (isItem(line)) {
            if (current !== null) items.push(current);
            current = line;
        } else if (current !== null) {
            if (gap && !/^\s/.test(raw) && !BULLET_MARK.test(line)) {
                items.push(current);
                current = null;
            } else {
                current = `${current} ${line}`;
            }
        }
        gap = false;
    }
    if (current !== null) items.push(current);
    return items;
}

const NAME_MAX = 24;

function plain(text) {
    return String(text || '')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/https?:\/\/\S+/g, '')
        .replace(/[*_`#]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

// "1. **분석식당** - 곰탕 전문" → "분석식당"
function itemName(item) {
    let text = String(item).replace(NUMBER_MARK, '').replace(BULLET_MARK, '');
    text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/^[\s|.:)\-–—]+/, '');
    const bold = /^(?:\*\*|__)\s*(.+?)\s*(?:\*\*|__)/.exec(text);
    const head = bold ? bold[1] : text.split(/\s+[-–—:|]\s+|[:：|(（[]|\s{2,}/)[0];
    const name = plain(head).replace(/[.,·\s]+$/, '');
    if (!name) return null;
    return name.length > NAME_MAX ? `${name.slice(0, NAME_MAX - 1)}…` : name;
}

// 주소가 어떤 곳인지와, 그 출처에 사장님이 할 수 있는 일. 위에서부터 먼저 맞는 것을 씁니다.
const SOURCE_TYPES = [
    {
        type: 'place', label: '지도·플레이스',
        test: /(^|\.)(place|map|m\.place|pcmap\.place)\.naver\.com|naver\.me|google\.[a-z.]+\/maps|maps\.google|maps\.app\.goo\.gl|place\.map\.kakao\.com|kko\.to|bing\.com\/maps/,
        action: '직접 고칠 수 있는 곳입니다. 영업시간·메뉴·가격이 지금과 같은지 확인하세요.',
    },
    {
        type: 'cafe', label: '카페·커뮤니티',
        test: /cafe\.naver\.com|cafe\.daum\.net|reddit\.com|dcinside\.com|clien\.net|theqoo\.net|threads\.(net|com)/,
        action: '카페 규칙이 허용하면 매장 관계자임을 밝히고 사실 정보만 답글로 남기세요. 손님인 척하는 글은 안 됩니다.',
    },
    {
        type: 'blog', label: '블로그',
        test: /blog\.naver\.com|post\.naver\.com|tistory\.com|brunch\.co\.kr|velog\.io|medium\.com|wordpress\.com|blogspot\.com/,
        action: '글쓴이에게 사실 정보(메뉴·가격·영업시간) 갱신을 요청하세요. 초안의 "출처 글 수정 요청문"을 쓰면 됩니다.',
    },
    {
        type: 'video', label: '영상',
        test: /youtube\.com|youtu\.be|tv\.naver\.com/,
        action: '내 채널 영상이면 제목·설명란·자막의 매장 정보를 지금 기준으로 고치세요.',
    },
    {
        type: 'listing', label: '예약·리뷰 서비스',
        test: /catchtable|tabling|diningcode|mangoplate|siksinhot|tripadvisor|yanolja|goodchoice|modoodoc|goodoc|gangnamunni|foursquare|yelp\.com/,
        action: '매장 프로필의 소개·영업시간·메뉴를 지금 기준으로 고치세요.',
    },
    {
        type: 'news', label: '뉴스·매거진',
        test: /(^|\.)news\.|news\.naver\.com|chosun\.com|joongang\.co\.kr|donga\.com|hani\.co\.kr|mk\.co\.kr|hankyung\.com|yna\.co\.kr|newsis\.com/,
        action: '틀린 사실이 있으면 매체에 정정을 요청하세요.',
    },
];
const SOURCE_DEFAULT = { type: 'web', label: '웹 문서', action: '운영자에게 사실 정보 갱신을 요청하세요.' };
const SOURCE_MAX = 8;

// 글에서 출처 주소를 뽑아 종류를 붙입니다. placeId 를 주면 내 플레이스 주소에 mine 표시를 합니다.
export function extractSources(text, { placeId = null } = {}) {
    const found = String(text || '').match(/https?:\/\/[^\s<>"'`)\]]+/g) || [];
    const sources = [];
    const seen = new Set();
    for (const raw of found) {
        const url = raw.replace(/[.,;:!?]+$/, '');
        let host;
        try {
            host = new URL(url).hostname.replace(/^www\./, '');
        } catch {
            continue;
        }
        const key = url.replace(/[#?].*$/, '').replace(/\/$/, '');
        if (seen.has(key)) continue;
        seen.add(key);
        const kind = SOURCE_TYPES.find((entry) => entry.test.test(`${host}${new URL(url).pathname}`)) || SOURCE_DEFAULT;
        sources.push({
            url,
            host,
            type: kind.type,
            label: kind.label,
            action: kind.action,
            mine: Boolean(placeId) && url.includes(String(placeId)),
        });
        if (sources.length >= SOURCE_MAX) break;
    }
    return sources;
}

const QUOTE_MAX = 180;

// 붙여 넣은 AI 답변에서 순위·추천 순서·내 매장을 설명한 문장·출처를 읽습니다. 참고용 자동 판정입니다.
// rank: 1~5 | 'mention'(5위 밖) | 'none' | null(판정 불가) · listed: 추천 순서 [{ name, mine }] (순위와 어긋나게 읽히면 비움)
export function analyzeAnswer(text, aliases, { placeId = null } = {}) {
    const body = String(text || '');
    const rank = evaluateAnswerRank(body, aliases);
    const names = list(aliases).map(compact).filter((value) => value.length >= 2);
    const mentions = (value) => {
        const flat = compact(value);
        return names.some((name) => flat.includes(name));
    };
    const items = listItems(body);
    const index = items.slice(0, 10).findIndex(mentions);
    // 여기서 읽은 순서가 evaluateAnswerRank 의 판정과 같을 때만 추천 순서를 보여 줍니다(다르면 순위만 믿음).
    let parsed = null;
    if (body.trim() && names.length) parsed = !mentions(body) ? SOM_NONE : index >= 0 && index < 5 ? index + 1 : SOM_MENTION;
    const agree = rank !== null && parsed === rank;
    const listed = agree
        ? items.slice(0, 8).map((item) => ({ name: itemName(item), mine: mentions(item) })).filter((item) => item.name)
        : [];

    let quote = null;
    if (rank !== null && rank !== SOM_NONE) {
        const source = index >= 0 ? items[index] : body.split(/\r?\n/).map(stripLineMarks).find(mentions);
        // 주소를 지우고 남은 "- 출처:" 같은 꼬리는 뗍니다.
        const clean = plain(String(source || '').replace(NUMBER_MARK, '').replace(BULLET_MARK, ''))
            .replace(/(?:\s*[-–—·]\s*)?(?:출처|참고|링크)\s*:?\s*$/, '')
            .trim();
        if (clean) quote = clean.length > QUOTE_MAX ? `${clean.slice(0, QUOTE_MAX - 1)}…` : clean;
    }

    return {
        rank,
        label: rank === null ? '판정 불가' : somRankLabel(rank),
        points: rank === null ? null : somPoints(rank),
        listed,
        above: agree && Number.isInteger(rank) ? listed.filter((item) => !item.mine).slice(0, rank - 1).map((item) => item.name) : [],
        quote,
        sources: extractSources(body, { placeId }),
    };
}

// 순위에 따라 다음에 볼 곳. tab 은 GEO 화면의 탭 key 입니다.
export function rankAdvice(rank, platformKey) {
    const platform = PLATFORMS.find((p) => p.key === platformKey);
    const who = platform ? platform.short : '이 AI';
    if (rank === SOM_NONE) {
        return { tone: 'poor', tab: 'today', text: `${who}의 답에 내 매장이 없습니다. ${who}가 읽는 곳에 매장 정보가 올라가 있는지부터 확인하세요.`, cta: `${who} 통로 열기` };
    }
    if (rank === SOM_MENTION) {
        return { tone: 'fair', tab: 'drafts', text: '이름은 나오지만 앞쪽 다섯 곳 안에는 들지 못했습니다. 질문에 바로 답하는 글(질문형 제목 + 2~3줄 답 + 표)이 필요합니다.', cta: '답변 초안 보기' };
    }
    if (rank === 1) {
        return { tone: 'good', tab: null, text: '첫 번째로 추천됩니다. 가격·영업시간이 바뀌면 바로 고치고, 같은 질문으로 매주 다시 재세요.', cta: null };
    }
    if (Number.isInteger(rank)) {
        // 2~3위는 경고가 아니라 안내라 중립색으로 둡니다.
        return { tone: rank <= 3 ? 'unknown' : 'fair', tab: 'diagnosis', text: `${rank}번째로 추천됩니다. 위에 나온 매장에는 있고 내 매장에는 빠진 정보를 채우세요.`, cta: '부족한 항목 보기' };
    }
    return null;
}

// ---------------------------------------------------------------------------
// 실측 기록 → 점유율·추이·리포트
// history: [{ at: ISO 시각, results: [{ prompt, ranks: { naver, chatgpt, … } }] }] (GeoAeoPanel 의 저장 형식과 같음)
// ---------------------------------------------------------------------------

// 직전 기록을 지금 질문 순서에 맞춥니다. 질문 글이 같은 것끼리만 비교하고, 없던 질문은 빈 줄로 둡니다.
export function alignPrevious(results, previous) {
    const before = list(previous);
    if (before.length === 0) return null;
    return list(results).map((row) => before.find((old) => old.prompt === row.prompt) || { prompt: row.prompt, ranks: {} });
}

// sameCells: 지난 기록에서 이번에 잰 칸만 남겨 같은 칸끼리 비교합니다. 재는 중간(몇 칸만 넣은 상태)의 미리보기에 씁니다.
export function somOf(results, previous = null, { sameCells = false } = {}) {
    let before = alignPrevious(results, previous);
    if (before && sameCells) {
        const rows = list(results);
        before = before.map((row, index) => ({
            prompt: row.prompt,
            ranks: Object.fromEntries(Object.entries(row.ranks || {}).filter(([key]) => isSomRank(rows[index]?.ranks?.[key]))),
        }));
    }
    return shareOfModel(results, before);
}

// 재다 만 기록에 이어 넣기: 같은 질문은 새로 잰 칸만 덮어쓰고, 없던 질문은 뒤에 붙입니다. 재지 않은 칸은 건드리지 않습니다.
export function mergeResults(base, add) {
    const rows = list(base).map((row) => ({ prompt: row.prompt, ranks: { ...row.ranks } }));
    for (const row of list(add)) {
        const measured = Object.entries(row?.ranks || {}).filter(([, rank]) => isSomRank(rank));
        if (measured.length === 0) continue;
        const target = rows.find((item) => item.prompt === row.prompt);
        if (target) Object.assign(target.ranks, Object.fromEntries(measured));
        else rows.push({ prompt: row.prompt, ranks: { ...row.ranks } });
    }
    return rows;
}

function kstParts(iso) {
    const time = Date.parse(iso);
    if (!Number.isFinite(time)) return null;
    const date = new Date(time + 9 * 60 * 60 * 1000);
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

export function dayLabel(iso) {
    const parts = kstParts(iso);
    return parts ? `${parts.month}.${parts.day}` : '';
}

// 그 기록이 한국 시간으로 오늘 것인지
export function isToday(iso, nowMs = Date.now()) {
    const day = dayLabel(iso);
    return day !== '' && day === dayLabel(new Date(nowMs).toISOString()) && Math.abs(nowMs - Date.parse(iso)) < 36 * 60 * 60 * 1000;
}

// 차트용 점: 기록마다 종합 점유율과 AI별 점유율(재지 않은 AI는 null).
export function somTrend(history) {
    return list(history)
        .map((entry) => {
            const result = shareOfModel(entry.results);
            if (!result) return null;
            return {
                at: entry.at,
                label: dayLabel(entry.at),
                overall: result.overall,
                measured: result.measured,
                ...Object.fromEntries(result.platforms.map((platform) => [platform.key, platform.score])),
            };
        })
        .filter(Boolean);
}

// 대화의 트래커는 4시간마다 자동으로 쟀습니다. 사람 손으로는 주 1회를 권하고, 그 주기가 지났는지 알려 줍니다.
export const REMEASURE_DAYS = 7;

export function remeasureStatus(history, nowMs = Date.now()) {
    const last = list(history).slice(-1)[0] || null;
    const time = last ? Date.parse(last.at) : NaN;
    if (!Number.isFinite(time)) return { last: null, days: null, due: false };
    const days = Math.max(0, Math.floor((nowMs - time) / (24 * 60 * 60 * 1000)));
    return { last: last.at, days, due: days >= REMEASURE_DAYS };
}

function deltaText(value, unit) {
    if (value === null || value === undefined || value === 0) return '';
    return ` (${value > 0 ? '▲' : '▼'}${Math.abs(value)}${unit})`;
}

// 메모장·메신저에 붙여 넣는 글 리포트(대화의 텔레그램 리포트 형식).
export function somReportText(placeName, entry, previousEntry = null) {
    if (!entry) return '';
    const result = somOf(entry.results, previousEntry?.results);
    if (!result) return '';
    const parts = kstParts(entry.at);
    const lines = [
        `[AI 답변 점유율] ${placeName || '내 매장'}`,
        parts ? `측정일 ${parts.year}.${parts.month}.${parts.day}` : null,
        '',
    ];
    list(entry.results).forEach((row, index) => {
        const cells = result.cells.filter((cell) => cell.prompt === index);
        if (cells.length === 0) return;
        lines.push(`질문 ${index + 1}. ${row.prompt}`);
        for (const cell of cells) {
            const platform = PLATFORMS.find((p) => p.key === cell.platform);
            lines.push(`- ${platform.short}: ${somRankLabel(cell.rank)}${deltaText(cell.delta, '')} · ${cell.points}점`);
        }
        lines.push('');
    });
    lines.push(`종합 점유율 ${result.overall}%${deltaText(result.delta, '%p')} · ${result.measured}칸 측정`);
    for (const platform of result.platforms) {
        if (platform.score !== null) lines.push(`- ${platform.short} ${platform.score}%${deltaText(platform.delta, '%p')}`);
    }
    lines.push('', '사장님이 AI에 직접 물어 기록한 값입니다. AI 답은 물을 때마다 달라질 수 있습니다.');
    return lines.filter((line) => line !== null).join('\n');
}

// 모든 기록을 엑셀에서 열 수 있는 CSV 로. 한 줄 = 측정한 한 칸.
export function somCsv(history) {
    const rows = [];
    for (const entry of list(history)) {
        const when = Number.isFinite(Date.parse(entry.at)) ? formatDateTimeKST(entry.at) : '';
        for (const row of list(entry.results)) {
            for (const platform of PLATFORMS) {
                const rank = row?.ranks?.[platform.key];
                if (!isSomRank(rank)) continue;
                rows.push([when, row.prompt, platform.short, somRankLabel(rank), somPoints(rank)]);
            }
        }
    }
    return buildCsv(['측정일시', '질문', 'AI', '순위', '점수'], rows);
}
