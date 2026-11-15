// 오늘 시작하는 AI 노출 가이드 — AI마다 오늘 열 수 있는 통로를 사장님이 따라 할 순서로 정리한 순수 함수 모음.
//
// lib/place-geo.js 의 진단(몇 주짜리 로드맵)과 달리 "오늘 손댈 수 있는 일"만 다룹니다.
// 반영 시간은 이 파일에 숫자로 적지 않고 모두 lib/place-geo.js 에서 읽어 옵니다(전략 정리 후반 QA 정정값 · 검증 안 됨).
//  - AI 단위(탭·타임라인·다시 재는 날): PLATFORMS[].claim
//  - 전략 카드: 같은 일이 로드맵 단계에 있고 그 단계에 반영 시간(eta)이 적혀 있으면 그 값, 없으면 그 AI의 claim
// 전략 정리 초반의 "15분~6시간" 주장은 과장으로 정정됐으므로 쓰지 않습니다.
// 대화의 "댓글 하이재킹·자문자답·자막 하이재킹"은 매장 관계자임을 밝히고 사실만 쓰는 방식으로 바꿔 옮겼습니다.
// 손님인 척하는 글·여러 계정·반복 게시는 place-geo.js 의 GEO_DONTS 가 금지하는 방법이라 넣지 않고, 전략마다 주의사항으로 다시 적습니다.
// 네트워크 요청 없이 이미 받은 매장 정보만 씁니다.

import { placeHomeUrl } from './naver-place.js';
import {
    PLATFORMS, josa, placeArea, categoryLabel, targetQuestion, summarizeHours, buildFanout, buildAtomicAnswer,
    externalSteps, profileSites,
} from './place-geo.js';

const UNIT_MINUTES = { 분: 1, 시간: 60, 일: 1440, 주: 10080 };
const CLAIM_RANGE = /(즉시|\d+)\s*(분|시간|일|주)?\s*~\s*(\d+)\s*(분|시간|일|주)/;

// claim 글("이미 잡힌 글 수정은 즉시~24시간 · 새 글은 12~48시간")을 구간으로 나눕니다.
// range: 화면에 쓸 시간 글 · note: 그 구간의 조건 · min/max: 분(숫자로 읽을 수 없는 "수일" 같은 값은 null)
export function claimWindows(claim) {
    return String(claim || '').split('·').map((part) => part.trim()).filter(Boolean).map((text) => {
        const match = CLAIM_RANGE.exec(text);
        if (!match) return { text, range: text, note: '', min: null, max: null };
        const unit = UNIT_MINUTES[match[4]];
        const rest = `${text.slice(0, match.index)} ${text.slice(match.index + match[0].length)}`;
        return {
            text,
            range: match[0],
            note: rest.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[은는]$/, ''),
            min: match[1] === '즉시' ? 0 : Number(match[1]) * (UNIT_MINUTES[match[2]] || unit),
            max: Number(match[3]) * unit,
        };
    });
}

// 가이드의 AI 탭. 진단·로드맵과 같은 다섯 AI이고, 반영 시간(claim)도 그 표의 값을 그대로 씁니다.
export const QUICK_PLATFORMS = PLATFORMS.map((platform) => ({
    key: platform.key,
    label: platform.short,
    claim: platform.claim,
    windows: claimWindows(platform.claim),
}));

export const QUICK_DIFFICULTY = { easy: '쉬움', normal: '보통', hard: '어려움' };
// 체크 표시 id 앞머리. 화면은 GEO·AEO 체크리스트와 같은 저장소에 함께 저장합니다.
export const QUICK_CHECK_PREFIX = 'quick:';

// 로드맵에 같은 일이 있는 전략 → 그 단계 id. 단계에 반영 시간이 적혀 있으면 카드도 그 값을 씁니다.
// 이 표를 비우면 모든 카드가 AI의 claim 만 씁니다.
const ROADMAP_MIRROR = {
    'naver-collect': 'faqPage',
    'chatgpt-fetch': 'bingWebmaster',
    'chatgpt-news': 'press',
    'gemini-live': 'youtube',
    'gemini-gbp': 'gbp',
    'gemini-websub': 'searchConsole',
    'perplexity-post': 'faqPage',
};

function list(value) {
    return Array.isArray(value) ? value.filter(Boolean) : [];
}

function uniq(values) {
    return [...new Set(values.filter(Boolean))];
}

function kstDateText(nowMs) {
    return new Date(nowMs + 9 * 60 * 60 * 1000).toISOString().slice(0, 10).replace(/-/g, '.');
}

export function durationLabel(minutes) {
    if (!Number.isFinite(minutes) || minutes <= 0) return '즉시';
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    if (hours === 0) return `${rest}분`;
    return rest === 0 ? `${hours}시간` : `${hours}시간 ${rest}분`;
}

// '09:00' 에서 offset 분 뒤의 시각. 날을 넘기면 '다음 날'·'모레'·'N일 뒤'를 붙이고, 시작 시각을 읽지 못하면 09:00 으로 봅니다.
export function clockAt(start, offsetMinutes) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(start || ''));
    const base = match && Number(match[1]) < 24 && Number(match[2]) < 60 ? Number(match[1]) * 60 + Number(match[2]) : 9 * 60;
    const total = base + Math.max(0, Math.round(offsetMinutes || 0));
    const days = Math.floor(total / 1440);
    const hh = String(Math.floor((total % 1440) / 60)).padStart(2, '0');
    const mm = String(total % 60).padStart(2, '0');
    const day = days === 0 ? '' : days === 1 ? '다음 날 ' : days === 2 ? '모레 ' : `${days}일 뒤 `;
    return `${day}${hh}:${mm}`;
}

// 매장 정보로 확인되는 사실 [항목, 내용]. 댓글·표·보도자료 초안이 모두 같은 사실을 쓰게 합니다(모르는 항목은 넣지 않음).
function quickFacts(place) {
    const detail = place.detail || null;
    const subway = detail?.subway || null;
    const hours = summarizeHours(detail?.hours);
    const menus = uniq([...list(place.reviewMenus).map((m) => m.label), ...list(detail?.pos?.popularMenus).map((m) => m.name)]).slice(0, 3);
    const average = detail?.pos?.averagePrice?.total || null;
    const parking = detail?.parking || null;
    return [
        ['업종', categoryLabel(place)],
        place.address ? ['주소', place.address] : null,
        subway ? ['가까운 역', `${subway.station}${subway.exit ? ` ${subway.exit}번 출구` : ''}${subway.walkMinutes ? ` 도보 ${subway.walkMinutes}분` : ''}`] : null,
        hours ? ['영업시간', `${hours}${detail.hours.regularClosed ? ` (정기휴무 ${detail.hours.regularClosed})` : ''}`] : null,
        menus.length ? ['대표 메뉴', menus.join(', ')] : null,
        average ? ['1회 평균 결제', `약 ${Number(average).toLocaleString('ko-KR')}원 (최근 1주 네이버 결제 기준)`] : null,
        parking?.available ? ['주차', `가능${parking.free === true ? '(무료)' : parking.free === false ? '(유료)' : ''}`] : null,
        detail?.hasBooking === true ? ['예약', '네이버 예약 가능'] : null,
        list(place.paymentInfo).length ? ['결제', place.paymentInfo.slice(0, 4).join(', ')] : null,
    ].filter(Boolean);
}

// 공개 문서·블로그 글에 그대로 붙일 "스펙 표" 마크다운. 플레이스에 보이는 사실만 담고 평점·순위는 넣지 않습니다.
export function quickFactSheet(place, activity = null, { atomic, fanout, nowMs = Date.now() } = {}) {
    if (!place) return '';
    const fan = fanout || buildFanout(place, activity);
    const answer = atomic || buildAtomicAnswer(place, activity, fan);
    const cell = (text) => String(text).replace(/\|/g, '\\|');
    const lines = [
        `# ${place.name || '내 매장'} — ${targetQuestion(place)}`,
        '',
        answer.text,
        '',
        '| 항목 | 내용 |',
        '| --- | --- |',
        ...quickFacts(place).map(([label, value]) => `| ${label} | ${cell(value)} |`),
        `| 네이버 플레이스 | ${placeHomeUrl(place.placeId)} |`,
    ];
    const faq = answer.faq.slice(0, 5);
    if (faq.length) {
        lines.push('', '## 자주 묻는 질문');
        for (const item of faq) lines.push('', `**Q. ${item.question}**`, item.answer);
    }
    lines.push('', `_기준일 ${kstDateText(nowMs)} · 출처: 네이버 플레이스 등록 정보_`);
    return lines.join('\n');
}

const REDDIT_LABELS = { 주소: 'Address', '가까운 역': 'Nearest station', 영업시간: 'Hours', '대표 메뉴': 'Popular menu', 주차: 'Parking', 예약: 'Reservation' };
const COMMENT_FACTS = Object.keys(REDDIT_LABELS);
// 반영을 확인하는 때는 숫자로 적지 않고 하루 플랜의 '다시 재기'로 넘깁니다(그 시각은 claim 에서 계산).
const RECHECK = "하루 플랜의 '다시 재기' 때";

// 전략 목록. done: 사장님이 체크한 할 일 id(구글 비즈니스 프로필 등록 'gbp' 등)
// when: 'now' 지금 바로 할 수 있음 · 'prep' 준비가 필요함(needs 에 준비물)
// eta: 화면에 쓸 반영 시간 글 · etaFrom: 'step'(로드맵의 같은 단계 값) | 'ai'(그 AI의 claim)
export function buildQuickStrategies(place, activity = null, { atomic, fanout, done = [], nowMs = Date.now() } = {}) {
    if (!place) return [];
    const fan = fanout || buildFanout(place, activity);
    const answer = atomic || buildAtomicAnswer(place, activity, fan);
    const name = place.name || '내 매장';
    const area = placeArea(place);
    const category = categoryLabel(place);
    const question = targetQuestion(place);
    const detail = place.detail || null;
    const links = list(detail?.links);
    const facts = quickFacts(place);
    const menu = list(place.reviewMenus)[0]?.label || list(detail?.pos?.popularMenus)[0]?.name || null;
    const hasSite = links.some((link) => /홈페이지|website/i.test(link));
    const hasBlog = Boolean(place.hasBlog) || links.some((link) => /블로그|blog/i.test(link));
    const hasYoutube = links.some((link) => /유튜브|youtube/i.test(link));
    const hasGbp = list(done).includes('gbp');
    const sheet = quickFactSheet(place, activity, { atomic: answer, fanout: fan, nowMs });
    const faq = answer.faq.slice(0, 3);
    const faqText = faq.map((item) => `Q. ${item.question}\nA. ${item.answer}`).join('\n\n');
    const lead = answer.text.match(/^.*?[.!?](?=\s|$)/)?.[0] || answer.text;
    const commentFacts = facts.filter(([label]) => COMMENT_FACTS.includes(label));
    const feature = detail?.parking?.available ? '주차 되는' : detail?.hasBooking === true ? '예약 되는' : '지금 영업 중인';
    const year = kstDateText(nowMs).slice(0, 4);
    const sites = profileSites(place.category).join('·');
    const stepEta = Object.fromEntries(externalSteps(place, activity).filter((step) => step.eta).map((step) => [step.id, step.eta]));

    const drafts = {
        feed: [
            '[제목]',
            `${question}? ${name} ${menu ? `${menu}·` : ''}위치·영업시간 안내`,
            '',
            '[본문]',
            answer.text,
            ...(faqText ? ['', faqText] : []),
        ].join('\n'),
        cafe: [
            `안녕하세요, ${name} 사장입니다(매장 관계자입니다).`,
            '질문하신 내용에 맞춰 저희 매장의 사실 정보만 남깁니다.',
            ...commentFacts.map(([label, value]) => `- ${label}: ${value}`),
            `다른 곳과 비교하실 때 참고하세요. 네이버 지도에서 "${name}" 검색 시 메뉴·가격을 확인하실 수 있습니다.`,
        ].join('\n'),
        longTail: uniq([
            `${area ? `${area}에서 ` : ''}${menu ? `${menu} 잘하고 ` : ''}${feature} ${category} 알려줘. 출처 링크도 같이 보여줘.`,
            `${name} 영업시간이랑 가격대 알려줘.`,
            `${question} — 근거가 되는 글도 같이 알려줘.`,
        ]).join('\n'),
        reddit: [
            `Disclosure: I'm the owner of ${name} (${category}${area ? `, near ${area}` : ''}).`,
            'Just the facts so you can compare:',
            ...commentFacts.map(([label, value]) => `- ${REDDIT_LABELS[label]}: ${value}`),
            'Happy to answer any questions.',
            '',
            '(값은 영어로 옮겨 적으세요. 매장명은 한글·영문을 함께 쓰면 찾기 쉽습니다.)',
        ].join('\n'),
        press: [
            `[제목] ${area ? `${area} ` : ''}${category} '${name}', ○○(새 메뉴·행사·수치 등 새 소식) 발표`,
            `[첫 문단] ${answer.text}`,
            '[본문에 넣을 사실]',
            ...facts.map(([label, value]) => `- ${label}: ${value}`),
            '[빠지면 안 되는 것] 새 소식의 날짜·수치·문의처. 확인할 수 없는 순위·과장 표현은 쓰지 않습니다.',
        ].join('\n'),
        live: [
            `[제목] ${question}? ${name} 3분 정리`,
            `[설명란 첫 줄] ${lead}`,
            '',
            '[대본]',
            answer.text,
            ...faq.map((item) => `${item.question} ${item.answer}`),
        ].join('\n'),
        gbp: [
            `Q. ${question} 찾는데, ${josa(name, '은', '는')} 어떤 곳인가요?`,
            `A. ${answer.text}`,
            ...(faqText ? ['', faqText] : []),
        ].join('\n'),
        profile: [
            `상호: ${name}`,
            ...facts.map(([label, value]) => `${label}: ${value}`),
            `네이버 플레이스: ${placeHomeUrl(place.placeId)}`,
        ].join('\n'),
    };

    const items = [
        // ── 네이버 AI ──
        {
            id: 'naver-feed', platform: 'naver', short: '새소식', ready: true,
            title: "스마트플레이스 '새소식'을 타겟 질문 제목으로 올리기",
            difficulty: 'easy', effortMinutes: 20,
            why: '소식은 플레이스 안에서 바로 발행돼 네이버가 가장 먼저 읽는 최신 글입니다. 질문형 제목과 두괄식 답이 AI 브리핑·검색 요약의 재료가 됩니다.',
            steps: [
                `스마트플레이스 앱(또는 관리자) → '소식' → 새 소식 쓰기. 제목에 "${question}"을 그대로 넣습니다.`,
                '본문 첫 문단에 아래 초안(원자 답변)을 붙이고 자주 묻는 질문 2~3개를 문답으로 적습니다. 메뉴·가격·영업시간은 오늘 기준으로 확인하세요.',
                `${RECHECK} 네이버에서 "${question}"을 검색해 AI 브리핑·플레이스 소식에 반영됐는지 확인하고 순위를 기록합니다.`,
            ],
            cautions: [
                '"최고·1위·역대급" 같은 표현은 빼세요. 광고 문구는 AI 요약에 쓰이지 않습니다.',
                "업종에 따라 '문의·Q&A' 메뉴가 있으면 같은 문답을 올리되, 손님인 척 질문을 지어내지 마세요.",
            ],
            draft: { label: '소식 제목·본문 초안', text: drafts.feed },
        },
        {
            id: 'naver-cafe', platform: 'naver', short: '카페 답글', ready: true,
            title: '검색 상위 카페 질문글에 사장님 답글 달기',
            difficulty: 'normal', effortMinutes: 30,
            why: '네이버 AI 브리핑은 카페 글과 댓글도 출처로 씁니다. 이미 검색 상위에 있는 질문글은 새 글보다 빨리 다시 읽힙니다(추정).',
            steps: [
                `네이버에서 "${question}"을 검색해 카페 영역 상위의 추천 요청 글 2~3개를 고릅니다. 카페 규칙에서 업체 답글이 허용되는지 먼저 확인하세요.`,
                `"${name} 사장입니다"라고 밝히고 아래 초안처럼 위치·영업시간·대표 메뉴·주차 같은 비교 기준 사실만 답글로 답니다. 글 하나에 답글 하나만 답니다.`,
                `${RECHECK} 같은 질문을 네이버에 다시 검색해 AI 브리핑·카페 영역을 확인하고 순위를 기록합니다.`,
            ],
            cautions: [
                '손님인 척하거나 여러 계정으로 추천 댓글을 달면 기만 광고(표시광고법)·카페 강퇴 대상입니다. 반드시 매장 관계자임을 밝히세요.',
                '경쟁 매장을 깎아내리는 비교는 금지입니다. 홍보 금지 카페는 건너뛰고, 제휴·홍보 게시판이 있으면 그곳을 쓰세요.',
            ],
            draft: { label: '카페 답글 초안', text: drafts.cafe },
        },
        {
            id: 'naver-collect', platform: 'naver', short: '수집 요청', ready: hasSite,
            title: '질문형 글 발행 → 서치어드바이저 수집 요청 + 내 인기 글에 링크',
            difficulty: 'normal', effortMinutes: 40,
            needs: '소유 확인이 되는 홈페이지(내 도메인·티스토리·워드프레스 등). 네이버 블로그만 있다면 블로그 글로 발행하세요(자동 수집).',
            why: '새 글은 검색 로봇이 찾아올 때까지 기다려야 합니다. 수집 요청과, 이미 자주 수집되는 내 글에서 거는 링크가 그 시간을 줄입니다.',
            steps: [
                `홈페이지·블로그에 제목 "${question}" 글을 발행합니다. 첫 문단은 원자 답변, 그 아래에 스펙 표(아래 초안)를 넣습니다.`,
                "네이버 서치어드바이저 → 요청 → '웹 페이지 수집'에 새 글 주소를 넣습니다.",
                '방문이 많은 내 기존 글(블로그 인기 글·홈페이지 첫 화면) 본문에 새 글 링크를 한 줄 추가합니다. 수집됐는지는 네이버에서 글 제목으로 검색해 확인합니다(수집과 AI 답변 반영은 다릅니다).',
            ],
            cautions: [
                '수집 요청은 "빨리 읽어 달라"는 요청일 뿐 노출을 보장하지 않습니다.',
                '같은 글을 여러 사이트에 복사하거나 지역명만 바꾼 글을 여러 개 만들면 저품질·스팸으로 처리됩니다.',
            ],
            draft: { label: '글에 붙일 스펙 표(마크다운)', text: sheet },
        },
        // ── ChatGPT ──
        {
            id: 'chatgpt-fetch', platform: 'chatgpt', short: '봇 길 열기', ready: hasSite,
            title: 'ChatGPT 검색 봇 길 열기 + 초구체 질문으로 읽히는지 확인',
            difficulty: 'normal', effortMinutes: 15,
            needs: 'robots.txt를 고칠 수 있는 내 홈페이지',
            why: 'ChatGPT 검색은 Bing 색인과 자체 봇(OAI-SearchBot)을 함께 쓰고, 답할 때 글을 다시 읽습니다(ChatGPT-User). 봇이 막혀 있으면 좋은 글도 인용되지 않습니다.',
            steps: [
                '홈페이지 robots.txt가 OAI-SearchBot·ChatGPT-User·Bingbot을 막고 있지 않은지 확인합니다.',
                "Bing 웹마스터 도구의 'URL 제출'(호스팅이 지원하면 IndexNow)로 새 글 주소를 보냅니다.",
                'ChatGPT에서 검색을 켜고 아래 초구체 질문을 물어 출처에 내 글이 뜨는지 봅니다. 안 뜨면 글 주소를 붙여 "이 페이지 기준으로 알려줘"라고 해 읽히는지(차단 여부) 확인합니다.',
            ],
            cautions: [
                '같은 질문을 반복한다고 색인·순위가 오른다는 근거는 없습니다(대화의 주장, 미검증). 확인용으로 1~2번만 물으세요.',
                '여러 계정이나 자동 프로그램으로 질문을 반복하는 것은 이용약관 위반입니다.',
            ],
            draft: { label: 'ChatGPT에 물어볼 초구체 질문', text: drafts.longTail },
        },
        {
            id: 'chatgpt-reddit', platform: 'chatgpt', short: '레딧 답글', ready: false,
            title: '이미 노출된 레딧 스레드에 사장님 답글(외국인 손님 매장)',
            difficulty: 'hard', effortMinutes: 30,
            needs: '활동 이력이 있는 레딧 계정과 영어 답글. 외국인 손님이 찾는 매장일 때만 의미가 있습니다.',
            why: 'ChatGPT 검색은 레딧 글을 자주 인용합니다. 이미 색인된 스레드의 새 댓글은 새 글보다 빨리 읽힙니다(추정).',
            steps: [
                '구글·Bing에서 "site:reddit.com"과 지역·업종의 영어 표현을 함께 검색해 상위에 있는 추천 요청 스레드를 찾습니다.',
                '서브레딧 규칙(자기 홍보 제한)을 확인하고, 매장 주인임을 밝힌 뒤 위치·영업시간·대표 메뉴를 영어로 답글합니다(아래 초안).',
                `${RECHECK} ChatGPT 검색에 영어로 같은 질문을 물어 확인합니다.`,
            ],
            cautions: [
                '가입 직후 계정의 홍보 댓글은 자동 삭제·차단되기 쉽습니다. 손님인 척 추천하는 글은 금지입니다.',
                '국내 손님 위주 매장은 효과가 거의 없으니 건너뛰세요.',
            ],
            draft: { label: '레딧 답글 틀(영어)', text: drafts.reddit },
        },
        {
            id: 'chatgpt-news', platform: 'chatgpt', short: '보도자료', ready: false,
            title: '보도자료 배포(뉴스 와이어)로 Bing 뉴스에 싣기',
            difficulty: 'hard', effortMinutes: 60,
            needs: '유료 보도자료 배포 서비스와, 기사가 될 만한 새 소식(새 메뉴·이전·행사·수치)',
            why: '언론사 기사는 Bing 뉴스에 색인되고 ChatGPT 검색이 사실 확인용 출처로 자주 씁니다(추정).',
            steps: [
                '새 소식 하나를 정해 아래 틀로 보도자료를 씁니다. 제목에 지역·업종·매장명을 넣고 수치는 확인되는 것만 씁니다.',
                '보도자료 배포 서비스에 접수합니다. 포털·Bing 뉴스에 실리는 매체가 포함된 상품인지 확인하세요.',
                `기사가 실리면 주소를 플레이스 소식·홈페이지에 공유하고, ${RECHECK} ChatGPT 검색으로 확인합니다.`,
            ],
            cautions: [
                '배포 서비스 심사 때문에 접수 당일 실리지 않을 수 있습니다. 새 소식이 없으면 건너뛰세요.',
                '근거 없는 순위·과장 표현과 경쟁 매장 비방은 부당 광고입니다. 기사형 광고는 광고 표기 규정을 지키세요.',
            ],
            draft: { label: '보도자료 틀', text: drafts.press },
        },
        // ── Gemini ──
        {
            id: 'gemini-live', platform: 'gemini', short: '유튜브 자막', ready: hasYoutube,
            title: '유튜브 라이브(또는 짧은 영상)로 자막에 답변 문장 남기기',
            difficulty: 'normal', effortMinutes: 30,
            needs: '이미 운영 중인 유튜브 채널(새 채널은 반영이 느립니다). 라이브는 전화번호 인증 후 첫 활성화에 최대 24시간이 걸려, 처음이면 일반 영상 업로드로 대신하세요.',
            why: 'Gemini·구글 AI 개요는 유튜브 제목·설명란·자막을 읽습니다. 방송이 끝나면 다시보기에 자동 자막이 붙어 말한 문장이 그대로 글이 됩니다.',
            steps: [
                `제목을 "${question}? ${name} 3분 정리"로 하고 설명란 첫 줄에 매장명·위치·대표 메뉴를 적어 3~5분 라이브를 켭니다.`,
                '아래 대본을 또박또박 읽습니다. 화면은 실제 매장·메뉴를 찍은 영상을 쓰세요.',
                `종료 후 다시보기를 공개로 두고 자동 자막의 매장명·가격 오타를 고칩니다. ${RECHECK} 구글·Gemini에서 확인합니다.`,
            ],
            cautions: [
                '정지 화면에 같은 음성만 반복하는 방송을 여러 번 올리면 유튜브 스팸·반복 콘텐츠 정책에 걸립니다. 한 번, 실제 화면으로 하세요.',
                '자동 자막은 매장명·숫자를 자주 틀립니다. 직접 고친 자막이 더 확실합니다.',
            ],
            draft: { label: '라이브 제목·대본', text: drafts.live },
        },
        {
            id: 'gemini-gbp', platform: 'gemini', short: '구글 문답', ready: hasGbp,
            title: '구글 비즈니스 프로필에 자주 받는 질문·답 올리기',
            difficulty: 'easy', effortMinutes: 15,
            needs: "인증이 끝난 구글 비즈니스 프로필. 인증까지 마쳤다면 '로드맵' 탭의 '구글 비즈니스 프로필 등록·인증 신청'을 체크하세요. 이 전략이 '지금 바로'로 옮겨집니다.",
            why: '구글 지도 프로필은 Gemini가 매장 정보를 가져오는 첫 통로입니다. 소유자가 올린 문답·업데이트는 프로필 안에서 바로 발행됩니다.',
            steps: [
                `구글 지도에서 내 매장 프로필을 열어 'Q&A'에 손님이 실제로 자주 묻는 질문을 "${question}" 표현을 넣어 등록합니다.`,
                '소유자 계정으로 바로 답합니다(아래 초안). 사실만 쓰고 가격·영업시간은 오늘 기준으로 맞춥니다.',
                `Q&A가 안 보이는 프로필이면 '업데이트(게시물)'에 같은 문답을 올립니다. ${RECHECK} Gemini에서 확인합니다.`,
            ],
            cautions: [
                '구글이 Q&A 기능을 줄이고 있어 프로필·지역에 따라 메뉴가 없을 수 있습니다. 그때는 업데이트 게시물이 대안입니다.',
                "여러 계정으로 질문을 지어내거나 '좋아요'를 누르는 것은 구글 정책 위반입니다. 실제로 받는 질문만 올리세요.",
            ],
            draft: { label: '질문·답 초안', text: drafts.gbp },
        },
        {
            id: 'gemini-websub', platform: 'gemini', short: 'WebSub 핑', ready: hasSite || hasBlog,
            title: 'WebSub 허브에 새 글 알리기 + 서치 콘솔 색인 요청',
            difficulty: 'normal', effortMinutes: 10,
            needs: 'RSS·사이트맵이 있는 홈페이지나 블로그',
            why: '구글은 WebSub 허브로 "피드에 새 글이 생겼다"는 알림을 받습니다. 로봇이 다시 올 때까지 기다리는 시간을 줄입니다(추정).',
            steps: [
                '새 글이 RSS(또는 사이트맵)에 들어갔는지 확인합니다. 네이버 블로그·티스토리·워드프레스에는 RSS 주소가 있습니다.',
                "pubsubhubbub.appspot.com 의 'Publish' 칸에 RSS 주소를 넣고 보냅니다.",
                "내 도메인이라면 구글 서치 콘솔 'URL 검사 → 색인 생성 요청'도 함께 합니다. 색인됐는지는 구글에서 글 제목으로 검색해 확인합니다(색인과 AI 답변 반영은 다릅니다).",
            ],
            cautions: [
                '핑은 알림일 뿐 색인·노출을 보장하지 않습니다. 새 글이 없는데 반복해서 보내도 효과가 없습니다.',
            ],
            draft: null,
        },
        // ── Claude: 이미 잡힌 글 수정(claim 첫 구간) · 새 글(claim 둘째 구간) ──
        {
            id: 'claude-refresh', platform: 'claude', short: '내 글 고치기', ready: hasSite || hasBlog, windowIndex: 0,
            title: '이미 검색에 잡힌 내 글 본문을 지금 고치기',
            difficulty: 'easy', effortMinutes: 20,
            needs: 'Brave·구글에 이미 잡혀 있는 내 블로그·홈페이지·노션·서브스택 글',
            why: 'Claude는 Brave 검색 결과의 글을 답하는 순간 다시 읽는다는 것이 전략 정리의 설명입니다. 그래서 새 글을 올리는 것보다 이미 검색에 잡힌 글을 고치는 편이 빠릅니다(추정).',
            steps: [
                `Brave Search(search.brave.com)에서 "${question}"과 매장명을 검색해 내가 고칠 수 있는 글이 상위에 있는지 찾습니다.`,
                '그 글 맨 위에 원자 답변과 스펙 표(아래 초안)를 넣고 수정 날짜를 적습니다. 옛 가격·영업시간은 지웁니다.',
                `Claude에 "${question}"을 물어 인용 문장이 바뀌었는지 확인합니다. 바로 안 바뀌면 ${RECHECK} 다시 봅니다.`,
            ],
            cautions: [
                '남의 글은 고칠 수 없습니다. 운영자에게 사실 정정만 요청하고, 대가가 있으면 광고 표기가 필요합니다.',
                '상위에 잡힌 내 글이 없으면 효과가 없습니다. 그때는 공개 문서 만들기부터 하세요.',
            ],
            draft: { label: '글 맨 위에 넣을 요약·스펙 표', text: sheet },
        },
        {
            id: 'claude-gist', platform: 'claude', short: '공개 문서', ready: true, windowIndex: 1,
            title: '스펙 표를 공개 마크다운 문서(GitHub Gist·노션)로 올리기',
            difficulty: 'normal', effortMinutes: 20,
            why: 'Claude는 광고 문구 없이 표로 정리된 건조한 사실을 고른다는 것이 전략 정리의 설명입니다. 새 글이라 이미 잡힌 글을 고치는 것보다 늦게 반영됩니다.',
            steps: [
                '아래 마크다운 초안을 복사해 GitHub Gist(공개) 또는 노션 공개 페이지에 올립니다. 제목·파일 이름에 지역과 업종을 넣고, 첫 줄에 매장이 직접 정리한 자료임을 적습니다.',
                '공개 저장소·블로그처럼 피드(RSS·Atom)가 있는 곳에 올렸다면 WebSub 허브(pubsubhubbub.appspot.com)에 피드 주소를 한 번 알립니다. Gist만 올렸다면 건너뜁니다.',
                `${RECHECK} Brave Search에서 매장명으로 잡혔는지 보고 Claude에 질문해 확인합니다.`,
            ],
            cautions: [
                '문서는 매장당 1개만 만드세요. 같은 내용을 여러 개 올리면 스팸으로 처리되고 GitHub 이용약관(홍보용 대량 게시 금지)에도 어긋납니다.',
                '플레이스에 보이는 사실과 똑같이 쓰세요. 화면에 없는 평점·순위는 넣지 않고, 제3자가 검증한 자료처럼 꾸미지 않습니다.',
            ],
            draft: { label: '공개 문서 초안(마크다운)', text: sheet },
        },
        // ── Perplexity ──
        {
            id: 'perplexity-post', platform: 'perplexity', short: '요약·표 글', ready: hasSite || hasBlog,
            title: '질문형 글 1개를 Perplexity가 인용하기 쉬운 모양으로 올리기',
            difficulty: 'normal', effortMinutes: 30,
            needs: '글을 올릴 블로그나 홈페이지(네이버 블로그도 됩니다)',
            why: 'Perplexity는 최근에 쓰이거나 고쳐진 글, 글 맨 위 2~3줄 요약, 표를 그대로 인용하는 편이라는 것이 전략 정리의 설명입니다. 답변마다 출처 번호가 붙어 내 글이 쓰였는지 바로 볼 수 있습니다.',
            steps: [
                `제목을 "${question} (${year}년 기준)"처럼 손님이 묻는 말 그대로 쓰고, 글 맨 위 2~3줄에 아래 초안의 첫 문단(원자 답변)을 넣습니다. 오늘 올린 질문형 글이 있으면 그 글을 다듬어도 됩니다.`,
                '그 아래에 스펙 표와 자주 묻는 질문을 붙이고 글 끝에 최종 수정일을 적습니다. 가격·영업시간은 오늘 기준으로 확인하세요.',
                `Perplexity에 "${question}"을 물어 답변의 [1]·[2] 출처에 어떤 글이 쓰였는지 적어 두고, ${RECHECK} 내 글이 출처에 들어왔는지 확인합니다.`,
            ],
            cautions: [
                '내용은 그대로 두고 날짜만 바꾸지 마세요. 정보가 바뀔 때 본문과 수정일을 함께 고칩니다.',
                '같은 글을 여러 사이트에 복사해 올리면 유사 문서로 처리됩니다. 홈페이지라면 robots.txt가 PerplexityBot을 막지 않는지도 확인하세요.',
            ],
            draft: { label: '글에 넣을 요약·스펙 표(마크다운)', text: sheet },
        },
        {
            id: 'perplexity-profiles', platform: 'perplexity', short: '매장 페이지', ready: true,
            title: `${sites}의 매장 정보를 오늘 기준으로 맞추기`,
            difficulty: 'easy', effortMinutes: 30,
            why: 'AI는 업종별 예약·리뷰 서비스의 매장 페이지도 출처로 가져온다는 것이 전략 정리의 설명입니다. 홈페이지나 블로그가 없어도 할 수 있습니다.',
            steps: [
                `${sites}에서 매장을 검색해 내 매장 페이지가 있는지 확인합니다. 없으면 무료 등록부터 합니다.`,
                '상호·주소·전화·영업시간·대표 메뉴를 네이버 플레이스와 한 글자까지 똑같이 맞춥니다(아래 사실 목록을 그대로 옮기세요).',
                `Perplexity에 "${name} 영업시간이랑 가격대 알려줘"를 물어 옛 정보가 나오면 그 출처 글을 적어 둡니다. ${RECHECK} 다시 확인합니다.`,
            ],
            cautions: [
                '서비스마다 상호 띄어쓰기·전화번호 표기가 다르면 AI가 다른 매장으로 볼 수 있습니다.',
                '리뷰를 부탁하면서 대가를 주거나 별점·문구를 정해 주지 마세요.',
            ],
            draft: { label: '옮겨 적을 매장 사실', text: drafts.profile },
        },
    ];

    const windowsOf = Object.fromEntries(QUICK_PLATFORMS.map((platform) => [platform.key, platform.windows]));
    return items.map(({ ready, needs, windowIndex = 0, ...item }) => {
        const windows = windowsOf[item.platform] || [];
        const fromAi = windows[windowIndex] || windows[0] || null;
        const fromStep = stepEta[ROADMAP_MIRROR[item.id]] || null;
        return {
            ...item,
            when: ready ? 'now' : 'prep',
            needs: ready ? null : needs || null,
            windowIndex: windows[windowIndex] ? windowIndex : 0,
            eta: fromStep || fromAi?.range || null,
            etaFrom: fromStep ? 'step' : 'ai',
            difficultyLabel: QUICK_DIFFICULTY[item.difficulty],
            stepIds: item.steps.map((_, i) => `${QUICK_CHECK_PREFIX}${item.id}:${i + 1}`),
        };
    });
}

// 가로 타임라인: AI마다 "일을 끝낸 뒤 답변에 반영되기까지"의 구간(claim)을 한 시간 축 위에 막대로 놓습니다.
// 눈금은 claim 에 나온 시각만 모아 만들므로 claim 이 바뀌면 축도 따라 바뀝니다. 숫자로 읽을 수 없는 구간("수일")은 맨 끝 열린 칸에 둡니다.
// from/to 는 막대가 놓일 칸의 시작·끝 선 번호(1부터)입니다.
export function buildQuickTimeline(platforms = QUICK_PLATFORMS) {
    const rows = list(platforms).flatMap((platform) => list(platform.windows).map((window, index) => ({
        key: `${platform.key}-${index}`,
        platform: platform.key,
        label: platform.label,
        note: window.note,
        range: window.range,
        min: window.min,
        max: window.max,
        windowIndex: index,
    })));
    const points = [...new Set(rows.filter((row) => row.max !== null).flatMap((row) => [row.min, row.max]))].sort((a, b) => a - b);
    const open = rows.some((row) => row.max === null);
    const columns = Math.max(points.length - 1, 0) + (open ? 1 : 0);
    return {
        ticks: points.map((minutes) => ({ minutes, label: durationLabel(minutes) })),
        open,
        columns,
        rows: rows.map((row) => (row.max === null
            ? { ...row, from: columns, to: columns + 1 }
            : { ...row, from: points.indexOf(row.min) + 1, to: points.indexOf(row.max) + 1 })),
    };
}

// 하루 플랜 순서: 재료가 되는 글부터 만들고(소식·질문형 글) 그 글을 다듬고 알리는 일(요약·핑·봇)을 바로 뒤에 둡니다.
const ONE_DAY_ORDER = [
    'naver-feed', 'naver-collect', 'perplexity-post', 'gemini-websub', 'chatgpt-fetch', 'claude-refresh', 'claude-gist',
    'perplexity-profiles', 'gemini-gbp', 'gemini-live', 'naver-cafe', 'chatgpt-reddit', 'chatgpt-news',
];

// 하루 플랜: 기준점 기록 → 재료 맞추기 → 지금 바로 되는 통로 → 준비가 필요한 통로 → 다시 재기.
// offset 은 시작 시각부터의 분입니다. 다시 재는 날은 AI의 claim 끝 시각(24시간·48시간…)에서 계산하고,
// 숫자로 읽을 수 없는 AI("수일")는 later 에 모아 로드맵의 주간 측정으로 넘깁니다.
export function buildOneDayPlan(strategies, platforms = QUICK_PLATFORMS) {
    const byId = new Map(list(strategies).map((strategy) => [strategy.id, strategy]));
    const ordered = ONE_DAY_ORDER.map((id) => byId.get(id)).filter(Boolean);
    const queue = [...ordered.filter((strategy) => strategy.when === 'now'), ...ordered.filter((strategy) => strategy.when !== 'now')];
    const blank = { platform: null, strategyId: null, when: 'now', eta: null };
    const count = list(platforms).length;
    const steps = [];
    let clock = 0;
    const push = (step) => {
        steps.push({ ...blank, ...step, offset: clock });
        clock += step.minutes;
    };
    push({
        id: 'day-measure', kind: 'measure', minutes: 15, checkIds: [`${QUICK_CHECK_PREFIX}day-measure`],
        title: `기준점 기록 — AI ${count}곳에 같은 질문을 물어 지금 순위 적어 두기`,
        detail: "바꾸기 전 점수가 있어야 다시 잴 때 ▲▼를 볼 수 있습니다. 'AI 답변 실측' 탭에 기록하세요.",
    });
    push({
        id: 'day-material', kind: 'material', minutes: 20, checkIds: [`${QUICK_CHECK_PREFIX}day-material`],
        title: '공통 재료 맞추기 — 원자 답변·스펙 표의 가격·영업시간을 오늘 기준으로 확인',
        detail: '아래 모든 통로에 같은 사실을 씁니다. 한 번 맞춰 두면 복사해 붙이기만 하면 됩니다.',
    });
    for (const strategy of queue) {
        push({
            id: `day-${strategy.id}`, kind: 'strategy', minutes: strategy.effortMinutes, checkIds: strategy.stepIds,
            platform: strategy.platform, strategyId: strategy.id, when: strategy.when,
            title: strategy.title,
            detail: `난이도 ${strategy.difficultyLabel}`,
            eta: strategy.eta,
        });
    }
    const workMinutes = clock;
    const nowMinutes = steps.filter((step) => step.when === 'now').reduce((sum, step) => sum + step.minutes, 0);
    const base = Math.ceil(workMinutes / 30) * 30;
    const windows = list(platforms).flatMap((platform) => list(platform.windows).map((window) => ({
        label: window.note && platform.windows.length > 1 ? `${platform.label}(${window.note})` : platform.label,
        days: window.max === null ? null : Math.max(1, Math.ceil(window.max / 1440)),
    })));
    const later = uniq(windows.filter((window) => window.days === null).map((window) => window.label));
    const days = [...new Set(windows.filter((window) => window.days !== null).map((window) => window.days))].sort((a, b) => a - b);
    days.forEach((day, index) => {
        const last = index === days.length - 1;
        const targets = windows.filter((window) => window.days === day).map((window) => window.label);
        steps.push({
            ...blank, id: `day-remeasure${index + 1}`, kind: 'remeasure', minutes: 15, offset: base + day * 1440,
            checkIds: [`${QUICK_CHECK_PREFIX}day-remeasure${index + 1}`],
            title: `${index + 1}차 다시 재기 — ${targets.join('·')} 확인`,
            detail: [
                `작업을 끝내고 ${day * 24}시간 뒤입니다(이 AI들의 반영 시간 끝). 같은 질문을 같은 방식으로 물어야 비교가 됩니다. 틀린 정보가 나오면 그 출처 글부터 고치세요.`,
                last && later.length ? `${later.join('·')}처럼 더 오래 걸리는 AI와 아직 오르지 않은 AI는 '로드맵' 탭의 주간 측정 때 다시 봅니다.` : null,
            ].filter(Boolean).join(' '),
        });
    });
    const end = steps[steps.length - 1];
    return { steps, workMinutes, nowMinutes, later, endOffset: end.offset + end.minutes };
}

// AI별 요약: 지금 바로 할 수 있는 전략 수·끝낸 전략 수. checked: 체크한 단계 id
export function quickSummary(strategies, checked = []) {
    const on = new Set(list(checked));
    return QUICK_PLATFORMS.map((platform) => {
        const mine = list(strategies).filter((strategy) => strategy.platform === platform.key);
        const now = mine.filter((strategy) => strategy.when === 'now').length;
        return {
            ...platform,
            total: mine.length,
            now,
            prep: mine.length - now,
            done: mine.filter((strategy) => strategy.stepIds.every((id) => on.has(id))).length,
        };
    });
}
