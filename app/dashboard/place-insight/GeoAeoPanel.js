'use client';

// AI 검색(GEO·AEO) 진단 화면. 계산은 모두 lib/place-geo.js 의 순수 함수가 하고,
// 여기서는 이미 받은 매장 정보·활동·대표키워드 순위만 씁니다. 네이버 요청이 더 생기는 곳은
// "상위 3곳 AI 추천·답변 점수 비교" 버튼 하나뿐입니다(누를 때만 조회). AI에 물어보기 탭은 사장님이 직접 물어 본 결과를
// 넣는 칸이라 외부로 나가는 요청이 없고, 체크 표시와 실측 기록은 이 브라우저에만 저장합니다.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
    AlertCircle, ArrowRight, Bot, CheckCircle2, Circle, ClipboardCheck, Copy, FileText, HelpCircle,
    ListTodo, Loader2, MessageCircleQuestion, Network, Quote, Radar, Route,
} from 'lucide-react';
import {
    analyzeGeoAeo, buildRoadmap, compareGeoSignals, placeOnlyScores, platformProgress, rivalGaps,
    PLATFORMS, ROADMAP_STAGES, ATOMIC_MIN, ATOMIC_MAX, GEO_TAB_LABELS, SITE_WORK_TITLE, SITE_WORK_NOTE,
} from '@/lib/place-geo';
import { dayLabel, remeasureStatus, somOf } from '@/lib/place-geo-prompts';
import { buildOneDayPlan, buildQuickStrategies } from '@/lib/place-geo-quick';
import base from './page.module.css';
import styles from './GeoAeoPanel.module.css';
import { GEO_TABS, GeoStatus, GeoTabPanel, GeoTabs } from './GeoSections';
import QuickGeoPanel from './QuickGeoPanel';
import SomTracker from './SomTracker';
import { useSomHistory } from './somStore';
import { useUnfold } from './unfold';

// 그래프의 AI 검색 점이 본문에서 들어 있는 탭: 진단(세부 항목·AI별 준비도), 초안(AI가 나눠 묻는 질문)
function geoTabOf(id) {
    if (id.startsWith('gf:') || id.startsWith('ai:')) return 'diagnosis';
    if (id === 'geo:fanout' || id.startsWith('fq:')) return 'drafts';
    return null;
}

const STATUS = {
    good: { label: '좋음', cls: 'sGood' },
    fair: { label: '보통', cls: 'sFair' },
    poor: { label: '부족', cls: 'sPoor' },
    unknown: { label: '확인 불가', cls: 'sUnknown' },
};

const FANOUT_STATUS = {
    yes: { label: '바로 답함', cls: 'sGood', Icon: CheckCircle2 },
    partial: { label: '일부만', cls: 'sFair', Icon: HelpCircle },
    no: { label: '정보 없음', cls: 'sPoor', Icon: AlertCircle },
    unknown: { label: '확인 불가', cls: 'sUnknown', Icon: HelpCircle },
};

// 업종 때문에 점수에서 뺀 질문(lib/place-industry.js, 병의원의 결제·약국의 예약 질문 등): '확인 불가'나 '채울 것'이 아니라 이름표와 이유로 보입니다.
// 이름표는 lib 가 이유와 같은 세기로 줍니다(예: 약국의 예약은 "확인 안 됨(점수에서 뺌)", 쿠폰은 "해당 없음").
const naFanout = (tag) => ({ label: tag || '해당 없음', cls: 'sUnknown', Icon: HelpCircle });

const ACTION_LEVEL = {
    high: { cls: 'actHigh' },
    mid: { cls: 'actMid' },
    low: { cls: 'actLow' },
};

const PLATFORM_LABEL = Object.fromEntries(PLATFORMS.map((p) => [p.key, p.label]));
const PLATFORM_SHORT = { ...Object.fromEntries(PLATFORMS.map((p) => [p.key, p.short])), common: '공통' };
const STAGE_LABEL = Object.fromEntries(ROADMAP_STAGES.map((stage) => [stage.key, stage.label]));
const CHECK_GROUPS = ['common', ...PLATFORMS.map((p) => p.key)];
const STORAGE_PREFIX = 'place-geo-check:v1:';
// 탭·탭 내용의 id 앞머리(예: geo-view-tab-today, geo-view-panel-today)
const TAB_ID = 'geo-view';

function scoreText(value) {
    return value === null || value === undefined ? '-' : `${value}`;
}

// 점수 등급(scoreLabel)과 같은 경계: 70점 이상 좋음, 50점 이상 보통
function toneOf(value) {
    if (value === null || value === undefined) return 'sUnknown';
    if (value >= 70) return 'sGood';
    if (value >= 50) return 'sFair';
    return 'sPoor';
}

function gainSum(gain) {
    return gain ? gain.geo + gain.aeo : 0;
}

async function copyText(text, doneMessage) {
    try {
        await navigator.clipboard.writeText(text);
        toast.success(doneMessage);
    } catch {
        toast.error('복사하지 못했습니다. 직접 선택해 복사해주세요.');
    }
}

function loadStored(key, fallback) {
    try {
        const parsed = JSON.parse(window.localStorage.getItem(key) || 'null');
        return parsed ?? fallback;
    } catch {
        return fallback;
    }
}

function saveStored(key, value) {
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // 저장이 막힌 브라우저(사생활 보호 모드 등)에서는 이번 화면에서만 기억합니다.
    }
}

function loadChecks(placeId) {
    const parsed = loadStored(STORAGE_PREFIX + placeId, []);
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
}

function Bar({ value }) {
    return (
        <span className={`${styles.bar} ${styles[toneOf(value)]}`} aria-hidden="true">
            <span style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }} />
        </span>
    );
}

function GainChips({ gain }) {
    if (!gain) return null;
    const parts = [gain.geo > 0 ? `AI 추천 +${gain.geo}` : null, gain.aeo > 0 ? `AI 답변 +${gain.aeo}` : null].filter(Boolean);
    if (parts.length === 0) return <span className={styles.gainNone}>점수 변화 작음</span>;
    return parts.map((text) => <span key={text} className={styles.gain}>{text}점</span>);
}

// 직전 측정과의 차이. 0이면 "변동 없음", 처음이면 아무것도 그리지 않습니다.
function TemplateButton({ action, templates, onOpenTemplate }) {
    const template = action.template ? templates.find((item) => item.key === action.template) : null;
    if (!template) return null;
    return (
        <button type="button" className={styles.linkBtn} onClick={() => onOpenTemplate(template.key)}>
            <FileText size={14} aria-hidden="true" /> &lsquo;{template.label}&rsquo; 초안 열기
        </button>
    );
}

function FactorList({ title, factors, actions }) {
    return (
        <div className={styles.factors}>
            <h3>{title}</h3>
            <ul>
                {factors.map((factor) => {
                    const status = STATUS[factor.status] || STATUS.unknown;
                    const next = factor.pct !== null && factor.pct < 100
                        ? actions.find((action) => gainSum(action.gain) > 0 && action.factors?.includes(factor.key))
                        : null;
                    const partial = factor.pct !== null && factor.max < factor.fullWeight;
                    return (
                        <li key={factor.key} data-node={factor.key === 'fanout' ? undefined : `gf:${factor.key}`}>
                            <div className={styles.factorHead}>
                                <span className={styles.factorLabel}>{factor.label}</span>
                                <Bar value={factor.pct} />
                                <span className={styles.factorPct}>{factor.pct === null ? '-' : factor.pct}</span>
                                <span className={`${styles.badge} ${styles[status.cls]}`}>{status.label}</span>
                            </div>
                            <p>{factor.evidence}</p>
                            {factor.platforms.length > 0 && (
                                <p className={styles.platformTags}>
                                    {factor.platforms.map((key) => <span key={key}>{PLATFORM_SHORT[key] || key}</span>)}
                                </p>
                            )}
                            {partial && <p className={styles.partial}>일부 확인 불가 — 확인된 부분({factor.max}/{factor.fullWeight}점 만점)만 계산했습니다.</p>}
                            {Array.isArray(factor.notApplicable) && factor.notApplicable.length > 0 && (
                                // 이 업종에 해당 없거나 확인되지 않아 점수 계산에서 뺀 세부 항목(병의원의 소식·쿠폰, 약국의 쿠폰·예약). 이름표와 이유는 lib 이 준 문장 그대로.
                                <p className={styles.partial}>
                                    점수에서 뺀 항목:{' '}
                                    {factor.notApplicable.map((entry) => `${entry.label} — ${entry.tag || '해당 없음'}: ${entry.reason}`).join(' / ')}
                                </p>
                            )}
                            {next && (
                                <p className={styles.next}>
                                    <ArrowRight size={14} aria-hidden="true" />
                                    <span>{next.title}</span>
                                    <GainChips gain={next.gain} />
                                </p>
                            )}
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}

function Overview({ analysis, progress }) {
    const { geo, aeo, question, coverage, actions } = analysis;
    return (
        <section className={base.card}>
            <div className={base.cardHead}>
                <div>
                    <h2><Bot size={18} aria-hidden="true" /> 진단 — AI별 준비도와 점수가 나온 이유</h2>
                    <p>
                        위 AI 추천 준비 {scoreText(geo.score)}점·AI 답변 준비 {scoreText(aeo.score)}점이 어떤 항목에서 나왔는지와, AI마다 준비가 얼마나 됐는지 봅니다.
                        {coverage && <> AI가 &ldquo;{question}&rdquo;을 나눠 찾는 세부 질문 {coverage.known}개 중 {coverage.yes}개는 바로 답할 수 있고, {coverage.no}개는 답할 정보가 없습니다.</>}
                    </p>
                </div>
            </div>

            <h3 className={styles.subTitle}>AI별 종합 준비도 — 재료(매장 정보) + 통로(그 AI가 읽는 곳)</h3>
            <ul className={styles.platforms}>
                {progress.map((platform) => (
                    <li key={platform.key} data-node={`ai:${platform.key}`}>
                        <div className={styles.platformHead}>
                            <strong>{platform.label}</strong>
                            <span className={styles.platformScore}>{scoreText(platform.overall)}<small>점 · {platform.overallGrade}</small></span>
                        </div>
                        <Bar value={platform.overall} />
                        <p className={styles.platformParts}>
                            재료 <b>{scoreText(platform.score)}점</b>
                            {platform.channel.total > 0 && <> · 통로 <b>{platform.channel.done}/{platform.channel.total}</b> 체크</>}
                        </p>
                        <p>읽는 곳: {platform.source}</p>
                        {platform.weakest && <p className={styles.weak}>가장 약한 재료: {platform.weakest}</p>}
                    </li>
                ))}
            </ul>

            <div className={styles.factorCols}>
                <FactorList title="AI 추천 준비 세부 항목 (GEO)" factors={geo.factors} actions={actions} />
                <FactorList title="AI 답변 준비 세부 항목 (AEO)" factors={aeo.factors} actions={actions} />
            </div>

            <p className={base.diagNote}>
                점수는 혼잘마가 정당한 방법만 골라 직접 정한 점검 기준이며, 네이버나 AI 회사가 알려 준 기준이 아닙니다. 네이버와 AI 회사는 항목별 비중을 공개하지 않으므로
                AI 답변에 나오는지·순위가 어떻게 되는지는 보장하지 않습니다. 확인할 수 없는 항목은 점수 계산(분모)에서 뺍니다.
                네이버 밖 AI는 네이버 플레이스를 직접 읽지 못하는 것으로 보아, ChatGPT·Gemini·Claude·Perplexity의 종합 준비도는
                재료 점수와 통로 진행률(&lsquo;{GEO_TAB_LABELS.roadmap}&rsquo; 탭에서 직접 체크한 외부 등록·글, 핵심 통로는 3배)을 반반 합쳤고 네이버는 통로를 20%만 반영했습니다.
                실제로 추천되는지는 &lsquo;{GEO_TAB_LABELS.measure}&rsquo; 탭에서 확인하세요.
            </p>
        </section>
    );
}

function ActionItem({ action, templates, onOpenTemplate }) {
    const level = ACTION_LEVEL[action.level] || ACTION_LEVEL.low;
    return (
        <li className={`${base[level.cls]} ${styles.actionItem}`}>
            <span className={base.actBadge}>{STAGE_LABEL[action.stage]}</span>
            <div className={styles.actionBody}>
                <strong>{action.title}</strong>
                {action.now && action.target && (
                    <p className={styles.nowTarget}>
                        <span><small>지금</small> {action.now}</span>
                        <ArrowRight size={14} aria-hidden="true" />
                        <span><small>목표</small> {action.target}</span>
                        <GainChips gain={action.gain} />
                    </p>
                )}
                <p>{action.how}</p>
                <p className={styles.platformTags}>
                    {action.platforms.map((key) => <span key={key}>{PLATFORM_SHORT[key] || key}</span>)}
                </p>
                <TemplateButton action={action} templates={templates} onOpenTemplate={onOpenTemplate} />
                {action.link && (
                    <Link href={action.link.href} className={styles.actionLink}>
                        {action.link.label} <ArrowRight size={14} aria-hidden="true" />
                    </Link>
                )}
            </div>
        </li>
    );
}

function ActionPlan({ analysis, onOpenTemplate }) {
    const { actions, projected, templates } = analysis;
    const scoring = actions.filter((action) => gainSum(action.gain) > 0);
    const others = actions.filter((action) => !action.manual && gainSum(action.gain) <= 0);
    return (
        <section className={base.card}>
            <div className={base.cardHead}>
                <div>
                    <h2><ListTodo size={18} aria-hidden="true" /> 재료 점수 올리는 순서 — 지금 → 목표 → +N점</h2>
                    <p>플레이스에서 고칠 일을 하나만 했다고 치고 점수를 다시 계산해, 많이 오르는 순서로 정리했습니다. 왼쪽 표시는 시작할 때입니다.</p>
                </div>
            </div>

            {projected && scoring.length > 0 && (
                <p className={styles.projection}>
                    아래를 모두 하면 <b>AI 추천 준비 {scoreText(projected.geo.now)} → {scoreText(projected.geo.after)}</b>
                    {' · '}<b>AI 답변 준비 {scoreText(projected.aeo.now)} → {scoreText(projected.aeo.after)}</b> (어림값)
                </p>
            )}

            {scoring.length === 0 ? (
                <p className={base.muted}>플레이스 정보로 점수를 더 올릴 할 일이 없습니다. &lsquo;{GEO_TAB_LABELS.roadmap}&rsquo; 탭의 외부 통로 일을 이어 가세요.</p>
            ) : (
                <ol className={base.actionList}>
                    {scoring.map((action) => <ActionItem key={action.id} action={action} templates={templates} onOpenTemplate={onOpenTemplate} />)}
                </ol>
            )}

            {others.length > 0 && (
                <>
                    <h3 className={styles.subTitle}>점수로 바로 잡히지 않지만 챙길 것</h3>
                    <ol className={base.actionList}>
                        {others.map((action) => <ActionItem key={action.id} action={action} templates={templates} onOpenTemplate={onOpenTemplate} />)}
                    </ol>
                </>
            )}

            <p className={base.diagNote}>
                +N점은 그 일 하나만 하고 다른 조건은 그대로라고 보고 다시 계산한 값입니다. 여러 개를 함께 하면 합이 조금 다를 수 있고, AI 답변 노출을 보장하지 않습니다.
            </p>
        </section>
    );
}

function RoadmapStep({ item, platformKey, checked, onToggle, templates, onOpenTemplate }) {
    const autoDone = item.done === true;
    const checkable = item.manual && !autoDone;
    const isDone = autoDone || (checkable && checked.includes(item.id));
    const inputId = `geo-road-${item.id}`;
    const core = Array.isArray(item.core) && item.core.includes(platformKey);
    const hasTags = core || item.needsSite || item.optional || autoDone;
    return (
        <li className={isDone ? styles.stepDone : undefined}>
            {checkable ? (
                <input id={inputId} type="checkbox" checked={isDone} onChange={() => onToggle(item.id)} />
            ) : (
                <span className={styles.stepMark} aria-hidden="true">
                    {autoDone ? <CheckCircle2 size={18} className={styles.sGood} /> : <Circle size={18} />}
                </span>
            )}
            <div>
                {checkable
                    ? <label htmlFor={inputId} className={styles.stepTitle}>{item.title}</label>
                    : <span className={styles.stepTitle}>{item.title}</span>}
                {hasTags && (
                    <p className={styles.stepTags}>
                        {core && <small className={styles.tagCore}>핵심 통로</small>}
                        {item.needsSite && <small className={styles.tagOpt}>홈페이지 있을 때</small>}
                        {item.optional && !item.needsSite && <small className={styles.tagOpt}>선택</small>}
                        {autoDone && <small className={styles.tagOpt}>자동 확인 · 완료</small>}
                    </p>
                )}
                {(item.now && item.target) || item.gain ? (
                    <p className={styles.stepMeta}>
                        {item.now && item.target && <span>{item.now} → {item.target}</span>}
                        <GainChips gain={item.gain} />
                    </p>
                ) : null}
                {(item.work || item.eta) && (
                    <p className={styles.stepInfo}>
                        {item.work && <span>작업 약 {item.work}</span>}
                        {item.eta && <span>반영 {item.eta} <small>(어림값)</small></span>}
                    </p>
                )}
                <p>{item.how}</p>
                <TemplateButton action={item} templates={templates} onOpenTemplate={onOpenTemplate} />
            </div>
        </li>
    );
}

function Roadmap({ analysis, progress, checked, onToggle, onOpenTemplate }) {
    const [platformKey, setPlatformKey] = useState(PLATFORMS[0].key);
    const platform = progress.find((p) => p.key === platformKey) || progress[0];
    const stages = useMemo(() => buildRoadmap(analysis.actions, platformKey), [analysis.actions, platformKey]);
    return (
        <section className={base.card}>
            <div className={base.cardHead}>
                <div>
                    <h2><Route size={18} aria-hidden="true" /> AI별 단계별 계획 — 지금 당장 → 1주 → 2주 → 1개월</h2>
                    <p>
                        AI마다 매장 정보를 가져가는 통로가 달라 순서도 다릅니다. 빨리 되는 것부터(지금 답변·출처 확인 → 이미 검색에 잡힌 글 맞추기 → 질문형 글 → 통로 넓히기) 차례로 놓았습니다.
                        직접 하는 일은 체크해 두세요(이 브라우저에 저장됩니다).
                    </p>
                </div>
            </div>
            <div className={styles.tabs} role="group" aria-label="단계별 계획을 볼 AI">
                {progress.map((p) => (
                    <button
                        key={p.key}
                        type="button"
                        className={p.key === platformKey ? styles.tabOn : styles.tab}
                        aria-pressed={p.key === platformKey}
                        onClick={() => setPlatformKey(p.key)}
                    >
                        {p.short} <small>{scoreText(p.overall)}점</small>
                    </button>
                ))}
            </div>

            {/* key: AI를 바꾸면 아래 두 덩어리를 새로 그려 등장 애니메이션이 다시 재생됩니다 */}
            <dl key={`info-${platformKey}`} className={styles.platformInfo}>
                <div>
                    <dt>가장 빠른 길</dt>
                    <dd>{platform.fastest}</dd>
                </div>
                <div>
                    <dt>이 AI가 고르는 글</dt>
                    <dd>{platform.filter}</dd>
                </div>
                <div>
                    <dt>반영까지</dt>
                    <dd>
                        {platform.claim} <small>— 네이버·AI 회사가 알려 준 시간이 아니라 어림값입니다. 일을 끝내는 시간과 AI 답변에 반영되는 시간은 다릅니다.</small>
                    </dd>
                </div>
                <div>
                    <dt>지금 상태</dt>
                    <dd>
                        종합 {scoreText(platform.overall)}점 = 재료 {scoreText(platform.score)}점
                        {platform.channel.total > 0 && <> + 통로 {platform.channel.done}/{platform.channel.total} 체크</>}
                        {platform.channel.coreTotal > 0 && <> (핵심 통로 {platform.channel.coreDone}/{platform.channel.coreTotal})</>}
                    </dd>
                </div>
            </dl>

            <ol key={`stages-${platformKey}`} className={styles.stages}>
                {stages.map((stage) => (
                    <li key={stage.key} className={styles.stage}>
                        <div className={styles.stageHead}>
                            <strong>{stage.label}</strong>
                            <span>{stage.sub}</span>
                        </div>
                        {stage.items.length === 0 ? (
                            <p className={styles.stageEmpty}>이 기간에 따로 할 일이 없습니다.</p>
                        ) : (
                            <>
                                {/* 홈페이지가 있어야 하는 기술 작업은 머리말 하나 아래로 모아, 홈페이지를 만든 분에게 그대로 전달할 수 있게 합니다. */}
                                {[stage.items.filter((item) => !item.needsSite), stage.items.filter((item) => item.needsSite)].map((group, index) => (
                                    group.length > 0 && (
                                        <div key={index === 0 ? 'plain' : 'site'} className={index === 1 ? styles.siteGroup : undefined}>
                                            {index === 1 && <p className={styles.siteHead}><b>{SITE_WORK_TITLE}</b> — {SITE_WORK_NOTE}</p>}
                                            <ul className={styles.steps}>
                                                {group.map((item) => (
                                                    <RoadmapStep
                                                        key={item.id}
                                                        item={item}
                                                        platformKey={platformKey}
                                                        checked={checked}
                                                        onToggle={onToggle}
                                                        templates={analysis.templates}
                                                        onOpenTemplate={onOpenTemplate}
                                                    />
                                                ))}
                                            </ul>
                                        </div>
                                    )
                                ))}
                            </>
                        )}
                    </li>
                ))}
            </ol>
        </section>
    );
}

function lengthBadge(answer) {
    if (answer.inRange) return `${answer.length}자 (권장 범위)`;
    return answer.short ? `${answer.length}자 (${ATOMIC_MIN}자보다 짧음)` : `${answer.length}자 (${ATOMIC_MAX}자 초과)`;
}

function AnswerCard({ analysis }) {
    const { atomic, criteria, fanout } = analysis;
    const faqText = atomic.faq.map((item) => `Q. ${item.question}\nA. ${item.answer}`).join('\n\n');
    return (
        <section className={base.card}>
            <div className={base.cardHead}>
                <div>
                    <h2><MessageCircleQuestion size={18} aria-hidden="true" /> AI가 나눠 묻는 질문과 답변 초안</h2>
                    <p>AI는 &ldquo;{atomic.question}&rdquo;을 아래처럼 세부 질문으로 나눠 찾는 것으로 보입니다. 매장 정보로 답할 수 있는지와 답변 초안을 보여 줍니다.</p>
                </div>
            </div>

            <div className={styles.atomic}>
                <div className={styles.atomicHead}>
                    <h3><Quote size={16} aria-hidden="true" /> 한 문단 답변 초안 — 소개글 첫 문단·홈페이지 질문 바로 아래에</h3>
                    <span className={`${styles.badge} ${atomic.inRange ? styles.sGood : styles.sFair}`}>{lengthBadge(atomic)}</span>
                </div>
                <p className={styles.atomicQ}>Q. {atomic.question}</p>
                <p className={styles.atomicA}>{atomic.text}</p>
                <div className={styles.btnRow}>
                    <button type="button" className={base.ghostBtn} onClick={() => copyText(atomic.text, '한 문단 답변을 복사했습니다.')}>
                        <Copy size={16} aria-hidden="true" /> 답변 복사
                    </button>
                    {faqText && (
                        <button type="button" className={base.ghostBtn} onClick={() => copyText(faqText, '질문·답변 목록을 복사했습니다.')}>
                            <Copy size={16} aria-hidden="true" /> 질문·답변 {atomic.faq.length}개 복사
                        </button>
                    )}
                </div>
                <p className={base.diagNote}>
                    질문 하나에 답 하나로 끝나는 짧은 글입니다. 매장 정보에 있는 사실만으로 만든 초안이며, &ldquo;최고·유일&rdquo; 같은 표현이나 다른 매장과의 비교는 일부러 넣지 않았습니다.
                    {atomic.short ? ' 비어 있는 정보(가까운 역·영업시간·리뷰 평가)를 채우면 근거가 더 붙습니다.' : ''}
                </p>
            </div>

            {criteria ? (
                <div className={styles.atomic}>
                    <div className={styles.atomicHead}>
                        <h3><Quote size={16} aria-hidden="true" /> 조건형 답변 초안 — &ldquo;주차되는·예약 가능한&rdquo;처럼 조건을 붙인 질문용</h3>
                        <span className={`${styles.badge} ${criteria.inRange ? styles.sGood : styles.sFair}`}>{lengthBadge(criteria)}</span>
                    </div>
                    <p className={styles.atomicQ}>Q. {criteria.question}</p>
                    <p className={styles.atomicA}>{criteria.text}</p>
                    <div className={styles.btnRow}>
                        <button type="button" className={base.ghostBtn} onClick={() => copyText(`${criteria.question}\n${criteria.text}`, '조건형 답변을 복사했습니다.')}>
                            <Copy size={16} aria-hidden="true" /> 질문과 답변 복사
                        </button>
                    </div>
                    <p className={base.diagNote}>
                        기준을 먼저 말하고 그 기준에 맞는 곳을 답하는 문장입니다. 이유와 결론이 한 문장에 붙어 있어 AI가 가져다 쓰기 쉬운 모양입니다(쓰인다는 보장은 없습니다).
                        매장 정보로 확인되는 조건만 넣었고, &ldquo;이 조건에 맞는 곳은 여기뿐&rdquo; 같은 단정이나 다른 매장의 단점은 넣지 않았습니다.
                    </p>
                </div>
            ) : (
                <p className={base.muted}>
                    주차·예약·가까운 역·늦은 영업처럼 확인되는 조건이 2개 이상 등록되면 조건형 답변 초안(&ldquo;주차되는 ○○ 추천&rdquo; 질문용)도 만들어 드립니다.
                </p>
            )}

            <ul className={styles.fanout} data-node="geo:fanout">
                {fanout.map((item) => {
                    const notApplicable = typeof item.notApplicable === 'string' && item.notApplicable ? item.notApplicable : null;
                    const status = notApplicable ? naFanout(item.notApplicableTag) : FANOUT_STATUS[item.status] || FANOUT_STATUS.unknown;
                    return (
                        <li key={item.key} data-node={`fq:${item.key}`}>
                            <div className={styles.fanoutHead}>
                                <status.Icon size={16} aria-hidden="true" className={styles[status.cls]} />
                                <strong>{item.question}</strong>
                                <span className={`${styles.badge} ${styles[status.cls]}`}>{status.label}</span>
                            </div>
                            {item.answer && <p className={styles.fanoutAnswer}>{item.answer}</p>}
                            {notApplicable
                                ? <p className={styles.fanoutNa}>{item.notApplicableTag === '해당 없음' || !item.notApplicableTag ? '이 업종에는 해당 없음' : '점수에서 뺀 이유'}: {notApplicable}</p>
                                : item.status !== 'yes' && <p className={styles.fanoutFix}>채울 것: {item.fix}</p>}
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}

function rankText(row) {
    if (row.rank) return `${row.rank}위`;
    return row.status === 'not_listed' ? '목록에 없음' : '순위 밖';
}

function CompetitionCard({ place, analysis, ranks, unavailable }) {
    const { share } = analysis;
    const results = useMemo(
        () => (ranks || []).filter((row) => row.state === 'done' && row.result?.top?.length > 0).map((row) => row.result),
        [ranks],
    );
    const loading = (ranks || []).some((row) => row.state === 'loading');
    const [selected, setSelected] = useState(null);
    const [rivals, setRivals] = useState({});
    const result = results.find((r) => r.keyword === selected) || results[0] || null;
    const signals = useMemo(() => compareGeoSignals(result, place), [result, place]);
    const mineOnly = useMemo(() => placeOnlyScores(place), [place]);
    const rival = result ? rivals[result.keyword] : null;

    const loadRivals = async () => {
        if (!result) return;
        const placeIds = result.top.filter((row) => !row.isTarget).slice(0, 3).map((row) => row.placeId);
        if (placeIds.length === 0) return;
        const keyword = result.keyword;
        setRivals((prev) => ({ ...prev, [keyword]: { loading: true } }));
        try {
            const res = await fetch('/api/place-insight/geo-rivals', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ placeIds }),
            });
            const data = await res.json();
            if (!res.ok) {
                toast.error(typeof data?.error === 'string' ? data.error : '경쟁 매장을 비교하지 못했습니다.');
                setRivals((prev) => ({ ...prev, [keyword]: undefined }));
                return;
            }
            setRivals((prev) => ({ ...prev, [keyword]: { loading: false, items: data.items, failed: data.failed } }));
        } catch (error) {
            console.error('Error loading rival GEO/AEO:', error);
            toast.error('경쟁 매장 비교 중 오류가 발생했습니다.');
            setRivals((prev) => ({ ...prev, [keyword]: undefined }));
        }
    };

    return (
        <section className={base.card}>
            <div className={base.cardHead}>
                <div>
                    <h2><Radar size={18} aria-hidden="true" /> 경쟁 매장 대비 AI 추천·답변 준비</h2>
                    <p>대표키워드 검색 순위로 노출 점유율을 매기고, 같은 검색 결과의 상위 매장과 AI 추천 신호를 비교합니다.</p>
                </div>
            </div>

            {!share && (
                <p className={base.muted}>
                    {loading
                        ? <><Loader2 size={14} className={base.spin} aria-hidden="true" /> 대표키워드 순위를 조회하고 있습니다. 끝나면 이곳이 채워집니다.</>
                        : '대표키워드 순위를 조회하면 노출 점유율과 경쟁 비교가 나옵니다. 위 키워드 순위 조회를 이용하세요.'}
                </p>
            )}

            {share && (
                <div className={styles.share}>
                    <div className={styles.shareScore}>
                        <span>네이버 검색 노출 점유율</span>
                        <strong>{share.score}<small>점</small></strong>
                        <p>
                            1위 100 · 2위 75 · 3위 55 · 4위 35 · 5위 20 · 6~10위 15점의 평균입니다. 같은 점수표를 플레이스 검색 순위에 옮긴 값이라
                            AI 답변 점유율과는 다릅니다(AI 답변은 &lsquo;{GEO_TAB_LABELS.measure}&rsquo; 탭에서 잽니다).
                        </p>
                    </div>
                    <ul className={styles.shareRows}>
                        {share.rows.map((row) => (
                            <li key={row.keyword}>
                                <span>{row.keyword}</span>
                                <b>{rankText(row)}</b>
                                <em>{row.points}점</em>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {results.length > 1 && (
                <div className={styles.tabs} role="group" aria-label="비교할 키워드">
                    {results.map((r) => (
                        <button
                            key={r.keyword}
                            type="button"
                            className={r.keyword === result?.keyword ? styles.tabOn : styles.tab}
                            aria-pressed={r.keyword === result?.keyword}
                            onClick={() => setSelected(r.keyword)}
                        >
                            {r.keyword}
                        </button>
                    ))}
                </div>
            )}

            {signals && (
                <div key={signals.keyword} className={styles.signals}>
                    <h3>&lsquo;{signals.keyword}&rsquo; 상위 매장 AI 추천 신호 지수</h3>
                    <p className={styles.signalSummary}>
                        내 매장 <b>{scoreText(signals.mine)}</b>
                        {signals.top5Average !== null && <> · 상위 5곳 평균 <b>{signals.top5Average}</b></>}
                        {signals.position && <> · {signals.count}곳 중 <b>{signals.position}번째</b></>}
                    </p>
                    <ul className={styles.signalRows}>
                        {signals.rows.map((row) => (
                            <li key={row.placeId || row.name} className={row.isTarget ? styles.mineRow : undefined}>
                                <span className={styles.signalRank}>{row.rank ? `${row.rank}위` : '-'}</span>
                                <span className={styles.signalName}>
                                    {row.name}
                                    {row.isTarget && <span className={base.tag}>내 매장</span>}
                                </span>
                                <Bar value={row.index} />
                                <span className={styles.factorPct}>{scoreText(row.index)}</span>
                            </li>
                        ))}
                    </ul>
                    <p className={base.diagNote}>
                        AI 추천 신호 지수는 같은 검색 결과 안에서 방문자 리뷰·블로그 리뷰·평점·사진·저장·운영 도구(예약·주문·쿠폰·페이)가 몇 번째쯤인지 평균한 값(0~100)입니다.
                        이미 받은 순위 목록만 써서 추가 조회가 없습니다.
                    </p>
                </div>
            )}

            {result && (
                <div className={styles.rivals}>
                    {!rival && (
                        <button type="button" className={base.ghostBtn} onClick={loadRivals} disabled={unavailable}>
                            <Network size={16} aria-hidden="true" /> 상위 3곳 AI 추천·답변 점수 비교
                        </button>
                    )}
                    {rival?.loading && (
                        <p className={base.rankPending}><Loader2 size={16} className={base.spin} aria-hidden="true" /> 상위 매장 화면을 1곳씩 읽는 중입니다(매장마다 2초 간격).</p>
                    )}
                    {rival?.items && (
                        <>
                            <div className={base.tableWrap}>
                                <table className={base.table}>
                                    <caption className={base.srOnly}>{result.keyword} 상위 매장과 내 매장의 AI 추천·답변 점수</caption>
                                    <thead>
                                        <tr>
                                            <th scope="col">구분</th>
                                            <th scope="col">매장</th>
                                            <th scope="col">AI 추천</th>
                                            <th scope="col">AI 답변</th>
                                            <th scope="col">내 매장보다 앞선 항목</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr className={base.myRow}>
                                            <td>내 매장</td>
                                            <th scope="row">{place.name}</th>
                                            <td>{scoreText(mineOnly.geo)}</td>
                                            <td>{scoreText(mineOnly.aeo)}</td>
                                            <td>-</td>
                                        </tr>
                                        {rival.items.map((item) => {
                                            const gaps = rivalGaps(mineOnly, item);
                                            const listed = result.top.find((row) => row.placeId === item.placeId);
                                            return (
                                                <tr key={item.placeId}>
                                                    <td>{listed ? `${listed.rank}위` : '-'}</td>
                                                    <th scope="row">{item.name}</th>
                                                    <td>{scoreText(item.geo)}</td>
                                                    <td>{scoreText(item.aeo)}</td>
                                                    <td>{gaps.length ? gaps.map((gap) => `${gap.label} +${gap.gap}`).join(', ') : '큰 차이 없음'}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                            {rival.failed > 0 && <p className={base.muted}>{rival.failed}곳은 읽지 못했습니다.</p>}
                            <p className={base.diagNote}>
                                경쟁 매장의 리뷰 날짜·답글·소식·순위는 따로 조회하지 않아, 내 매장도 같은 조건(매장 화면 정보만)으로 다시 계산했습니다. 그래서 &lsquo;진단&rsquo; 탭의 점수와 조금 다를 수 있습니다.
                            </p>
                        </>
                    )}
                </div>
            )}
        </section>
    );
}

// 복사해 쓰는 초안. 어떤 초안을 볼지는 로드맵의 "초안 열기"에서도 바꿀 수 있어 부모가 기억합니다.
function TemplatesCard({ templates, tab, onTab, cardRef }) {
    const current = templates.find((item) => item.key === tab) || templates[0];
    if (!current) return null;
    const blanks = (current.text.match(/직접 적기/g) || []).length;
    const isCode = ['answerPage', 'robots', 'jsonld', 'llms'].includes(current.key);
    // 홈페이지가 있는 가게만 쓰는 초안(로봇 안내 파일·구조화 데이터 등)은 머리말 하나 아래로 따로 모읍니다.
    const writeTabs = templates.filter((item) => item.group !== 'site');
    const siteTabs = templates.filter((item) => item.group === 'site');
    const tabButton = (item) => (
        <button
            key={item.key}
            type="button"
            className={item.key === current.key ? styles.tabOn : styles.tab}
            aria-pressed={item.key === current.key}
            onClick={() => onTab(item.key)}
        >
            {item.label}
        </button>
    );
    return (
        <section className={base.card} ref={cardRef} tabIndex={-1} aria-label="복사해 쓰는 초안">
            <div className={`${base.cardHead} ${styles.headWrap}`}>
                <div>
                    <h2><FileText size={18} aria-hidden="true" /> 복사해 쓰는 초안 — 이대로 붙여 넣고 빈칸만 채우기</h2>
                    <p>&lsquo;{GEO_TAB_LABELS.roadmap}&rsquo;의 할 일마다 쓸 글·요청문·설정 예시입니다. 플레이스에 있는 사실만 채워 넣었고, 화면 정보에 없는 값(전화번호·가격)은 &lsquo;직접 적기&rsquo;로 비워 두었습니다.</p>
                </div>
                <button type="button" className={base.ghostBtn} onClick={() => copyText(current.text, `'${current.label}' 초안을 복사했습니다.`)}>
                    <Copy size={16} aria-hidden="true" /> 복사
                </button>
            </div>
            <div className={styles.tabs} role="group" aria-label="초안 종류">
                {writeTabs.map(tabButton)}
            </div>
            {siteTabs.length > 0 && (
                <div className={styles.siteGroup}>
                    <p className={styles.siteHead}><b>{SITE_WORK_TITLE}</b> — {SITE_WORK_NOTE}</p>
                    <div className={styles.tabs} role="group" aria-label="홈페이지용 초안 종류">
                        {siteTabs.map(tabButton)}
                    </div>
                </div>
            )}
            {/* key: 초안을 바꾸면 새로 그려 등장 애니메이션이 다시 재생되고, 글 상자의 스크롤도 맨 위로 돌아갑니다 */}
            <p key={`where-${current.key}`} className={styles.templateWhere}>
                <b>쓰는 곳</b> {current.where}
                {current.group === 'site' && <span className={`${styles.badge} ${styles.sUnknown}`}>홈페이지가 있는 가게만</span>}
                {blanks > 0 && <span className={`${styles.badge} ${styles.sFair}`}>직접 적을 칸 {blanks}곳</span>}
            </p>
            {current.purpose && <p key={`purpose-${current.key}`} className={styles.templatePurpose}>{current.purpose}</p>}
            <pre key={`text-${current.key}`} className={isCode ? styles.code : styles.draft} tabIndex={0} aria-label={`${current.label} 초안`}>{current.text}</pre>
            {current.notes.length > 0 && (
                <ul className={styles.notes}>
                    {current.notes.map((note) => <li key={note}>{note}</li>)}
                </ul>
            )}
        </section>
    );
}

function Checklist({ items, checked, onToggle }) {
    // 자동 판정이 안 되는 항목(확인 불가)은 사장님이 직접 체크할 수 있게 둡니다.
    const checkable = (item) => !item.auto || item.done === null || item.done === undefined;
    const isDone = (item) => (checkable(item) ? checked.includes(item.id) : item.done === true);
    const done = items.filter(isDone).length;

    return (
        <section className={base.card}>
            <div className={`${base.cardHead} ${styles.headWrap}`}>
                <div>
                    <h2><ClipboardCheck size={18} aria-hidden="true" /> AI 검색 체크리스트</h2>
                    <p>&lsquo;자동&rsquo;은 매장 정보로 판정했고, 나머지는 외부 채널이라 직접 확인한 뒤 체크하세요. &lsquo;{GEO_TAB_LABELS.roadmap}&rsquo; 탭에서 체크한 일은 여기에도 표시됩니다.</p>
                </div>
                <span className={styles.progress}>{done}/{items.length} 완료</span>
            </div>
            <div className={styles.checkGroups}>
                {CHECK_GROUPS.map((group) => {
                    const groupItems = items.filter((item) => item.platform === group);
                    if (groupItems.length === 0) return null;
                    // 홈페이지가 있어야 하는 일은 같은 AI 묶음 안에서 머리말 아래로 뒤에 모읍니다.
                    const ordered = [...groupItems.filter((item) => !item.needsSite), ...groupItems.filter((item) => item.needsSite)];
                    const firstSite = ordered.find((item) => item.needsSite)?.id;
                    return (
                        <div key={group} className={styles.checkGroup}>
                            <h3>{group === 'common' ? '공통' : PLATFORM_LABEL[group]}</h3>
                            <ul>
                                {ordered.map((item) => {
                                    const inputId = `geo-check-${item.id}`;
                                    return (
                                        <Fragment key={item.id}>
                                        {item.id === firstSite && <li className={styles.siteHeadItem}><p className={styles.siteHead}><b>{SITE_WORK_TITLE}</b> — {SITE_WORK_NOTE}</p></li>}
                                        <li>
                                            {checkable(item) ? (
                                                <input id={inputId} type="checkbox" checked={checked.includes(item.id)} onChange={() => onToggle(item.id)} />
                                            ) : (
                                                <span className={styles.autoMark} aria-hidden="true">
                                                    {item.done === true ? <CheckCircle2 size={18} className={styles.sGood} /> : <AlertCircle size={18} className={styles.sPoor} />}
                                                </span>
                                            )}
                                            <div>
                                                {checkable(item) ? (
                                                    <label htmlFor={inputId} className={styles.checkTitle}>
                                                        {item.title}
                                                        {item.auto && <small className={styles.autoTag}>자동 확인 불가 · 직접 체크</small>}
                                                        {item.optional && <small className={styles.autoTag}>{item.needsSite ? '홈페이지 있을 때' : '선택'}</small>}
                                                    </label>
                                                ) : (
                                                    <span className={styles.checkTitle}>
                                                        {item.title}
                                                        <small className={styles.autoTag}>자동 · {item.done === true ? '완료' : '미완료'}</small>
                                                    </span>
                                                )}
                                                <p>{item.detail}</p>
                                            </div>
                                        </li>
                                        </Fragment>
                                    );
                                })}
                            </ul>
                        </div>
                    );
                })}
            </div>

        </section>
    );
}

export default function GeoAeoPanel({ place, activity, ranks, unavailable, onShowInGraph }) {
    const analysis = useMemo(() => analyzeGeoAeo({ place, activity, ranks }), [place, activity, ranks]);
    const placeId = place?.placeId;
    const [checked, setChecked] = useState([]);
    const [templateTab, setTemplateTab] = useState(null);
    const templatesRef = useRef(null);
    // 처음에는 첫 탭만 그리고, 다른 탭은 처음 열 때 그린 뒤 그대로 둡니다(입력하던 값·조회 결과를 잃지 않게).
    const [tab, setTab] = useState(GEO_TABS[0].key);
    const [opened, setOpened] = useState([GEO_TABS[0].key]);
    const [jump, setJump] = useState(null);
    const [somHistory] = useSomHistory(placeId);

    useEffect(() => {
        if (placeId) setChecked(loadChecks(placeId));
    }, [placeId]);

    const toggle = useCallback((id) => {
        setChecked((prev) => {
            const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
            saveStored(STORAGE_PREFIX + placeId, next);
            return next;
        });
    }, [placeId]);

    // 여러 체크를 한 번에 켜거나 끕니다(초단기 가이드의 원데이 플랜·체크 초기화).
    const setMany = useCallback((ids, on) => {
        setChecked((prev) => {
            const rest = prev.filter((id) => !ids.includes(id));
            const next = on ? [...rest, ...ids] : rest;
            saveStored(STORAGE_PREFIX + placeId, next);
            return next;
        });
    }, [placeId]);

    const showTab = useCallback((key) => {
        setTab(key);
        setOpened((prev) => (prev.includes(key) ? prev : [...prev, key]));
    }, []);

    // 그래프에서 고른 점(세부 항목·AI·세부 질문)이 다른 탭에 있으면 그 탭을 엽니다.
    useUnfold(
        (id) => {
            const key = geoTabOf(id);
            return Boolean(key) && key !== tab;
        },
        (id) => showTab(geoTabOf(id)),
    );

    // 요약 줄·안내 버튼으로 다른 탭에 갈 때는 그 탭으로 화면과 초점을 옮깁니다(탭을 직접 누를 때는 옮기지 않음).
    const goTab = useCallback((key) => {
        showTab(key);
        setJump((prev) => ({ to: 'panel', key, n: (prev?.n || 0) + 1 }));
    }, [showTab]);

    const openTemplate = useCallback((key) => {
        setTemplateTab(key);
        showTab('drafts');
        setJump((prev) => ({ to: 'template', key: 'drafts', n: (prev?.n || 0) + 1 }));
    }, [showTab]);

    useEffect(() => {
        if (!jump) return;
        const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const behavior = calm ? 'auto' : 'smooth';
        if (jump.to === 'template') {
            const card = templatesRef.current;
            if (!card) return;
            card.scrollIntoView({ behavior, block: 'start' });
            card.focus({ preventScroll: true });
            return;
        }
        const panel = document.getElementById(`${TAB_ID}-panel-${jump.key}`);
        const tabs = document.getElementById(`${TAB_ID}-tab-${jump.key}`)?.parentElement;
        if (!panel || !tabs) return;
        // 탭 줄이 화면 밖이면 탭 줄부터 보이게 올립니다.
        const top = tabs.getBoundingClientRect().top;
        if (top < 56 || top > window.innerHeight - 240) tabs.scrollIntoView({ behavior, block: 'start' });
        panel.focus({ preventScroll: true });
    }, [jump]);

    const progress = useMemo(
        () => (analysis ? platformProgress(analysis.platforms, analysis.actions, checked) : []),
        [analysis, checked],
    );

    // 요약 줄에 보일 '오늘 할 일' 진행 — QuickGeoPanel 이 그리는 하루 순서와 같은 계산입니다.
    const dayPlan = useMemo(() => {
        if (!analysis) return null;
        const strategies = buildQuickStrategies(place, activity, { atomic: analysis.atomic, fanout: analysis.fanout, done: checked });
        return buildOneDayPlan(strategies);
    }, [place, activity, analysis, checked]);
    const today = useMemo(() => {
        const steps = dayPlan?.steps || [];
        const isDone = (step) => step.checkIds.every((id) => checked.includes(id));
        return { done: steps.filter(isDone).length, total: steps.length, next: steps.find((step) => !isDone(step))?.title || null };
    }, [dayPlan, checked]);

    const som = useMemo(() => {
        const latest = somHistory[somHistory.length - 1];
        const result = latest ? somOf(latest.results, somHistory[somHistory.length - 2]?.results) : null;
        if (!result) return null;
        const status = remeasureStatus(somHistory);
        return { overall: result.overall, delta: result.delta, day: dayLabel(latest.at), days: status.days, due: status.due };
    }, [somHistory]);

    // 실측을 기록하면 로드맵의 '기준점 기록'과 하루 순서의 다음 측정 단계도 함께 체크합니다.
    const onRecorded = useCallback(() => {
        const steps = (dayPlan?.steps || []).filter((step) => step.kind === 'measure' || step.kind === 'remeasure');
        const next = steps.find((step) => !step.checkIds.every((id) => checked.includes(id)));
        setMany(['measure', ...(next ? next.checkIds : [])], true);
    }, [dayPlan, checked, setMany]);

    if (!analysis) return null;
    const tabs = GEO_TABS.map((item) => ({
        ...item,
        badge: item.key === 'today' ? `${today.done}/${today.total}` : item.key === 'measure' && som ? `${som.overall}%` : null,
    }));
    const panel = (key) => ({ idBase: TAB_ID, tabKey: key, active: tab, mounted: opened.includes(key) });
    return (
        <>
            <GeoStatus question={analysis.question} geo={analysis.geo} aeo={analysis.aeo} som={som} today={today} onGo={goTab} onShowInGraph={onShowInGraph} />
            <GeoTabs idBase={TAB_ID} tabs={tabs} active={tab} onSelect={showTab} />
            <GeoTabPanel {...panel('today')}>
                <QuickGeoPanel
                    place={place}
                    activity={activity}
                    analysis={analysis}
                    progress={progress}
                    checked={checked}
                    onToggle={toggle}
                    onSetMany={setMany}
                />
            </GeoTabPanel>
            <GeoTabPanel {...panel('measure')}>
                <SomTracker
                    place={place}
                    activity={activity}
                    visible={tab === 'measure'}
                    onGo={goTab}
                    onOpenTemplate={openTemplate}
                    onRecorded={onRecorded}
                />
            </GeoTabPanel>
            <GeoTabPanel {...panel('diagnosis')}>
                <Overview analysis={analysis} progress={progress} />
                <ActionPlan analysis={analysis} onOpenTemplate={openTemplate} />
            </GeoTabPanel>
            <GeoTabPanel {...panel('roadmap')}>
                <Roadmap analysis={analysis} progress={progress} checked={checked} onToggle={toggle} onOpenTemplate={openTemplate} />
                <Checklist items={analysis.checklist} checked={checked} onToggle={toggle} />
            </GeoTabPanel>
            <GeoTabPanel {...panel('drafts')}>
                <AnswerCard analysis={analysis} />
                <TemplatesCard templates={analysis.templates} tab={templateTab} onTab={setTemplateTab} cardRef={templatesRef} />
            </GeoTabPanel>
            <GeoTabPanel {...panel('rivals')}>
                <CompetitionCard place={place} analysis={analysis} ranks={ranks} unavailable={unavailable} />
            </GeoTabPanel>
        </>
    );
}
