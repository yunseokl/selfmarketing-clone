'use client';

// GEO·AEO 화면의 틀 — 항상 보이는 요약 줄(점수·AI 답변 점유율·오늘 할 일)과 탭.
// 탭마다 어떤 카드를 넣을지는 GeoAeoPanel 이 정하고, 여기서는 틀과 이동만 맡습니다.
// 처음에는 열린 탭만 그리고, 다른 탭은 처음 눌렀을 때 그린 뒤 그대로 둡니다(입력하던 값·조회 결과를 잃지 않게).

import { useRef } from 'react';
import { ArrowRight, Bot, TrendingDown, TrendingUp } from 'lucide-react';
import styles from './GeoSections.module.css';
import CountUp from './CountUp';

export const GEO_TABS = [
    { key: 'today', label: '오늘 할 일' },
    { key: 'measure', label: 'AI 답변 실측' },
    { key: 'diagnosis', label: '진단' },
    { key: 'roadmap', label: '로드맵' },
    { key: 'drafts', label: '초안' },
    { key: 'rivals', label: '경쟁 비교' },
];

// 점수 등급과 같은 경계: 70점 이상 좋음, 50점 이상 보통
function toneOf(value) {
    if (value === null || value === undefined) return 'unknown';
    if (value >= 70) return 'good';
    if (value >= 50) return 'fair';
    return 'poor';
}

function Delta({ value }) {
    if (value === null || value === undefined) return null;
    if (value === 0) return <span className={styles.flat}>변동 없음</span>;
    const up = value > 0;
    const Icon = up ? TrendingUp : TrendingDown;
    return (
        <span className={up ? styles.up : styles.down}>
            <Icon size={14} aria-hidden="true" />
            {up ? '+' : '−'}{Math.abs(value)}%p
        </span>
    );
}

// node: 그래프에서 같은 항목을 가리키는 점의 id(본문 카드와 그래프 점을 서로 밝힐 때 씀)
function Tile({ label, hint, go, onClick, node, children }) {
    return (
        <li data-node={node}>
            <button type="button" className={styles.tile} onClick={onClick}>
                <span className={styles.tileLabel}>{label}</span>
                <span className={styles.tileValue}>{children}</span>
                <span className={styles.tileHint}>{hint}</span>
                <span className={styles.tileGo}>{go} <ArrowRight size={14} aria-hidden="true" /></span>
            </button>
        </li>
    );
}

function ScoreTile({ label, hint, score, onClick, node }) {
    return (
        <Tile label={label} hint={hint} go="세부 항목 보기" onClick={onClick} node={node}>
            {score.score === null || score.score === undefined ? '-' : <CountUp value={score.score} />}
            <small>점</small>
            <span className={`${styles.badge} ${styles[toneOf(score.score)]}`}>{score.label}</span>
        </Tile>
    );
}

function somHint(som) {
    if (!som) return '아직 재지 않았습니다. 고치기 전에 지금 상태부터 기록해 두세요.';
    const when = som.days === 0 ? '오늘 측정' : `${som.day} 측정 · ${som.days}일 전`;
    return som.due ? `${when}. 같은 질문으로 다시 잴 때입니다.` : `${when}. 지난번과 같은 질문으로 다시 재면 변화가 보입니다.`;
}

function todayHint(today) {
    if (today.total === 0) return '오늘 할 일을 만들 정보가 없습니다.';
    if (today.done >= today.total) return '오늘 할 일을 모두 끝냈습니다. 내일 같은 질문으로 다시 재 보세요.';
    return `다음 · ${today.next}`;
}

// som: { overall, delta, day, days, due } | null · today: { done, total, next }
export function GeoStatus({ question, geo, aeo, som, today, onGo }) {
    return (
        <div className={styles.status}>
            <div className={styles.statusHead}>
                <h2><Bot size={18} aria-hidden="true" /> GEO·AEO — AI 검색 노출</h2>
                <p>손님이 AI에게 <q>{question}</q>을 물을 때 내 매장이 답에 나오는지 봅니다.</p>
            </div>
            <ul className={styles.tiles} aria-label="GEO·AEO 요약">
                <ScoreTile label="GEO · 추천 목록에 들 준비" hint="AI가 추천 목록을 만들 때 쓸 재료(리뷰·출처·기본 정보)" score={geo} onClick={() => onGo('diagnosis')} node="geo:score" />
                <ScoreTile label="AEO · 질문에 바로 답할 준비" hint="주차·가격·영업시간 같은 세부 질문에 답할 재료" score={aeo} onClick={() => onGo('diagnosis')} node="aeo:score" />
                <Tile label="AI 답변 점유율 · 실제 결과" hint={somHint(som)} go={som ? '다시 재기' : '지금 재기'} onClick={() => onGo('measure')}>
                    {som ? <><CountUp value={som.overall} /><small>%</small><Delta value={som.delta} /></> : '-'}
                    {som?.due && <span className={`${styles.badge} ${styles.fair}`}>다시 잴 때</span>}
                </Tile>
                <Tile label="오늘 할 일" hint={todayHint(today)} go={today.done > 0 && today.done < today.total ? '이어서 하기' : '순서 보기'} onClick={() => onGo('today')}>
                    {today.done}<small>/ {today.total}</small>
                </Tile>
            </ul>
        </div>
    );
}

export function GeoTabs({ idBase, tabs, active, onSelect }) {
    const buttons = useRef({});
    const pick = (key) => {
        onSelect(key);
        buttons.current[key]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    };
    const onKeyDown = (event, index) => {
        const last = tabs.length - 1;
        let next = null;
        if (event.key === 'ArrowRight') next = index === last ? 0 : index + 1;
        else if (event.key === 'ArrowLeft') next = index === 0 ? last : index - 1;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = last;
        if (next === null) return;
        event.preventDefault();
        pick(tabs[next].key);
        buttons.current[tabs[next].key]?.focus();
    };
    return (
        <div className={styles.tabs} role="tablist" aria-label="GEO·AEO 보기">
            {tabs.map((tab, index) => {
                const on = tab.key === active;
                return (
                    <button
                        key={tab.key}
                        ref={(node) => { buttons.current[tab.key] = node; }}
                        type="button"
                        role="tab"
                        id={`${idBase}-tab-${tab.key}`}
                        aria-selected={on}
                        aria-controls={`${idBase}-panel-${tab.key}`}
                        tabIndex={on ? 0 : -1}
                        className={on ? styles.tabOn : styles.tab}
                        onClick={() => pick(tab.key)}
                        onKeyDown={(event) => onKeyDown(event, index)}
                    >
                        {tab.label}
                        {tab.badge && <span className={styles.tabBadge}>{tab.badge}</span>}
                    </button>
                );
            })}
        </div>
    );
}

// mounted: 한 번이라도 연 탭인지. 열지 않은 탭은 그리지 않습니다.
export function GeoTabPanel({ idBase, tabKey, active, mounted, children }) {
    return (
        <div
            role="tabpanel"
            id={`${idBase}-panel-${tabKey}`}
            aria-labelledby={`${idBase}-tab-${tabKey}`}
            hidden={active !== tabKey}
            tabIndex={-1}
            className={styles.panel}
        >
            {mounted && children}
        </div>
    );
}
