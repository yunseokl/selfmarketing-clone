'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
    AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, ClipboardCheck, ExternalLink, Info, Lightbulb,
    ListChecks, RotateCcw, TrendingDown,
} from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import {
    AS_OF,
    DIAGNOSE_QUESTIONS,
    EXTRA_ITEMS,
    FACTORS,
    INDUSTRIES,
    KEYWORD_MAX,
    OFFICIAL_ITEMS,
    RANK_NOTICE,
    SOURCES,
    STORAGE_KEY,
    buildTodos,
    checkKeywords,
    defaultState,
    diagnose,
    getItemGuide,
    normalizeState,
    summarizeChecklist,
} from '@/lib/place-check';
import styles from './page.module.css';

const TABS = [
    { id: 'checklist', label: '정보 충실도 점검', icon: ClipboardCheck },
    { id: 'drop', label: '순위가 떨어졌을 때', icon: TrendingDown },
];

const FACTOR_LABEL = Object.fromEntries(FACTORS.map((f) => [f.id, f.label]));

function SourceLine({ ids }) {
    return (
        <p className={styles.sources}>
            <span>출처</span>
            {ids.map((id) => {
                const src = SOURCES[id];
                return (
                    <a key={id} href={src.url} target="_blank" rel="noopener noreferrer" className={styles.srcLink}>
                        <b className={src.kind === 'official' ? styles.srcOfficial : styles.srcSecondary}>
                            {src.kind === 'official' ? '공식' : '2차'}
                        </b>
                        {src.name}
                    </a>
                );
            })}
            <span>· 기준일 {AS_OF}</span>
        </p>
    );
}

export default function PlaceCheckPage() {
    const { status } = useSession();
    const router = useRouter();

    const [tab, setTab] = useState('checklist');
    const [state, setState] = useState(defaultState);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        if (status === 'unauthenticated') router.push('/login');
    }, [status, router]);

    // 저장된 체크 상태 불러오기 — 이 브라우저에만 저장되고 서버로 보내지 않습니다.
    useEffect(() => {
        try {
            const raw = window.localStorage.getItem(STORAGE_KEY);
            if (raw) setState(normalizeState(JSON.parse(raw)));
        } catch {
            // 저장소를 못 읽으면 빈 상태로 시작합니다.
        }
        setLoaded(true);
    }, []);

    useEffect(() => {
        if (!loaded) return;
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch {
            // 저장소가 막혀 있어도 화면은 그대로 동작합니다.
        }
    }, [state, loaded]);

    const industryLabel = INDUSTRIES.find((i) => i.id === state.industry)?.label || '';
    const summary = useMemo(() => summarizeChecklist(state), [state]);
    const todos = useMemo(() => buildTodos(state, state.industry), [state]);
    const keywordResult = useMemo(
        () => checkKeywords(state.keywordsText, { businessName: state.businessName }),
        [state.keywordsText, state.businessName]
    );
    const diagnosis = useMemo(() => diagnose(state.answers), [state.answers]);

    const toggle = (group, id) => {
        setState((prev) => ({ ...prev, [group]: { ...prev[group], [id]: !prev[group][id] } }));
    };

    const setAnswer = (id, value) => {
        setState((prev) => ({ ...prev, answers: { ...prev.answers, [id]: value } }));
    };

    const resetAll = () => {
        if (!window.confirm('체크한 내용과 입력한 키워드, 질문 답변을 모두 지우고 처음부터 다시 할까요?')) return;
        setState(defaultState());
        try {
            window.localStorage.removeItem(STORAGE_KEY);
        } catch {
            // 무시
        }
        toast.success('처음부터 다시 시작합니다.');
    };

    return (
        <DashboardLayout>
            <div className={styles.container}>
                <header className={styles.header}>
                    <div>
                        <h1>플레이스 진단</h1>
                        <p>네이버 플레이스 정보를 얼마나 채웠는지 점검하고, 순위가 떨어졌을 때 먼저 확인할 것을 정리해 드려요.</p>
                    </div>
                    <div className={styles.headRight}>
                        <span className={styles.freeBadge}>무료 · 이 브라우저에만 저장</span>
                        <button type="button" className={styles.ghostBtn} onClick={resetAll}>
                            <RotateCcw size={14} /> 처음부터 다시
                        </button>
                    </div>
                </header>

                <div className={styles.tabs} role="tablist" aria-label="진단 종류">
                    {TABS.map(({ id, label, icon: Icon }) => (
                        <button
                            key={id}
                            type="button"
                            role="tab"
                            id={`tab-${id}`}
                            aria-selected={tab === id}
                            aria-controls={`panel-${id}`}
                            className={`${styles.tab} ${tab === id ? styles.tabActive : ''}`}
                            onClick={() => setTab(id)}
                        >
                            <Icon size={16} />
                            {label}
                        </button>
                    ))}
                </div>

                {tab === 'checklist' && (
                    <div id="panel-checklist" role="tabpanel" aria-labelledby="tab-checklist">
                        <div className={styles.layout}>
                            {/* ===== 점검 항목 ===== */}
                            <section className={styles.formCard} aria-label="정보 충실도 점검 항목">
                                <div className={styles.cardHead}>
                                    <h2><ListChecks size={16} /> 공식 10개 항목</h2>
                                </div>

                                <div className={styles.field}>
                                    <label htmlFor="industry">업종</label>
                                    <div className={styles.selectWrap}>
                                        <select
                                            id="industry"
                                            value={state.industry}
                                            onChange={(e) => setState((prev) => ({ ...prev, industry: e.target.value }))}
                                        >
                                            {INDUSTRIES.map((i) => (
                                                <option key={i.id} value={i.id}>{i.label}</option>
                                            ))}
                                        </select>
                                        <ChevronDown size={16} aria-hidden="true" />
                                    </div>
                                    <p className={styles.hint}>업종에 따라 안내 문구가 달라져요.</p>
                                </div>

                                <p className={styles.lead}>
                                    네이버는 순위를 높이려면 스마트플레이스 정보를 정확하고 풍부하게 채우라고 안내합니다. 아래 10개 항목을 하나씩 확인하고, 채웠으면 체크하세요.
                                </p>

                                <ul className={styles.itemList}>
                                    {OFFICIAL_ITEMS.map((item, index) => {
                                        const guide = getItemGuide(item, state.industry);
                                        const checked = state.checked[item.id] === true;
                                        return (
                                            <li key={item.id} className={`${styles.item} ${checked ? styles.itemDone : ''}`}>
                                                <div className={styles.itemHead}>
                                                    <input
                                                        id={`official-${item.id}`}
                                                        type="checkbox"
                                                        checked={checked}
                                                        onChange={() => toggle('checked', item.id)}
                                                    />
                                                    <label htmlFor={`official-${item.id}`}>
                                                        <span className={styles.itemNo}>{index + 1}</span>
                                                        {item.label}
                                                    </label>
                                                </div>
                                                <p className={styles.how}>{guide.how}</p>
                                                {guide.industryNote && (
                                                    <p className={styles.tip}>
                                                        <Lightbulb size={14} aria-hidden="true" />
                                                        <span><b>{industryLabel}</b> {guide.industryNote}</span>
                                                    </p>
                                                )}
                                                <p className={styles.caution}>
                                                    <AlertTriangle size={14} aria-hidden="true" />
                                                    <span>{guide.caution}</span>
                                                </p>
                                                <SourceLine ids={item.sources} />
                                            </li>
                                        );
                                    })}
                                </ul>

                                <h3 className={styles.groupTitle}>추가 운영 점검 <span className={styles.tag}>2차 출처 기반</span></h3>
                                <p className={styles.lead}>
                                    아래는 공식 10개 항목이 아니며, 순위에 직접 반영된다고 네이버가 밝힌 항목도 아닙니다. 업계 글에서 정리한 운영 습관이라 참고용으로만 보세요. 위 10개 완료 개수에는 포함되지 않아요.
                                </p>
                                <ul className={styles.itemList}>
                                    {EXTRA_ITEMS.map((item) => {
                                        const checked = state.extra[item.id] === true;
                                        return (
                                            <li key={item.id} className={`${styles.item} ${checked ? styles.itemDone : ''}`}>
                                                <div className={styles.itemHead}>
                                                    <input
                                                        id={`extra-${item.id}`}
                                                        type="checkbox"
                                                        checked={checked}
                                                        onChange={() => toggle('extra', item.id)}
                                                    />
                                                    <label htmlFor={`extra-${item.id}`}>{item.label}</label>
                                                </div>
                                                <p className={styles.how}>{item.how}</p>
                                                <p className={styles.caution}>
                                                    <AlertTriangle size={14} aria-hidden="true" />
                                                    <span>{item.caution}</span>
                                                </p>
                                                <SourceLine ids={item.sources} />
                                            </li>
                                        );
                                    })}
                                </ul>
                            </section>

                            {/* ===== 결과 ===== */}
                            <div className={styles.resultCol}>
                                <section className={styles.resultCard} aria-label="점검 결과" aria-live="polite">
                                    <div className={styles.resultLabel}>정보 충실도 점검</div>
                                    <div className={styles.bigNumber}>
                                        10개 중 <span>{summary.done}</span>개 완료
                                    </div>
                                    <div
                                        className={styles.bar}
                                        role="progressbar"
                                        aria-label="완료한 항목 수"
                                        aria-valuemin={0}
                                        aria-valuemax={summary.total}
                                        aria-valuenow={summary.done}
                                    >
                                        <div className={styles.barFill} style={{ width: `${(summary.done / summary.total) * 100}%` }} />
                                    </div>
                                    <p className={styles.callout}>
                                        <Info size={14} aria-hidden="true" />
                                        <span>
                                            네이버는 순위를 정하는 세부 가중치를 공개하지 않습니다. 이 숫자는 채운 항목의 <b>개수</b>일 뿐, 점수나 등급, 예상 순위가 아니에요.
                                        </span>
                                    </p>

                                    {summary.complete ? (
                                        <p className={styles.done}>
                                            <CheckCircle2 size={16} aria-hidden="true" /> 10개 항목을 모두 확인했어요. 정보가 바뀌면 바뀐 날 바로 고쳐 주세요.
                                        </p>
                                    ) : (
                                        <>
                                            <h3 className={styles.todoTitle}>아직 안 한 항목 {todos.length}개</h3>
                                            <ol className={styles.todoList}>
                                                {todos.map((todo) => (
                                                    <li key={todo.id}>
                                                        <strong>{todo.label}</strong>
                                                        <span>{todo.action}</span>
                                                    </li>
                                                ))}
                                            </ol>
                                        </>
                                    )}

                                    <p className={styles.extraStat}>
                                        추가 운영 점검 {summary.extraTotal}개 중 {summary.extraDone}개 완료
                                    </p>
                                    <SourceLine ids={['rankHow', 'itemsList']} />
                                </section>
                            </div>
                        </div>

                        {/* ===== 대표키워드 점검기 ===== */}
                        <section className={styles.kwCard} aria-label="대표키워드 점검기">
                            <div className={styles.cardHead}>
                                <h2><ListChecks size={16} /> 대표키워드 점검기</h2>
                            </div>
                            <p className={styles.lead}>
                                대표키워드는 최대 {KEYWORD_MAX}개까지 등록할 수 있고, 손님이 실제로 찾는 메뉴명·서비스명을 넣는 칸이에요. 등록하기 전에 규칙으로 먼저 확인해 보세요. 입력한 내용은 저장소 밖으로 나가지 않습니다.
                            </p>
                            <div className={styles.kwGrid}>
                                <div>
                                    <div className={styles.field}>
                                        <label htmlFor="businessName">업체명 (선택)</label>
                                        <div className={styles.inputWrap}>
                                            <input
                                                id="businessName"
                                                type="text"
                                                maxLength={40}
                                                value={state.businessName}
                                                placeholder="예: 연남돼지갈비집"
                                                onChange={(e) => setState((prev) => ({ ...prev, businessName: e.target.value }))}
                                            />
                                        </div>
                                        <p className={styles.hint}>입력하면 대표키워드가 업체명을 그대로 반복하는지도 확인해요.</p>
                                    </div>
                                    <div className={styles.field}>
                                        <label htmlFor="keywordsText">대표키워드 (한 줄에 하나, 또는 쉼표로 구분)</label>
                                        <textarea
                                            id="keywordsText"
                                            rows={6}
                                            maxLength={300}
                                            value={state.keywordsText}
                                            placeholder={'돼지갈비\n삼겹살\n냉면'}
                                            onChange={(e) => setState((prev) => ({ ...prev, keywordsText: e.target.value }))}
                                        />
                                    </div>
                                </div>

                                <div aria-live="polite">
                                    {keywordResult.count === 0 ? (
                                        <div className={styles.emptyResult}>
                                            <strong>키워드를 입력해 보세요</strong>
                                            <p>개수, 중복, 길이, 홍보성 표현, 업체명 반복을 확인합니다.</p>
                                        </div>
                                    ) : (
                                        <>
                                            <p className={styles.kwSummary}>
                                                {keywordResult.count}개 입력 · 통과 {keywordResult.passCount}개 · 확인 필요 {keywordResult.warnCount}개
                                            </p>
                                            {keywordResult.listIssues.map((issue) => (
                                                <p key={issue} className={styles.warn}>
                                                    <AlertTriangle size={14} aria-hidden="true" /> {issue}
                                                </p>
                                            ))}
                                            <ul className={styles.kwList}>
                                                {keywordResult.items.map((item, index) => (
                                                    <li key={`${item.keyword}-${index}`} className={item.status === 'pass' ? styles.kwPass : styles.kwWarn}>
                                                        <div className={styles.kwHead}>
                                                            {item.status === 'pass'
                                                                ? <CheckCircle2 size={16} aria-hidden="true" />
                                                                : <AlertTriangle size={16} aria-hidden="true" />}
                                                            <strong>{item.keyword}</strong>
                                                            <span>{item.status === 'pass' ? '통과' : '확인 필요'}</span>
                                                        </div>
                                                        {item.reasons.length > 0 && (
                                                            <ul className={styles.reasons}>
                                                                {item.reasons.map((reason) => <li key={reason}>{reason}</li>)}
                                                            </ul>
                                                        )}
                                                    </li>
                                                ))}
                                            </ul>
                                            {keywordResult.ok && (
                                                <p className={styles.done}>
                                                    <CheckCircle2 size={16} aria-hidden="true" /> 규칙상 걸리는 곳이 없어요. 실제 등록 가능 여부는 스마트플레이스에서 최종 확인됩니다.
                                                </p>
                                            )}
                                        </>
                                    )}
                                </div>
                            </div>
                            <SourceLine ids={['rankHow', 'itemsList', 'marketing']} />
                            <p className={styles.sources}>
                                <span>글자 수 기준(2자 이상 15자 이하)은 이 도구의 권장 기준이며 네이버가 정한 제한이 아닙니다.</span>
                            </p>
                        </section>
                    </div>
                )}

                {tab === 'drop' && (
                    <div id="panel-drop" role="tabpanel" aria-labelledby="tab-drop">
                        <div className={styles.layout}>
                            <section className={styles.formCard} aria-label="순위 하락 질문">
                                <div className={styles.cardHead}>
                                    <h2><TrendingDown size={16} /> 해당되는 것을 골라 보세요</h2>
                                    <span className={styles.counter}>답변 {diagnosis.answered}/{diagnosis.total}</span>
                                </div>

                                <p className={styles.callout}>
                                    <Info size={14} aria-hidden="true" />
                                    <span>{RANK_NOTICE}</span>
                                </p>
                                <SourceLine ids={['rankAlgo']} />

                                <div className={styles.questions}>
                                    {DIAGNOSE_QUESTIONS.map((q, index) => {
                                        const value = state.answers[q.id];
                                        return (
                                            <fieldset key={q.id} className={styles.question}>
                                                <legend>
                                                    <span className={styles.itemNo}>{index + 1}</span>
                                                    {q.question}
                                                </legend>
                                                <div className={styles.yn}>
                                                    <input
                                                        id={`${q.id}-yes`}
                                                        type="radio"
                                                        name={q.id}
                                                        checked={value === 'yes'}
                                                        onChange={() => setAnswer(q.id, 'yes')}
                                                    />
                                                    <label htmlFor={`${q.id}-yes`}>예</label>
                                                    <input
                                                        id={`${q.id}-no`}
                                                        type="radio"
                                                        name={q.id}
                                                        checked={value === 'no'}
                                                        onChange={() => setAnswer(q.id, 'no')}
                                                    />
                                                    <label htmlFor={`${q.id}-no`}>아니오</label>
                                                    <span className={styles.factorTag}>{FACTOR_LABEL[q.factor]}</span>
                                                </div>
                                            </fieldset>
                                        );
                                    })}
                                </div>
                            </section>

                            <div className={styles.resultCol}>
                                <section className={styles.resultCard} aria-label="먼저 확인할 것" aria-live="polite">
                                    <div className={styles.cardTitle}><ListChecks size={16} /> 먼저 확인할 것</div>

                                    {diagnosis.answered === 0 && (
                                        <div className={styles.emptyResult}>
                                            <strong>질문에 답해 보세요</strong>
                                            <p>&quot;예&quot;라고 답한 항목만 모아서 먼저 확인할 순서로 정리해 드려요.</p>
                                        </div>
                                    )}

                                    {diagnosis.nothingFound && (
                                        <p className={styles.done}>
                                            <CheckCircle2 size={16} aria-hidden="true" /> 해당되는 항목이 없어요. 일주일 뒤 같은 조건으로 다시 확인해 보고, 그때도 내려가 있다면 순위 기록장의 추이를 함께 살펴보세요.
                                        </p>
                                    )}

                                    {diagnosis.groups.map((group) => (
                                        <div key={group.id} className={styles.group}>
                                            <h3>{group.label}</h3>
                                            <p className={styles.groupDesc}>{group.desc}</p>
                                            <ol className={styles.todoList}>
                                                {group.items.map((item) => (
                                                    <li key={item.id}>
                                                        <strong>{item.question}</strong>
                                                        <span>{item.action}</span>
                                                    </li>
                                                ))}
                                            </ol>
                                        </div>
                                    ))}

                                    {diagnosis.answered > 0 && !diagnosis.complete && (
                                        <p className={styles.muted}>아직 답하지 않은 질문이 {diagnosis.total - diagnosis.answered}개 있어요.</p>
                                    )}

                                    <SourceLine ids={['rankAlgo', 'rankHow', 'dropGuide', 'revu']} />
                                </section>

                                <section className={styles.recordCard} aria-label="순위 기록장 안내">
                                    <div className={styles.cardTitle}><Info size={16} /> 실제 순위와 추이는 여기서 확인하세요</div>
                                    <p className={styles.muted}>
                                        이 화면은 질문에 답해 점검하는 도구라 순위를 조회하지 않습니다. 플레이스 분석에서 실제 순위와 숨은 대표키워드를 조회하고, 순위 기록장에 쌓아 두면 하루 이틀의 흔들림과 실제 추이를 구분할 수 있어요.
                                    </p>
                                    <Link href="/dashboard/place-insight" className={styles.primaryBtn}>
                                        플레이스 분석으로 이동 <ArrowRight size={14} aria-hidden="true" />
                                    </Link>
                                </section>
                            </div>
                        </div>
                    </div>
                )}

                <section className={styles.basisCard} aria-label="출처와 안내">
                    <h2><Info size={14} aria-hidden="true" /> 이 화면의 기준</h2>
                    <ul>
                        <li>네이버는 플레이스 순위를 유사도·인기도·거리·정보의 충실성 등을 종합해 정한다고 안내하며, 세부 가중치는 공개하지 않습니다.</li>
                        <li>이 도구는 규칙으로 점검 항목을 정리할 뿐이며 순위를 조회하거나 예측하지 않습니다.</li>
                        <li>&quot;공식&quot;은 네이버 고객센터·공식 블로그 안내이고, &quot;2차&quot;는 공식 내용을 인용·정리한 외부 글입니다. 기준일은 {AS_OF}이며 네이버 정책은 바뀔 수 있어요.</li>
                    </ul>
                    <ul className={styles.sourceList}>
                        {Object.entries(SOURCES).map(([id, src]) => (
                            <li key={id}>
                                <b className={src.kind === 'official' ? styles.srcOfficial : styles.srcSecondary}>
                                    {src.kind === 'official' ? '공식' : '2차'}
                                </b>
                                <a href={src.url} target="_blank" rel="noopener noreferrer">
                                    {src.name} <ExternalLink size={11} aria-hidden="true" />
                                </a>
                            </li>
                        ))}
                    </ul>
                </section>
            </div>
        </DashboardLayout>
    );
}
