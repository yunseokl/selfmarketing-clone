'use client';

// AI 답변 실측 화면 — 질문 고르기 → AI에 직접 묻기 → 답변 붙여 넣기(자동 판정) → 기록 → 추이.
// 질문·판정·리포트 계산은 lib/place-geo-prompts.js 와 lib/place-geo.js 의 순수 함수가 하고, 여기서는 그리기와 입력만 합니다.
// 혼잘마가 AI에 대신 묻지 않습니다. "열기"는 사장님 브라우저에서 그 AI 화면을 여는 링크이고, 붙여 넣은 글은 저장하지 않습니다.
// 기록은 이 브라우저에만 남습니다(somStore.js).

import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
    ArrowRight, ClipboardPaste, Copy, Download, ExternalLink, FileText, Gauge, History, Link2, ListOrdered, Plus, Quote, Save, Trash2,
    TrendingDown, TrendingUp,
} from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { kstDateStamp } from '@/lib/csv';
import { PLATFORMS, SOM_MENTION, SOM_NONE, SOM_RANKS, brandAliases, somPoints, somRankLabel } from '@/lib/place-geo';
import {
    AI_GUIDES, PROMPT_KINDS, aiOpenUrl, analyzeAnswer, buildPromptSet, dayLabel, isToday, mergeResults, promptFor, rankAdvice,
    remeasureStatus, somCsv, somOf, somReportText, somTrend,
} from '@/lib/place-geo-prompts';
import base from './page.module.css';
import styles from './SomTracker.module.css';
import CountUp from './CountUp';
import { SOM_KEEP, useSomHistory } from './somStore';

const KIND_LABEL = Object.fromEntries(PROMPT_KINDS.map((kind) => [kind.key, kind.label]));
const PLATFORM_KEYS = PLATFORMS.map((p) => p.key);

// 순위 표시 색: 1~3위 좋음, 4~5위·5위 밖 보통, 안 나옴 부족. 색과 함께 글자("3위")로도 적습니다.
function rankTone(rank) {
    if (rank === null || rank === undefined) return null;
    if (rank === SOM_NONE) return 'poor';
    if (rank === SOM_MENTION) return 'fair';
    return rank <= 3 ? 'good' : 'fair';
}

function scoreTone(value) {
    if (value === null || value === undefined) return 'unknown';
    if (value >= 70) return 'good';
    if (value >= 50) return 'fair';
    return 'poor';
}

async function copyText(text, doneMessage) {
    try {
        await navigator.clipboard.writeText(text);
        toast.success(doneMessage);
    } catch {
        toast.error('복사하지 못했습니다. 직접 선택해 복사해주세요.');
    }
}

function dateText(iso) {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric', day: 'numeric' });
}

function Delta({ value, unit }) {
    if (value === null || value === undefined) return null;
    if (value === 0) return <span className={styles.flat}>변동 없음</span>;
    const up = value > 0;
    const Icon = up ? TrendingUp : TrendingDown;
    return (
        <span className={up ? styles.up : styles.down}>
            <Icon size={14} aria-hidden="true" />
            {up ? '+' : '−'}{Math.abs(value)}{unit}
        </span>
    );
}

function Bar({ value }) {
    return (
        <span className={`${styles.bar} ${styles[scoreTone(value)]}`} aria-hidden="true">
            <span style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }} />
        </span>
    );
}

// AI 한 곳의 점유율 흐름을 보여 주는 작은 선. 숫자는 옆 칸과 '지난 기록' 표에 있습니다.
function Spark({ values }) {
    if (values.length < 2) return null;
    const width = 64;
    const height = 22;
    const pad = 4;
    const step = (width - pad * 2) / (values.length - 1);
    const y = (value) => height - pad - (value / 100) * (height - pad * 2);
    const last = values.length - 1;
    return (
        <svg className={styles.spark} viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true">
            <polyline points={values.map((value, i) => `${pad + i * step},${y(value)}`).join(' ')} />
            <circle cx={pad + last * step} cy={y(values[last])} r="3" />
        </svg>
    );
}

function TrendTip({ active, payload }) {
    if (!active || !payload?.length) return null;
    const point = payload[0].payload;
    const measured = PLATFORMS.filter((p) => point[p.key] !== null && point[p.key] !== undefined);
    return (
        <div className={styles.tip}>
            <p>{dateText(point.at)} · {point.measured}칸 측정</p>
            <strong><i aria-hidden="true" />{point.overall}% <span>종합</span></strong>
            <ul>
                {measured.map((p) => <li key={p.key}><b>{point[p.key]}%</b> {p.short}</li>)}
            </ul>
        </div>
    );
}

// 종합 점유율 추이(한 계열). 값은 아래 '지난 기록' 표에서도 볼 수 있습니다.
function TrendChart({ points }) {
    const summary = points.map((point) => `${point.label} ${point.overall}%`).join(', ');
    return (
        <figure className={styles.chart}>
            <figcaption className={base.srOnly}>AI 답변 점유율 추이: {summary}</figcaption>
            <ResponsiveContainer width="100%" height={170} initialDimension={{ width: 520, height: 170 }}>
                <AreaChart data={points} margin={{ top: 10, right: 14, bottom: 0, left: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--hair)" />
                    <XAxis
                        dataKey="at" tickFormatter={dayLabel} tickLine={false} axisLine={{ stroke: 'var(--rule)' }}
                        tick={{ fontSize: 12, fill: 'var(--ink-3)' }} interval="preserveStartEnd" minTickGap={28}
                    />
                    <YAxis
                        domain={[0, 100]} ticks={[0, 50, 100]} tickFormatter={(value) => `${value}%`} tickLine={false} axisLine={false}
                        tick={{ fontSize: 12, fill: 'var(--ink-3)' }} width={44}
                    />
                    <Tooltip content={<TrendTip />} cursor={{ stroke: 'var(--ink-3)', strokeWidth: 1 }} isAnimationActive={false} />
                    <Area
                        type="linear" dataKey="overall" stroke="var(--ai)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
                        fill="var(--ai)" fillOpacity={0.1} isAnimationActive={false}
                        dot={{ r: 4, fill: 'var(--ai)', fillOpacity: 1, stroke: 'var(--raised-2)', strokeWidth: 2 }}
                        activeDot={{ r: 5, fill: 'var(--ai)', stroke: 'var(--raised-2)', strokeWidth: 2 }}
                    />
                </AreaChart>
            </ResponsiveContainer>
        </figure>
    );
}

function Result({ place, history, saved, trend, due, visible, onRemoveLatest }) {
    const [confirm, setConfirm] = useState(false);
    const latest = history[history.length - 1];
    const before = history[history.length - 2] || null;

    const downloadCsv = () => {
        const name = String(place.name || '매장').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 30);
        const url = URL.createObjectURL(new Blob([somCsv(history)], { type: 'text/csv;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `AI답변점유율_${name}_${kstDateStamp()}.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        toast.success('기록을 CSV 파일로 내려받았습니다. 엑셀에서 열 수 있습니다.');
    };

    const remove = () => {
        if (!confirm) {
            setConfirm(true);
            return;
        }
        setConfirm(false);
        onRemoveLatest();
    };

    return (
        <>
            <div className={styles.result}>
                <div className={styles.figure}>
                    <span>{dateText(latest.at)} 기준</span>
                    <strong><CountUp value={saved.overall} /><small>%</small></strong>
                    <p>
                        <Delta value={saved.delta} unit="%p" />
                        {saved.delta === null ? '첫 기록입니다.' : ' 지난번 대비'} · {saved.measured}칸 측정
                    </p>
                    {due.due && <p className={styles.due}>잰 지 {due.days}일 지났습니다. 같은 질문으로 다시 재서 변화를 확인하세요.</p>}
                </div>
                <div className={styles.trend}>
                    <h3>종합 점유율 추이</h3>
                    {trend.length >= 2 && visible
                        ? <TrendChart points={trend} />
                        : <p className={styles.trendEmpty}>한 번 더 기록하면 추이가 그려집니다. 같은 질문으로 1주 뒤(급하면 오늘 저녁)에 다시 재세요.</p>}
                </div>
            </div>

            <ul className={styles.meters} aria-label="AI별 점유율">
                {saved.platforms.map((platform) => (
                    <li key={platform.key}>
                        <span className={styles.meterName}>{platform.short}</span>
                        <span className={styles.meterTop}>
                            {platform.score === null
                                ? <span className={styles.meterNone}>아직 안 잼</span>
                                : <strong className={styles.meterValue}><CountUp value={platform.score} /><small>%</small></strong>}
                            <Spark values={trend.map((point) => point[platform.key]).filter((value) => value !== null && value !== undefined)} />
                        </span>
                        <Bar value={platform.score} />
                        <span className={styles.meterFoot}>
                            {platform.best !== null && (
                                <span>{platform.measured > 1 && Number.isInteger(platform.best) ? '최고 ' : ''}{somRankLabel(platform.best)}</span>
                            )}
                            <Delta value={platform.delta} unit="%p" />
                        </span>
                    </li>
                ))}
            </ul>

            <details className={styles.records}>
                <summary><History size={16} aria-hidden="true" /> 지난 기록 {history.length}건 표로 보기</summary>
                <div className={styles.tableWrap}>
                    <table className={styles.table}>
                        <caption className={base.srOnly}>측정일별 종합·AI별 점유율</caption>
                        <thead>
                            <tr>
                                <th scope="col">측정일</th>
                                <th scope="col">종합</th>
                                <th scope="col">변동</th>
                                {PLATFORMS.map((p) => <th key={p.key} scope="col">{p.short}</th>)}
                            </tr>
                        </thead>
                        <tbody>
                            {[...history].reverse().map((entry, index) => {
                                const position = history.length - 1 - index;
                                const row = somOf(entry.results, history[position - 1]?.results);
                                return (
                                    <tr key={`${entry.at}-${position}`}>
                                        <th scope="row">{dateText(entry.at)}</th>
                                        <td><b>{row ? `${row.overall}%` : '-'}</b></td>
                                        <td><Delta value={row?.delta ?? null} unit="%p" /></td>
                                        {PLATFORMS.map((p) => {
                                            const score = row?.platforms.find((item) => item.key === p.key)?.score ?? null;
                                            return <td key={p.key}>{score === null ? '-' : `${score}%`}</td>;
                                        })}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                <div className={styles.recordTools}>
                    <button type="button" className={base.ghostBtn} onClick={() => copyText(somReportText(place.name, latest, before), '리포트를 복사했습니다. 메모장이나 메신저에 붙여 넣으세요.')}>
                        <Copy size={16} aria-hidden="true" /> 최근 기록 글로 복사
                    </button>
                    <button type="button" className={base.ghostBtn} onClick={downloadCsv}>
                        <Download size={16} aria-hidden="true" /> 전체 기록 CSV
                    </button>
                    <button type="button" className={base.ghostBtn} onClick={remove} onBlur={() => setConfirm(false)}>
                        <Trash2 size={16} aria-hidden="true" /> {confirm ? '한 번 더 누르면 지웁니다' : '마지막 기록 지우기'}
                    </button>
                    <small>기록은 이 브라우저에만 저장됩니다(최근 {SOM_KEEP}건).</small>
                </div>
            </details>
        </>
    );
}

// 출처를 종류별로 묶어 "어디에 무엇을 할지"를 한 번씩만 보여 줍니다.
function Sources({ sources, onOpenTemplate }) {
    const groups = [];
    for (const source of sources) {
        const group = groups.find((item) => item.type === source.type);
        if (group) group.items.push(source);
        else groups.push({ type: source.type, label: source.label, action: source.action, items: [source] });
    }
    const askable = sources.some((source) => source.type === 'blog' || source.type === 'web');
    return (
        <div className={styles.block}>
            <h5><Link2 size={14} aria-hidden="true" /> 답변에 나온 출처 {sources.length}곳</h5>
            <ul className={styles.sources}>
                {groups.map((group) => (
                    <li key={group.type}>
                        <p>
                            <span className={styles.srcType}>{group.label}</span>
                            {group.items.map((source) => (
                                <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer nofollow">
                                    {source.host}{source.mine && <em>내 플레이스</em>}
                                </a>
                            ))}
                        </p>
                        <p className={styles.srcAction}>{group.action}</p>
                    </li>
                ))}
            </ul>
            {askable && onOpenTemplate && (
                <button type="button" className={styles.linkBtn} onClick={() => onOpenTemplate('sourceRequest')}>
                    <FileText size={14} aria-hidden="true" /> &lsquo;출처 글 수정 요청문&rsquo; 초안 열기
                </button>
            )}
        </div>
    );
}

function emptyRanks() {
    return Object.fromEntries(PLATFORM_KEYS.map((key) => [key, null]));
}

function hasRanks(row) {
    return PLATFORM_KEYS.some((key) => row?.ranks?.[key] !== null && row?.ranks?.[key] !== undefined);
}

export default function SomTracker({ place, activity, visible = true, onGo, onOpenTemplate, onRecorded }) {
    const placeId = place.placeId;
    const [history, saveHistory] = useSomHistory(placeId);
    const prompts = useMemo(() => buildPromptSet(place, activity), [place, activity]);
    const rankPrompts = useMemo(() => prompts.filter((prompt) => prompt.kind === 'rank'), [prompts]);
    const checkPrompts = useMemo(() => prompts.filter((prompt) => prompt.kind !== 'rank'), [prompts]);
    const extraCount = rankPrompts.filter((prompt) => !prompt.core).length;

    const latest = history[history.length - 1] || null;
    const before = history[history.length - 2] || null;
    // 지난번에 세부 질문까지 쟀다면 이번에도 펼쳐 둡니다.
    const [showExtra, setShowExtra] = useState(() => rankPrompts.some((prompt) => !prompt.core && hasRanks(latest?.results.find((row) => row.prompt === prompt.text))));
    // draft: { [질문 글]: { [AI key]: 순위 } } · auto: 붙여 넣은 답변으로 자동 판정한 칸
    const [draft, setDraft] = useState({});
    const [auto, setAuto] = useState({});
    const [sel, setSel] = useState(() => ({ promptId: rankPrompts[0]?.id ?? null, platform: PLATFORM_KEYS[0] }));
    const [pasted, setPasted] = useState('');
    const [aliasText, setAliasText] = useState('');
    const [now] = useState(() => Date.now());
    const panelRef = useRef(null);
    const picked = useRef(false);

    const aliases = useMemo(() => brandAliases(place, aliasText.split(',')), [place, aliasText]);
    const saved = useMemo(() => (latest ? somOf(latest.results, before?.results) : null), [latest, before]);
    const trend = useMemo(() => somTrend(history), [history]);
    const due = useMemo(() => remeasureStatus(history, now), [history, now]);

    const cellValue = (prompt, platformKey) => draft[prompt.text]?.[platformKey] ?? null;
    const rows = rankPrompts.filter((prompt) => prompt.core || showExtra || PLATFORM_KEYS.some((key) => cellValue(prompt, key) !== null));
    const draftResults = rows.map((prompt) => ({ prompt: prompt.text, ranks: { ...emptyRanks(), ...(draft[prompt.text] || {}) } }));
    const preview = somOf(draftResults, latest?.results, { sameCells: true });

    const prompt = prompts.find((item) => item.id === sel.promptId) || rankPrompts[0];
    const platform = PLATFORMS.find((p) => p.key === sel.platform) || PLATFORMS[0];
    const guide = AI_GUIDES[platform.key];
    const isRank = prompt.kind === 'rank';
    const ask = promptFor(prompt, platform.key);
    const value = isRank ? cellValue(prompt, platform.key) : null;
    const cellKey = `${prompt.id}:${platform.key}`;
    const analysis = useMemo(
        () => (pasted.trim() ? analyzeAnswer(pasted, aliases, { placeId }) : null),
        [pasted, aliases, placeId],
    );
    const advice = isRank && value !== null ? rankAdvice(value, platform.key) : null;
    const canMerge = Boolean(latest) && isToday(latest.at, now);
    const lastRank = (item, platformKey) => latest?.results.find((row) => row.prompt === item.text)?.ranks?.[platformKey] ?? null;

    // 왼쪽 표·목록에서 칸을 고르면 입력 칸으로 초점을 옮깁니다(좁은 화면에서는 그곳으로 스크롤).
    useEffect(() => {
        if (!picked.current) return;
        picked.current = false;
        const panel = panelRef.current;
        if (!panel) return;
        const rect = panel.getBoundingClientRect();
        if (rect.top < 0 || rect.top > window.innerHeight - 200) {
            const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            panel.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
        }
        panel.focus({ preventScroll: true });
    }, [sel]);

    const select = (promptId, platformKey) => {
        picked.current = true;
        setSel({ promptId, platform: platformKey });
        setPasted('');
    };

    const switchPlatform = (platformKey) => {
        setSel({ promptId: prompt.id, platform: platformKey });
        setPasted('');
    };

    const applyRank = (rank, byPaste) => {
        setDraft((prev) => ({ ...prev, [prompt.text]: { ...(prev[prompt.text] || {}), [platform.key]: rank } }));
        setAuto((prev) => ({ ...prev, [cellKey]: byPaste }));
    };

    const judge = (text, names) => {
        if (!isRank || !text.trim()) return;
        const result = analyzeAnswer(text, names, { placeId });
        if (result.rank !== null) applyRank(result.rank, true);
    };

    const onPaste = (text) => {
        setPasted(text);
        judge(text, aliases);
    };

    const onAlias = (text) => {
        setAliasText(text);
        judge(pasted, brandAliases(place, text.split(',')));
    };

    const goNext = () => {
        const order = isRank
            ? rows.flatMap((item) => PLATFORM_KEYS.map((key) => ({ item, key })))
            : PLATFORM_KEYS.filter((key) => promptFor(prompt, key).text).map((key) => ({ item: prompt, key }));
        const at = order.findIndex((cell) => cell.item.id === prompt.id && cell.key === platform.key);
        const rest = [...order.slice(at + 1), ...order.slice(0, Math.max(at, 0))];
        const next = (isRank ? rest.find((cell) => cellValue(cell.item, cell.key) === null) : null) || rest[0];
        if (next) select(next.item.id, next.key);
    };

    const resetDraft = () => {
        setDraft({});
        setAuto({});
        setPasted('');
    };

    const save = () => {
        if (!preview) {
            toast.error('순위를 한 칸 이상 넣은 뒤 기록해주세요.');
            return;
        }
        saveHistory([...history, { at: new Date().toISOString(), results: draftResults }].slice(-SOM_KEEP));
        resetDraft();
        onRecorded?.();
        toast.success('오늘 실측을 기록했습니다. 같은 질문으로 다시 재면 변화를 보여 드립니다.');
    };

    // 재다 만 칸을 채웠을 때: 새 기록을 만들지 않고 오늘 마지막 기록에 합칩니다(기록마다 잰 칸이 달라 비교가 흐려지지 않게).
    const mergeToLatest = () => {
        if (!preview || !latest) return;
        saveHistory([...history.slice(0, -1), { at: latest.at, results: mergeResults(latest.results, draftResults) }]);
        resetDraft();
        toast.success('방금 기록에 이어 넣었습니다.');
    };

    const removeLatest = () => {
        saveHistory(history.slice(0, -1));
        toast.success('마지막 기록을 지웠습니다.');
    };

    const copyAsk = () => copyText(ask.text, ask.keyword ? '검색어를 복사했습니다.' : '질문을 복사했습니다.');
    const openAi = () => {
        navigator.clipboard?.writeText(ask.text).catch(() => {});
        toast.success(guide.prefill ? `새 창에서 ${guide.site} 화면을 엽니다. 질문은 복사해 두었습니다.` : `질문을 복사했습니다. 열린 ${guide.site} 화면에 붙여 넣으세요.`);
    };

    return (
        <>
            <section className={base.card}>
                <div className={base.cardHead}>
                    <div>
                        <h2><Gauge size={18} aria-hidden="true" /> AI 답변 실측 — 지금 실제로 몇 번째로 추천되나</h2>
                        <p>
                            준비도는 재료 점검이고 이 칸은 결과입니다. 같은 질문을 AI마다 직접 묻고 내 매장 순위를 기록하면
                            AI 답변 점유율(Share of Model)을 계산해 지난번과 비교합니다.
                        </p>
                    </div>
                </div>
                {saved ? (
                    <Result place={place} history={history} saved={saved} trend={trend} due={due} visible={visible} onRemoveLatest={removeLatest} />
                ) : (
                    <p className={styles.empty}>
                        아직 기록이 없습니다. 무엇을 고치기 전에 지금 상태부터 재 두어야 나중에 효과가 있었는지 알 수 있습니다.
                        아래에서 기본 질문 하나를 한 AI에만 물어도 기록할 수 있습니다.
                    </p>
                )}
            </section>

            <section className={base.card}>
                <div className={base.cardHead}>
                    <div>
                        <h2><ClipboardPaste size={18} aria-hidden="true" /> 직접 묻고 기록하기</h2>
                        <p>
                            질문을 골라 AI에 똑같이 묻고, 받은 답변을 붙여 넣으면 순위와 출처를 읽어 드립니다.
                            다섯 AI를 모두 재지 않아도 됩니다(잰 칸만 계산합니다).
                        </p>
                    </div>
                </div>

                <div className={styles.benchBox}>
                    <div className={styles.bench}>
                        <div className={styles.lists}>
                            <h3>기록하는 질문 <small>칸을 누르면 묻는 법이 열립니다</small></h3>
                            <table className={styles.matrix}>
                                <caption className={base.srOnly}>질문별·AI별 내 매장 추천 순위 입력</caption>
                                <thead>
                                    <tr>
                                        <th scope="col">질문</th>
                                        {PLATFORMS.map((p) => <th key={p.key} scope="col">{p.short}</th>)}
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map((item) => (
                                        <tr key={item.id}>
                                            <th scope="row">
                                                <span className={styles.qLabel}>{item.label}</span>
                                                <span className={styles.qText}>{item.naver}</span>
                                            </th>
                                            {PLATFORMS.map((p) => {
                                                const rank = cellValue(item, p.key);
                                                const on = item.id === prompt.id && p.key === platform.key;
                                                const last = lastRank(item, p.key);
                                                const tone = rankTone(rank);
                                                return (
                                                    <td key={p.key} data-label={p.short}>
                                                        <button
                                                            type="button"
                                                            className={`${styles.cell}${tone ? ` ${styles[tone]}` : ''}`}
                                                            aria-current={on ? 'true' : undefined}
                                                            aria-label={`${p.label} · ${item.label}: ${rank === null ? '아직 안 잼' : somRankLabel(rank)}${last !== null ? `, 지난번 ${somRankLabel(last)}` : ''} — 입력하기`}
                                                            onClick={() => select(item.id, p.key)}
                                                        >
                                                            {rank === null ? <Plus size={16} aria-hidden="true" /> : somRankLabel(rank)}
                                                            {rank === null && last !== null && <small>지난번 {somRankLabel(last)}</small>}
                                                        </button>
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {extraCount > 0 && (
                                <button type="button" className={styles.linkBtn} aria-expanded={showExtra} onClick={() => setShowExtra((prev) => !prev)}>
                                    {showExtra ? '세부 질문 접기' : `세부 질문 ${extraCount}개도 재기 — 메뉴·조건으로 물을 때`}
                                </button>
                            )}

                            <h3 className={styles.checkTitle}>확인용 질문 <small>기록하지 않고 답만 봅니다</small></h3>
                            <ul className={styles.checks}>
                                {checkPrompts.map((item) => (
                                    <li key={item.id}>
                                        <button
                                            type="button"
                                            className={styles.check}
                                            aria-current={item.id === prompt.id ? 'true' : undefined}
                                            onClick={() => select(item.id, platform.key)}
                                        >
                                            <span className={styles.kind}>{KIND_LABEL[item.kind]}</span>
                                            <span className={styles.checkLabel}>{item.label}</span>
                                            <ArrowRight size={14} aria-hidden="true" />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>

                        <div className={styles.ask} ref={panelRef} tabIndex={-1} aria-label={`${platform.label}에 ${prompt.label} 묻기`}>
                            <p className={styles.askHead}>
                                <span className={styles.kind}>{KIND_LABEL[prompt.kind]}</span>
                                <strong>{prompt.label}</strong>
                            </p>
                            <div className={styles.aiPick} role="group" aria-label="물어볼 AI">
                                {PLATFORMS.map((p) => (
                                    <button
                                        key={p.key}
                                        type="button"
                                        className={p.key === platform.key ? styles.aiOn : styles.ai}
                                        aria-pressed={p.key === platform.key}
                                        onClick={() => switchPlatform(p.key)}
                                    >
                                        {p.short}
                                    </button>
                                ))}
                            </div>

                            <ol className={styles.flow}>
                                <li>
                                    <h4>{ask.keyword ? '네이버 검색창에 이 검색어를 넣으세요' : `${guide.site}에 이렇게 물으세요`}</h4>
                                    {ask.text ? (
                                        <>
                                            {/* key: 질문이 바뀌면 새로 그려 등장 애니메이션이 다시 재생됩니다 */}
                                            <p key={ask.text} className={styles.askText}>{ask.text}</p>
                                            <div className={styles.btnRow}>
                                                <button type="button" className={base.ghostBtn} onClick={copyAsk}>
                                                    <Copy size={16} aria-hidden="true" /> 복사
                                                </button>
                                                <a
                                                    className={`${base.ghostBtn} ${styles.openBtn}`}
                                                    href={aiOpenUrl(platform.key, ask.text)}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    onClick={openAi}
                                                >
                                                    <ExternalLink size={16} aria-hidden="true" /> 복사하고 {guide.site} 열기
                                                </a>
                                            </div>
                                            <ul className={styles.tips}>
                                                {[...guide.tips, ...(isRank ? guide.rankTips || [] : [])].map((tip) => <li key={tip}>{tip}</li>)}
                                            </ul>
                                        </>
                                    ) : (
                                        <p className={styles.skip}>{ask.note} 위에서 다른 AI를 고르세요.</p>
                                    )}
                                </li>
                                <li>
                                    <h4><label htmlFor="som-paste">받은 답변 붙여 넣기</label></h4>
                                    <textarea
                                        id="som-paste"
                                        className={styles.textarea}
                                        rows={5}
                                        value={pasted}
                                        placeholder={guide.paste}
                                        onChange={(event) => onPaste(event.target.value)}
                                    />
                                    <p className={styles.hint}>붙여 넣은 글은 이 화면에서만 읽고 저장하지 않습니다.</p>
                                </li>
                                <li>
                                    <h4>{isRank ? '내 매장 순위' : '답변에서 볼 것'}</h4>
                                    {isRank ? (
                                        <>
                                            <div className={styles.ranks} role="group" aria-label="내 매장 순위">
                                                {SOM_RANKS.map((rank) => (
                                                    <button
                                                        key={rank}
                                                        type="button"
                                                        className={`${value === rank ? styles.rankOn : styles.rank}${value === rank ? ` ${styles[rankTone(rank)]}` : ''}`}
                                                        aria-pressed={value === rank}
                                                        onClick={() => applyRank(rank, false)}
                                                    >
                                                        {somRankLabel(rank)}
                                                    </button>
                                                ))}
                                            </div>
                                            <p className={styles.verdict} role="status">
                                                {value === null && !analysis && '답변을 붙여 넣으면 자동으로 판정합니다. 직접 골라도 됩니다.'}
                                                {value === null && analysis && '상호를 읽지 못했습니다. 순위를 직접 골라주세요.'}
                                                {value !== null && (
                                                    <>
                                                        <b>{somRankLabel(value)}</b> · {somPoints(value)}점
                                                        {auto[cellKey] ? ' — 붙여 넣은 답변으로 판정했습니다(참고용). 실제와 다르면 직접 고르세요.' : ' — 직접 골랐습니다.'}
                                                        <button type="button" className={styles.linkBtn} onClick={() => applyRank(null, false)}>지우기</button>
                                                    </>
                                                )}
                                            </p>
                                        </>
                                    ) : (
                                        <p className={styles.look}>{prompt.look}</p>
                                    )}

                                    {prompt.facts?.length > 0 && (
                                        <div className={styles.block}>
                                            <h5>플레이스에 등록된 실제 정보</h5>
                                            <dl className={styles.facts}>
                                                {prompt.facts.map((fact) => (
                                                    <div key={fact.label}>
                                                        <dt>{fact.label}</dt>
                                                        <dd>{fact.value}</dd>
                                                    </div>
                                                ))}
                                            </dl>
                                        </div>
                                    )}

                                    {analysis?.listed.length > 0 && (
                                        <div className={styles.block}>
                                            <h5><ListOrdered size={14} aria-hidden="true" /> AI가 추천한 순서</h5>
                                            <ol className={styles.listed}>
                                                {analysis.listed.map((item, index) => (
                                                    <li key={`${index}-${item.name}`} className={item.mine ? styles.mine : undefined}>
                                                        <span>{index + 1}</span>{item.name}{item.mine && <em>내 매장</em>}
                                                    </li>
                                                ))}
                                            </ol>
                                        </div>
                                    )}

                                    {analysis?.quote && (
                                        <div className={styles.block}>
                                            <h5><Quote size={14} aria-hidden="true" /> AI가 내 매장을 이렇게 설명했습니다</h5>
                                            <blockquote className={styles.quote}>{analysis.quote}</blockquote>
                                            <p className={styles.hint}>영업시간·가격·메뉴가 지금과 같은지 확인하세요. 다르면 그 정보가 실린 출처 글부터 고칩니다.</p>
                                        </div>
                                    )}

                                    {analysis?.sources.length > 0 && <Sources sources={analysis.sources} onOpenTemplate={onOpenTemplate} />}
                                    {analysis && analysis.sources.length === 0 && prompt.kind === 'source' && (
                                        <p className={styles.hint}>출처 주소를 찾지 못했습니다. 답변의 링크 주소(https://…)까지 함께 복사했는지 확인하세요.</p>
                                    )}

                                    {advice && (
                                        <p className={`${styles.advice} ${styles[advice.tone]}`}>
                                            {advice.text}
                                            {advice.tab && onGo && (
                                                <button type="button" className={styles.linkBtn} onClick={() => onGo(advice.tab)}>
                                                    {advice.cta} <ArrowRight size={14} aria-hidden="true" />
                                                </button>
                                            )}
                                        </p>
                                    )}
                                </li>
                            </ol>

                            <div className={styles.askFoot}>
                                <details className={styles.alias}>
                                    <summary>답변에 상호가 다르게 적혀 있나요?</summary>
                                    <label htmlFor="som-alias">상호의 다른 표기(쉼표로 구분)</label>
                                    <input
                                        id="som-alias"
                                        type="text"
                                        className={styles.input}
                                        value={aliasText}
                                        placeholder="예: 영문 이름, 줄임말"
                                        onChange={(event) => onAlias(event.target.value)}
                                    />
                                </details>
                                <button type="button" className={base.ghostBtn} onClick={goNext}>
                                    {isRank ? '다음 칸' : '다음 AI'} <ArrowRight size={16} aria-hidden="true" />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <div className={styles.saveBar}>
                    <p role="status">
                        {preview
                            ? (
                                <>
                                    지금 넣은 값 · 점유율 <b>{preview.overall}%</b> <span>({preview.measured}칸)</span>
                                    <Delta value={preview.delta} unit="%p" />
                                    {preview.delta !== null && <span>지난번 같은 칸 대비</span>}
                                </>
                            )
                            : '순위를 한 칸 이상 넣으면 점유율이 계산됩니다.'}
                    </p>
                    <div className={styles.saveBtns}>
                        {canMerge && (
                            <button type="button" className={base.ghostBtn} onClick={mergeToLatest} disabled={!preview}>
                                <Plus size={16} aria-hidden="true" /> 방금 기록에 이어 넣기
                            </button>
                        )}
                        <button type="button" className={base.primaryBtn} onClick={save} disabled={!preview}>
                            <Save size={16} aria-hidden="true" /> {canMerge ? '새 기록으로 남기기' : '오늘 결과 기록'}
                        </button>
                    </div>
                    {canMerge && (
                        <small>다시 잰 것이면 &lsquo;새 기록으로 남기기&rsquo;, 아까 재다 만 칸을 채운 것이면 &lsquo;방금 기록에 이어 넣기&rsquo;를 누르세요.</small>
                    )}
                </div>

                <p className={base.diagNote}>
                    점수표는 전략 정리의 Share of Model과 같습니다: {SOM_RANKS.map((rank) => `${somRankLabel(rank)} ${somPoints(rank)}점`).join(' · ')}.
                    점유율 = 받은 점수 ÷ (잰 칸 × 100)이며 재지 않은 칸은 계산에서 뺍니다. AI 답은 물을 때마다, 사람마다 달라지므로
                    한 번의 결과보다 같은 질문으로 반복해 잰 흐름을 보세요. 혼잘마는 AI에 대신 묻지 않으며, &lsquo;열기&rsquo;는 내 브라우저에서 그 AI 화면을 여는 링크입니다.
                </p>
            </section>
        </>
    );
}
