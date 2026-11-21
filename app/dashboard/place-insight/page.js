'use client';

import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import {
    AlertCircle, ArrowUpRight, ArrowUpToLine, BadgeCheck, BookmarkCheck, BookmarkPlus, CalendarCheck, Check, CheckCircle2,
    ChevronDown, ChevronRight, Copy, CreditCard, Info, KeyRound, Lightbulb, Link2, Loader2, MapPin, Minus, Search, ShoppingBag, Store, Ticket,
    TrendingDown, TrendingUp, Utensils, Waypoints, X,
} from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { keywordFrequency, diagnoseRank, parseCount, buildActionItems, distanceKm, rankLocality, feedDays } from '@/lib/naver-place';
import { recommendKeywords, pickRankKeywords, rankScope, regionStatusOf } from '@/lib/place-keywords';
// 업종 때문에 해당 없는 항목(병의원의 새소식·쿠폰, 약국의 쿠폰·예약): 경고색 없이 "해당 없음"과 이유로 보여 줍니다.
import { healthKind, notApplicableOf } from '@/lib/place-industry';
import { notApplicableTag, menuWord, fitMenuText } from '@/lib/place-geo';
// 숫자·날짜·순위 표기는 연결 그래프와 본문이 같은 글자를 쓰도록 lib/place-graph 의 것을 함께 씁니다.
import { buildPlaceGraph, buildIdleGraph, ONTOLOGY, ontologyFor, itemWord, formatNumber, agoLabel, won, rankLabel, rankTone, sampleSuffix } from '@/lib/place-graph';
import styles from './page.module.css';
import PlaceGraph from './PlaceGraph';
import GeoAeoPanel from './GeoAeoPanel';
import { Unfold, useUnfold, unfoldIn } from './unfold';
import Prescription, { PrescriptionButton } from './Prescription';

const MAX_KEYWORDS = 5;
// 추천 키워드의 '순위 보기'로 순위 표에 덧붙일 수 있는 줄 수
const RANK_ROWS_MAX = 10;
const RECO_SHOWN = 6;
const MENU_SHOWN = 8;
const COUNT_SHOWN = 6;
// 손가락·펜을 댄 뒤 이 시간 안의 마우스 이동은 가짜(화면이 움직여 브라우저가 다시 만든 것)로 봅니다.
const TOUCH_QUIET_MS = 2500;

/* ───────── 표시 도우미 ───────── */

function timeLabel(ms) {
    if (!ms) return '';
    return new Date(ms).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

// 1km 미만은 10m 단위, 10km 미만은 소수 한 자리
function kmLabel(km) {
    if (km === null || km === undefined) return '-';
    if (km < 1) return `${Math.max(10, Math.round(km * 100) * 10)}m`;
    return km < 10 ? `${km.toFixed(1)}km` : `${formatNumber(Math.round(km))}km`;
}

function splitKeywords(text) {
    const seen = new Set();
    const list = [];
    for (const raw of text.split(/[,\n]/)) {
        const word = raw.trim();
        const key = word.replace(/\s+/g, '').toLowerCase();
        if (!word || seen.has(key)) continue;
        seen.add(key);
        list.push(word);
    }
    return list;
}

function errorText(data, fallback) {
    if (typeof data?.error === 'string') return data.error;
    if (data?.error && typeof data.error === 'object') {
        const first = Object.values(data.error).flat()[0];
        if (first) return first;
    }
    return fallback;
}

function recordNote(recorded) {
    if (!recorded) return null;
    if (recorded.saved) {
        return recorded.created
            ? '순위 기록장에 새 항목으로 등록하고 오늘 순위를 저장했습니다.'
            : '순위 기록장에 오늘 순위를 저장했습니다.';
    }
    if (recorded.reason === 'NOT_IN_RANGE') return '300위 안에 없어 기록하지 않았습니다. 1,000위까지 조회하면 기록됩니다.';
    if (recorded.reason === 'LIMIT') return '순위 기록장이 가득 차(10개) 기록하지 못했습니다.';
    if (recorded.reason === 'NO_RESULTS') return '검색된 매장이 없어 기록하지 않았습니다.';
    return null;
}

// 전체 대비 비율(%). 값이 없거나 전체보다 크면(집계 기준이 다른 경우) 보여 주지 않습니다.
function shareOf(part, whole) {
    if (part === null || part === undefined || !whole || part > whole) return null;
    return Math.round((part / whole) * 100);
}

/* ───────── 응답 정리 ─────────
 * 서버 응답의 목록(메뉴·키워드·리뷰 낱말·상위 매장 …)에 null·잘못된 줄이 섞여 와도 화면 전체가 죽지 않게,
 * 응답을 상태에 넣기 직전 이 한곳에서 목록의 잘못된 줄을 걸러 냅니다(그리는 코드마다 ?. 를 뿌리지 않습니다).
 *   'text'       빈 글이 아닌 문자열만(같은 글은 첫 번째만)
 *   'rec:이름'    객체만, 그 가운데 '이름' 칸(줄의 key·그래프 점 이름으로 쓰는 값)이 비어 있지 않은 것만
 * 순서가 뜻을 가진 목록(요일별 시간·평점 분포)은 건드리지 않습니다. */
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const PLACE_LISTS = {
    conveniences: 'text', paymentInfo: 'text', keywords: 'text',
    reviewThemes: 'rec:label', reviewMenus: 'rec:label', reviewVotes: 'rec:label',
    detail: {
        hours: { days: 'rec:day' },
        pos: { popularMenus: 'rec:name' },
        tools: 'rec:type', menus: 'rec:name', styles: 'rec:name',
        tabs: 'text', facilities: 'text', links: 'text', badges: 'text', benefits: 'text', themes: 'text', seats: 'text', externalSites: 'text',
    },
};
const ACTIVITY_LISTS = {
    coupons: { titles: 'text', memberships: 'text' },
    feeds: { titles: 'text' },
    briefing: 'text',
    mentions: { terms: 'rec:term' },
};
const RIVAL_LISTS = { keywords: 'text' };
const RANK_LISTS = { top: 'rec:placeId' };

const hasText = (value) => (typeof value === 'string' ? value.trim() !== '' : Number.isFinite(value));

function cleanList(list, rule) {
    if (rule === 'text') return [...new Set(list.filter((entry) => typeof entry === 'string' && entry.trim() !== ''))];
    const field = rule.slice(4);
    return list.filter((entry) => isRecord(entry) && hasText(entry[field]));
}

function cleanLists(value, spec) {
    if (!isRecord(value)) return value;
    const next = { ...value };
    for (const [key, rule] of Object.entries(spec)) {
        const item = next[key];
        if (typeof rule === 'string') {
            if (Array.isArray(item)) next[key] = cleanList(item, rule);
        } else if (isRecord(item)) {
            next[key] = cleanLists(item, rule);
        }
    }
    return next;
}

const cleanPlace = (place) => cleanLists(place, PLACE_LISTS);
const cleanActivity = (activity) => cleanLists(activity, ACTIVITY_LISTS);
// 순위 결과는 상위 매장 목록(top)이 늘 목록이라고 가정하고 쓰는 곳이 많아, 없거나 목록이 아니면 빈 목록으로 둡니다.
const cleanRank = (result) => {
    const next = cleanLists(result, RANK_LISTS);
    return isRecord(next) && !Array.isArray(next.top) ? { ...next, top: [] } : next;
};
const cleanRivals = (items) => (Array.isArray(items) ? items.filter((item) => isRecord(item) && hasText(item.placeId)).map((item) => cleanLists(item, RIVAL_LISTS)) : []);
const cleanSaved = (saved) => (Array.isArray(saved) ? saved.filter(isRecord) : []);

function reducedMotion() {
    return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

function scrollToId(id) {
    document.getElementById(id)?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
}

// 화면 이동이 끝나 목적지가 화면에 보일 때 한 번 부릅니다. 돌려주는 함수를 부르면 기다리던 것을 그만둡니다.
// "스크롤 이벤트가 잠깐 멈췄다"만으로는 도착을 알 수 없습니다(기기가 버벅이면 이동이 시작되기도 전에 멈춘 것처럼 보입니다).
// 그래서 도착은 아래 둘이 함께 맞을 때로 봅니다.
//   1) 목적지가 화면 안에 보임(ready 가 true)
//   2) 이동이 끝남: scrollend 이벤트가 왔거나, 0.1초 간격으로 읽은 스크롤 위치가 두 번 연속 앞 값과 같음
// 끝까지 목적지가 보이지 않으면(limit 이 지나면) 부르지 않습니다. 보이지 않는 곳의 강조는 아무도 보지 못하고 끝납니다.
function afterScroll(callback, { ready = () => true, limit = 6000 } = {}) {
    const SAMPLE_MS = 100;
    const SAME_NEEDED = 2;
    let timer = 0;
    let cap = 0;
    let last = Math.round(window.scrollY * 2);
    let same = 0;
    let finished = false;
    function stop() {
        finished = true;
        document.removeEventListener('scrollend', onEnd);
        clearInterval(timer);
        clearTimeout(cap);
    }
    function arrive() {
        if (finished || !ready()) return;
        stop();
        callback();
    }
    function onEnd() {
        arrive();
    }
    function sample() {
        const pos = Math.round(window.scrollY * 2);
        same = pos === last ? same + 1 : 0;
        last = pos;
        if (same >= SAME_NEEDED) arrive();
    }
    document.addEventListener('scrollend', onEnd, { passive: true });
    timer = setInterval(sample, SAMPLE_MS);
    cap = setTimeout(stop, limit);
    return stop;
}

/* ───────── 움직임: 화면에 들어오면 펼치기, 숫자 올리기 ───────── */

const InView = createContext(true);

function useInView() {
    const ref = useRef(null);
    const [inView, setInView] = useState(false);
    useEffect(() => {
        const el = ref.current;
        if (!el || inView) return undefined;
        if (typeof IntersectionObserver === 'undefined') {
            setInView(true);
            return undefined;
        }
        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
                setInView(true);
                observer.disconnect();
            }
        }, { rootMargin: '0px 0px -8% 0px', threshold: 0.02 });
        observer.observe(el);
        return () => observer.disconnect();
    }, [inView]);
    return [ref, inView];
}

function Reveal({ as: Tag = 'section', className, children, ...rest }) {
    const [ref, inView] = useInView();
    return (
        <InView.Provider value={inView}>
            <Tag ref={ref} className={className} data-in={inView ? 'true' : 'false'} {...rest}>
                {children}
            </Tag>
        </InView.Provider>
    );
}

// 값이 바뀌면 처음부터가 아니라 지금 보이는 숫자에서 이어서 움직입니다.
function CountUp({ value, decimals = 0, from = 0, duration = 1100 }) {
    const run = useContext(InView);
    const [shown, setShown] = useState(from);
    const last = useRef(from);
    useEffect(() => {
        if (!run || value === null || value === undefined) return undefined;
        if (reducedMotion()) {
            last.current = value;
            setShown(value);
            return undefined;
        }
        let raf = 0;
        const origin = last.current;
        const start = performance.now();
        const tick = (now) => {
            const t = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - t, 4);
            last.current = origin + (value - origin) * eased;
            setShown(last.current);
            if (t < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [run, value, duration]);
    if (value === null || value === undefined) return '-';
    return decimals
        ? Number(shown).toLocaleString('ko-KR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
        : formatNumber(Math.round(shown));
}

// 증감은 색과 함께 ▲/▼ 와 +/- 기호로도 구분합니다.
function Delta({ value }) {
    if (value === null || value === undefined || value === 0) return null;
    const up = value > 0;
    return (
        <span className={styles.delta} data-dir={up ? 'up' : 'down'}>
            <span className={styles.arrow} aria-hidden="true">{up ? '▲' : '▼'}</span>
            {up ? '+' : '-'}{formatNumber(Math.abs(value))}
        </span>
    );
}

function Meter({ ratio, tone }) {
    const w = Math.max(0, Math.min(1, ratio || 0));
    return (
        <span className={styles.meter} data-tone={tone} aria-hidden="true">
            <span className={styles.fill} style={{ '--w': w }} />
        </span>
    );
}

/* ───────── 그래프 데이터 ─────────
 * 점과 연결은 lib/place-graph.js 의 buildPlaceGraph 가 만듭니다(순수 함수, tests/place-graph.test.mjs).
 * 점의 id 는 본문 카드의 data-node 와 같습니다. 같은 id 끼리 서로 밝혀 그래프와 카드를 잇습니다. */

const IDLE_GRAPH = buildIdleGraph(false);
const LOADING_GRAPH = buildIdleGraph(true);

// 범례의 묶음 이름은 그래프 데이터가 쓰는 묶음 이름(ONTOLOGY.groups)을 그대로 씁니다(범례·묶음 점·카드 머리가 같은 말).
const LEGEND = Object.entries(ONTOLOGY.groups)
    .filter(([group]) => group !== 'store')
    .sort((a, b) => a[1].order - b[1].order)
    .map(([group, info]) => ({ group, label: info.label }));

// 구역 머리의 '그래프' 버튼과 카드 강조가 함께 쓰는 연결 통로
const GraphLink = createContext({ showInGraph: () => {} });

/* ───────── 요약 패널 ───────── */

// 요약 칸의 숫자 한 칸. 같은 id 의 그래프 점과 서로 밝혀지고, 누르면 본문의 해당 카드로 갑니다.
function Kpi({ node, label, tone, note, onJump, children }) {
    return (
        <button type="button" className={styles.kpi} data-node={node} data-tone={tone} onClick={() => onJump(node)}>
            <span className={styles.kpiLabel}>{label}</span>
            <span className={styles.kpiValue}>{children}</span>
            {note && <span className={styles.kpiNote}>{note}</span>}
        </button>
    );
}

// 순위가 높을수록 긴 막대(로그 눈금): 1위는 가득, 살펴본 범위 끝이면 비어 보입니다.
function rankReach(result) {
    if (result.status !== 'found') return 0;
    const span = Math.max(100, result.scanned || 0, result.rank);
    return Math.max(0.03, 1 - Math.log10(Math.max(1, result.rank)) / Math.log10(span));
}

function SummaryRail({ place, placeInfo, activity, ranks, actions, saving, onSave, onPickRank, onJump }) {
    const change = placeInfo?.change;
    const visitor = activity?.visitor;
    const blog = activity?.blog;
    const hours = place.detail?.hours;
    const settled = ranks.length > 0 && ranks.every((row) => row.state !== 'loading');
    const top10 = ranks.filter((row) => row.state === 'done' && row.result.status === 'found' && row.result.rank <= 10).length;
    // 순위를 조회하지 못한 키워드는 분모에서 빼고, 몇 개를 뺐는지 덧붙입니다("10위 안 1/3 · 조회 못 한 2개 제외").
    const looked = ranks.filter((row) => row.state === 'done').length;
    const missed = ranks.filter((row) => row.state === 'error').length;
    const high = actions.filter((item) => item.level === 'high');
    const replyTone = !visitor || visitor.replyRate === null ? undefined : visitor.replyRate < 10 ? 'bad' : visitor.replyRate < 50 ? 'warn' : 'good';
    return (
        <div className={`${styles.rail} ${styles.railIn}`}>
            <div className={styles.railHead} style={{ '--d': 0 }}>
                <h2 className={styles.storeName}>{place.name}</h2>
                <p className={styles.storeMeta}>
                    {hours?.registered && hours.status && (
                        <span className={styles.storeState} data-open={hours.status === '영업 중' ? 'true' : undefined}>{hours.status}</span>
                    )}
                    {[place.category, place.address].filter(Boolean).join(' · ')}
                </p>
            </div>
            <div className={styles.kpiGrid} style={{ '--d': 1 }}>
                <Kpi node="rv:visitor" label="방문자 리뷰" onJump={onJump} note={place.reviewAuthors ? `${formatNumber(place.reviewAuthors)}명이 작성` : null}>
                    <CountUp value={place.visitorReviews} /><Delta value={change?.visitorReviews} />
                </Kpi>
                <Kpi node="rv:blog" label="블로그·카페 리뷰" onJump={onJump} note={blog ? `최근 30일 ${formatNumber(blog.last30)}${sampleSuffix(blog.last30, blog.sampled, blog.total)}` : null}>
                    <CountUp value={place.blogReviews} /><Delta value={change?.blogReviews} />
                </Kpi>
                <Kpi node="rv:score" label="평점" onJump={onJump} note={place.visitorScore ? '5점 만점' : null}>
                    {place.visitorScore ? <CountUp value={place.visitorScore} decimals={2} /> : <span className={styles.quiet}>표시 안 함</span>}
                </Kpi>
                <Kpi node="rv:photo" label="사진 리뷰" onJump={onJump} note={place.textReviews !== null && place.textReviews !== undefined ? `글 리뷰 ${formatNumber(place.textReviews)}개` : null}>
                    <CountUp value={place.photoReviews} />
                </Kpi>
                <Kpi node="ac:reply" label="사장님 답글률" tone={replyTone} onJump={onJump} note={visitor ? `최근 ${formatNumber(visitor.sampled)}개 중 ${formatNumber(visitor.replied)}개` : '확인 불가'}>
                    {visitor && visitor.replyRate !== null ? <><CountUp value={visitor.replyRate} /><small>%</small></> : '-'}
                </Kpi>
                <Kpi node="ac:week" label="최근 7일 리뷰" onJump={onJump} note={visitor && visitor.perDay !== null ? `하루 약 ${visitor.perDay}개` : visitor ? null : '확인 불가'}>
                    {visitor ? <><CountUp value={visitor.last7} /><small>{sampleSuffix(visitor.last7, visitor.sampled, visitor.total)}</small></> : '-'}
                </Kpi>
            </div>
            {ranks.length > 0 && (
                <div className={styles.ticker} style={{ '--d': 2 }}>
                    <h3>
                        키워드 순위
                        {settled && looked > 0 && (
                            <span className={styles.tickerSum} data-tone={top10 > 0 ? 'good' : undefined}>
                                10위 안 {top10}/{looked}{missed > 0 && <small> · 조회 못 한 {missed}개 제외</small>}
                            </span>
                        )}
                        {settled && looked === 0 && missed > 0 && <span className={styles.tickerSum}>조회 못 한 {missed}개</span>}
                    </h3>
                    <ul>
                        {ranks.map((row) => (
                            <li key={row.keyword}>
                                <button type="button" data-node={`kw:${row.keyword}`} onClick={() => onPickRank(row.keyword)}>
                                    <span className={styles.tickerWord}>{row.keyword}</span>
                                    <span className={styles.tickerTrack} data-state={row.state} aria-hidden="true">
                                        {row.state === 'done' && <span className={styles.fill} data-tone={rankTone(row.result)} style={{ '--w': rankReach(row.result) }} />}
                                    </span>
                                    {row.state === 'loading' && <span className={styles.tickerPending}><Loader2 size={14} className={styles.spin} aria-hidden="true" />조회 중</span>}
                                    {row.state === 'error' && <span className={styles.tickerValue} data-tone="muted">실패</span>}
                                    {row.state === 'done' && <span className={styles.tickerValue} data-tone={rankTone(row.result)}>{rankLabel(row.result)}</span>}
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {actions.length > 0 && (
                <button type="button" className={styles.railTodo} data-node="hub:todo" data-level={high.length ? 'high' : 'mid'} style={{ '--d': 3 }} onClick={() => onJump('hub:todo')}>
                    <span className={styles.railTodoCount}>{actions.length}</span>
                    <span className={styles.railTodoText}>
                        <strong>{high.length ? `먼저 할 일 ${high.length}개` : `지금 할 일 ${actions.length}개`}</strong>
                        <span>{(high[0] || actions[0]).title}</span>
                    </span>
                    <ChevronRight size={16} aria-hidden="true" />
                </button>
            )}
            <div className={styles.railFoot} style={{ '--d': 4 }}>
                <button type="button" className={styles.secondaryBtn} onClick={onSave} disabled={saving || placeInfo?.saved}>
                    {placeInfo?.saved ? <BookmarkCheck size={16} aria-hidden="true" /> : <BookmarkPlus size={16} aria-hidden="true" />}
                    {placeInfo?.saved ? '내 매장으로 저장됨' : '내 매장으로 저장'}
                </button>
                <PrescriptionButton className={styles.secondaryBtn} />
                <p className={styles.basis}>
                    {timeLabel(placeInfo?.fetchedAt)} 조회{placeInfo?.cached ? ' (같은 조회는 30분 동안 저장된 결과를 보여 줍니다)' : ''}.
                    {change
                        ? ` 숫자 옆 증감은 ${change.since} 조회와 비교한 값입니다.`
                        : placeInfo?.saved
                            ? ' 다음에 다시 조회하면 오늘과 비교한 증감이 표시됩니다.'
                            : ' 내 매장으로 저장하면 다음 조회 때 리뷰 수 증감을 보여 드립니다.'}
                </p>
            </div>
        </div>
    );
}

const IDLE_FEATURES = [
    ['숨은 대표키워드', '스마트플레이스에 등록했지만 매장 화면에는 안 보이는 키워드를 보여 줍니다. 경쟁 매장 것도 볼 수 있습니다.'],
    ['추천 키워드', '주소·업종·리뷰에서 "청주약국" 같은 지역 + 업종 조합을 뽑고, 블로그 후기와 상위 매장 키워드로 근거를 붙입니다.'],
    ['실제 검색 순위', '키워드를 검색했을 때 내 매장이 몇 번째인지 네이버 목록에서 광고를 빼고 셉니다.'],
    ['상위 매장 비교', '상위 10곳의 방문자 리뷰·블로그 리뷰·저장 수를 내 매장과 나란히 놓습니다.'],
    ['지금 할 일', '답글률·소식·영업시간·쿠폰처럼 비어 있거나 오래된 항목을 먼저 할 순서로 정리합니다.'],
    ['AI 검색 노출 점검', 'ChatGPT·Gemini·Claude·네이버 AI가 내 매장을 추천하고 질문에 답할 재료가 있는지 점수와 개선 제안, 답변 초안으로 보여 줍니다.'],
];

function IdleRail() {
    return (
        <div className={`${styles.rail} ${styles.railIn}`}>
            <h2 className={styles.idleTitle} style={{ '--d': 0 }}>주소 하나로 펼쳐지는 것</h2>
            <dl className={styles.idleList}>
                {IDLE_FEATURES.map(([title, text], index) => (
                    <div key={title} style={{ '--d': index + 1 }}>
                        <dt>{title}</dt>
                        <dd>{text}</dd>
                    </div>
                ))}
            </dl>
        </div>
    );
}

function Skel({ w = '100%', h = 14, d = 0 }) {
    return <span className={styles.skel} style={{ '--w': w, '--h': `${h}px`, '--d': d }} />;
}

// 불러오는 동안의 요약 칸: 실제 요약 칸과 같은 자리(이름 → 숫자 6칸 → 키워드 순위)에 뼈대를 둡니다.
function RailSkeleton() {
    return (
        <div className={styles.rail} aria-hidden="true">
            <div className={styles.skelStack}>
                <Skel w="62%" h={26} />
                <Skel w="88%" h={13} d={1} />
            </div>
            <div className={styles.skelKpis}>
                {[0, 1, 2, 3, 4, 5].map((cell) => (
                    <div key={cell}>
                        <Skel w="56%" h={12} d={cell + 2} />
                        <Skel w="44%" h={24} d={cell + 2} />
                    </div>
                ))}
            </div>
            <div className={styles.skelStack}>
                <Skel w="38%" h={13} d={8} />
                {[0, 1, 2, 3, 4].map((row) => <Skel key={row} h={32} d={9 + row} />)}
            </div>
        </div>
    );
}

function SectionsSkeleton() {
    return (
        <div className={styles.skelSections} aria-hidden="true">
            {[0, 1].map((block) => (
                <div key={block} className={styles.skelBlock}>
                    <Skel w="18%" h={20} d={block * 2} />
                    <div className={styles.skelGrid}>
                        <Skel h={72} d={block * 2 + 1} />
                        <Skel h={72} d={block * 2 + 2} />
                        <Skel h={72} d={block * 2 + 3} />
                    </div>
                </div>
            ))}
        </div>
    );
}

const LOADING_PARTS = ['매장 화면', '리뷰 집계', '소식·쿠폰', '결제 데이터', '운영 정보'];

// 그래프 위에 띄우는 불러오는 중 안내. 한 번의 조회로 읽는 항목과 지난 시간을 보여 줍니다.
function LoadingStatus() {
    const [seconds, setSeconds] = useState(0);
    useEffect(() => {
        const timer = setInterval(() => setSeconds((prev) => prev + 1), 1000);
        return () => clearInterval(timer);
    }, []);
    return (
        <div className={styles.loading} role="status">
            <Loader2 size={20} className={styles.spin} aria-hidden="true" />
            <div className={styles.loadingText}>
                <strong>매장 정보를 불러오는 중입니다</strong>
                <p>네이버 플레이스에서 아래 항목을 한 번에 읽습니다. 이어서 지역 키워드 순위를 조회합니다.</p>
                <ul aria-hidden="true">
                    {LOADING_PARTS.map((part, index) => <li key={part} style={{ '--d': index }}>{part}</li>)}
                </ul>
            </div>
            <span className={styles.loadingTime} aria-hidden="true">{seconds}초</span>
        </div>
    );
}

// AI 검색 구역은 자기 머리(점수 요약 줄)를 가지므로, 같은 '그래프' 버튼에 쓸 연결 통로만 이어 줍니다.
function GeoPanel(props) {
    const { showInGraph } = useContext(GraphLink);
    return <GeoAeoPanel {...props} onShowInGraph={showInGraph} />;
}

// 구역 머리: 묶음 색 막대 + 제목 + 한 줄 설명 + 연결 그래프에서 같은 점을 찾아 주는 버튼
function SectionHead({ title, count, hub, children }) {
    const { showInGraph } = useContext(GraphLink);
    return (
        <header className={`${styles.sectionHead} ${styles.rise}`}>
            <h2>{title}{count > 0 && <span className={styles.headCount}>{count}</span>}</h2>
            <p>{children}</p>
            {hub && (
                <button type="button" className={styles.graphBtn} onClick={(event) => showInGraph(hub, event)} aria-label={`${title}: 연결 그래프에서 보기`}>
                    <Waypoints size={14} aria-hidden="true" />
                    그래프
                </button>
            )}
        </header>
    );
}

/* ───────── 지금 할 일 ───────── */

const ACTION_LEVEL = { high: '먼저', mid: '권장', low: '참고' };

function FillStatus({ place }) {
    const rows = [];
    if (place.missing) {
        rows.push(['영업시간', !place.missing.hours, place.missing.hours ? '비어 있음' : '등록됨']);
        rows.push(['소개글', !place.missing.description, place.missing.description ? '비어 있음' : '등록됨']);
        // 약국·병의원·동물병원은 메뉴판이 없는 업종이라 이 줄을 세지도 보이지도 않습니다(등록한 메뉴가 있으면 '품목·서비스 사진'으로 보임).
        if (!healthKind(place) || place.menuCount > 0) {
            rows.push([healthKind(place) ? '품목·서비스 사진' : '메뉴·가격 사진', !place.missing.menuImage, place.missing.menuImage ? '비어 있음' : '등록됨']);
        }
        rows.push(['편의시설', !place.missing.conveniences, place.missing.conveniences ? '비어 있음' : `${place.conveniences.length}개 등록`]);
        rows.push(['찾아오는 길', !place.missing.accessor, place.missing.accessor ? '비어 있음' : '등록됨']);
    }
    const businessPhotos = place.detail?.photos?.business;
    if (businessPhotos !== null && businessPhotos !== undefined) {
        rows.push(['업체 사진', businessPhotos > 0, businessPhotos > 0 ? `${formatNumber(businessPhotos)}장` : '없음']);
    }
    if (Array.isArray(place.keywords)) {
        rows.push(['대표키워드', place.keywords.length >= MAX_KEYWORDS, `${place.keywords.length}/${MAX_KEYWORDS}개`]);
    }
    rows.push(['톡톡 상담', place.hasTalktalk, place.hasTalktalk ? '연결됨' : '연결 안 됨']);
    rows.push(['블로그', place.hasBlog, place.hasBlog ? '연결됨' : '연결 안 됨']);
    const done = rows.filter((row) => row[1]).length;
    const menus = place.detail?.menus;
    // 메뉴 목록을 못 읽은 경우(예전에 저장된 결과)에는 지금까지처럼 사진 수를 보여 줍니다.
    const menuPhotoKnown = !Array.isArray(menus) || menus.length === 0 || menus.some((menu) => menu.hasImage !== null && menu.hasImage !== undefined);
    return (
        <aside className={`${styles.fillPanel} ${styles.rise}`} style={{ '--d': 2 }}>
            <div className={styles.fillHead}>
                <h3>정보 채움 상태</h3>
                <p className={styles.fillScore}><CountUp value={done} /><span> / {rows.length}</span></p>
            </div>
            <Meter ratio={done / rows.length} tone={done === rows.length ? 'good' : 'warn'} />
            {!place.missing && <p className={styles.note}>네이버가 표시하는 정보 부족 항목을 읽지 못했습니다.</p>}
            <ul className={styles.checks}>
                {rows.map(([label, ok, detail]) => (
                    <li key={label} data-ok={ok ? 'true' : 'false'}>
                        {ok ? <Check size={16} aria-hidden="true" /> : <AlertCircle size={16} aria-hidden="true" />}
                        <span>{label}</span>
                        <em>{detail}</em>
                    </li>
                ))}
            </ul>
            {place.menuCount > 0 && (
                <p className={styles.note}>
                    등록된 메뉴 {place.menuCount}개 중{' '}
                    {[
                        // 미용실 가격표처럼 메뉴마다 사진 칸이 없는 업종은 사진 수를 세지 않습니다.
                        menuPhotoKnown ? `사진 ${place.menuImageCount}개` : null,
                        place.menuPricedCount !== null && place.menuPricedCount !== undefined ? `가격 ${place.menuPricedCount}개` : null,
                        place.menuDescribedCount !== null && place.menuDescribedCount !== undefined ? `설명 ${place.menuDescribedCount}개` : null,
                        place.menuCategoryCount ? `분류 ${place.menuCategoryCount}개` : null,
                    ].filter(Boolean).join(' · ')}.
                </p>
            )}
            <Link href="/dashboard/place-check" className={styles.textLink}>
                플레이스 진단에서 항목별로 점검하기 <ArrowUpRight size={14} aria-hidden="true" />
            </Link>
        </aside>
    );
}

function TodoSection({ place, actions }) {
    const high = actions.filter((item) => item.level === 'high').length;
    // 새소식 기능이 없는 업종(병의원)에는 소식 이야기를 하지 않습니다.
    const feedOk = !notApplicableOf(place).feed;
    return (
        <Reveal id="sec-todo" className={styles.section} data-group="todo" data-node="hub:todo">
            <SectionHead title="지금 할 일" count={actions.length} hub="hub:todo">
                {feedOk ? '매장 화면·리뷰·소식에서' : '매장 화면·리뷰에서'} 비어 있거나 오래된 항목입니다. 위에서부터 하면 됩니다.
                {high > 0 && ` 먼저 할 일이 ${high}개 있습니다.`}
            </SectionHead>
            <PrescriptionButton className={styles.secondaryBtn} block />
            <div className={styles.todoGrid}>
                {actions.length === 0 ? (
                    <p className={`${styles.emptyPanel} ${styles.rise}`} style={{ '--d': 1 }}>
                        지금 확인된 빈 항목이 없습니다. {feedOk ? '리뷰 답글과 소식 올리기를' : '리뷰 답글 달기를'} 꾸준히 이어가세요.
                    </p>
                ) : (
                    <ol className={styles.actions}>
                        {actions.map((item, index) => (
                            <li key={item.key} className={`${styles.action} ${styles.rise}`} data-level={item.level} data-node={`todo:${item.key}`} style={{ '--d': index + 1 }}>
                                <span className={styles.actionLevel}>{ACTION_LEVEL[item.level] || '참고'}</span>
                                <div>
                                    <strong>{item.title}</strong>
                                    <p>{item.detail}</p>
                                    {item.link && (
                                        <button type="button" className={styles.actionLink} onClick={() => scrollToId(item.link.target)}>
                                            {item.link.label}
                                            <ChevronRight size={14} aria-hidden="true" />
                                        </button>
                                    )}
                                </div>
                            </li>
                        ))}
                    </ol>
                )}
                <FillStatus place={place} />
            </div>
        </Reveal>
    );
}

/* ───────── 키워드 순위 ───────── */

// '지역 확인 못 함' 칩의 풀이. 칩에 마우스를 올리면 title 로 뜨고, 폰에서는 title 이 안 보이므로 같은 뜻의 설명 한 줄을 칸 아래에 한 번 보입니다.
const UNKNOWN_REGION_TITLE = '이 키워드의 지역을 확인하지 못했습니다';

// 등록한 키워드 한 칸 아래에 붙는 진단: 지역이 들어 있는지, 블로그 후기에 그 낱말이 몇 번 나오는지
function slotState(entry, blogTotal) {
    if (!entry) return null;
    const blog = entry.blog === null || entry.blog === undefined ? null : `블로그 ${entry.blog}${blogTotal ? `/${blogTotal}` : '개'}`;
    // 살펴볼 점이 걸린 키워드(순위 30위 밖 등)는 지역이 들어 있어도 초록(좋음) 칩으로 보이지 않게 합니다. 아래 '살펴볼 점'이 말해 줍니다.
    const status = regionStatusOf(entry);
    if (status === 'known') return { tone: entry.concern ? undefined : 'good', text: ['지역 포함', blog].filter(Boolean).join(' · ') };
    // 앞말이 지역인지 확인하지 못한 키워드는 지역이 없다고 단정하지 않습니다.
    if (status === 'unknown') return { tone: undefined, text: ['지역 확인 못 함', blog].filter(Boolean).join(' · '), title: UNKNOWN_REGION_TITLE };
    return { tone: 'warn', text: ['지역 없음', blog].filter(Boolean).join(' · ') };
}

// 쓸모 관문의 규칙(lib/place-keywords.js recommendKeywords 의 rule)을 사장님 말의 짧은 이름표로 바꿉니다.
// 모르는 규칙이 와도(빈 값·영문 코드) 그대로 보이지 않게 기본 이름표를 씁니다(뺀 키워드는 '추천 제외', 살펴볼 점은 '확인 필요').
const RULE_LABEL = {
    broad: '넓은 업종 이름', extra: '추가 메뉴', vague: '뜻이 넓음', drink: '술·음료', otherBusiness: '다른 업종 낱말',
    offMain: '주력 메뉴 아님', classification: '분류 이름', rank: '내 순위 낮은 지역',
    condition: '조건 안 맞음', rivalOnly: '상위 매장만 씀', noBlog: '근거 부족', thin: '근거 부족', channel: '받는 방법', merged: '겹치는 낱말', region: '지역만 바꿈',
    attribute: '꾸밈·조건 낱말', place: '메뉴 이름 속 지명', lowRank: '순위 30위 밖',
    brand: '매장 이름과 같은 말', short: '한 글자 낱말', duplicate: '같은 키워드 두 칸',
    unrelated: '자료에 없는 말', prefix: '메뉴 앞에 붙는 말', label: '업종 분류 이름',
};

// 후보(candidates[].lacks)의 꼬리표. 값이 없으면(옛 결과) '자료가 적음', 모르는 값이면 꼬리표를 달지 않습니다.
//   menu 품목(메뉴판·예약·결제)에서 확인 못 함 · voice 품목에는 있지만 손님 리뷰·상위 매장 키워드에서는 확인 못 함 · share 리뷰 수가 주력 메뉴들에 견줘 적음 · data 자료가 아예 없음
//   family 같은 낱말을 이미 두 칸 씀 · long 지역을 붙이면 대표키워드 글자 수를 넘는 긴 이름이라 지역 조합을 못 만듦(이때 keyword 는 지역 없는 낱말; 처방전의 같은 꼬리표와 같은 말)
const LACKS_LABEL = { menu: '품목 자료에 없음', voice: '리뷰·상위 매장에 없음', share: '리뷰 비중 낮음', data: '자료가 적음', family: '같은 낱말 두 칸 사용 중', long: '이름이 길어 지역 조합 불가' };

function lacksLabel(lacks) {
    if (lacks === undefined || lacks === null || lacks === '') return LACKS_LABEL.data;
    return LACKS_LABEL[lacks] || null;
}

function ruleLabel(rule, fallback = '추천 제외') {
    return (typeof rule === 'string' && RULE_LABEL[rule]) || fallback;
}

// 키워드 구역의 고정 문구(이름표 '주력 메뉴 아님', '메뉴 설명' 꼬리표, 빈 추천 안내 같은 것)에 박힌 '메뉴'를 업종 말로 바꿉니다.
// 키워드 엔진 문장과 같은 기준입니다: 미용·네일·피부 '시술', 약국·병의원·동물병원 '품목', 그 밖(음식점·카페·업종을 모를 때 포함) '메뉴'.
// '메뉴판'·따옴표 안의 자료는 fitMenuText 가 그대로 둡니다.
function keywordItemWord(place) {
    const word = menuWord(place);
    if (word === '시술') return '시술';
    return word === '메뉴' || word === '서비스' ? '메뉴' : '품목';
}
const KeywordItemWord = createContext('메뉴');
function useKeywordFit() {
    const word = useContext(KeywordItemWord);
    return useCallback((text) => (typeof text === 'string' ? fitMenuText(word, text) : text), [word]);
}

// 접어 두는 한 줄(추천에서 뺀 키워드·등록 키워드에서 살펴볼 점). 누르면 아래에 목록이 펼쳐집니다.
function Fold({ id, label, children }) {
    const [open, setOpen] = useState(false);
    return (
        <div className={styles.fold}>
            <button type="button" className={styles.foldBtn} aria-expanded={open} aria-controls={id} onClick={() => setOpen((prev) => !prev)}>
                <ChevronDown size={16} aria-hidden="true" />
                {label}
            </button>
            {open && <ul id={id} className={styles.foldList}>{children}</ul>}
        </div>
    );
}

// 분류 이름을 손님 말로 바꿔 쓰라는 까닭(spoken.why)이 있으면 그것을 먼저 말하고, 블로그 언급은 뒷받침으로 뒤에 붙입니다.
// 읽은 블로그 후기마다 나오는 낱말(업종 이름 같은 것)은 개수 비교의 근거가 못 되므로 개수를 적지 않습니다.
// 까닭이 없는 줄(블로그 개수 비교로만 고른 말)은 예전 문장 그대로입니다.
function spokenSupport(entry) {
    const { spoken } = entry;
    if (!spoken) return null;
    if (spoken.why) {
        return spoken.everyPost
            ? <>블로그 후기에는 &lsquo;{spoken.term}&rsquo; 말이 읽은 후기마다 나옵니다.</>
            : <>블로그 후기 언급: &lsquo;{entry.keyword}&rsquo; {entry.blog ?? 0}개 · &lsquo;{spoken.term}&rsquo; {spoken.blog}개</>;
    }
    if (!spoken.keyword) return null;
    return spoken.everyPost
        ? <>&lsquo;{spoken.term}&rsquo; 낱말은 읽은 블로그 후기마다 나오는 흔한 말이라 개수로 견주지 않았습니다.</>
        : <>블로그 후기 언급: &lsquo;{entry.keyword}&rsquo; {entry.blog ?? 0}개 · &lsquo;{spoken.term}&rsquo; {spoken.blog}개</>;
}

// 등록한 대표키워드 가운데 쓸모 관문에 걸린 것: 이유와(있으면) 대신 써 볼 말
function ConcernRow({ entry }) {
    const { concern, spoken, suggest } = entry;
    // 분류 이름 줄은 spoken.why 가 같은 까닭("…분류 이름이라")을 이미 말하므로 concern.reason 을 되풀이하지 않습니다.
    const reasonShown = !(spoken?.why && concern.rule === 'classification');
    const support = spokenSupport(entry);
    const fit = useKeywordFit();
    return (
        <li>
            <p className={styles.foldHead}>
                <strong>{entry.keyword}</strong>
                <span className={styles.ruleTag}>{fit(ruleLabel(concern.rule, '확인 필요'))}</span>
            </p>
            {spoken?.why && <p>{spoken.why}</p>}
            {reasonShown && <p>{concern.reason}</p>}
            {spoken?.keyword ? (
                <p>대신 써 볼 말 <b>{spoken.keyword}</b>{support && <> · {support}</>}</p>
            ) : spoken?.why && support ? (
                <p>{support}</p>
            ) : suggest ? (
                <p>대신 써 볼 말 <b>{suggest}</b></p>
            ) : null}
        </li>
    );
}

function KeywordSlots({ keywords, diagnosis, blogTotal, onCopy }) {
    const list = keywords || [];
    const slots = Array.from({ length: Math.max(MAX_KEYWORDS, list.length) }, (_, index) => list[index] || null);
    const stateOf = new Map((diagnosis || []).map((entry) => [entry.keyword, slotState(entry, blogTotal)]));
    const concerns = (diagnosis || []).filter((entry) => entry.concern && list.includes(entry.keyword));
    const concernOf = new Map(concerns.map((entry) => [entry.keyword, entry.concern]));
    // '지역 확인 못 함' 칩이 하나라도 있을 때만(키워드가 여럿이어도 한 번만) 풀이 한 줄을 보입니다.
    const unknownShown = list.some((word) => stateOf.get(word)?.title === UNKNOWN_REGION_TITLE);
    const fit = useKeywordFit();
    return (
        <div className={`${styles.slots} ${styles.rise}`} style={{ '--d': 1 }}>
            <div className={styles.slotsHead}>
                <h3>숨은 대표키워드 <span className={styles.slotCount}>{list.length}/{MAX_KEYWORDS}</span></h3>
                <p>스마트플레이스에 등록됐지만 매장 화면에는 보이지 않는 키워드입니다.</p>
                {list.length > 0 && (
                    <button type="button" className={styles.secondaryBtn} onClick={onCopy}>
                        <Copy size={16} aria-hidden="true" />
                        복사
                    </button>
                )}
            </div>
            {keywords === null ? (
                <p className={styles.note}>대표키워드를 읽지 못했습니다. 잠시 후 다시 조회해주세요.</p>
            ) : (
                <ol className={styles.slotRow}>
                    {slots.map((word, index) => {
                        const state = word ? stateOf.get(word) : null;
                        const concern = word ? concernOf.get(word) : null;
                        return (
                            <li key={word || `empty-${index}`} data-empty={word ? undefined : 'true'} data-concern={concern ? 'true' : undefined} data-node={word ? `kw:${word}` : undefined} style={{ '--d': index }}>
                                <span>{word || '빈 칸'}</span>
                                {state && <small className={styles.slotState} data-tone={state.tone} title={state.title}>{state.text}</small>}
                                {concern && <small className={styles.slotConcern}>살펴볼 점{ruleLabel(concern.rule, '') ? ` · ${fit(ruleLabel(concern.rule, ''))}` : ''}</small>}
                            </li>
                        );
                    })}
                </ol>
            )}
            {keywords !== null && unknownShown && (
                <p className={styles.note}>&lsquo;지역 확인 못 함&rsquo;은 이 키워드의 지역을 확인하지 못했다는 뜻입니다.</p>
            )}
            {concerns.length > 0 && (
                <Fold id="kw-concerns" label={`등록 키워드에서 살펴볼 점 ${concerns.length}개`}>
                    {concerns.map((entry) => <ConcernRow key={entry.keyword} entry={entry} />)}
                </Fold>
            )}
            {keywords !== null && list.length === 0 && (
                <p className={styles.note}>
                    등록된 대표키워드가 없습니다. 스마트플레이스 &gt; 업체정보에서 5개까지 등록할 수 있습니다.{' '}
                    <Link href="/dashboard/place-check" className={styles.inlineLink}>대표키워드 고르는 법 보기</Link>
                </p>
            )}
        </div>
    );
}

// '지역만 바꾼 조합'은 지역 이름별로 묶어 짧게 보여 줍니다("압구정 + 점심 · 맛집 · 모임").
function byRegion(entries) {
    const groups = new Map();
    for (const entry of entries) {
        for (const keyword of entry.keywords || []) {
            const region = keyword.endsWith(entry.term) ? keyword.slice(0, keyword.length - entry.term.length) : '';
            if (!groups.has(region)) groups.set(region, []);
            groups.get(region).push(region ? entry.term : keyword);
        }
    }
    return [...groups];
}

// 추천에서 뺀 키워드 한 줄. 사실(lead)·이유(why)가 있으면 "사실 한 줄 / 이유 한 줄 / 쓰기 좋은 곳(useIn)" 세 줄로,
// 없으면(옛 결과·다른 규칙) 이유 한 문장 reason 을 그대로 그립니다. 새 필드가 없어도 깨지지 않습니다.
// '낱말'·'낱말'·'낱말' 처럼 공백 없이 가운뎃점으로만 이어진 긴 목록이 한 덩어리로 안 접히지 않게, 가운뎃점 뒤에 줄바꿈 자리(보이지 않는 공백)를 둡니다.
const softWrap = (text) => text.replace(/·/g, '·\u200B');

function ExcludedRow({ entry }) {
    const lead = typeof entry.lead === 'string' ? softWrap(entry.lead.trim()) : '';
    const why = typeof entry.why === 'string' ? softWrap(entry.why.trim()) : '';
    const useIn = Array.isArray(entry.useIn) ? entry.useIn.filter((place) => typeof place === 'string' && place) : [];
    const split = Boolean(lead || why);
    const fit = useKeywordFit();
    // 한 줄이 낱말 여럿을 묶은 것이면(엔진이 words 로 묶인 낱말을 줌) 제목에 그 수를 적어, 까닭 문장이 늘어놓는 낱말과 제목이 어긋나 보이지 않게 합니다.
    // 몇 개가 묶였는지는 줄마다 다르므로 개수를 가정하지 않고 words 에서 셉니다(term 자신은 빼고).
    const others = Array.isArray(entry.words) ? new Set(entry.words.filter((word) => typeof word === 'string' && word && word !== entry.term)) : new Set();
    return (
        <li>
            <p className={styles.foldHead}>
                <strong>{entry.term}{others.size > 0 ? ` 외 ${others.size}개` : ''}</strong>
                <span className={styles.ruleTag}>{fit(ruleLabel(entry.rule))}</span>
            </p>
            {split ? (
                <>
                    {lead && <p className={styles.foldFact}>{lead}</p>}
                    {why && <p>{why}</p>}
                    {useIn.length > 0 && (
                        <p className={styles.foldUse}>
                            <span>쓰기 좋은 곳</span>
                            {useIn.map((place) => <span key={place} className={styles.useTag}>{fit(place)}</span>)}
                        </p>
                    )}
                </>
            ) : (
                <p>{softWrap(String(entry.reason || ''))}</p>
            )}
            {entry.keywords?.length > 0 && (
                // 예는 둘까지만 보여 폰에서 한 줄이 길어지지 않게 합니다(나머지는 개수로).
                <p className={styles.foldMuted}>
                    {entry.rule === 'rank' ? '만들지 않은 조합' : '뺀 조합'} 예: {entry.keywords.slice(0, 2).join(' · ')}
                    {entry.keywords.length > 2 ? ` 외 ${entry.keywords.length - 2}개` : ''}
                </p>
            )}
        </li>
    );
}

// 추천에서 뺀 키워드: 낱말(내 순위가 낮은 지역은 지역 이름)마다 이유 한 문장.
// 개수가 많은 '지역만 바꾼 조합'만 맨 아래에 한 줄로 묶습니다(펼침 줄의 개수 = 낱말 줄 수 + 묶음 안의 낱말 수).
// 메뉴판에 한 줄뿐인 품목에서 나온 말(board)이 셋 이상이면 낱말만 한 문단으로 보이는 한 줄로 묶고, 말마다의 까닭은 펼쳐서 읽게 합니다.
// (줄마다 까닭이 달라 묶음 제목에서 까닭을 하나로 말하지 않습니다. 둘 이하면 묶지 않고 다른 줄처럼 그립니다.)
const BOARD_GROUP_MIN = 3;

function ExcludedFold({ excluded }) {
    const [boardOpen, setBoardOpen] = useState(false);
    if (!excluded?.length) return null;
    const region = excluded.filter((entry) => entry.rule === 'region');
    const rest = excluded.filter((entry) => entry.rule !== 'region');
    const boardAll = rest.filter((entry) => entry.board === true);
    const grouped = boardAll.length >= BOARD_GROUP_MIN;
    const board = grouped ? boardAll : [];
    const single = grouped ? rest.filter((entry) => entry.board !== true) : rest;
    // 한 줄이 낱말 여럿을 묶은 것이면(words) 머리의 숫자는 줄 수가 아니라 실제 낱말 수입니다. 둘이 다르면 "낱말 14개 · 5줄"처럼 둘 다 적습니다.
    // (위 '추천에서 뺀 키워드 N개'의 N 은 줄 수입니다. 줄·묶음·지역만 바꾼 묶음의 줄을 모두 합친 수라서 안쪽의 '줄' 수와 맞습니다.)
    // 숫자는 줄마다 words 에서 세므로 엔진이 묶음 구성을 바꿔도 그대로 맞습니다.
    const boardWords = [...new Set(board.flatMap((entry) => [entry.term, ...(Array.isArray(entry.words) ? entry.words : [])]).filter((word) => typeof word === 'string' && word))];
    return (
        <Fold id="kw-excluded" label={`추천에서 뺀 키워드 ${excluded.length}개`}>
            {single.map((entry) => <ExcludedRow key={`${entry.rule}-${entry.term}`} entry={entry} />)}
            {board.length > 0 && (
                <li>
                    <p className={styles.foldHead}>
                        <strong>메뉴판 품목에서 나온 말</strong>
                        <span className={styles.ruleTag}>낱말 {boardWords.length}개{boardWords.length !== board.length ? ` · ${board.length}줄` : ''}</span>
                    </p>
                    <p>메뉴판에 한 줄로 올라 있는 품목에서 나온 말입니다. 말마다 까닭이 달라 아래 단추로 펼쳐서 읽을 수 있습니다.</p>
                    <p className={styles.foldWords}>{boardWords.join(' · ')}</p>
                    <button type="button" className={styles.foldNestedBtn} aria-expanded={boardOpen} aria-controls="kw-excluded-board" onClick={() => setBoardOpen((prev) => !prev)}>
                        <ChevronDown size={16} aria-hidden="true" />
                        {boardOpen ? '까닭 접기' : `까닭 보기 (${board.length}줄)`}
                    </button>
                    {boardOpen && (
                        <ul id="kw-excluded-board" className={styles.foldNested}>
                            {board.map((entry) => <ExcludedRow key={`${entry.rule}-${entry.term}`} entry={entry} />)}
                        </ul>
                    )}
                </li>
            )}
            {region.length > 0 && (
                <li>
                    <p className={styles.foldHead}>
                        <strong>지역만 바꾼 조합</strong>
                        <span className={styles.ruleTag}>낱말 {region.length}개</span>
                    </p>
                    <p>같은 낱말로 이미 등록했거나 추천한 조합이 있어, 지역 이름만 바꾼 조합은 더 권하지 않았습니다.</p>
                    {byRegion(region).map(([name, words]) => (
                        <p key={name || 'etc'} className={styles.foldWords}>
                            {name && <b>{name} +</b>}
                            <span>{words.join(' · ')}</span>
                        </p>
                    ))}
                </li>
            )}
        </Fold>
    );
}

// 리뷰에는 나오지만 메뉴판·예약·결제 품목에서 확인되지 않아 추천에 넣지 않은 말(최대 8개). 사장님이 직접 판단해 쓸 말이라
// 추천 목록과 따로 두고, 순위를 조회하지 않으며 복사 목록에도 넣지 않습니다. 값이 없으면 그리지 않습니다.
// terse: 추천이 0개이고 후보가 모두 '자료가 아예 없음'(lacks 'data')이면, 까닭은 빈 추천 자리에서 한 번 말하므로 줄마다 같은 문장을 되풀이하지 않습니다.
// (후보의 까닭이 섞여 있거나 추천이 있으면 줄마다 why 를 그대로 보입니다.)
// 후보가 많아도 추천보다 길어 보이지 않게 앞의 CANDIDATE_SHOWN 개만 먼저 보이고 나머지는 'N개 더 보기'로 접습니다(제목 옆 숫자는 전체 수).
const CANDIDATE_SHOWN = 3;

function CandidateList({ candidates, terse = false }) {
    const [more, setMore] = useState(false);
    const all = (candidates || []).filter((entry) => entry && typeof entry.keyword === 'string' && entry.keyword).slice(0, 8);
    if (all.length === 0) return null;
    const shown = more ? all : all.slice(0, CANDIDATE_SHOWN);
    return (
        <div className={styles.candidates}>
            <h4>사장님이 직접 판단할 말 <span className={styles.slotCount}>{all.length}</span></h4>
            <p className={styles.note}>추천은 아닙니다. 가게 자료와 손님 리뷰 양쪽에서 충분히 확인하지 못한 말이라, 순위를 조회하지 않고 복사 목록에도 넣지 않았습니다.</p>
            <ul className={styles.foldList}>
                {shown.map((entry) => (
                    <li key={entry.keyword}>
                        <p className={styles.foldHead}>
                            <strong>{entry.keyword}</strong>
                            {lacksLabel(entry.lacks) && <span className={styles.ruleTag}>{lacksLabel(entry.lacks)}</span>}
                        </p>
                        {entry.why && !terse && <p>{entry.why}</p>}
                        {Array.isArray(entry.reasons) && entry.reasons.length > 0 && (
                            <p className={styles.candidateReasons}>
                                {entry.reasons.map((reason) => (
                                    <span key={reason.text} className={styles.reason} data-kind={reason.kind}>{reason.text}</span>
                                ))}
                            </p>
                        )}
                    </li>
                ))}
            </ul>
            {all.length > CANDIDATE_SHOWN && (
                <div className={styles.recoFoot}>
                    <button type="button" className={styles.toggleBtn} onClick={() => setMore((prev) => !prev)} aria-expanded={more}>
                        <ChevronDown size={16} aria-hidden="true" />
                        {more ? '접기' : `${all.length - CANDIDATE_SHOWN}개 더 보기`}
                    </button>
                </div>
            )}
        </div>
    );
}

// 추천이 0개일 때의 안내. 까닭(recommendation.emptyReason)에 따라 다른 말을 합니다.
// 까닭을 모르는 옛 결과에는 '이미 잘 담고 있다' 같은 단정을 하지 않고 중립 문구를 씁니다.
// (allWeak 문구의 '소식'은 새소식 기능이 없는 업종에서는 뺍니다: FEED_WORD 자리)
const EMPTY_NOTE = {
    enough: '새로 추천할 조합이 없습니다. 등록한 대표키워드가 이미 지역과 업종을 잘 담고 있습니다.',
    allWeak: '등록한 키워드의 순위가 30위 안에 들지 못해(30위 밖·목록에 없음·먼 지역 결과 포함), 같은 지역으로는 새 조합을 만들지 않았습니다. 대표키워드를 더 만들기보다 소개글·FEED_WORD메뉴 설명에 같은 말을 함께 쓰고, 아래 입력 칸에서 가까운 다른 지역(옆 동네·가까운 역)이나 메뉴 이름으로 순위를 직접 조회해 보세요.',
    noRegion: '주소에서 지역 이름을 읽지 못해 추천을 만들지 못했습니다. 아래 입력 칸에 ‘지역 + 업종’을 직접 넣어 순위를 조회해 보세요.',
    noData: '지역과 함께 권할 만한 낱말을 아직 찾지 못했습니다. 메뉴·리뷰·블로그 후기에 쓸 만한 말이 쌓이면 나타납니다. 지금은 아래 입력 칸에 ‘지역 + 업종’을 직접 넣어 순위를 조회해 보세요.',
    unknown: '지금 읽은 자료로는 새로 추천할 조합을 만들지 못했습니다.',
};

// 추천 키워드: 지역 + 업종(메뉴·서비스) 조합과 근거. 누르면 그 키워드의 순위를 순위 표에 덧붙여 조회합니다.
function KeywordReco({ recommendation, ranks, rankPick, rivalRegistered = null, comparing, ranking, unavailable, canCompare, feedOk = true, onRank, onRankAll, onCompare, onCopy }) {
    const [more, setMore] = useState(false);
    const fit = useKeywordFit();
    // 그래프에서 고른 추천 키워드가 '더 보기' 뒤에 접혀 있으면 펼칩니다.
    useUnfold(
        (id) => !more && id.startsWith('kw:') && (recommendation?.items || []).findIndex((item) => `kw:${item.keyword}` === id) >= RECO_SHOWN,
        () => setMore(true),
    );
    if (!recommendation) return null;
    const { regions, items, registered, rivalCount, excluded, emptyReason, regionSource } = recommendation;
    const candidates = Array.isArray(recommendation.candidates) ? recommendation.candidates : [];
    // 앞말이 지역인지 확인하지 못한 등록 키워드(regionStatus 'unknown'): 지역이 없다고 말하지 않고, 순위는 조회하되 지역을 확인하지 못했다고 알립니다.
    const unknownRegion = registered.filter((entry) => regionStatusOf(entry) === 'unknown').map((entry) => entry.keyword);
    // 순위 조회에서 뺀 키워드(rankPick.skipped)는 까닭이 둘입니다: 지역이 없다고 확실한 것(none)과, 지역을 확인하지 못했는데 이 매장 자료에도 없는 말(내 순위가 아닐 수 있음).
    // 뒤의 것에는 '순위는 조회하지만'이라고 말하지 않고, 앞의 것만 '지역명이 없어' 안내에 넣습니다.
    const skippedWords = new Set(rankPick?.skipped || []);
    const unknownRanked = unknownRegion.filter((word) => !skippedWords.has(word));
    const unknownNotMine = unknownRegion.filter((word) => skippedWords.has(word));
    const noRegionSkipped = (rankPick?.skipped || []).filter((word) => !unknownRegion.includes(word));
    // 지역을 주소에서 읽었는지: 등록 키워드에서만 읽었거나(keywords) 못 읽었으면(none) 한 줄로 알립니다. 값이 없으면(옛 결과) 말하지 않습니다.
    const regionNotice = regionSource === 'keywords'
        ? '주소에서 지역 이름을 읽지 못해, 등록한 대표키워드에 쓴 지역으로 추천을 만들었습니다. 매장 위치와 다를 수 있으니 위의 읽은 지역을 확인하세요.'
        : regionSource === 'none' && regions.length > 0
            ? '주소와 등록 키워드에서 지역 이름을 읽지 못했습니다. 아래 추천은 지역을 확인한 것이 아닙니다.'
            : null;
    const shown = more ? items : items.slice(0, RECO_SHOWN);
    const rankOf = new Map(ranks.map((row) => [row.keyword, row]));
    const unrankedAll = items.filter((item) => !rankOf.has(item.keyword));
    // 순위 조회는 한 번에 MAX_KEYWORDS 개까지라, 안 본 것이 더 많으면 단추에 전체 수와 이번에 보는 수를 함께 적습니다.
    const unranked = unrankedAll.slice(0, MAX_KEYWORDS);
    const swaps = registered.filter((entry) => regionStatusOf(entry) === 'none' && (entry.suggest || entry.spoken?.keyword));
    // '이미 지역과 업종을 잘 담고 있습니다'는 등록 키워드 모두가 지역을 확인했고 살펴볼 점이 없을 때만 말합니다(위 안내와 어긋나지 않게).
    const allClean = registered.every((entry) => !entry.concern && regionStatusOf(entry) === 'known');
    // 추천은 없는데 후보가 있으면 "왜 추천이 없고 아래 말은 무엇인지"가 한 흐름으로 읽히게 이어 줍니다.
    const candidateRows = candidates.filter((entry) => entry && typeof entry.keyword === 'string' && entry.keyword).slice(0, 8);
    // 후보가 모두 '자료가 아예 없음'이면 까닭을 여기서 한 번만 말하고(후보 줄은 낱말·근거 칩만), 아니면 후보 줄마다 까닭을 보입니다.
    // (추천이 0개이거나, 순위 확인용 칩만 있어 lib 가 emptyReason 을 준 경우)
    const emptyShown = items.length === 0 || Boolean(emptyReason);
    const dataOnly = emptyShown && candidateRows.length > 0 && candidateRows.every((entry) => entry.lacks === 'data');
    const emptyBase = emptyReason === 'enough' && (!allClean || dataOnly) ? '새로 추천할 조합이 없습니다.' : (EMPTY_NOTE[emptyReason] || EMPTY_NOTE.unknown);
    const candidateNote = candidateRows.length === 0
        ? ''
        : dataOnly
            ? ' 메뉴판·예약·결제 자료가 없어 추천할 말을 확인하지 못했습니다. 아래는 리뷰에 자주 나온 말입니다 — 실제로 하는 것만 골라 쓰세요.'
            : candidateRows.every((entry) => entry.lacks === 'menu')
                ? ' 리뷰에 나온 말이 있지만 메뉴판·예약·결제 품목에서 확인되지 않아, 추천하지 않고 아래에 사장님이 직접 판단할 말로만 두었습니다.'
                // 까닭이 말마다 다르거나(voice·share 등) 모르는 값이면 까닭은 줄마다 적은 문장을 보게 합니다.
                : ' 추천하지 않은 말은 아래에 사장님이 직접 판단할 말로만 두었습니다. 말마다 까닭을 적었습니다.';
    const emptyNote = fit(`${emptyBase}${candidateNote}`);
    // 등록 키워드의 '살펴볼 점'에 이미 같은 문장이 나온 뺀 키워드(상호와 같은 말 등)는 아래 접힘에서 되풀이하지 않습니다.
    const concernTexts = new Set(registered.filter((entry) => entry.concern?.reason).map((entry) => entry.concern.reason.trim()));
    const excludedShown = (excluded || []).filter((entry) => {
        const text = String((entry.why || entry.reason || '')).trim();
        return !(text && concernTexts.has(text));
    });
    const headCount = emptyReason ? items.filter((item) => item.registrable).length : items.length;
    return (
        <div id="kw-reco" className={`${styles.reco} ${styles.rise}`} style={{ '--d': 2 }}>
            <div className={styles.recoHead}>
                <h3>
                    <Lightbulb size={16} aria-hidden="true" />
                    추천 키워드
                    {/* 엔진이 '등록할 수 있는 추천 0개'라는 까닭(emptyReason)을 줄 때는 순위 확인용 칩을 세지 않습니다. 아래 '새로 추천할 조합이 없습니다'와 어긋나지 않게 합니다. */}
                    {headCount > 0 && <span className={styles.slotCount}>{headCount}</span>}
                </h3>
                <p>
                    주소·업종·리뷰·블로그 후기에 나온 말로 만든 &lsquo;지역 + 업종&rsquo; 조합입니다. 검색량은 알 수 없으니 순위를 먼저 확인한 뒤 대표키워드·소개글{feedOk ? '·소식' : ''}에 넣어 보세요.
                </p>
            </div>

            {regions.length > 0 && (
                <p className={styles.recoRegions}>
                    <MapPin size={14} aria-hidden="true" />
                    <span>읽은 지역</span>
                    {regions.map((region) => (
                        <span key={`${region.scope}-${region.term}`} className={styles.word} data-node={`region:${region.term}`}>
                            {region.term}<small>{region.label}</small>
                        </span>
                    ))}
                </p>
            )}

            {rankPick && noRegionSkipped.length > 0 && rankPick.added.length > 0 && (
                <p className={styles.recoNotice}>
                    <Info size={14} aria-hidden="true" />
                    <span>
                        등록한 대표키워드 {noRegionSkipped.map((word) => `'${word}'`).join(', ')}에는 지역명이 없어 검색하는 위치마다 순위가 달라집니다.
                        그래서 지역을 붙인 추천 키워드 {rankPick.added.length}개로 순위를 조회했습니다.
                    </span>
                </p>
            )}

            {unknownRanked.length > 0 && (
                <p className={styles.recoNotice}>
                    <Info size={14} aria-hidden="true" />
                    <span>
                        지역을 확인하지 못한 대표키워드: {unknownRanked.map((word) => `'${word}'`).join(', ')}. 순위는 조회하지만 어느 지역 기준인지는 알 수 없습니다.
                    </span>
                </p>
            )}

            {unknownNotMine.length > 0 && (
                <p className={styles.recoNotice}>
                    <Info size={14} aria-hidden="true" />
                    <span>
                        지역을 확인하지 못했고 이 매장 자료에서도 찾지 못한 대표키워드: {unknownNotMine.map((word) => `'${word}'`).join(', ')}. 내 매장의 순위가 아닐 수 있어 순위는 조회하지 않았습니다.
                    </span>
                </p>
            )}

            {regionNotice && (
                <p className={styles.recoNotice}>
                    <Info size={14} aria-hidden="true" />
                    <span>{regionNotice}</span>
                </p>
            )}

            {regions.length === 0 ? (
                <p className={styles.note}>{fit(EMPTY_NOTE.noRegion)}</p>
            ) : items.length === 0 ? (
                <p className={styles.note}>{emptyNote.replace('FEED_WORD', feedOk ? '소식·' : '')}</p>
            ) : (
                <>
                {/* 등록할 수 있는 추천이 하나도 없는데 '순위 확인용' 칩만 있는 경우에도 까닭(emptyReason)을 한 줄 먼저 말합니다. */}
                {emptyReason && <p className={styles.note}>{emptyNote.replace('FEED_WORD', feedOk ? '소식·' : '')}</p>}
                <ol className={styles.recoList}>
                    {shown.map((item, index) => {
                        const row = rankOf.get(item.keyword);
                        return (
                            <li key={item.keyword} data-node={`kw:${item.keyword}`} style={{ '--d': index }}>
                                <span className={styles.recoWord}>
                                    <strong>{item.keyword}</strong>
                                    {!item.registrable && <span className={styles.tagMuted}>순위 확인용</span>}
                                </span>
                                <span className={styles.recoReasons}>
                                    {item.reasons.map((reason) => (
                                        <span key={reason.text} className={styles.reason} data-kind={reason.kind}>{reason.text}</span>
                                    ))}
                                </span>
                                <span className={styles.recoAct}>
                                    {row?.state === 'done' && (
                                        <button type="button" className={styles.recoRank} data-tone={rankTone(row.result)} onClick={() => onRank(item.keyword)} aria-label={`${item.keyword} ${rankLabel(row.result)}, 순위 표에서 보기`}>
                                            {rankLabel(row.result)}
                                        </button>
                                    )}
                                    {row?.state === 'loading' && <span className={styles.rankPending}><Loader2 size={14} className={styles.spin} aria-hidden="true" /> 조회 중</span>}
                                    {row?.state === 'error' && <span className={styles.rankError}>조회 실패</span>}
                                    {!row && (
                                        <button type="button" className={styles.ghostBtn} onClick={() => onRank(item.keyword)} disabled={ranking || unavailable}>
                                            순위 보기
                                        </button>
                                    )}
                                </span>
                            </li>
                        );
                    })}
                </ol>
                </>
            )}

            {swaps.length > 0 && (
                <ul className={styles.recoSwaps}>
                    {swaps.map((entry) => (
                        <li key={entry.keyword}>
                            <span className={styles.word}>{entry.keyword}</span>
                            <ChevronRight size={14} aria-hidden="true" />
                            {entry.spoken?.keyword ? (
                                <span>
                                    <b>{entry.spoken.keyword}</b> — {entry.spoken.why ? <>{entry.spoken.why} </> : null}{spokenSupport(entry)}
                                </span>
                            ) : (
                                <span><b>{entry.suggest}</b> — 지역을 붙이면 순위를 정확히 확인할 수 있습니다.</span>
                            )}
                        </li>
                    ))}
                </ul>
            )}

            {items.length > 0 && (
                <div className={styles.recoFoot}>
                    {unranked.length > 0 && (
                        <button
                            type="button"
                            className={styles.secondaryBtn}
                            onClick={() => onRankAll(unranked.map((item) => item.keyword))}
                            disabled={ranking || unavailable}
                            title={unrankedAll.length > unranked.length ? `한 번에 ${MAX_KEYWORDS}개까지 조회합니다. 끝나면 남은 ${unrankedAll.length - unranked.length}개를 이어서 조회할 수 있습니다.` : undefined}
                        >
                            <Search size={16} aria-hidden="true" />
                            {unrankedAll.length > unranked.length
                                ? `아직 안 본 ${unrankedAll.length}개 중 ${unranked.length}개 순위 조회`
                                : `아직 안 본 ${unranked.length}개 순위 조회`}
                        </button>
                    )}
                    <button type="button" className={styles.secondaryBtn} onClick={() => onCopy(items.filter((item) => item.registrable).map((item) => item.keyword))}>
                        <Copy size={16} aria-hidden="true" />
                        복사
                    </button>
                    {items.length > RECO_SHOWN && (
                        <button type="button" className={styles.toggleBtn} onClick={() => setMore((prev) => !prev)} aria-expanded={more}>
                            <ChevronDown size={16} aria-hidden="true" />
                            {more ? '접기' : `${items.length - RECO_SHOWN}개 더 보기`}
                        </button>
                    )}
                    {rivalCount === 0 && canCompare && (
                        <button type="button" className={styles.secondaryBtn} onClick={onCompare} disabled={comparing || unavailable}>
                            {comparing ? <Loader2 size={16} className={styles.spin} aria-hidden="true" /> : <KeyRound size={16} aria-hidden="true" />}
                            상위 매장 키워드와 비교
                        </button>
                    )}
                </div>
            )}
            {regions.length > 0 && <CandidateList candidates={candidates} terse={dataOnly} />}
            {regions.length > 0 && <ExcludedFold excluded={excludedShown} />}
            <p className={styles.note}>
                {rivalCount > 0
                    // 읽은 상위 매장 가운데 대표키워드를 등록한 곳만 셉니다('등록 안 함'인 곳은 비교할 것이 없음).
                    ? (rivalRegistered === null || rivalRegistered === rivalCount
                        ? `상위 매장 ${rivalCount}곳이 등록한 대표키워드와 비교한 결과입니다. `
                        : rivalRegistered === 0
                            ? `상위 매장 ${rivalCount}곳을 읽었지만 등록한 대표키워드가 없어 비교할 것이 없습니다. `
                            : `상위 매장 ${rivalCount}곳 가운데 대표키워드를 등록한 ${rivalRegistered}곳과 비교한 결과입니다. `)
                    : comparing ? '상위 매장의 대표키워드를 읽어 비교하는 중입니다. ' : ''}
                &lsquo;맛집&rsquo;·&lsquo;잘하는&rsquo; 같은 홍보성 표현은 대표키워드 등록이 거절될 수 있어 &lsquo;순위 확인용&rsquo;으로만 표시합니다.
                지역명이 들어간 대표키워드는 네이버가 수정할 수 있으니 소개글{feedOk ? '·소식' : ''}에도 같은 표현을 함께 쓰세요.{' '}
                <Link href="/dashboard/place-check" className={styles.inlineLink}>대표키워드 점검기</Link>
            </p>
        </div>
    );
}

// 1위~살펴본 범위를 로그 눈금으로 펼쳐 상위권 차이가 잘 보이게 합니다.
function RankTrack({ result }) {
    const found = result.status === 'found';
    const span = Math.max(100, result.scanned || 0, found ? result.rank : 0);
    const pos = (rank) => Math.log10(Math.max(1, rank)) / Math.log10(span);
    const ticks = [1, 10, 100, 1000].filter((tick) => tick < span);
    ticks.push(span);
    return (
        <span className={styles.track} aria-hidden="true">
            <span className={styles.trackBase} />
            <span className={styles.trackZone} style={{ '--w': pos(10) }} />
            {ticks.map((tick, index) => (
                <span
                    key={tick}
                    className={styles.tick}
                    data-edge={index === 0 ? 'start' : index === ticks.length - 1 ? 'end' : undefined}
                    style={{ '--x': pos(tick) }}
                >
                    {formatNumber(tick)}
                </span>
            ))}
            <span className={styles.trackMark} data-tone={rankTone(result)} style={{ '--x': found ? pos(result.rank) : 1 }} />
        </span>
    );
}

function CellBar({ value, max }) {
    return (
        <span className={styles.cellBar}>
            <span>{formatNumber(value)}</span>
            <span className={styles.cellTrack} aria-hidden="true">
                <span className={styles.fill} style={{ '--w': value ? value / max : 0 }} />
            </span>
        </span>
    );
}

// origin: 내 매장 좌표. 상위 매장이 내 매장에서 얼마나 떨어져 있는지(직선 거리) 함께 보여 줍니다.
function RankTable({ result, origin }) {
    const rows = [...result.top];
    if (result.target && !rows.some((row) => row.isTarget)) rows.push(result.target);
    const maxVisitor = Math.max(1, ...rows.map((row) => row.visitorReviews || 0));
    const maxBlog = Math.max(1, ...rows.map((row) => row.blogReviews || 0));
    const distances = rows.map((row) => (row.isTarget ? null : distanceKm(origin, row)));
    const showDistance = distances.some((km) => km !== null);
    // 저장 수·평점을 공개하지 않는 업종(약국 등)은 모든 줄이 비어 있어 칸을 숨깁니다.
    const showSave = rows.some((row) => row.saveText);
    const showScore = rows.some((row) => row.score);
    return (
        <div className={styles.tableWrap}>
            <table className={`${styles.table} ${styles.rankTable}`}>
                <caption className={styles.srOnly}>{result.keyword} 검색 상위 매장과 내 매장</caption>
                <thead>
                    <tr>
                        <th scope="col">순위</th>
                        <th scope="col">매장</th>
                        <th scope="col">방문자 리뷰</th>
                        <th scope="col">블로그 리뷰</th>
                        {showSave && <th scope="col">저장</th>}
                        {showScore && <th scope="col">평점</th>}
                        {showDistance && <th scope="col">내 매장에서</th>}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, index) => {
                        // 행정구역의 마지막 낱말(동·읍·면)만 보여 줍니다.
                        const town = row.area ? row.area.split(' ').pop() : null;
                        const sub = [row.category, town].filter(Boolean).join(' · ');
                        // 상위 매장 줄은 그래프의 경쟁 매장 점(rival:매장번호)과 잇습니다. 그 점에서 내려오면 이 줄도 함께 강조됩니다.
                        return (
                            <tr key={row.placeId} className={row.isTarget ? styles.myRow : undefined} data-node={row.isTarget ? undefined : `rival:${row.placeId}`} style={{ '--d': index }}>
                                <td className={styles.numCell}>{row.rank}</td>
                                <th scope="row">
                                    <span className={styles.shopName}>{row.name}</span>
                                    {row.isTarget && <span className={styles.tag}>내 매장</span>}
                                    {row.isNew && <span className={styles.tagMuted}>새로 오픈</span>}
                                    {sub && <small>{sub}</small>}
                                </th>
                                <td><CellBar value={row.visitorReviews} max={maxVisitor} /></td>
                                <td><CellBar value={row.blogReviews} max={maxBlog} /></td>
                                {showSave && <td className={styles.numCell}>{row.saveText || '-'}</td>}
                                {showScore && <td className={styles.numCell}>{row.score ? row.score.toFixed(2) : '-'}</td>}
                                {showDistance && <td className={styles.numCell}>{row.isTarget ? '-' : kmLabel(distances[index])}</td>}
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

// 내 매장 신호를 진단용으로 모읍니다. 상위 100위 밖이면 매장 화면(place)에 없는 값은 '확인 불가'(null).
function buildMine(place, result) {
    const t = result.target;
    const pick = (value) => (value === null || value === undefined ? null : value);
    return {
        visitorReviews: place.visitorReviews,
        blogReviews: place.blogReviews,
        score: place.visitorScore,
        imageCount: t ? pick(t.imageCount) : null,
        saveCount: t ? parseCount(t.saveText) : null,
        hasBooking: t ? pick(t.hasBooking) : null,
        hasOrder: t ? pick(t.hasOrder) : null,
        hasCoupon: t && t.couponCount !== null && t.couponCount !== undefined ? t.couponCount > 0 : null,
        hasMembership: t ? pick(t.hasMembership) : null,
        hasNPay: t ? pick(t.hasNPay) : null,
        hasPos: t ? pick(t.hasPos) : null,
    };
}

const VERDICT = {
    behind: { label: '뒤처짐', tone: 'bad', Icon: TrendingDown },
    near: { label: '비슷', tone: 'warn', Icon: Minus },
    ahead: { label: '앞섬', tone: 'good', Icon: TrendingUp },
};

const FEATURE_ICON = {
    booking: CalendarCheck, order: ShoppingBag, coupon: Ticket,
    membership: BadgeCheck, npay: CreditCard, pos: Utensils,
};

function signalText(signal, value) {
    if (value === null || value === undefined) return '확인 불가';
    const num = signal.key === 'score' ? value.toFixed(2) : formatNumber(value);
    return `${num}${signal.unit}`;
}

// 상위 100곳(내 매장 제외)의 공개 신호와 내 매장을 막대(내 매장)와 눈금(상위 중간값)으로 비교합니다.
function RankDiagnosis({ diagnosis, na = {} }) {
    if (!diagnosis) return null;
    const { signals, features, behind, count } = diagnosis;
    if (signals.length === 0 && features.length === 0) return null;
    // 상위 매장은 쓰지만 이 업종에는 해당 없는 도구(약국의 쿠폰·예약, 병의원의 쿠폰)는 '내 매장 미운영'(빨강) 대신 '해당 없음'으로 보이고 이유를 아래에 적습니다.
    const reasonOf = (feature) => (feature.key === 'booking' ? na.booking : feature.key === 'coupon' ? na.coupon : null) || null;
    const naNotes = features.map((feature) => [feature.label, reasonOf(feature)]).filter(([, reason]) => reason);
    return (
        <div className={styles.diag}>
            <div className={styles.diagHead}>
                <h4>상위 {count}곳과 비교</h4>
                <p>
                    {behind > 0
                        ? `상위권이 앞서는 항목이 ${behind}개 있습니다. 리뷰·사진·저장처럼 꾸준히 쌓이는 신호부터 채우면 순위에 도움이 될 수 있습니다.`
                        : '숫자 신호는 상위권과 비슷하거나 앞섭니다.'}
                </p>
                <p className={styles.diagKey}>
                    <span className={styles.keyBar} aria-hidden="true" /> 내 매장
                    <span className={styles.keyTick} aria-hidden="true" /> 상위 중간값
                </p>
            </div>
            {signals.length > 0 && (
                <ul className={styles.bullets}>
                    {signals.map((signal, index) => {
                        const verdict = VERDICT[signal.verdict];
                        const scale = Math.max(signal.best || 0, signal.mine || 0, signal.median || 0) || 1;
                        return (
                            <li key={signal.key} style={{ '--d': index }}>
                                <span className={styles.bulletLabel}>{signal.label}</span>
                                <span className={styles.bulletTrack} aria-hidden="true">
                                    <span className={styles.fill} data-tone={verdict?.tone} style={{ '--w': signal.mine !== null ? signal.mine / scale : 0 }} />
                                    <span className={styles.medianTick} style={{ '--x': (signal.median || 0) / scale }} />
                                </span>
                                <span className={styles.bulletText}>
                                    내 매장 <b>{signalText(signal, signal.mine)}</b>
                                    <span> · 중간 {signalText(signal, signal.median)} · 최고 {signalText(signal, signal.best)}</span>
                                </span>
                                {verdict ? (
                                    <span className={styles.verdict} data-tone={verdict.tone}>
                                        <verdict.Icon size={14} aria-hidden="true" />{verdict.label}
                                    </span>
                                ) : (
                                    <span className={styles.verdict} data-tone="muted">확인 불가</span>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}
            {features.length > 0 && (
                <ul className={styles.adoption}>
                    {features.map((feature, index) => {
                        const Icon = FEATURE_ICON[feature.key] || CheckCircle2;
                        const notApplicable = Boolean(reasonOf(feature)) && feature.mine !== true;
                        const mineState = notApplicable ? 'na' : feature.mine === true ? 'yes' : feature.mine === false ? 'no' : 'unknown';
                        const mineLabel = notApplicable ? (feature.key === 'booking' ? notApplicableTag('booking') : '이 업종에는 해당 없음') : feature.mine === true ? '내 매장 운영' : feature.mine === false ? '내 매장 미운영' : '확인 불가';
                        return (
                            <li key={feature.key} style={{ '--d': index }}>
                                <span className={styles.adoptLabel}><Icon size={14} aria-hidden="true" /> {feature.label}</span>
                                <span className={styles.adoptTrack} aria-hidden="true">
                                    <span className={styles.fill} style={{ '--w': feature.known ? feature.have / feature.known : 0 }} />
                                </span>
                                <span className={styles.adoptText}>상위 {feature.known}곳 중 <b>{feature.have}곳</b> 운영</span>
                                <span className={styles.mineState} data-state={mineState}>{mineLabel}</span>
                            </li>
                        );
                    })}
                </ul>
            )}
            {naNotes.map(([label, reason]) => (
                <p key={label} className={styles.naReason}>{label}: {reason}</p>
            ))}
            <p className={styles.note}>저장 수는 네이버가 구간(예: ~100)으로만 공개해 대략값입니다. 순위는 광고를 뺀 기본 목록 순서입니다.</p>
        </div>
    );
}

// 상위 매장 두 곳 이상이 함께 등록한 대표키워드
function CommonKeywords({ mine, items }) {
    const common = keywordFrequency(mine || [], items).filter((entry) => entry.count >= 2);
    if (common.length === 0) return null;
    return (
        <div className={styles.common}>
            <h5>두 곳 이상이 함께 쓰는 키워드</h5>
            <p>
                {common.map((entry) => (
                    <span key={entry.keyword} className={entry.mine ? styles.wordMine : styles.word}>
                        {entry.keyword} · {entry.count}곳{entry.mine && <small> 내 매장도 사용</small>}
                    </span>
                ))}
            </p>
        </div>
    );
}

/* ───────── 리뷰 · 활동 ───────── */

// prefix: 줄마다 붙는 그래프 점 id 의 앞말(lib/place-graph.js addCountList 의 prefix 와 같게. 예: vote → 'vote:친절해요')
function CountList({ title, items, unit = '회', d = 0, node, prefix }) {
    const [more, setMore] = useState(false);
    const list = items || [];
    // 그래프에서 고른 낱개가 접힌 줄에 있으면 펼칩니다.
    useUnfold(
        (id) => !more && Boolean(prefix) && list.findIndex((item) => `${prefix}:${item.label}` === id) >= COUNT_SHOWN,
        () => setMore(true),
    );
    if (!list.length) return null;
    const max = Math.max(...list.map((item) => item.count));
    const shown = more ? list : list.slice(0, COUNT_SHOWN);
    return (
        <div className={`${styles.countList} ${styles.rise}`} data-node={node} style={{ '--d': d }}>
            <h3>{title}</h3>
            <ul>
                {shown.map((item, index) => (
                    <li key={item.label} data-node={prefix ? `${prefix}:${item.label}` : undefined} style={{ '--d': d + Math.min(index, COUNT_SHOWN) * 0.6 }}>
                        <span className={styles.countLabel} title={item.label}>{item.label}</span>
                        <span className={styles.countTrack} aria-hidden="true">
                            <span className={styles.fill} style={{ '--w': item.count / max }} />
                        </span>
                        <span className={styles.countValue}>{formatNumber(item.count)}{unit}</span>
                    </li>
                ))}
            </ul>
            {list.length > COUNT_SHOWN && (
                <button type="button" className={styles.toggleBtn} onClick={() => setMore((prev) => !prev)} aria-expanded={more}>
                    <ChevronDown size={16} aria-hidden="true" />
                    {more ? '접기' : `${list.length - COUNT_SHOWN}개 더 보기`}
                </button>
            )}
        </div>
    );
}

// unmentioned: 등록한 대표키워드 가운데 블로그 후기에 한 번도 나오지 않은 것
function ReviewSection({ place, briefing, mentions, unmentioned = [] }) {
    // 미용실: 스타일별 누적 예약 수 / 블로그 후기에 업종·등록 키워드 낱말이 들어간 글 수
    const styleItems = (place.detail?.styles || []).map((style) => ({ label: style.name, count: style.count }));
    const mentionItems = (mentions?.terms || [])
        .filter((entry) => entry.count > 0)
        .sort((a, b) => b.count - a.count)
        .map((entry) => ({ label: entry.term, count: entry.count }));
    const hasCounts = place.reviewVotes.length + place.reviewThemes.length + place.reviewMenus.length + styleItems.length + mentionItems.length > 0;
    return (
        <Reveal id="sec-reviews" className={styles.section} data-group="voice" data-node="hub:voice">
            <SectionHead title="리뷰" hub="hub:voice">
                네이버가 방문자 리뷰를 집계한 값입니다. 소개글과 답글에 쓸 표현을 고를 때 참고하세요.
            </SectionHead>
            <div className={styles.reviewGrid}>
                <dl className={`${styles.figures} ${styles.rise}`} style={{ '--d': 1 }}>
                    <div data-node="rv:visitor">
                        <dt>방문자 리뷰</dt>
                        <dd><CountUp value={place.visitorReviews} /></dd>
                        {place.reviewAuthors ? <dd className={styles.figureNote}>{formatNumber(place.reviewAuthors)}명이 작성</dd> : null}
                    </div>
                    {place.textReviews !== null && place.textReviews !== undefined && (
                        <div data-node="rv:text">
                            <dt>글 리뷰</dt>
                            <dd><CountUp value={place.textReviews} /></dd>
                            {shareOf(place.textReviews, place.visitorReviews) !== null && <dd className={styles.figureNote}>방문자 리뷰 대비 {shareOf(place.textReviews, place.visitorReviews)}%</dd>}
                        </div>
                    )}
                    <div data-node="rv:photo">
                        <dt>사진 리뷰</dt>
                        <dd><CountUp value={place.photoReviews} /></dd>
                        {shareOf(place.photoReviews, place.visitorReviews) !== null && <dd className={styles.figureNote}>방문자 리뷰 대비 {shareOf(place.photoReviews, place.visitorReviews)}%</dd>}
                    </div>
                    <div data-node="rv:blog">
                        <dt>블로그·카페 리뷰</dt>
                        <dd><CountUp value={place.blogReviews} /></dd>
                    </div>
                    <div data-node="rv:score">
                        <dt>평점</dt>
                        <dd>{place.visitorScore ? <CountUp value={place.visitorScore} decimals={2} /> : <span className={styles.quiet}>표시 안 함</span>}</dd>
                        {place.visitorScore ? <dd className={styles.figureMeter}><Meter ratio={place.visitorScore / 5} tone="warn" /></dd> : null}
                    </div>
                </dl>
                <div className={styles.countLists}>
                    {hasCounts ? (
                        <>
                            <CountList title="손님이 고른 좋은 점" items={place.reviewVotes} unit="명" d={2} node="rv:vote" prefix="vote" />
                            <CountList title="많이 언급된 주제" items={place.reviewThemes} d={3} node="rv:theme" prefix="theme" />
                            <CountList title={`많이 언급된 ${itemWord(place)}`} items={place.reviewMenus} d={4} node="rv:menu" prefix="rmenu" />
                            <CountList title="예약 많은 스타일" items={styleItems} unit="건" d={5} node="ops:style" prefix="style" />
                            <CountList
                                title={`블로그 후기에 나온 낱말${mentions?.blogTotal ? ` (전체 ${formatNumber(mentions.blogTotal)}개 중)` : ''}`}
                                items={mentionItems}
                                unit="개"
                                d={6}
                                node="rv:mention"
                                prefix="bm"
                            />
                        </>
                    ) : (
                        <p className={`${styles.emptyPanel} ${styles.rise}`} style={{ '--d': 2 }}>아직 집계된 리뷰가 없습니다.</p>
                    )}
                </div>
            </div>
            {unmentioned.length > 0 && (
                <p className={styles.note}>
                    블로그 후기에 한 번도 나오지 않은 등록 대표키워드: {unmentioned.map((word) => `'${word}'`).join(', ')}. 손님이 쓰는 표현과 다른지 확인해 보세요.
                </p>
            )}
            {briefing && (
                <figure className={`${styles.briefing} ${styles.rise}`} data-node="rv:briefing" style={{ '--d': 5 }}>
                    <figcaption>
                        <strong>네이버 AI 브리핑</strong>
                        리뷰를 바탕으로 매장 화면에 보여 주는 요약입니다. 손님이 내 매장을 어떻게 기억하는지 확인하세요.
                    </figcaption>
                    <blockquote>
                        {/* 문장마다 그래프의 브리핑 점(brief:순서)과 잇습니다. 순서는 그래프와 같게 빈 문장을 뺀 뒤 셉니다. */}
                        {briefing.map((sentence) => String(sentence).trim()).filter(Boolean).map((sentence, index) => (
                            <p key={sentence} data-node={`brief:${index}`}>{sentence}</p>
                        ))}
                    </blockquote>
                </figure>
            )}
        </Reveal>
    );
}

const TILE_NODE = { last7: 'ac:week', reply: 'ac:reply', revisit: 'ac:revisit', blog: 'ac:blog', feed: 'ac:feed', coupon: 'ac:coupon' };

function ActivitySection({ activity, error, place }) {
    const { visitor, blog, feeds, coupons } = activity || {};
    const na = notApplicableOf(place);
    const tiles = [];
    if (visitor) {
        tiles.push({
            key: 'last7', label: '최근 7일 방문자 리뷰', value: visitor.last7, suffix: sampleSuffix(visitor.last7, visitor.sampled, visitor.total),
            note: visitor.perDay !== null ? `최근 ${formatNumber(visitor.sampled)}개 기준 하루 약 ${visitor.perDay}개` : null,
        });
        const replyTone = visitor.replyRate === null ? undefined : visitor.replyRate < 10 ? 'bad' : visitor.replyRate < 50 ? 'warn' : 'good';
        tiles.push({
            key: 'reply', label: '사장님 답글률', value: visitor.replyRate, suffix: '%', tone: replyTone,
            meter: visitor.replyRate === null ? undefined : visitor.replyRate / 100,
            note: `최근 ${formatNumber(visitor.sampled)}개 중 ${formatNumber(visitor.replied)}개 답글`,
        });
        tiles.push({
            key: 'revisit', label: '재방문 리뷰', value: visitor.revisitRate, suffix: '%',
            meter: visitor.revisitRate === null ? undefined : visitor.revisitRate / 100,
            note: '2번 이상 방문한 손님이 쓴 리뷰 비율',
        });
    }
    if (blog) {
        tiles.push({
            key: 'blog', label: '최근 30일 블로그 리뷰', value: blog.last30, suffix: sampleSuffix(blog.last30, blog.sampled, blog.total),
            tone: blog.total !== null && blog.last30 === 0 ? 'warn' : undefined,
            note: blog.latest ? `마지막 글 ${agoLabel(blog.latest)}` : '최근 글 없음',
        });
    }
    // 해당 없는 업종(na.feed·na.coupon 이 이유 문장)에서는 '없음'·0개 경고 대신 "해당 없음"과 이유 한 줄(lib 이 준 문장 그대로)을 보입니다.
    if (feeds) {
        if (na.feed) {
            tiles.push({ key: 'feed', label: '마지막 소식', text: '해당 없음', notApplicable: true, note: na.feed });
        } else {
            const stale = !feeds.latest || (feedDays(feeds) !== null && feedDays(feeds) > 30);
            tiles.push({
                key: 'feed', label: '마지막 소식', text: feeds.latest ? agoLabel(feeds.latest) : '없음', tone: stale ? 'warn' : undefined,
                note: feeds.latestTitle ? `${feeds.latestCategory ? `[${feeds.latestCategory}] ` : ''}${feeds.latestTitle}` : '소식 탭에 올린 글이 없습니다.',
            });
        }
    }
    if (coupons) {
        if (na.coupon) {
            tiles.push({ key: 'coupon', label: '쿠폰', text: '해당 없음', notApplicable: true, note: na.coupon });
        } else {
            tiles.push({
                key: 'coupon', label: '쿠폰', value: coupons.total, suffix: '개', tone: coupons.total === 0 ? 'warn' : undefined,
                note: coupons.titles.length ? coupons.titles.join(' · ') : coupons.memberships.length ? `멤버십: ${coupons.memberships.join(', ')}` : '등록된 쿠폰이 없습니다.',
            });
        }
    }
    return (
        <Reveal id="sec-activity" className={styles.section} data-group="voice" data-node="hub:activity">
            <SectionHead title="리뷰·소식 활동" hub="hub:activity">
                최근 방문자 리뷰 50개와 블로그 리뷰 30개의 날짜·답글 여부로 매장이 얼마나 활발한지 봅니다. 리뷰 내용과 작성자는 가져오지 않습니다.
            </SectionHead>
            {!activity ? (
                <p className={`${styles.emptyPanel} ${styles.rise}`} style={{ '--d': 1 }}>
                    {error || '리뷰·소식 활동을 불러오지 못했습니다. 잠시 후 다시 분석해주세요.'}
                </p>
            ) : (
                <dl className={styles.tiles}>
                    {tiles.map((tile, index) => (
                        <div key={tile.key} className={`${styles.tile} ${styles.rise}`} data-tone={tile.tone} data-na={tile.notApplicable ? 'true' : undefined} data-node={TILE_NODE[tile.key]} style={{ '--d': index + 1 }}>
                            <dt>{tile.label}</dt>
                            <dd className={styles.tileValue}>
                                {tile.text !== undefined ? tile.text : tile.value === null || tile.value === undefined ? '-' : <><CountUp value={tile.value} />{tile.suffix}</>}
                            </dd>
                            {tile.meter !== undefined && <dd><Meter ratio={tile.meter} tone={tile.tone} /></dd>}
                            {tile.note && <dd className={styles.tileNote}>{tile.note}</dd>}
                        </div>
                    ))}
                </dl>
            )}
        </Reveal>
    );
}

/* ───────── 결제 데이터(POS) ───────── */

const CHANGE_MARK = { UP: '▲', DOWN: '▼', NEW: 'NEW' };
const PRICE_SLOTS = [['morning', '아침'], ['lunch', '점심'], ['dinner', '저녁'], ['night', '밤']];

// 네이버페이 결제 단말(POS) 매장만 공개되는 결제 집계
function PosSection({ pos }) {
    const active = pos.weekly.flatMap((day) => day.hours.map((value, hour) => (value > 0 ? hour : null))).filter((hour) => hour !== null);
    const from = active.length ? Math.min(...active) : 0;
    const to = active.length ? Math.max(...active) : 23;
    const hours = Array.from({ length: to - from + 1 }, (_, i) => from + i);
    const max = Math.max(1, ...pos.weekly.flatMap((day) => day.hours));
    const maxShare = Math.max(1, ...pos.popularMenus.map((menu) => menu.share || 0));
    const price = pos.averagePrice;
    const prices = PRICE_SLOTS.filter(([key]) => price[key]);
    const maxPrice = Math.max(1, ...prices.map(([key]) => price[key]));
    return (
        <Reveal id="sec-pos" className={`${styles.section} ${styles.band}`} data-group="pay" data-node="hub:pos">
            <SectionHead title="결제 데이터" hub="hub:pos">
                네이버페이 결제 단말(POS)을 쓰는 매장에만 네이버가 공개하는 최근 1주 결제 집계입니다. 메뉴 구성과 영업 시간대를 정할 때 참고하세요.
            </SectionHead>
            <dl className={styles.kpis}>
                <div className={styles.rise} data-node="pos:sales" style={{ '--d': 1 }}>
                    <dt>주간 결제 건수</dt>
                    <dd>{pos.weeklySales !== null ? <><CountUp value={pos.weeklySales} /><small>건</small></> : '-'}</dd>
                </div>
                <div className={styles.rise} data-node="pos:price" style={{ '--d': 2 }}>
                    <dt>1회 평균 결제</dt>
                    <dd>{price.total ? <><CountUp value={price.total} /><small>원</small></> : '-'}</dd>
                </div>
                <div className={styles.rise} data-node="pos:day" style={{ '--d': 3 }}>
                    <dt>가장 붐비는 요일</dt>
                    <dd>{pos.busiestDay ? <>{pos.busiestDay}<small>요일</small></> : '-'}</dd>
                </div>
                <div className={styles.rise} data-node="pos:stay" style={{ '--d': 4 }}>
                    <dt>평균 체류 시간</dt>
                    <dd>{pos.stayMinutes ? <><CountUp value={pos.stayMinutes} /><small>분</small></> : '-'}</dd>
                </div>
            </dl>
            <div className={styles.posGrid}>
                {pos.popularMenus.length > 0 && (
                    <div className={`${styles.countList} ${styles.rise}`} data-node="pos:menu" style={{ '--d': 5 }}>
                        <h3>주간 인기 메뉴 (주문 점유율)</h3>
                        <ul>
                            {pos.popularMenus.map((menu, index) => (
                                <li key={menu.name} data-node={`pmenu:${menu.name}`} style={{ '--d': 5 + index * 0.6 }}>
                                    <span className={styles.countLabel}>{menu.name}</span>
                                    <span className={styles.countTrack} aria-hidden="true">
                                        <span className={styles.fill} style={{ '--w': Math.max(0.04, (menu.share || 0) / maxShare) }} />
                                    </span>
                                    <span className={styles.countValue}>
                                        {menu.share !== null ? `${menu.share}%` : '-'}
                                        {CHANGE_MARK[menu.change] && (
                                            <span className={styles.menuChange} data-dir={menu.change === 'DOWN' ? 'down' : menu.change === 'UP' ? 'up' : 'new'}>
                                                <span className={styles.arrow}>{CHANGE_MARK[menu.change]}</span>
                                            </span>
                                        )}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
                {prices.length > 0 && (
                    <div className={`${styles.countList} ${styles.rise}`} style={{ '--d': 6 }}>
                        <h3>시간대별 1회 평균 결제</h3>
                        <ul>
                            {prices.map(([key, label], index) => (
                                <li key={key} data-node={`pos:slot:${key}`} style={{ '--d': 6 + index * 0.6 }}>
                                    <span className={styles.countLabel}>{label}</span>
                                    <span className={styles.countTrack} aria-hidden="true">
                                        <span className={styles.fill} style={{ '--w': price[key] / maxPrice }} />
                                    </span>
                                    <span className={styles.countValue}>{won(price[key])}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>
            {pos.weekly.length > 0 && (
                <div className={`${styles.heat} ${styles.rise}`} style={{ '--d': 7 }}>
                    <h3>요일·시간대별 붐빔 <span>진할수록 손님이 많고, 흰 테두리가 그날 가장 붐비는 시간입니다.</span></h3>
                    <div className={styles.heatScroll}>
                        <table className={styles.heatTable}>
                            <caption className={styles.srOnly}>요일별 시간대 붐빔 정도. 각 요일의 가장 붐비는 시간은 행 제목에 적었습니다.</caption>
                            <thead>
                                <tr>
                                    <th scope="col"><span className={styles.srOnly}>요일</span></th>
                                    {hours.map((hour) => <th key={hour} scope="col">{hour + 1}</th>)}
                                </tr>
                            </thead>
                            <tbody>
                                {pos.weekly.map((day, row) => (
                                    <tr key={day.key} data-node={`pos:peak:${day.key}`}>
                                        <th scope="row" title={day.peakHour !== null ? `${day.day}요일 가장 붐비는 시간 ${day.peakHour}시` : undefined}>{day.day}</th>
                                        {hours.map((hour, col) => {
                                            const value = day.hours[hour] || 0;
                                            return (
                                                <td key={hour} aria-label={`${day.day} ${hour + 1}시 ${value}`} title={`${day.day}요일 ${hour + 1}시 · 가장 붐빌 때의 ${Math.round((value / max) * 100)}%`}>
                                                    <span
                                                        className={styles.heatCell}
                                                        data-zero={value > 0 ? undefined : 'true'}
                                                        data-peak={day.peakHour === hour + 1 ? 'true' : undefined}
                                                        style={{ '--v': value / max, '--col': col, '--row': row }}
                                                    />
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <p className={styles.note}>
                        가장 붐비는 시간: {pos.weekly.filter((day) => day.peakHour !== null).map((day) => `${day.day} ${day.peakHour}시`).join(' · ')}
                    </p>
                </div>
            )}
        </Reveal>
    );
}

/* ───────── 운영 정보 ───────── */

function Fact({ label, node, children }) {
    return (
        <div data-node={node}>
            <dt>{label}</dt>
            <dd>{children}</dd>
        </div>
    );
}

// 매장이 공개한 메뉴·가격표. 가격이나 사진이 빠진 메뉴를 눈에 띄게 표시합니다.
function MenuBoard({ place }) {
    const [open, setOpen] = useState(false);
    const menus = place.detail?.menus || [];
    // 그래프에서 고른 메뉴가 '더 보기' 뒤에 접혀 있으면 펼칩니다.
    useUnfold(
        (id) => !open && id.startsWith('menu:') && menus.findIndex((menu) => `menu:${menu.name}` === id) >= MENU_SHOWN,
        () => setOpen(true),
    );
    if (menus.length === 0) return null;
    const total = place.menuCount || menus.length;
    const unpriced = place.menuPricedCount === null || place.menuPricedCount === undefined ? null : total - place.menuPricedCount;
    // 미용실 가격표처럼 메뉴마다 사진을 붙이는 칸이 없는 업종은 사진 여부를 따지지 않습니다.
    const photoKnown = menus.some((menu) => menu.hasImage !== null && menu.hasImage !== undefined);
    const noPhoto = photoKnown ? total - (place.menuImageCount || 0) : 0;
    const gaps = [unpriced > 0 ? `가격 없는 메뉴 ${unpriced}개` : null, noPhoto > 0 ? `사진 없는 메뉴 ${noPhoto}개` : null].filter(Boolean);
    const shown = open ? menus : menus.slice(0, MENU_SHOWN);
    return (
        <div className={`${styles.menuBoard} ${styles.rise}`} data-node="ops:menu" style={{ '--d': 3 }}>
            <div className={styles.menuHead}>
                <h3>메뉴·가격 <span className={styles.slotCount}>{formatNumber(total)}</span></h3>
                <p>
                    {gaps.length > 0
                        ? `${gaps.join(', ')}가 있습니다. 채우면 손님이 방문 전에 비교하기 쉽습니다.`
                        : photoKnown ? '모든 메뉴에 가격과 사진이 있습니다.' : '모든 메뉴에 가격이 있습니다.'}
                    {place.detail.menuUpdatedAt ? ` 마지막 수정 ${place.detail.menuUpdatedAt}.` : ''}
                </p>
            </div>
            <ul className={styles.menuList} data-photo={photoKnown ? 'true' : undefined}>
                {shown.map((menu, index) => (
                    <li key={`${menu.name}-${index}`} data-node={`menu:${menu.name}`}>
                        <span className={styles.menuName}>
                            {menu.name}
                            {menu.recommended && <span className={styles.tagMuted}>대표</span>}
                        </span>
                        <span className={styles.menuPrice} data-missing={menu.price ? undefined : 'true'}>{menu.price || '가격 없음'}</span>
                        {photoKnown && (
                            <span className={styles.menuPhoto} data-missing={menu.hasImage ? undefined : 'true'}>{menu.hasImage ? '사진 있음' : '사진 없음'}</span>
                        )}
                    </li>
                ))}
            </ul>
            {menus.length > MENU_SHOWN && (
                <button type="button" className={styles.toggleBtn} onClick={() => setOpen((prev) => !prev)} aria-expanded={open}>
                    <ChevronDown size={16} aria-hidden="true" />
                    {open ? '접기' : `${menus.length - MENU_SHOWN}개 더 보기`}
                </button>
            )}
            {total > menus.length && <p className={styles.note}>메뉴가 많아 앞의 {menus.length}개만 보여 줍니다.</p>}
        </div>
    );
}

// 낱말 목록을 쉼표로 이어 쓰되, 낱말마다 그래프의 같은 점(prefix:낱말)과 잇습니다.
function NodeWords({ words, prefix }) {
    return words.map((word, index) => (
        <Fragment key={word}>
            {index > 0 && ', '}
            <span className={styles.factWord} data-node={`${prefix}:${word}`}>{word}</span>
        </Fragment>
    ));
}

function OpsSection({ place, activity }) {
    const detail = place.detail;
    const { hours, photos, tools, parking } = detail;
    // 쿠폰 수는 리뷰·소식 활동의 쿠폰 목록(제목이 있는 자료)이 있으면 그 수를 우선합니다. 같은 화면의 두 줄이 서로 다른 수를 말하지 않게.
    const couponCount = Number.isFinite(activity?.coupons?.total) ? activity.coupons.total : detail.couponCount;
    // 소식은 지금 할 일과 같은 사실로: 있으면 마지막이 며칠 전인지까지 적습니다.
    const feedGap = feedDays(activity?.feeds);
    // 이 업종에 해당 없는 항목: '없음'·'미사용' 대신 "해당 없음"으로 적고 이유를 한 줄씩 보입니다.
    const na = notApplicableOf(place);
    const naLines = [['예약', na.booking], ['쿠폰', na.coupon], ['소식', na.feed]].filter(([, reason]) => reason);
    const seats = (detail.seats || []).map((word) => String(word).trim()).filter(Boolean);
    const seatExtra = [
        detail.rental === true ? '대관 가능' : null,
        detail.corkage === true ? '콜키지 가능' : null,
    ].filter(Boolean);
    // 편의시설은 그래프와 같게 매장 요약의 편의 정보와 정보 탭의 시설을 겹치지 않게 합칩니다.
    const seenConv = new Set();
    const conveniences = [...(place.conveniences || []), ...(detail.facilities || [])].map((word) => String(word).trim()).filter((word) => {
        const key = word.replace(/\s+/g, '').toLowerCase();
        if (!key || seenConv.has(key)) return false;
        seenConv.add(key);
        return true;
    });
    const themes = detail.themes || [];
    const externalSites = detail.externalSites || [];
    // 메뉴판 사진 수는 메뉴를 올리는 업종에서만 뜻이 있어, 메뉴나 메뉴판 사진이 하나라도 있을 때만 보여 줍니다.
    const hasBoardCount = detail.menuBoardPhotos > 0 || (place.menuCount > 0 && detail.menuBoardPhotos === 0);
    return (
        <Reveal id="sec-ops" className={styles.section} data-group="ops" data-node="hub:ops">
            <SectionHead title="운영 정보" hub="hub:ops">
                매장 화면에 실린 영업시간·사진·네이버 도구 사용 현황입니다. 비어 있는 항목은 스마트플레이스에서 채울 수 있습니다.
            </SectionHead>
            <div className={styles.opsGrid}>
                <dl className={`${styles.facts} ${styles.rise}`} style={{ '--d': 1 }}>
                    <Fact label="영업 상태" node="ops:hours">
                        {hours?.registered
                            ? <>{hours.status || '등록됨'}{hours.statusText ? ` · ${hours.statusText}` : ''}{hours.regularClosed ? ` · 정기휴무 ${hours.regularClosed}` : ''}</>
                            : <span className={styles.warnText}>영업시간 미등록</span>}
                    </Fact>
                    <Fact label="사진" node="ops:photos">
                        {photos.business === 0
                            ? <span className={styles.warnText}>업체 사진 0장</span>
                            : <>업체 사진 {formatNumber(photos.business)}장</>}
                        {' '}· 전체 사진 {formatNumber(photos.top)}장 · 방문자 사진·영상 {formatNumber(photos.visitorMedia)}개
                        {hasBoardCount ? ` · 메뉴판 사진 ${formatNumber(detail.menuBoardPhotos)}장` : ''}
                    </Fact>
                    {tools.length > 0 && (
                        <Fact label="네이버 도구">
                            <span className={styles.chipRow}>
                                {tools.map((tool) => {
                                    // 약국의 네이버 예약처럼 해당 없는 도구는 '미사용'(할 일처럼 보임) 대신 '해당 없음'
                                    const notApplicable = Boolean(na.booking) && tool.type === 'naverBooking' && !tool.using;
                                    return (
                                        <span key={tool.type} className={tool.using ? styles.chipOn : styles.chipOff}>
                                            {tool.title} {tool.using ? '사용 중' : notApplicable ? '확인 안 됨' : '미사용'}
                                        </span>
                                    );
                                })}
                            </span>
                        </Fact>
                    )}
                    <Fact label="예약·쿠폰" node="ops:booking">
                        {na.booking ? `예약 — ${notApplicableTag('booking')}` : detail.hasBooking === null ? '예약 확인 불가' : detail.hasBooking ? '네이버 예약 연결됨' : '네이버 예약 없음'}
                        {!na.booking && detail.bookingItemCount > 0 ? ` (예약 상품 ${formatNumber(detail.bookingItemCount)}개)` : ''}
                        {na.coupon ? ' · 쿠폰 해당 없음' : couponCount !== null && couponCount !== undefined ? ` · 쿠폰 ${formatNumber(couponCount)}개` : ''}
                        {na.feed ? ' · 소식 해당 없음' : detail.hasFeed !== null ? ` · ${detail.hasFeed ? (Number.isFinite(feedGap) ? `소식: 마지막 ${feedGap}일 전` : '소식 있음') : '소식 없음'}` : ''}
                        {naLines.map(([label, reason]) => (
                            <small key={label} className={styles.naReason}>{label}: {reason}</small>
                        ))}
                    </Fact>
                    {detail.bookingPromotion && <Fact label="예약 혜택 문구">{detail.bookingPromotion}</Fact>}
                    {(detail.stylistCount > 0 || themes.length > 0) && (
                        <Fact label="디자이너·특징">
                            {[detail.stylistCount > 0 ? `디자이너 ${formatNumber(detail.stylistCount)}명` : null, ...themes].filter(Boolean).join(' · ')}
                        </Fact>
                    )}
                    {(seats.length > 0 || seatExtra.length > 0) && (
                        <Fact label="좌석·대관" node="ops:seat">
                            <NodeWords words={seats} prefix="seat" />
                            {seatExtra.length > 0 && `${seats.length > 0 ? ' · ' : ''}${seatExtra.join(' · ')}`}
                        </Fact>
                    )}
                    {typeof detail.hasAiBriefing === 'boolean' && (
                        <Fact label="네이버 AI 브리핑">{detail.hasAiBriefing ? '매장 화면에 노출 중' : '아직 노출되지 않음'}</Fact>
                    )}
                    {parking && (
                        <Fact label="주차" node="ops:parking">
                            {parking.available ? `가능${parking.free === true ? ' (무료)' : parking.free === false ? ' (유료)' : ''}${parking.valet ? ' · 발레파킹' : ''}` : '정보 없음'}
                        </Fact>
                    )}
                    {conveniences.length > 0 && (
                        <Fact label="편의시설" node="ops:conv">
                            <NodeWords words={conveniences} prefix="conv" />
                            {detail.pet === true ? ' · 반려동물 동반' : ''}
                        </Fact>
                    )}
                    {detail.links.length > 0 && <Fact label="연결 채널" node="ops:links">{detail.links.join(', ')}</Fact>}
                    {externalSites.length > 0 && <Fact label="함께 보이는 서비스">{externalSites.join(', ')}</Fact>}
                    {detail.subway && (
                        <Fact label="가까운 역" node="ops:subway">
                            {detail.subway.station}{detail.subway.exit ? ` ${detail.subway.exit}번 출구` : ''}{detail.subway.walkMinutes ? ` · 걸어서 ${detail.subway.walkMinutes}분` : ''}
                        </Fact>
                    )}
                    {!detail.subway && detail.busStops > 0 && (
                        <Fact label="대중교통">가까운 버스 정류장 {formatNumber(detail.busStops)}곳 (지하철역 정보 없음)</Fact>
                    )}
                    {(detail.badges.length > 0 || detail.benefits.length > 0 || detail.newOpening) && (
                        <Fact label="표시 배지·혜택">
                            {[detail.newOpening ? '새로 오픈' : null, ...detail.badges, ...detail.benefits].filter(Boolean).join(' · ')}
                        </Fact>
                    )}
                    {detail.menuUpdatedAt && <Fact label="메뉴 수정일">{detail.menuUpdatedAt}</Fact>}
                </dl>
                {hours?.registered && hours.days.length > 0 && (
                    <div className={`${styles.week} ${styles.rise}`} style={{ '--d': 2 }}>
                        <h3>영업시간</h3>
                        <table>
                            <caption className={styles.srOnly}>요일별 영업시간과 브레이크 타임</caption>
                            <tbody>
                                {hours.days.map((day) => (
                                    <tr key={day.day} data-closed={day.start && day.end ? undefined : 'true'}>
                                        <th scope="row">{day.day}</th>
                                        <td>{day.start && day.end ? `${day.start}~${day.end}` : '휴무'}</td>
                                        <td>{day.breaks.length > 0 ? `브레이크 ${day.breaks.join(', ')}` : ''}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
            <MenuBoard place={place} />
        </Reveal>
    );
}

/* ───────── 페이지 ───────── */

export default function PlaceInsightPage() {
    const { status } = useSession();
    const router = useRouter();

    const [meta, setMeta] = useState({ enabled: true, pausedUntil: null, saved: [] });
    const [url, setUrl] = useState('');
    const [loadingPlace, setLoadingPlace] = useState(false);
    const [place, setPlace] = useState(null);
    const [placeInfo, setPlaceInfo] = useState(null);
    const [activity, setActivity] = useState(null);
    const [activityError, setActivityError] = useState(null);
    const [saving, setSaving] = useState(false);
    // 입력을 고쳐야 하는 오류(빈 값·틀린 주소·없는 매장). 입력 칸에 빨간 테두리로 표시하고 다시 입력하면 지웁니다.
    const [urlError, setUrlError] = useState(false);
    const [keywordError, setKeywordError] = useState(false);
    // 다른 매장을 새로 분석하면 진행 중이던 순위 조회를 멈추기 위한 번호
    const rankRun = useRef(0);
    const urlInput = useRef(null);
    const keywordInput = useRef(null);

    const [keywordText, setKeywordText] = useState('');
    const [deep, setDeep] = useState(false);
    const [record, setRecord] = useState(false);
    const [ranking, setRanking] = useState(false);
    const [ranks, setRanks] = useState([]);
    const [openKeyword, setOpenKeyword] = useState(null);
    const [rivals, setRivals] = useState({});
    // 이 매장에서 읽은 상위 매장 대표키워드 모음(키워드를 바꿔 조회해도 유지). 추천 키워드와 비교하는 데 씁니다.
    const [rivalPool, setRivalPool] = useState([]);
    const [comparing, setComparing] = useState(false);
    // 첫 분석 때 순위를 자동 조회한 키워드 구성: { skipped: 지역이 없어 뺀 등록 키워드, added: 대신 넣은 추천 키워드 }
    const [rankPick, setRankPick] = useState(null);
    const [activeSection, setActiveSection] = useState(null);
    const sheetRef = useRef(null);
    const graphRef = useRef(null);
    const indexRef = useRef(null);
    // 그래프 ↔ 카드 연결 상태(렌더와 무관해 ref 로 둠): 지금 가리킨 카드, '그래프' 버튼을 누른 자리, 강조 해제 타이머
    const linkState = useRef({ card: null, pin: null, pinTimer: 0, flashTimer: 0 });
    // 본문의 접히는 목록(더 보기·탭)이 등록하는 곳(unfold.js). 그래프에서 고른 줄이 접혀 있으면 펼칠 때 씁니다.
    const unfoldRef = useRef(null);
    if (!unfoldRef.current) unfoldRef.current = new Set();

    const fetchMeta = useCallback(async () => {
        try {
            const res = await fetch('/api/place-insight');
            if (!res.ok) return;
            const data = await res.json();
            setMeta({ enabled: data.enabled !== false, pausedUntil: data.pausedUntil || null, saved: cleanSaved(data.saved) });
        } catch (error) {
            console.error('Error fetching place insight meta:', error);
        }
    }, []);

    useEffect(() => {
        if (status === 'unauthenticated') {
            router.push('/login');
        } else if (status === 'authenticated') {
            fetchMeta();
        }
    }, [status, router, fetchMeta]);

    // 조회하는 동안 입력 칸이 잠겨 초점을 잃으므로, 입력을 고쳐야 하는 오류로 끝나면 초점을 돌려줍니다.
    useEffect(() => {
        if (urlError && !loadingPlace) urlInput.current?.focus();
    }, [urlError, loadingPlace]);

    const analyze = async (value) => {
        const target = String(value || '').trim();
        if (!target) {
            setUrlError(true);
            urlInput.current?.focus();
            toast.error('플레이스 주소 또는 ID를 입력해주세요.');
            return;
        }
        setUrlError(false);
        setLoadingPlace(true);
        setPlace(null);
        setPlaceInfo(null);
        setActivity(null);
        setActivityError(null);
        setRanks([]);
        setRivals({});
        setRivalPool([]);
        setComparing(false);
        setRankPick(null);
        setOpenKeyword(null);
        rankRun.current += 1;
        setRanking(false);
        try {
            const res = await fetch('/api/place-insight', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: target }),
            });
            const data = await res.json();
            if (!res.ok) {
                toast.error(errorText(data, '플레이스를 조회하지 못했습니다.'));
                // 조회 제한·서버 오류는 입력 탓이 아니므로, 주소가 틀렸거나 매장이 없을 때만 입력 칸에 표시합니다.
                if (res.status === 400 || res.status === 404) setUrlError(true);
                if (data.retryAt || data.disabled) fetchMeta();
                return;
            }
            // 응답의 목록에 섞인 null·잘못된 줄은 여기서 한 번에 걸러 낸 뒤 씁니다(응답 정리).
            const cleanedPlace = cleanPlace(data.place);
            const cleanedActivity = cleanActivity(data.activity) || null;
            setPlace(cleanedPlace);
            setPlaceInfo({ fetchedAt: data.fetchedAt, cached: data.cached, saved: data.saved, change: data.change });
            setActivity(cleanedActivity);
            setActivityError(data.activityError || null);
            // 순위는 지역이 들어간 키워드로 봐야 의미가 있어, 지역 없는 등록 키워드 대신 추천 키워드(지역 + 업종)를 씁니다.
            const pick = pickRankKeywords(cleanedPlace, recommendKeywords({ place: cleanedPlace, activity: cleanedActivity }), MAX_KEYWORDS);
            setRankPick(pick);
            setKeywordText(pick.keywords.join(', '));
            if (data.saved) fetchMeta();
            // 매장 코드 하나로 전체 분석이 끝나도록 키워드 순위와 상위 매장 대표키워드 비교까지 이어서 조회합니다.
            if (pick.keywords.length > 0) checkRanks(cleanedPlace.placeId, pick.keywords, { compare: true });
        } catch (error) {
            console.error('Error analyzing place:', error);
            toast.error('플레이스 조회 중 오류가 발생했습니다.');
        } finally {
            setLoadingPlace(false);
        }
    };

    const handleSubmit = (event) => {
        event.preventDefault();
        analyze(url);
    };

    const savePlace = async () => {
        if (!place) return;
        setSaving(true);
        try {
            const res = await fetch('/api/place-insight/saved', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ placeId: place.placeId }),
            });
            const data = await res.json();
            if (!res.ok) {
                toast.error(errorText(data, '매장을 저장하지 못했습니다.'));
                return;
            }
            toast.success(data.message);
            setPlaceInfo((prev) => ({ ...prev, saved: true }));
            fetchMeta();
        } catch (error) {
            console.error('Error saving place:', error);
            toast.error('매장 저장 중 오류가 발생했습니다.');
        } finally {
            setSaving(false);
        }
    };

    const removeSaved = async (saved) => {
        if (!window.confirm(`'${saved.name}'을(를) 내 매장에서 삭제할까요? 쌓아 둔 리뷰 수 기록도 함께 지워집니다.`)) return;
        try {
            const res = await fetch(`/api/place-insight/saved?placeId=${saved.placeId}`, { method: 'DELETE' });
            const data = await res.json();
            if (!res.ok) {
                toast.error(errorText(data, '삭제하지 못했습니다.'));
                return;
            }
            toast.success(data.message);
            if (place?.placeId === saved.placeId) setPlaceInfo((prev) => ({ ...prev, saved: false, change: null }));
            fetchMeta();
        } catch (error) {
            console.error('Error removing saved place:', error);
            toast.error('삭제 중 오류가 발생했습니다.');
        }
    };

    const copyWords = async (words, label) => {
        try {
            await navigator.clipboard.writeText(words.join(', '));
            toast.success(`${label}를 복사했습니다.`);
        } catch {
            toast.error('복사하지 못했습니다. 직접 선택해 복사해주세요.');
        }
    };

    const copyKeywords = () => copyWords(place.keywords, '대표키워드');

    // 키워드 1개의 순위를 조회해 순위 표의 그 줄을 채웁니다.
    // 돌려주는 값: { result: 조회 결과 또는 null, stop: 조회 제한·횟수 초과라 이어서 조회하면 안 됨 }
    const fetchRank = async (placeId, keyword, run) => {
        const setRow = (row) => setRanks((prev) => prev.map((item) => (item.keyword === keyword ? { keyword, ...row } : item)));
        try {
            const res = await fetch('/api/place-insight/rank', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ placeId, keyword, deep, record }),
            });
            // 그사이 다른 매장을 분석했으면 이 조회는 버립니다.
            if (rankRun.current !== run) return { result: null, stop: true };
            const data = await res.json();
            if (!res.ok) {
                const message = errorText(data, '순위를 조회하지 못했습니다.');
                setRow({ state: 'error', error: message });
                // 조회 제한·횟수 초과면 남은 키워드도 실패하므로 멈춥니다.
                if (res.status === 429 || res.status === 503) {
                    toast.error(message);
                    fetchMeta();
                    return { result: null, stop: true };
                }
                return { result: null, stop: false };
            }
            const result = cleanRank(data.result);
            setRow({ state: 'done', result, recorded: data.recorded });
            return { result, stop: false };
        } catch (error) {
            console.error('Error fetching rank:', error);
            setRow({ state: 'error', error: '순위 조회 중 오류가 발생했습니다.' });
            return { result: null, stop: false };
        }
    };

    // 상위 5곳의 대표키워드를 읽어 그 키워드 줄에 보여 주고, 추천 키워드와 비교할 모음에도 넣습니다.
    // quiet: 자동으로 부른 경우. 실패해도 알림을 띄우지 않습니다(버튼으로 다시 할 수 있음).
    const loadRivals = async (result, { quiet = false } = {}) => {
        const placeIds = result.top.filter((row) => !row.isTarget).slice(0, 5).map((row) => row.placeId);
        if (placeIds.length === 0) return;
        const run = rankRun.current;
        setComparing(true);
        setRivals((prev) => ({ ...prev, [result.keyword]: { loading: true } }));
        try {
            const res = await fetch('/api/place-insight/keywords', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ placeIds }),
            });
            const data = await res.json();
            if (rankRun.current !== run) return;
            if (!res.ok) {
                if (!quiet) toast.error(errorText(data, '대표키워드를 조회하지 못했습니다.'));
                setRivals((prev) => ({ ...prev, [result.keyword]: undefined }));
                return;
            }
            const items = cleanRivals(data.items);
            setRivals((prev) => ({ ...prev, [result.keyword]: { loading: false, items, failed: data.failed } }));
            setRivalPool((prev) => {
                const known = new Set(prev.map((item) => item.placeId));
                return [...prev, ...items.filter((item) => !known.has(item.placeId))];
            });
        } catch (error) {
            console.error('Error fetching rival keywords:', error);
            if (rankRun.current !== run) return;
            if (!quiet) toast.error('대표키워드 조회 중 오류가 발생했습니다.');
            setRivals((prev) => ({ ...prev, [result.keyword]: undefined }));
        } finally {
            if (rankRun.current === run) setComparing(false);
        }
    };

    // 키워드를 하나씩 차례로 조회합니다(네이버에 한꺼번에 몰리지 않게).
    // compare: 조회가 끝나면 상위 매장 대표키워드까지 이어서 읽습니다(첫 분석 때 한 번).
    const checkRanks = async (placeId, keywords, { compare = false } = {}) => {
        const run = rankRun.current + 1;
        rankRun.current = run;
        setRanking(true);
        setComparing(false);
        setRivals({});
        setOpenKeyword(keywords[0]);
        setRanks(keywords.map((keyword) => ({ keyword, state: 'loading' })));
        let stopped = false;
        let comparable = null;

        for (const keyword of keywords) {
            if (rankRun.current !== run) return;
            if (stopped) {
                setRanks((prev) => prev.map((row) => (row.keyword === keyword ? { keyword, state: 'error', error: '조회를 멈췄습니다.' } : row)));
                continue;
            }
            const outcome = await fetchRank(placeId, keyword, run);
            if (rankRun.current !== run) return;
            if (outcome.stop) stopped = true;
            // 내 매장 말고 두 곳 이상이 나온 첫 키워드의 상위 매장과 비교합니다.
            if (!comparable && outcome.result && outcome.result.top.filter((row) => !row.isTarget).length >= 2) comparable = outcome.result;
        }
        setRanking(false);
        if (compare && !stopped && comparable) loadRivals(comparable, { quiet: true });
    };

    // 추천 키워드의 '순위 보기': 이미 조회한 키워드면 그 줄로 가고, 아니면 순위 표 끝에 한 줄을 덧붙여 조회합니다.
    const addRank = async (keyword) => {
        if (!place) return;
        const index = ranks.findIndex((row) => row.keyword === keyword);
        if (index >= 0) {
            // 펼침을 먼저 화면에 반영한 뒤 이동합니다(이유는 아래 openRank 설명 참고).
            if (ranks[index].state === 'done') flushSync(() => setOpenKeyword(keyword));
            scrollToId(`rank-row-${index}`);
            return;
        }
        if (ranking) return;
        if (ranks.length >= RANK_ROWS_MAX) {
            toast.error(`순위 표에는 ${RANK_ROWS_MAX}개까지 담을 수 있습니다. 아래 입력 칸에 키워드를 넣어 다시 조회해주세요.`);
            return;
        }
        const run = rankRun.current;
        const row = ranks.length;
        setRanking(true);
        setRanks((prev) => [...prev, { keyword, state: 'loading' }]);
        setOpenKeyword(keyword);
        requestAnimationFrame(() => scrollToId(`rank-row-${row}`));
        await fetchRank(place.placeId, keyword, run);
        if (rankRun.current === run) setRanking(false);
    };

    const runRanks = (event) => {
        event.preventDefault();
        if (!place) return;
        const keywords = splitKeywords(keywordText);
        const problem = keywords.length === 0
            ? '순위를 볼 키워드를 입력해주세요.'
            : keywords.length > MAX_KEYWORDS
                ? `키워드는 한 번에 ${MAX_KEYWORDS}개까지 조회할 수 있습니다.`
                : keywords.some((word) => word.length > 40)
                    ? '키워드는 40자 이하로 입력해주세요.'
                    : null;
        if (problem) {
            setKeywordError(true);
            keywordInput.current?.focus();
            toast.error(problem);
            return;
        }
        setKeywordError(false);
        setRankPick(null);
        checkRanks(place.placeId, keywords);
    };

    // 추천 키워드 여러 개를 한 번에 조회합니다(입력 칸도 같은 키워드로 맞춤).
    const rankRecommended = (keywords) => {
        if (!place || keywords.length === 0) return;
        setKeywordText(keywords.join(', '));
        setKeywordError(false);
        setRankPick(null);
        checkRanks(place.placeId, keywords);
        scrollToId('sec-rank');
    };

    const paused = meta.pausedUntil && meta.pausedUntil > Date.now();
    const unavailable = !meta.enabled || paused;
    const myKeywordKeys = new Set((place?.keywords || []).map((word) => String(word ?? '').replace(/\s+/g, '').toLowerCase()));
    const recommendation = useMemo(
        () => (place ? recommendKeywords({ place, activity, rivals: rivalPool, ranks }) : null),
        [place, activity, rivalPool, ranks],
    );
    const actions = useMemo(() => (place ? buildActionItems(place, activity, { recommendation }) : []), [place, activity, recommendation]);
    // 상위 매장과 비교할 수 있는 순위 결과(내 매장 말고 두 곳 이상 나온 첫 키워드)
    const comparable = ranks.find((row) => row.state === 'done' && row.result.top.filter((item) => !item.isTarget).length >= 2)?.result || null;
    const graph = useMemo(() => {
        if (loadingPlace) return LOADING_GRAPH;
        return place ? buildPlaceGraph({ place, activity, ranks, rivals, rivalPool, recommendation, actions }) : IDLE_GRAPH;
    }, [loadingPlace, place, activity, ranks, rivals, rivalPool, recommendation, actions]);
    // 점마다 한 단계 위의 점. 자기 카드가 없는 세부 점에서 윗단계 카드를 찾을 때 씁니다.
    const parentOf = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node.parent])), [graph]);
    const showResult = place && !loadingPlace;

    const sections = useMemo(() => {
        if (!place) return [];
        return [
            { id: 'sec-todo', group: 'todo', label: '지금 할 일', count: actions.length || null },
            { id: 'sec-rank', group: 'search', label: '키워드 순위' },
            { id: 'sec-reviews', group: 'voice', label: '리뷰' },
            { id: 'sec-activity', group: 'voice', label: '활동' },
            { id: 'sec-geo', group: 'geo', label: 'AI 검색' },
            place.detail?.pos ? { id: 'sec-pos', group: 'pay', label: '결제 데이터' } : null,
            place.detail ? { id: 'sec-ops', group: 'ops', label: '운영 정보' } : null,
        ].filter(Boolean);
    }, [place, actions]);

    // 좁은 화면에서는 목차가 옆으로 넘칩니다. 보고 있는 구역의 칸이 가려져 있으면 목차만 옆으로 밀어 보이게 합니다.
    // 목차가 위에 붙으면 첫 칸('↑ 매장 이름')이 왼쪽에 멈춰 서서 그 밑으로 칸이 지나가므로, 그 칸의 오른쪽부터가 보이는 자리입니다.
    // (scrollIntoView 는 목차가 화면 밖에 있을 때 페이지까지 움직이므로 쓰지 않습니다.)
    const fitIndex = useCallback(() => {
        const nav = indexRef.current;
        const link = nav?.querySelector('a[aria-current="true"]');
        if (!nav || !link) return;
        const navBox = nav.getBoundingClientRect();
        const box = link.getBoundingClientRect();
        let left = navBox.left + (parseFloat(getComputedStyle(nav).paddingLeft) || 0);
        const home = nav.querySelector('button');
        if (home && nav.dataset.stuck === 'true') left = Math.max(left, home.getBoundingClientRect().right);
        const right = navBox.right - 16;
        const delta = box.right > right ? box.right - right : box.left < left ? box.left - left : 0;
        if (delta) nav.scrollBy({ left: delta, behavior: reducedMotion() ? 'auto' : 'smooth' });
    }, []);

    // 스크롤에 맞춰 목차 아래 진행 막대를 채우고, 목차가 위에 붙으면 매장 이름을 꺼내고,
    // 지금 보고 있는 구역(목차 바로 아래를 지난 마지막 구역)을 목차에 표시합니다.
    useEffect(() => {
        const nav = indexRef.current;
        if (!showResult || !nav) return undefined;
        let raf = 0;
        let refit = 0;
        const update = () => {
            raf = 0;
            const stage = document.getElementById('sec-summary');
            const start = stage ? stage.getBoundingClientRect().bottom + window.scrollY : 0;
            const end = document.documentElement.scrollHeight - window.innerHeight;
            const progress = end > start ? Math.min(1, Math.max(0, (window.scrollY - start) / (end - start))) : 0;
            nav.style.setProperty('--p', progress.toFixed(4));
            const stuck = nav.getBoundingClientRect().top <= 0.5 ? 'true' : 'false';
            if (nav.dataset.stuck !== stuck) {
                nav.dataset.stuck = stuck;
                // 첫 칸이 펼쳐지거나 접히며(0.35초) 다른 칸이 밀리므로, 끝난 뒤 보고 있는 칸이 가려졌는지 다시 봅니다.
                clearTimeout(refit);
                refit = setTimeout(fitIndex, 420);
            }
            const line = nav.getBoundingClientRect().bottom + 72;
            let current = null;
            for (const section of sections) {
                const el = document.getElementById(section.id);
                if (el && el.getBoundingClientRect().top <= line) current = section.id;
            }
            // 맨 아래까지 내리면 마지막 구역이 목차 줄에 닿지 못해도 그 구역을 보고 있는 것으로 칩니다.
            if (sections.length && window.scrollY >= end - 2 && end > start) current = sections[sections.length - 1].id;
            // 카드로 이동해 도착한 직후: 그 자리에서 크게 벗어나지 않았으면 도착한 카드가 든 구역을 켭니다.
            const arrival = linkState.current.arrival;
            if (arrival) {
                if (Math.abs(window.scrollY - arrival.y) < 160) current = arrival.id;
                else linkState.current.arrival = null;
            }
            setActiveSection(current);
        };
        let trail = 0;
        const onScroll = () => {
            if (!raf) raf = requestAnimationFrame(update);
            // 화면 갱신이 밀려 마지막 위치를 놓쳐도, 스크롤이 멈춘 뒤 한 번은 다시 읽습니다
            // (목차가 위에 붙었는데 첫 칸 '↑ 매장 이름'이 꺼진 채 남는 일을 막습니다).
            clearTimeout(trail);
            trail = setTimeout(update, 180);
        };
        update();
        window.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', onScroll);
        document.addEventListener('scrollend', onScroll);
        return () => {
            cancelAnimationFrame(raf);
            clearTimeout(refit);
            clearTimeout(trail);
            window.removeEventListener('scroll', onScroll);
            window.removeEventListener('resize', onScroll);
            document.removeEventListener('scrollend', onScroll);
        };
    }, [showResult, sections, fitIndex]);

    // 보고 있는 구역이 바뀌면 그 칸이 보이게 목차를 옆으로 밉니다(첫 칸이 펼쳐지는 중이면 위 스크롤 effect 가 끝난 뒤 다시 맞춥니다).
    useEffect(() => {
        fitIndex();
    }, [activeSection, fitIndex]);

    const scrollTo = scrollToId;

    // 그래프 점과 같은 id(data-node)를 가진 카드들
    const cardsOf = useCallback((id) => {
        const root = sheetRef.current;
        if (!root || !id) return [];
        return [...root.querySelectorAll(`[data-node="${CSS.escape(id)}"]`)];
    }, []);

    // 자기 카드가 없는 점(리뷰 좋은 점 하나, 경쟁 매장의 키워드 같은 세부·근거)은 윗단계로 올라가며 카드가 있는 점을 찾습니다.
    const hostOf = useCallback((id) => {
        for (let current = id, hop = 0; current && current !== 'store' && hop < 4; current = parentOf.get(current), hop += 1) {
            if (cardsOf(current).length > 0) return current;
        }
        return null;
    }, [parentOf, cardsOf]);

    // 그래프 → 카드: 그래프에서 가리킨 점과 같은 카드(없으면 가장 가까운 윗단계 카드)를 밝힙니다.
    const markLinked = useCallback((node) => {
        const root = sheetRef.current;
        if (!root) return;
        root.querySelectorAll('[data-linked]').forEach((el) => el.removeAttribute('data-linked'));
        if (!node) return;
        cardsOf(hostOf(node.id)).forEach((el) => el.setAttribute('data-linked', 'true'));
    }, [cardsOf, hostOf]);

    // 손가락·펜을 댄 시각을 적어 둡니다(터치와 마우스가 함께 있는 기기에서 가짜 마우스 이동을 가려내는 데 씁니다).
    const onSheetDown = (event) => {
        if (event.pointerType !== 'mouse') linkState.current.touchAt = performance.now();
    };

    // 카드 → 그래프: 카드마다 핸들러를 달지 않고 시트에서 한 번에 받아, 같은 id 의 점을 밝힙니다.
    // 구역 전체(#sec-…)나 화면 높이의 절반을 넘는 큰 덩어리 위에 마우스가 머무는 것만으로는 그래프를 돌리지 않고 밝히기만 합니다.
    // 본문을 읽는 동안 그래프가 따라 도는 일이 없게, 줄·칩·작은 카드 위에 머물 때만 돌립니다(엔진은 그대로, PlaceGraph 의 focus 옵션 still).
    const isBigCard = (el) => Boolean(el) && (Boolean(el.id?.startsWith('sec-')) || el.getBoundingClientRect().height > window.innerHeight * 0.5);

    const onSheetOver = (event) => {
        const card = event.target.closest?.('[data-node]') || null;
        const id = card?.dataset.node || null;
        const state = linkState.current;
        const touched = event.pointerType === 'touch' || event.pointerType === 'pen';
        if (touched) {
            state.touchAt = performance.now();
        } else if (state.touchAt && performance.now() - state.touchAt < TOUCH_QUIET_MS) {
            // 손가락을 댄 직후의 마우스 이동은 사람이 한 게 아닙니다. 화면이 움직이면 브라우저가 마지막 마우스 자리에서
            // 이동 이벤트를 다시 만들어 보내는데, 그것이 방금 밝힌 강조를 덮어쓰지 않게 무시합니다.
            return;
        }
        if (state.pin) {
            // '그래프' 버튼으로 올라온 직후에는, 스크롤 때문에 포인터 밑 카드가 바뀐 것만으로 강조를 바꾸지 않습니다.
            // 손가락으로 누른 버튼이면 6초 동안 마우스 이동은 모두 무시합니다(손가락으로 다시 짚으면 그 카드를 따라갑니다).
            if (!touched && state.pin.byTouch) return;
            if (Math.hypot(event.clientX - state.pin.x, event.clientY - state.pin.y) < 8) return;
            state.pin = null;
        }
        if (id === state.card) return;
        state.card = id;
        graphRef.current?.focus(id, { still: isBigCard(card) });
    };

    const onSheetLeave = () => {
        const state = linkState.current;
        if (state.pin) return;
        state.card = null;
        graphRef.current?.focus(null);
    };

    // 본문에 그려진 같은 id 의 카드(요약 칸의 숫자와, 숨은 탭 속처럼 화면에 그려지지 않은 것은 뺍니다)
    const bodyCards = (id) => cardsOf(id).filter((el) => !el.closest('#sec-summary') && el.getClientRects().length > 0);

    // 본문에서 자기 카드가 없는 점의 가장 가까운 윗단계 카드
    const bodyHostOf = (id) => {
        for (let current = parentOf.get(id), hop = 0; current && current !== 'store' && hop < 4; current = parentOf.get(current), hop += 1) {
            if (bodyCards(current).length > 0) return current;
        }
        return null;
    };

    const cardsFor = (find) => (typeof find === 'function' ? find() : cardsOf(find));

    // 카드가 화면에 보이는지. 위에 붙는 목차와 폰의 아래 막대 뒤로 가려진 부분은 보이는 것으로 치지 않습니다.
    const onScreen = (cards) => {
        const nav = indexRef.current?.getBoundingClientRect();
        const top = nav && nav.top <= 1 ? nav.bottom : 0;
        const bottom = window.innerHeight - (window.innerWidth <= 768 ? 64 : 0);
        return cards.some((el) => {
            const box = el.getBoundingClientRect();
            if (box.height <= 0 || box.width <= 0) return false;
            const shown = Math.min(box.bottom, bottom) - Math.max(box.top, top);
            return shown >= Math.min(48, box.height * 0.5);
        });
    };
    // 이동한 자리의 카드를 잠깐 강조해 그래프에서 고른 항목이 어디인지 알려 줍니다.
    // 이동이 끝났고 강조할 카드가 화면에 보일 때 시작합니다(afterScroll). 이동하는 동안 시작하면 도착했을 때는 강조가
    // 이미 끝나 있고, 보이지 않는 자리에서 시작하면 아무도 못 본 채 끝납니다.
    // find: 점 id(같은 id 의 카드를 모두 강조) 또는 강조할 요소들을 돌려주는 함수
    const flash = (find) => {
        const state = linkState.current;
        clearTimeout(state.flashTimer);
        state.flashWait?.();
        sheetRef.current?.querySelectorAll('[data-flash]').forEach((el) => el.removeAttribute('data-flash'));
        state.flashWait = afterScroll(() => {
            const cards = cardsFor(find);
            cards.forEach((el) => el.setAttribute('data-flash', 'true'));
            state.flashTimer = setTimeout(() => cards.forEach((el) => el.removeAttribute('data-flash')), 2200);
            // 카드를 화면 가운데 두고 도착하면 그 구역의 머리가 목차 판정선 아래에 있을 수 있어, 평소 판정은 앞 구역을 켭니다.
            // 도착한 카드가 든 구역을 목차에 켜고, 그 자리에서 크게 벗어나 스크롤하기 전까지 그대로 둡니다(아래 update 의 arrival).
            // 같은 점이 요약 칸(#sec-summary)에도 있으면 본문 쪽 카드의 구역을 씁니다.
            const host = cards.map((el) => el.closest?.('[id^="sec-"]')).find((el) => el && sections.some((section) => section.id === el.id));
            if (host) {
                state.arrival = { id: host.id, y: window.scrollY };
                setActiveSection(host.id);
            }
        }, { ready: () => onScreen(cardsFor(find)) });
    };

    // 카드로 화면 이동: 화면 높이의 60%보다 큰 카드는 머리가 보이게 위에 맞추고, 작은 카드는 가운데에 둡니다.
    const scrollToCard = (card) => {
        const tall = card.getBoundingClientRect().height > window.innerHeight * 0.6;
        card.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: card.id.startsWith('sec-') || tall ? 'start' : 'center' });
    };

    // 그래프 점·요약 숫자 → 본문: 같은 id 의 카드로 이동합니다. 카드가 없으면 fallback 자리(구역)로 가서 그 구역을 강조합니다.
    const jumpTo = (id, fallback) => {
        const card = id ? bodyCards(id)[0] : null;
        if (card) {
            scrollToCard(card);
            flash(id);
            return;
        }
        const spot = fallback ? document.getElementById(fallback) : null;
        if (!spot) return;
        scrollTo(fallback);
        flash(() => [spot.closest('[data-node]') || spot]);
    };

    // 본문 → 그래프: 구역 머리의 '그래프' 버튼. 위로 올라가 같은 점을 밝히고 고리를 한 번 퍼뜨립니다.
    // 살펴보기 카드가 열려 있으면 카드가 고른 점이 그래프를 차지하고 있어 밝히기만 해서는 보이지 않습니다.
    // 그때는 카드를 닫고 누른 구역의 묶음을 밝힙니다. 묶음 카드를 새로 열면 폰에서는 카드가 그래프를 70% 넘게 가려
    // 밝힌 점이 거의 안 보입니다(fix6 측정). 카드가 닫혀 있으면 밝히기만 합니다.
    const graphLink = useMemo(() => ({
        showInGraph(id, event) {
            const state = linkState.current;
            const type = event?.nativeEvent?.pointerType ?? event?.pointerType;
            const byTouch = type === 'touch' || type === 'pen' || Boolean(state.touchAt && performance.now() - state.touchAt < 1500);
            state.pin = { x: event?.clientX ?? 0, y: event?.clientY ?? 0, byTouch };
            state.card = null;
            scrollToId('sec-graph');
            const graph = graphRef.current;
            if (graph?.state?.().openId) graph.open(null);
            graph?.focus(id);
            setTimeout(() => graphRef.current?.ping(id), reducedMotion() ? 0 : 520);
            clearTimeout(state.pinTimer);
            state.pinTimer = setTimeout(() => {
                state.pin = null;
                if (!state.card) graphRef.current?.focus(null);
            }, 6000);
        },
    }), []);

    // 순위 표의 한 줄을 펼치고 그 줄로 갑니다.
    // 펼침을 먼저 화면에 반영(flushSync)한 뒤에 이동해야 합니다. 열려 있던 다른 줄이 접히면 그 아래 줄들이 접힌 높이만큼
    // 올라오는데, 접히기 전의 자리를 향해 이동하면 꼭 그만큼 지나쳐서 고른 줄이 화면 위로 사라집니다.
    // also: 그 줄과 함께 강조할 점 id(경쟁 매장 점에서 왔을 때, 펼친 줄 안에 그 매장의 줄이 있으면 같이 밝힙니다).
    const openRank = (keyword, also) => {
        const index = ranks.findIndex((row) => row.keyword === keyword);
        if (index < 0) return;
        if (ranks[index].state === 'done') flushSync(() => setOpenKeyword(keyword));
        scrollTo(`rank-row-${index}`);
        flash(also ? () => [...cardsOf(`kw:${keyword}`), ...bodyCards(also)] : `kw:${keyword}`);
    };

    // 경쟁 매장·경쟁 매장 키워드는 상위 매장 대표키워드를 읽어 둔 순위 줄을 펼쳐야 본문에 보입니다.
    // 그 매장(rival:…)이나 낱말(rk:…)이 든 줄을 펼칩니다(지금 펼친 줄이 맞으면 그대로).
    const openRivalRow = (id) => {
        const word = id.startsWith('rk:') ? id.slice(3) : null;
        const holds = (row) => {
            const items = row.state === 'done' ? rivals[row.keyword]?.items : null;
            if (!items?.length) return false;
            if (id.startsWith('rival:')) return items.some((item) => `rival:${item.placeId}` === id);
            return !word || items.some((item) => (item.keywords || []).some((kw) => kw.replace(/\s+/g, '').toLowerCase() === word));
        };
        const row = ranks.find((entry) => entry.keyword === openKeyword && holds(entry)) || ranks.find(holds);
        if (row && row.keyword !== openKeyword) flushSync(() => setOpenKeyword(row.keyword));
    };

    const selectNode = (node) => {
        if (!place || loadingPlace) {
            urlInput.current?.focus();
            return;
        }
        if (node.id === 'store') return;
        if (node.keyword && ranks.some((row) => row.keyword === node.keyword)) {
            openRank(node.keyword, node.type === 'rival' ? node.id : null);
            return;
        }
        if (node.group === 'rival') openRivalRow(node.id);
        // 고른 줄이 '더 보기'나 탭 뒤에 접혀 있으면 펼치고(그려진 다음에) 그 줄로 갑니다.
        flushSync(() => {
            unfoldIn(unfoldRef.current, node.id);
        });
        if (bodyCards(node.id).length > 0) {
            jumpTo(node.id);
            return;
        }
        // 자기 카드가 없는 점: 가장 가까운 윗단계 카드로 갑니다. 다만 점이 가리키는 자리(target)가 구역보다 좁고
        // 윗단계 카드가 그 자리 밖에 있으면(구역 전체 등) 그 자리로 가서 그 자리를 강조합니다(강조가 화면 밖에 생기지 않게).
        const host = bodyHostOf(node.id);
        const spot = node.target && !node.target.startsWith('sec-') ? document.getElementById(node.target) : null;
        if (spot && !(host && spot.contains(bodyCards(host)[0]))) {
            scrollTo(node.target);
            flash(() => [spot]);
            return;
        }
        if (host) jumpTo(host);
        else jumpTo(null, node.target || 'sec-summary');
    };

    return (
        <DashboardLayout>
            <GraphLink.Provider value={graphLink}>
            <Unfold.Provider value={unfoldRef.current}>
            <div ref={sheetRef} className={styles.sheet} onPointerDown={onSheetDown} onPointerOver={onSheetOver} onPointerLeave={onSheetLeave}>
                <header className={styles.top}>
                    <div className={styles.title}>
                        <h1>플레이스 분석</h1>
                        <p>매장 주소나 코드 하나로 숨은 대표키워드, 검색 순위, 리뷰·소식 활동, 결제 데이터, AI 검색 노출 점검과 지금 할 일을 한 화면에 모읍니다.</p>
                    </div>
                    <form className={styles.search} onSubmit={handleSubmit}>
                        <label htmlFor="place-url">플레이스 주소 또는 ID</label>
                        <div className={styles.inputWrap}>
                            <Link2 size={18} aria-hidden="true" />
                            <input
                                ref={urlInput}
                                id="place-url"
                                type="text"
                                inputMode="url"
                                autoComplete="off"
                                placeholder="예: https://m.place.naver.com/restaurant/1234567890/home"
                                value={url}
                                onChange={(event) => { setUrl(event.target.value); setUrlError(false); }}
                                disabled={loadingPlace || unavailable}
                                maxLength={500}
                                aria-invalid={urlError || undefined}
                                aria-describedby="place-url-help"
                            />
                        </div>
                        <button type="submit" className={styles.primaryBtn} disabled={loadingPlace || unavailable}>
                            {loadingPlace ? <Loader2 size={18} className={styles.spin} aria-hidden="true" /> : <Search size={18} aria-hidden="true" />}
                            {loadingPlace ? '분석 중' : '분석하기'}
                        </button>
                        <p id="place-url-help" className={styles.help}>
                            네이버 지도·플레이스 앱에서 &lsquo;공유&rsquo;로 복사한 주소(naver.me)나 주소 속 숫자만 넣어도 됩니다.
                        </p>
                    </form>
                </header>

                {meta.saved.length > 0 && (
                    <div className={styles.saved}>
                        <span className={styles.savedLabel}>내 매장</span>
                        {meta.saved.map((saved) => (
                            <span key={saved.placeId} className={styles.savedChip} data-current={place?.placeId === saved.placeId ? 'true' : undefined}>
                                <button type="button" onClick={() => { setUrl(saved.placeId); analyze(saved.placeId); }} disabled={loadingPlace || unavailable}>
                                    <Store size={14} aria-hidden="true" />
                                    {saved.name}
                                </button>
                                <button type="button" className={styles.savedRemove} onClick={() => removeSaved(saved)} aria-label={`${saved.name} 내 매장에서 삭제`}>
                                    <X size={14} aria-hidden="true" />
                                </button>
                            </span>
                        ))}
                    </div>
                )}

                {unavailable && (
                    <section className={styles.notice} role="status">
                        <Info size={20} aria-hidden="true" />
                        <div>
                            <strong>{meta.enabled ? '네이버 조회를 잠시 쉬는 중입니다' : '플레이스 조회 기능이 꺼져 있습니다'}</strong>
                            <p>
                                {meta.enabled
                                    ? `네이버가 조회를 제한해 ${timeLabel(meta.pausedUntil)}까지 쉬었다가 다시 시작합니다. 그 사이에는 플레이스 진단과 순위 기록장을 이용해주세요.`
                                    : '운영자가 기능을 다시 켜면 이용할 수 있습니다. 그동안 플레이스 진단과 순위 기록장을 이용해주세요.'}
                            </p>
                            <p className={styles.noticeLinks}>
                                <Link href="/dashboard/place-check">플레이스 진단</Link>
                                <Link href="/dashboard/ranking/place">플레이스 순위 기록장</Link>
                            </p>
                        </div>
                    </section>
                )}

                <section id="sec-summary" className={styles.stage} aria-busy={loadingPlace} aria-label="매장 연결 그래프와 요약">
                    {/* sec-graph: 본문의 '그래프' 버튼과 목차의 매장 이름이 올라오는 자리.
                        ontology 는 업종에 맞는 낱말(메뉴·시술)로 바꾼 스키마입니다(같은 업종이면 늘 같은 객체라 다시 그리지 않음).
                        조작 안내는 그래프가 입력 방식에 맞춰 직접 쓰므로, 빈 화면·불러오는 중의 문구(hint)와 이 화면에만 있는 한마디(tip)만 넘깁니다. */}
                    <div id="sec-graph" className={styles.graphPane}>
                        <PlaceGraph
                            ref={graphRef}
                            nodes={graph.nodes}
                            links={graph.links}
                            mode={loadingPlace ? 'loading' : place ? 'live' : 'idle'}
                            label={showResult
                                ? `${place.name}의 연결 그래프. 점을 누르면 연결된 항목을 살펴봅니다.`
                                : '플레이스 분석으로 채워질 항목의 연결 그래프'}
                            headline={graph.headline}
                            legend={LEGEND}
                            ontology={ontologyFor(showResult ? place : null)}
                            hint={loadingPlace ? '불러오는 대로 내 매장 데이터로 채웁니다.' : '주소를 넣고 분석하면 내 매장 데이터로 채워집니다.'}
                            tip="요약 숫자에 올리면 같은 점이 밝아집니다"
                            onSelect={selectNode}
                            onHover={markLinked}
                        >
                            {loadingPlace && <LoadingStatus />}
                        </PlaceGraph>
                    </div>
                    {loadingPlace ? (
                        <RailSkeleton />
                    ) : place ? (
                        <SummaryRail
                            key={place.placeId}
                            place={place}
                            placeInfo={placeInfo}
                            activity={activity}
                            ranks={ranks}
                            actions={actions}
                            saving={saving}
                            onSave={savePlace}
                            onPickRank={openRank}
                            onJump={jumpTo}
                        />
                    ) : (
                        <IdleRail />
                    )}
                </section>

                {loadingPlace && <SectionsSkeleton />}

                {showResult && (
                    <>
                        <nav ref={indexRef} className={styles.index} aria-label="분석 항목">
                            <button type="button" className={styles.indexHome} onClick={() => scrollTo('sec-graph')} aria-label={`${place.name} 연결 그래프로 올라가기`}>
                                <ArrowUpToLine size={14} aria-hidden="true" />
                                <span>{place.name}</span>
                            </button>
                            {sections.map((section) => (
                                <a
                                    key={section.id}
                                    href={`#${section.id}`}
                                    data-group={section.group}
                                    aria-current={activeSection === section.id ? 'true' : undefined}
                                    onClick={(event) => {
                                        event.preventDefault();
                                        scrollTo(section.id);
                                    }}
                                >
                                    {section.label}
                                    {section.count && <span className={styles.indexCount}>{section.count}</span>}
                                </a>
                            ))}
                        </nav>

                        <TodoSection place={place} actions={actions} />

                        <Reveal id="sec-rank" className={styles.section} data-group="search" data-node="hub:search">
                            <SectionHead title="키워드 순위" hub="hub:search">
                                키워드를 검색했을 때 내 매장이 몇 번째에 나오는지 네이버 목록에서 광고를 빼고 셉니다. 한 번에 {MAX_KEYWORDS}개까지, 쉼표로 구분해 입력하세요.
                            </SectionHead>

                            <KeywordItemWord.Provider value={keywordItemWord(place)}>
                            <KeywordSlots keywords={place.keywords} diagnosis={recommendation?.registered} blogTotal={recommendation?.blogTotal} onCopy={copyKeywords} />

                            <KeywordReco
                                key={place.placeId}
                                recommendation={recommendation}
                                ranks={ranks}
                                rankPick={rankPick}
                                rivalRegistered={new Set(rivalPool.filter((rival) => Array.isArray(rival?.keywords) && rival.keywords.length > 0 && String(rival.placeId) !== String(place.placeId)).map((rival) => String(rival.placeId || rival.name))).size}
                                comparing={comparing}
                                ranking={ranking}
                                unavailable={unavailable}
                                canCompare={Boolean(comparable)}
                                feedOk={!notApplicableOf(place).feed}
                                onRank={addRank}
                                onRankAll={rankRecommended}
                                onCompare={() => comparable && loadRivals(comparable)}
                                onCopy={(words) => copyWords(words, '추천 키워드')}
                            />
                            </KeywordItemWord.Provider>

                            <form className={`${styles.rankForm} ${styles.rise}`} style={{ '--d': 2 }} onSubmit={runRanks}>
                                <div className={styles.inputWrap}>
                                    <label htmlFor="rank-keywords" className={styles.srOnly}>순위를 볼 키워드</label>
                                    <Search size={18} aria-hidden="true" />
                                    <input
                                        ref={keywordInput}
                                        id="rank-keywords"
                                        type="text"
                                        placeholder="예: 강남역 맛집, 강남 회식"
                                        value={keywordText}
                                        onChange={(event) => { setKeywordText(event.target.value); setKeywordError(false); }}
                                        disabled={ranking || unavailable}
                                        maxLength={250}
                                        aria-invalid={keywordError || undefined}
                                    />
                                </div>
                                <button type="submit" className={styles.inkBtn} disabled={ranking || unavailable}>
                                    {ranking && <Loader2 size={18} className={styles.spin} aria-hidden="true" />}
                                    {ranking ? '조회 중' : '순위 조회'}
                                </button>
                                <div className={styles.rankOptions}>
                                    <label>
                                        <input type="checkbox" checked={deep} onChange={(event) => setDeep(event.target.checked)} disabled={ranking} />
                                        1,000위까지 찾기 <span>(기본 300위, 더 오래 걸려요)</span>
                                    </label>
                                    <label>
                                        <input type="checkbox" checked={record} onChange={(event) => setRecord(event.target.checked)} disabled={ranking} />
                                        오늘 순위를 순위 기록장에 저장
                                    </label>
                                </div>
                            </form>

                            {ranks.length > 0 && (
                                <ul className={styles.board}>
                                    {ranks.map((row, index) => {
                                        const open = openKeyword === row.keyword && row.state === 'done';
                                        const rival = rivals[row.keyword];
                                        const note = row.state === 'done' ? recordNote(row.recorded) : null;
                                        const result = row.result;
                                        // 이 순위가 내 지역의 검색 결과인지(상위 매장과의 거리·네이버가 인식한 지역)
                                        const rawScope = row.state === 'done' && result.scanned > 0
                                            ? rankScope({ keyword: row.keyword, locality: rankLocality(result, place.coordinate), regions: recommendation?.regions })
                                            : null;
                                        // 앞말이 지역인지 확인 못 한 등록 키워드(unknown)는 '지역명이 없는 키워드'라고 단정하지 않고, 확인하지 못했다고 말합니다.
                                        const regionUnknown = (recommendation?.registered || []).some((entry) => entry.keyword === row.keyword && regionStatusOf(entry) === 'unknown');
                                        const scope = rawScope && rawScope.tone === 'warn' && regionUnknown
                                            ? { tone: 'warn', title: '지역을 확인하지 못한 키워드', text: '검색하는 사람의 위치에 따라 순위가 달라질 수 있어 이 순위는 참고용입니다.' }
                                            : rawScope;
                                        return (
                                            <li key={row.keyword} id={`rank-row-${index}`} className={styles.rankRow} data-state={row.state} data-open={open ? 'true' : undefined} data-node={`kw:${row.keyword}`} style={{ '--d': index }}>
                                                <div className={styles.rankLine}>
                                                    <strong className={styles.rankKeyword}>{row.keyword}</strong>
                                                    {row.state === 'loading' && (
                                                        <span className={styles.rankPending}><Loader2 size={16} className={styles.spin} aria-hidden="true" /> 조회 중</span>
                                                    )}
                                                    {row.state === 'error' && <span className={styles.rankError}>{row.error}</span>}
                                                    {row.state === 'done' && (
                                                        <>
                                                            <span className={styles.rankFigure} data-tone={rankTone(result)}>
                                                                {result.status === 'found'
                                                                    ? <><CountUp value={result.rank} from={Math.max(result.scanned || 0, result.rank)} duration={900} /><small>위</small></>
                                                                    : <span className={styles.rankOut}>{rankLabel(result)}</span>}
                                                            </span>
                                                            <RankTrack result={result} />
                                                            <span className={styles.rankMeta}>
                                                                {result.total ? `검색된 매장 ${formatNumber(result.total)}곳` : ''}
                                                                {result.fetchedAt ? ` · ${timeLabel(result.fetchedAt)} 조회` : ''}
                                                            </span>
                                                            <button
                                                                type="button"
                                                                className={styles.toggleBtn}
                                                                onClick={() => setOpenKeyword(open ? null : row.keyword)}
                                                                aria-expanded={open}
                                                            >
                                                                <ChevronDown size={16} aria-hidden="true" />
                                                                상위 매장 {open ? '접기' : '보기'}
                                                            </button>
                                                        </>
                                                    )}
                                                </div>
                                                {scope && (scope.tone !== 'ok' || scope.text) && (
                                                    <p className={styles.rankScope} data-tone={scope.tone}>
                                                        <MapPin size={14} aria-hidden="true" />
                                                        <span><strong>{scope.title}</strong>{scope.text ? ` · ${scope.text}` : ''}</span>
                                                    </p>
                                                )}
                                                {note && <p className={styles.rankNote}>{note}</p>}

                                                {open && (
                                                    <div className={styles.rankBody}>
                                                        {result.top.length === 0 ? (
                                                            <p className={styles.note}>이 키워드로 검색된 매장이 없습니다.</p>
                                                        ) : (
                                                            <>
                                                                <RankTable result={result} origin={place.coordinate} />
                                                                <RankDiagnosis diagnosis={diagnoseRank(buildMine(place, result), result.topSignals)} na={notApplicableOf(place)} />

                                                                {!rival && (
                                                                    <button type="button" className={styles.secondaryBtn} onClick={() => loadRivals(result)} disabled={unavailable}>
                                                                        <KeyRound size={16} aria-hidden="true" />
                                                                        상위 5곳의 대표키워드 보기
                                                                    </button>
                                                                )}
                                                                {rival?.loading && (
                                                                    <p className={styles.rankPending}><Loader2 size={16} className={styles.spin} aria-hidden="true" /> 상위 매장 대표키워드 조회 중</p>
                                                                )}
                                                                {rival?.items && (
                                                                    <div className={styles.rivals} data-node="hub:rival">
                                                                        <h4>상위 매장이 등록한 대표키워드</h4>
                                                                        <ul>
                                                                            {rival.items.map((item, itemIndex) => (
                                                                                <li key={item.placeId} data-node={`rival:${item.placeId}`} style={{ '--d': itemIndex }}>
                                                                                    <span className={styles.rivalName}>{item.name}</span>
                                                                                    <span className={styles.rivalWords}>
                                                                                        {item.keywords.length === 0 && <em>등록 안 함</em>}
                                                                                        {item.keywords.map((word) => {
                                                                                            const key = word.replace(/\s+/g, '').toLowerCase();
                                                                                            const mine = myKeywordKeys.has(key);
                                                                                            // 내 매장이 등록하지 않은 낱말은 그래프의 '경쟁 매장 키워드' 점(rk:낱말)과 잇습니다.
                                                                                            return (
                                                                                                <span key={word} className={mine ? styles.wordMine : styles.word} data-node={mine ? undefined : `rk:${key}`}>
                                                                                                    {word}{mine && <small> 내 매장도 사용</small>}
                                                                                                </span>
                                                                                            );
                                                                                        })}
                                                                                    </span>
                                                                                </li>
                                                                            ))}
                                                                        </ul>
                                                                        <CommonKeywords mine={place.keywords} items={rival.items} />
                                                                        {rival.failed > 0 && <p className={styles.note}>{rival.failed}곳은 읽지 못했습니다.</p>}
                                                                    </div>
                                                                )}
                                                            </>
                                                        )}
                                                    </div>
                                                )}
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </Reveal>

                        <ReviewSection
                            place={place}
                            briefing={activity?.briefing}
                            mentions={activity?.mentions}
                            unmentioned={(recommendation?.registered || []).filter((entry) => entry.blog === 0).map((entry) => entry.keyword)}
                        />
                        <ActivitySection activity={activity} error={activityError} place={place} />

                        <div id="sec-geo" className={styles.geo} data-node="hub:geo">
                            <GeoPanel key={place.placeId} place={place} activity={activity} ranks={ranks} unavailable={unavailable} />
                        </div>

                        {place.detail?.pos && <PosSection pos={place.detail.pos} />}
                        {place.detail && <OpsSection place={place} activity={activity} />}
                        <Prescription place={place} activity={activity} ranks={ranks} recommendation={recommendation} actions={actions} rivals={rivalPool} fetchedAt={placeInfo?.fetchedAt} />
                    </>
                )}

                <p className={styles.source}>
                    <Info size={14} aria-hidden="true" />
                    <span>
                        네이버 플레이스 화면에 공개된 정보를 조회한 결과이며, 네이버 공식 제휴 데이터가 아니어서 네이버 사정에 따라 조회가 중단될 수 있습니다.
                        순위는 광고를 뺀 기본 목록 순서이고 하루에도 여러 번 바뀝니다. 지역명이 없는 키워드는 검색하는 사람의 위치에 따라 순위가 달라 정확하지 않습니다.
                        네이버에 부담을 주지 않도록 같은 조회는 10~30분 동안 저장된 결과를 보여 줍니다.
                    </span>
                </p>
            </div>
            </Unfold.Provider>
            </GraphLink.Provider>
        </DashboardLayout>
    );
}
