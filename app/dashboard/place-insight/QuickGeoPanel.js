'use client';

// 오늘 시작하는 AI 노출 가이드 화면 — AI별 반영 타임라인, AI 탭 5개와 전략 카드, 하루 플랜.
// 전략·문구·시간은 lib/place-geo-quick.js 의 순수 함수가 만들고(반영 시간은 모두 lib/place-geo.js 값), 여기서는 그리기와 체크만 합니다.
// 체크 표시는 GeoAeoPanel 의 체크 저장소(이 브라우저)에 함께 저장되며 외부로 나가는 요청은 없습니다.

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, Copy, Hourglass, RotateCcw, Timer, Zap } from 'lucide-react';
import {
    buildOneDayPlan, buildQuickStrategies, buildQuickTimeline, clockAt, durationLabel, quickSummary,
    QUICK_CHECK_PREFIX, QUICK_PLATFORMS,
} from '@/lib/place-geo-quick';
import base from './page.module.css';
import styles from './QuickGeoPanel.module.css';

const PLATFORM_LABEL = Object.fromEntries(QUICK_PLATFORMS.map((platform) => [platform.key, platform.label]));
const DIFFICULTY_CLASS = { easy: 'dEasy', normal: 'dNormal', hard: 'dHard' };

async function copyText(text, doneMessage) {
    try {
        await navigator.clipboard.writeText(text);
        toast.success(doneMessage);
    } catch {
        toast.error('복사하지 못했습니다. 직접 선택해 복사해주세요.');
    }
}

function readinessText(progress, platformKey) {
    const item = (progress || []).find((entry) => entry.key === platformKey);
    return item && Number.isFinite(item.overall) ? `준비도 ${item.overall}점` : null;
}

// AI마다 반영까지 걸리는 구간을 한 시간 축 위에 막대로 놓습니다. 눈금 간격은 실제 시간 비율이 아닙니다.
function Timeline({ timeline, onPick }) {
    const lastTick = timeline.ticks[timeline.ticks.length - 1];
    return (
        <div className={styles.timelineBox}>
            <h3>AI별 반영 타임라인 <small>일을 끝낸 뒤 AI 답변에 반영되기까지 · 검증 안 됨</small></h3>
            <div className={styles.tlScroll}>
                <div className={styles.tl} style={{ '--cols': timeline.columns }}>
                    <div className={styles.tlAxis} aria-hidden="true">
                        <span />
                        <span className={styles.tlTicks}>
                            {Array.from({ length: timeline.columns }, (_, index) => (
                                <span key={index} className={styles.tlTick}>
                                    {timeline.ticks[index]?.label}
                                    {index === timeline.columns - 1 && <em>{timeline.open ? '이후' : lastTick?.label}</em>}
                                </span>
                            ))}
                        </span>
                    </div>
                    <ul className={styles.tlRows}>
                        {timeline.rows.map((row) => (
                            <li key={row.key}>
                                <button
                                    type="button"
                                    className={styles.tlRow}
                                    onClick={() => onPick(row.platform)}
                                    aria-label={`${row.label}${row.note ? ` ${row.note}` : ''}, 반영까지 ${row.range}(검증 안 됨) — 이 AI의 통로 보기`}
                                >
                                    <span className={styles.tlName}>
                                        <strong>{row.label}</strong>
                                        {row.note && <small>{row.note}</small>}
                                        <em className={styles.tlRange} aria-hidden="true">{row.range}</em>
                                    </span>
                                    <span className={styles.tlTrack}>
                                        <span className={styles.tlBar} data-open={row.max === null} style={{ gridColumn: `${row.from} / ${row.to}` }}>
                                            {row.range}
                                        </span>
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
            <p className={styles.legend}>
                <span><i className={styles.legendBar} aria-hidden="true" /> 반영을 기대하는 구간</span>
                <span><i className={styles.legendOpen} aria-hidden="true" /> 며칠 걸림</span>
                <span className={styles.swipeHint}>옆으로 밀면 뒤 시간대가 보입니다</span>
                <span>눈금 간격은 실제 시간 비율과 다릅니다 · 줄을 누르면 그 AI의 통로로 이동합니다</span>
            </p>
        </div>
    );
}

function StrategyCard({ strategy, checked, onToggle }) {
    const done = strategy.stepIds.filter((id) => checked.includes(id)).length;
    const complete = done === strategy.stepIds.length;
    const cardClass = [styles.card, strategy.when === 'now' ? '' : styles.cardPrep, complete ? styles.cardDone : ''].filter(Boolean).join(' ');
    return (
        <li id={`quick-card-${strategy.id}`} className={cardClass} tabIndex={-1}>
            <div className={styles.cardHead}>
                <h4>{strategy.title}</h4>
                <span className={styles.stepCount}>
                    {complete && <CheckCircle2 size={14} aria-hidden="true" />}
                    {done}/{strategy.stepIds.length} 단계
                </span>
            </div>
            <p className={styles.meta}>
                {strategy.eta && <span className={styles.metaTime}><Timer size={14} aria-hidden="true" /> 예상 반영 {strategy.eta}</span>}
                <span className={`${styles.metaChip} ${styles[DIFFICULTY_CLASS[strategy.difficulty]]}`}>난이도 {strategy.difficultyLabel}</span>
                <span className={styles.metaChip}>작업 {durationLabel(strategy.effortMinutes)}</span>
            </p>
            <p className={styles.why}>{strategy.why}</p>
            {strategy.needs && <p className={styles.needs}><b>준비물</b> {strategy.needs}</p>}
            <ol className={styles.steps}>
                {strategy.steps.map((step, index) => {
                    const id = strategy.stepIds[index];
                    const inputId = `quick-step-${id}`;
                    const on = checked.includes(id);
                    return (
                        <li key={id} className={on ? styles.stepOn : undefined}>
                            <input id={inputId} type="checkbox" checked={on} onChange={() => onToggle(id)} />
                            <label htmlFor={inputId}><b>{index + 1}</b>{step}</label>
                        </li>
                    );
                })}
            </ol>
            <ul className={styles.cautions} aria-label="주의사항">
                {strategy.cautions.map((caution) => (
                    <li key={caution}><AlertTriangle size={14} aria-hidden="true" /><span>{caution}</span></li>
                ))}
            </ul>
            {strategy.draft && (
                <details className={styles.draft}>
                    <summary>{strategy.draft.label} 보기</summary>
                    <pre tabIndex={0} aria-label={strategy.draft.label}>{strategy.draft.text}</pre>
                    <button type="button" className={base.ghostBtn} onClick={() => copyText(strategy.draft.text, `'${strategy.draft.label}'을 복사했습니다.`)}>
                        <Copy size={16} aria-hidden="true" /> 복사
                    </button>
                </details>
            )}
        </li>
    );
}

function StrategyGroup({ title, hint, Icon, strategies, prep, checked, onToggle }) {
    if (strategies.length === 0) return null;
    return (
        <div className={styles.group}>
            <h3 className={prep ? styles.groupPrep : undefined}>
                <Icon size={16} aria-hidden="true" /> {title} <small>{strategies.length}개 · {hint}</small>
            </h3>
            <ul className={styles.cards}>
                {strategies.map((strategy) => <StrategyCard key={strategy.id} strategy={strategy} checked={checked} onToggle={onToggle} />)}
            </ul>
        </div>
    );
}

function OneDayPlan({ plan, checked, onSetMany, onPick }) {
    const [start, setStart] = useState('09:00');
    const isDone = (step) => step.checkIds.every((id) => checked.includes(id));
    const doneCount = plan.steps.filter(isDone).length;
    return (
        <section className={base.card}>
            <div className={`${base.cardHead} ${styles.headWrap}`}>
                <div>
                    <h2><CalendarClock size={18} aria-hidden="true" /> 오늘 하루 실행 플랜 — 오늘 통로를 열고 내일부터 다시 재기</h2>
                    <p>
                        지금 순위 기록 → 통로 열기 → 다시 재기까지 시간 순서로 늘어놓았습니다.
                        지금 바로 되는 일만 하면 약 {durationLabel(plan.nowMinutes)}
                        {plan.workMinutes > plan.nowMinutes && <>, 준비가 필요한 일까지 하면 약 {durationLabel(plan.workMinutes)}</>} 손이 갑니다.
                    </p>
                </div>
                <div className={styles.headTools}>
                    <label className={styles.startField} htmlFor="quick-day-start">
                        시작 시각
                        <input id="quick-day-start" type="time" value={start} onChange={(event) => setStart(event.target.value || '09:00')} />
                    </label>
                    <span className={styles.progress}>{doneCount}/{plan.steps.length} 완료</span>
                </div>
            </div>
            <ol className={styles.day}>
                {plan.steps.map((step) => {
                    const done = isDone(step);
                    const partial = step.checkIds.filter((id) => checked.includes(id)).length;
                    const inputId = `quick-${step.id}`;
                    return (
                        <li key={step.id} className={done ? styles.dayDone : undefined} data-kind={step.kind}>
                            <div className={styles.dayTime}>
                                <strong>{clockAt(start, step.offset)}</strong>
                                <small>{durationLabel(step.minutes)}</small>
                            </div>
                            <input id={inputId} type="checkbox" checked={done} onChange={() => onSetMany(step.checkIds, !done)} />
                            <div className={styles.dayBody}>
                                <label htmlFor={inputId} className={styles.dayTitle}>{step.title}</label>
                                {step.kind === 'strategy' && (
                                    <p className={styles.dayTags}>
                                        <span className={styles.tagAi}>{PLATFORM_LABEL[step.platform]}</span>
                                        {step.when !== 'now' && <span>준비되면</span>}
                                        {partial > 0 && !done && <span>{partial}/{step.checkIds.length} 단계 완료</span>}
                                    </p>
                                )}
                                <p>{step.detail}</p>
                                {step.eta && <p className={styles.dayExpect}>예상 반영 {step.eta} (검증 안 됨)</p>}
                                {step.kind === 'strategy' && (
                                    <button type="button" className={styles.linkBtn} onClick={() => onPick(step.strategyId)}>
                                        실행 단계 보기 <ArrowRight size={14} aria-hidden="true" />
                                    </button>
                                )}
                            </div>
                        </li>
                    );
                })}
            </ol>
            <p className={base.diagNote}>
                체크하면 아래 가이드의 그 통로 단계가 함께 체크됩니다. 다시 재는 날은 AI별 반영 시간의 끝에 맞춘 추정이며,
                그날 추천 목록에 든다는 보장은 없습니다. 오르지 않은 AI는 &lsquo;로드맵&rsquo; 탭의 주간 측정 때 같은 질문으로 다시 재 보세요.
            </p>
        </section>
    );
}

export default function QuickGeoPanel({ place, activity, analysis, progress, checked, onToggle, onSetMany }) {
    const strategies = useMemo(
        () => buildQuickStrategies(place, activity, { atomic: analysis.atomic, fanout: analysis.fanout, done: checked }),
        [place, activity, analysis, checked],
    );
    const timeline = useMemo(() => buildQuickTimeline(), []);
    const plan = useMemo(() => buildOneDayPlan(strategies), [strategies]);
    const summary = useMemo(() => quickSummary(strategies, checked), [strategies, checked]);
    const [platformKey, setPlatformKey] = useState(QUICK_PLATFORMS[0].key);
    const [focusId, setFocusId] = useState(null);

    // 타임라인·하루 플랜에서 고른 탭이나 전략 카드로 이동합니다(탭을 먼저 바꾼 뒤 그려진 요소를 찾음).
    useEffect(() => {
        if (!focusId) return;
        const target = document.getElementById(focusId);
        if (target) {
            const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            target.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'center' });
            target.focus({ preventScroll: true });
        }
        setFocusId(null);
    }, [focusId]);

    const pick = (strategyId) => {
        const strategy = strategies.find((item) => item.id === strategyId);
        if (!strategy) return;
        setPlatformKey(strategy.platform);
        setFocusId(`quick-card-${strategy.id}`);
    };

    const pickPlatform = (key) => {
        setPlatformKey(key);
        setFocusId(`quick-tab-${key}`);
    };

    const stepIds = strategies.flatMap((strategy) => strategy.stepIds);
    const stepsDone = stepIds.filter((id) => checked.includes(id)).length;
    const quickChecked = checked.filter((id) => id.startsWith(QUICK_CHECK_PREFIX));
    const platform = QUICK_PLATFORMS.find((item) => item.key === platformKey) || QUICK_PLATFORMS[0];
    const mine = strategies.filter((strategy) => strategy.platform === platform.key);
    const now = mine.filter((strategy) => strategy.when === 'now');
    const prep = mine.filter((strategy) => strategy.when !== 'now');

    const reset = () => {
        onSetMany(quickChecked, false);
        toast.success('가이드 체크를 지웠습니다.');
    };

    return (
        <>
            <OneDayPlan plan={plan} checked={checked} onSetMany={onSetMany} onPick={pick} />

            <section className={base.card}>
                <div className={`${base.cardHead} ${styles.headWrap}`}>
                    <div>
                        <h2><Zap size={18} aria-hidden="true" /> 오늘 시작하는 AI 노출 가이드 — AI별로 오늘 열 수 있는 통로</h2>
                        <p>
                            AI마다 매장 정보를 가져가는 통로가 달라, 오늘 손댈 수 있는 일을 AI별 1-2-3 단계로 풀었습니다.
                            일은 오늘 끝나도 AI 답변에 반영되기까지는 몇 시간에서 며칠이 걸립니다.
                            &lsquo;로드맵&rsquo; 탭이 몇 주짜리 계획이라면 이 칸은 오늘 할 일입니다.
                        </p>
                    </div>
                    <div className={styles.headTools}>
                        {quickChecked.length > 0 && (
                            <button type="button" className={base.ghostBtn} onClick={reset}>
                                <RotateCcw size={16} aria-hidden="true" /> 체크 초기화
                            </button>
                        )}
                        <span className={styles.progress}>{stepsDone}/{stepIds.length} 단계</span>
                    </div>
                </div>

                <Timeline timeline={timeline} onPick={pickPlatform} />

                <div className={styles.aiTabs} role="group" aria-label="전략을 볼 AI">
                    {summary.map((item) => {
                        const readiness = readinessText(progress, item.key);
                        return (
                            <button
                                key={item.key}
                                id={`quick-tab-${item.key}`}
                                type="button"
                                className={styles.aiTab}
                                aria-pressed={item.key === platform.key}
                                onClick={() => setPlatformKey(item.key)}
                            >
                                <strong>{item.label}</strong>
                                <span className={styles.aiCount}>지금 바로 <b>{item.now}</b>개{item.prep > 0 && ` · 준비 필요 ${item.prep}개`}</span>
                                <span>반영까지 {item.windows.map((window) => window.range).join(' · ')}</span>
                                {readiness && <span>{readiness}</span>}
                                {item.done > 0 && <span className={styles.aiDone}><CheckCircle2 size={14} aria-hidden="true" /> {item.done}/{item.total} 끝냄</span>}
                            </button>
                        );
                    })}
                </div>

                {/* key: AI를 바꾸면 새로 그려 등장 애니메이션이 다시 재생됩니다(아래 전략 카드는 AI마다 다른 카드라 저절로 새로 그려짐) */}
                <p key={platform.key} className={styles.aiInfo}>
                    <b>{platform.label} 반영까지</b> {platform.claim}
                    <small> — 전략 정리 후반에 제시된 값이며 검증되지 않았습니다. 일을 끝내는 시간과 AI 답변에 반영되는 시간은 다릅니다.</small>
                </p>

                <StrategyGroup title="지금 바로 할 수 있는 것" hint="위에서부터 차례로" Icon={Zap} strategies={now} checked={checked} onToggle={onToggle} />
                <StrategyGroup title="준비가 필요한 것" hint="준비물을 갖춘 뒤" Icon={Hourglass} strategies={prep} prep checked={checked} onToggle={onToggle} />

                <p className={base.diagNote}>
                    반영 시간은 전략 정리 후반에 정정된 값으로, 각 서비스가 보장하지 않는 검증 안 된 추정입니다.
                    카드의 예상 반영은 &lsquo;로드맵&rsquo; 탭에 같은 일이 있으면 그 단계의 값을, 없으면 그 AI의 값을 씁니다. 통로를 여는 순서이지 AI 추천을 보장하는 방법이 아닙니다.
                    전략 정리에 있던 손님인 척 쓰는 댓글, 여러 계정 자문자답, 같은 방송 반복은 삭제·계정 제한 위험이 커서 매장 관계자임을 밝히고 사실만 쓰는 방식으로 바꿨습니다.
                    결과는 &lsquo;AI 답변 실측&rsquo; 탭에 기록해 직전과 비교하세요.
                </p>
            </section>
        </>
    );
}
