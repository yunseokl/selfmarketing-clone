'use client';

// 플레이스 처방전 — 분석 결과를 A4 세로 문서로 뽑습니다.
// 새 패키지 없이 브라우저 인쇄를 씁니다: 버튼을 누르면 인쇄 창이 열리고, 거기서 'PDF로 저장'을 고르면 됩니다.
//  - 문서는 평소에는 그리지 않습니다(분석 화면이 무거워지지 않게). 버튼을 누르거나 브라우저 메뉴로 인쇄(Ctrl+P, beforeprint)할 때
//    그 자리에서 바로(flushSync) body 아래 포털에 그리고, 인쇄할 때만 보이게 합니다(Prescription.module.css). 인쇄가 끝나면 다시 치웁니다.
//    분석 전에는 평소처럼 화면을 인쇄합니다.
//  - 처방전 안에서 오류가 나도 오류 경계(PrescriptionBoundary)가 처방전만 빼고 분석 화면은 그대로 둡니다.
//    그때 버튼 옆에 "처방전을 만들지 못했습니다…" 한 줄을 띄우고 인쇄 창은 열지 않습니다.
//  - 저장되는 파일 이름이 "혼잘마 처방전 - 매장이름 - 날짜"가 되도록 인쇄하는 동안만 문서 제목(document.title)을 바꿉니다.
//  - 1쪽은 처방 요약(핵심 진단·이번 주 할 일·대표키워드 5칸·4주 뒤 다시 볼 숫자)이고, 2쪽부터 상세입니다.
//  - 문서에 들어갈 자료는 lib/place-prescription.js 의 순수 함수가 만듭니다. 3D 그래프는 싣지 않습니다.
//  - 확인 스크립트는 window.dispatchEvent(new Event(PRESCRIPTION_REQUEST)) 로 인쇄 창 없이 문서만 그릴 수 있습니다.

import { Component, Fragment, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { FileDown } from 'lucide-react';
import { toast } from 'sonner';
import { analyzeGeoAeo } from '@/lib/place-geo';
import { buildPrescription, prescriptionFileName, DRAFT_MARK } from '@/lib/place-prescription';
import { formatNumber } from '@/lib/place-graph';
import styles from './Prescription.module.css';

export const PRESCRIPTION_REQUEST = 'honjalma:prescription-request';
const FAILED_TEXT = '처방전을 만들지 못했습니다. 화면을 새로 고친 뒤 다시 눌러 주세요.';

// 인쇄하는 동안 바꿔 둔 문서 제목(끝나면 되돌림). 버튼과 브라우저 메뉴의 인쇄(Ctrl+P)가 같은 것을 씁니다.
let titleBefore = null;

function swapTitle(storeName) {
    if (titleBefore === null) titleBefore = document.title;
    document.title = prescriptionFileName(storeName);
}

function restoreTitle() {
    if (titleBefore === null) return;
    document.title = titleBefore;
    titleBefore = null;
}

// 문서를 그 자리에서 그리게 합니다(Prescription 이 이 신호를 받아 flushSync 로 그림). 그려졌으면 문서 요소를 돌려줍니다.
function requestDocument() {
    window.dispatchEvent(new Event(PRESCRIPTION_REQUEST));
    return document.querySelector('[data-prescription]');
}

// 처방전을 인쇄 창으로 보냅니다. 돌려주는 값: 'ok' · 'failed'(문서를 만들지 못함) · 'unsupported'(인쇄 창 없음)
export function printPrescription() {
    if (typeof window.print !== 'function') {
        toast.error('이 브라우저에서는 인쇄 창을 열 수 없습니다. 크롬이나 사파리에서 열어 주세요.');
        return 'unsupported';
    }
    const doc = requestDocument();
    if (!doc) return 'failed';
    swapTitle(doc.dataset.store);
    window.print();
    return 'ok';
}

// 저장 버튼 + 한 줄 안내. className 을 주면 그 화면의 버튼 모양을 그대로 씁니다.
//   block: 구역 머리 아래처럼 한 줄을 통째로 차지하게 놓을 때 / hint: 안내 문구를 함께 보일지
export function PrescriptionButton({ className, block = false, hint = true }) {
    const [failed, setFailed] = useState(false);
    const onClick = () => setFailed(printPrescription() === 'failed');
    return (
        <span className={styles.save} data-block={block ? 'true' : undefined}>
            <button type="button" className={className || styles.saveBtn} onClick={onClick}>
                <FileDown size={16} aria-hidden="true" />
                처방전 PDF로 저장
            </button>
            {failed
                ? <span className={styles.saveError} role="status">{FAILED_TEXT}</span>
                : hint && <span className={styles.saveHint}>인쇄 창에서 &lsquo;PDF로 저장&rsquo;을 고르세요</span>}
        </span>
    );
}

// 처방전 안에서 난 오류를 여기서 멈춥니다. 처방전만 그리지 않고, 분석 화면은 그대로 둡니다.
class PrescriptionBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { failed: false };
    }

    static getDerivedStateFromError() {
        return { failed: true };
    }

    componentDidCatch(error) {
        // 운영에서 원인을 찾을 수 있게 남깁니다(화면은 그대로).
        console.warn('[처방전] 문서를 만들지 못했습니다:', error?.message || error);
    }

    render() {
        return this.state.failed ? null : this.props.children;
    }
}

const CIRCLED = ['①', '②', '③', '④'];

// 쪽 넘김 규칙: 3줄 이하 표는 통째로 한 쪽에, 4줄 이상 표는 쪼개져도 되지만 양쪽에 2줄 이상 남게
// (앞 2줄·뒤 2줄을 각각 한 묶음으로 둠). 쪽이 넘어간 표는 머리 줄(칸 이름)이 다시 나오고, 표 제목은 표와 떨어지지 않습니다.
export const TABLE_WHOLE_MAX = 3;

function rowChunks(rows) {
    if (rows.length <= TABLE_WHOLE_MAX) return [rows];
    return [rows.slice(0, 2), rows.slice(2, rows.length - 2), rows.slice(-2)].filter((chunk) => chunk.length > 0);
}

function chunkClass(index, total) {
    return total === 1 || index === 0 || index === total - 1 ? styles.rowKeep : undefined;
}

// 3줄 이하 표가 든 묶음은 통째로(제목·표·풀이가 한 쪽에), 더 긴 표는 위 묶음으로 나눠 끊습니다.
function partClass(rowCount, extra) {
    return [styles.part, rowCount <= TABLE_WHOLE_MAX ? styles.keep : null, extra].filter(Boolean).join(' ');
}

// 항목 목록(그 밖의 할 일·AI 점검 일): 2개 이하는 통째로, 그보다 많으면 항목 사이에서 끊습니다(항목 하나는 쪼개지 않음).
function listPartClass(itemCount) {
    return [styles.part, itemCount <= 2 ? styles.keep : null].filter(Boolean).join(' ');
}

function count(value) {
    return Number.isFinite(value) ? formatNumber(value) : '-';
}

function score(value) {
    return Number.isFinite(value) ? value.toFixed(2) : '-';
}

/* ───────── 1쪽: 처방 요약 ───────── */

function BlockTitle({ index, children, note }) {
    return (
        <h2 className={styles.blockTitle}>
            <span className={styles.no}>{CIRCLED[index]}</span>
            {children}
            {note && <span className={styles.titleNote}>{note}</span>}
        </h2>
    );
}

function Diagnoses({ items, index }) {
    return (
        <section className={styles.block}>
            <BlockTitle index={index}>핵심 진단</BlockTitle>
            <ol className={styles.diagnoses}>
                {items.map((diag, i) => (
                    <li key={diag.key}>
                        <span className={styles.diagNo}>{i + 1}</span>
                        <div>
                            <p className={styles.diagText}>{diag.text}</p>
                            {diag.basis && <p className={styles.sub}>{diag.basis}</p>}
                        </div>
                    </li>
                ))}
            </ol>
        </section>
    );
}

function WeekTasks({ week, index }) {
    return (
        <section className={styles.block}>
            <BlockTitle index={index} note={`${week.items.length}개 · 모두 ${week.totalLabel}`}>이번 주 할 일</BlockTitle>
            <ol className={styles.week}>
                {week.items.map((task) => (
                    <li key={task.key}>
                        <span className={styles.box} aria-hidden="true" />
                        <span className={styles.weekNo}>{task.no}</span>
                        <div className={styles.weekBody}>
                            <p className={styles.weekTitle}>
                                <strong>{task.title}</strong>
                                {task.sourceLabel && <span className={styles.tag}>{task.sourceLabel}</span>}
                                <span className={styles.weekTime}>{task.timeLabel}</span>
                            </p>
                            <p className={styles.weekMeta}>
                                <span>{task.why}</span>
                                <span className={styles.weekWhere}>{task.where}</span>
                            </p>
                        </div>
                    </li>
                ))}
            </ol>
            {week.aiNote && <p className={styles.note}>{week.aiNote}</p>}
        </section>
    );
}

function Slots({ slots, index }) {
    return (
        <section className={styles.block}>
            <BlockTitle index={index} note={slots.changes ? `바꿀 칸 ${slots.changes}개` : '지금 그대로 둡니다'}>대표키워드 5칸 최종안</BlockTitle>
            <table className={`${styles.table} ${styles.tableFlush}`}>
                <thead>
                    <tr>
                        <th scope="col" className={styles.colNo}>칸</th>
                        <th scope="col" className={styles.colSlot}>지금</th>
                        <th scope="col" className={styles.colAct}>판단</th>
                        <th scope="col" className={styles.colSlot}>제안</th>
                        <th scope="col">이유</th>
                    </tr>
                </thead>
                <tbody>
                    {slots.rows.map((row) => (
                        <tr key={row.no} data-action={row.action}>
                            <td className={styles.num}>{row.no}</td>
                            <td>
                                {row.now ? <b>{row.now}</b> : <span className={styles.sub}>빈 칸</span>}
                                {row.nowRank && <span className={styles.rankTag}>{row.nowRank}</span>}
                            </td>
                            <td><span className={styles.act} data-action={row.action}>{row.actionLabel}</span></td>
                            <td>
                                {row.action === 'keep' || row.action === 'check' ? <span className={styles.sub}>그대로</span> : (
                                    <>
                                        <b>{row.next}</b>
                                        <span className={styles.rankTag}>{row.nextRank || '순위 미조회'}</span>
                                    </>
                                )}
                            </td>
                            <td className={styles.sub}>{row.reason}</td>
                        </tr>
                    ))}
                    {slots.empty > 0 && (
                        <tr>
                            <td className={styles.num}>-</td>
                            <td colSpan={4} className={styles.sub}>남은 빈 칸 {slots.empty}개는 넣을 만한 추천 키워드가 없어 비워 둡니다.{slots.emptyText ? ` ${slots.emptyText}` : ''}</td>
                        </tr>
                    )}
                </tbody>
            </table>
            {slots.unranked.length > 0 && slots.unrankedText && <p className={styles.note}>{slots.unrankedText}</p>}
            {/* I. 이유 칸에 쓴 약어의 풀이(이 쪽만 떼어 줘도 읽히게) */}
            {slots.legend?.length > 0 && (
                <p className={styles.legend}>
                    <span className={styles.legendHead}>읽는 법</span>
                    {slots.legend.map((text) => <span key={text}>{text}</span>)}
                </p>
            )}
        </section>
    );
}

function Metrics({ metrics, recheck, index }) {
    return (
        <section className={styles.block}>
            <BlockTitle index={index} note={`${recheck.label}(4주 뒤)에 다시 조회해 오른쪽 칸에 적으세요`}>4주 뒤 다시 볼 숫자</BlockTitle>
            <table className={`${styles.table} ${styles.tableFlush}`}>
                <thead>
                    <tr>
                        <th scope="col" className={styles.colMetric}>항목</th>
                        <th scope="col">지금</th>
                        <th scope="col">비교 기준</th>
                        <th scope="col" className={styles.colBlank}>{recheck.label}</th>
                    </tr>
                </thead>
                <tbody>
                    {metrics.map((metric) => {
                        const wide = Boolean(metric.wideNote && metric.note);
                        return (
                            <Fragment key={metric.key}>
                                <tr className={wide ? styles.hasWide : undefined}>
                                    <th scope="row">{metric.label}</th>
                                    <td>
                                        <b>{metric.now}</b>
                                        {metric.note && !wide && <span className={styles.metricNote}>{metric.note}</span>}
                                    </td>
                                    <td className={styles.sub}>{metric.compare || ''}</td>
                                    <td className={styles.blank} />
                                </tr>
                                {wide && (
                                    <tr className={styles.wideRow}>
                                        <td colSpan={4} className={styles.sub}>{metric.note}</td>
                                    </tr>
                                )}
                            </Fragment>
                        );
                    })}
                </tbody>
            </table>
        </section>
    );
}

function SummaryPage({ doc }) {
    const { summary } = doc;
    const blocks = [
        summary.diagnoses.length ? (index) => <Diagnoses key="diag" items={summary.diagnoses} index={index} /> : null,
        summary.week ? (index) => <WeekTasks key="week" week={summary.week} index={index} /> : null,
        summary.slots ? (index) => <Slots key="slots" slots={summary.slots} index={index} /> : null,
        summary.metrics ? (index) => <Metrics key="metrics" metrics={summary.metrics} recheck={doc.recheck} index={index} /> : null,
    ].filter(Boolean);
    const letters = doc.sections.map((section) => section.letter);
    return (
        <div className={styles.page1}>
            <p className={styles.pageLabel}>처방 요약 — 이 쪽만 보셔도 됩니다</p>
            {blocks.map((render, index) => render(index))}
            {letters.length > 0 && (
                <p className={styles.page1Foot}>
                    근거 숫자·하는 법·바로 쓸 초안은 다음 쪽부터({letters[0]}~{letters[letters.length - 1]})에 있습니다.
                </p>
            )}
        </div>
    );
}

/* ───────── 2쪽부터: 상세 ───────── */

function SectionTitle({ section, note }) {
    return (
        <h2 className={styles.title}>
            <span className={styles.no}>{section.letter}</span>
            {section.title}
            {note && <span className={styles.titleNote}>{note}</span>}
        </h2>
    );
}

function Rivals({ section }) {
    return (
        <section className={styles.section}>
            <SectionTitle section={section} />
            <p className={styles.lead}>{section.lead}</p>
            {section.headline.length > 0 && (
                <ul className={styles.findings}>
                    {section.headline.map((line) => <li key={line}>{line}</li>)}
                </ul>
            )}
            {section.rows.length > 0 && (
                <table className={styles.table}>
                    <thead>
                        <tr>
                            <th scope="col" className={styles.colWord}>키워드</th>
                            <th scope="col">비교 대상</th>
                            <th scope="col" className={styles.colCount}>방문자 리뷰</th>
                            <th scope="col" className={styles.colCount}>블로그 리뷰</th>
                            {section.hasScore && <th scope="col" className={styles.colScore}>평점</th>}
                        </tr>
                    </thead>
                    {section.rows.map((row) => (
                        <tbody key={row.keyword} className={styles.group}>
                            {row.lines.map((line, index) => (
                                <tr key={line.kind} data-kind={line.kind}>
                                    {index === 0 && <th scope="rowgroup" rowSpan={row.lines.length}>{row.keyword}</th>}
                                    <td className={styles.lineLabel}>{line.kind === 'mine' ? <b>{line.label}</b> : line.label}</td>
                                    <td className={styles.numCell}>{count(line.visitor)}</td>
                                    <td className={styles.numCell}>{count(line.blog)}</td>
                                    {section.hasScore && <td className={styles.numCell}>{score(line.score)}</td>}
                                </tr>
                            ))}
                        </tbody>
                    ))}
                </table>
            )}
            {section.firsts.length > 0 && <p className={styles.note}>내 매장이 1위인 키워드: {section.firsts.join(', ')}</p>}
            {section.more > 0 && <p className={styles.note}>이 밖에 키워드 {section.more}개는 이 표에 싣지 않았습니다.</p>}
            {section.pool && (
                <div className={`${styles.part} ${styles.keep}`}>
                    <h3 className={styles.partTitle}>
                        조회한 상위 {formatNumber(section.pool.count)}곳 전체와 비교
                        <span>{section.pool.keyword} 검색 결과 기준(광고 제외, 내 매장 제외)</span>
                    </h3>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th scope="col">항목</th>
                                <th scope="col" className={styles.colCount}>내 매장</th>
                                <th scope="col" className={styles.colCount}>상위 중간값</th>
                                <th scope="col" className={styles.colCount}>상위 최고</th>
                                <th scope="col" className={styles.colVerdict}>판정</th>
                            </tr>
                        </thead>
                        <tbody>
                            {section.pool.rows.map((row) => (
                                <tr key={row.key}>
                                    <th scope="row">{row.label}</th>
                                    <td className={styles.numCell}><b>{row.key === 'score' ? score(row.mine) : count(row.mine)}</b></td>
                                    <td className={styles.numCell}>{row.key === 'score' ? score(row.median) : count(row.median)}</td>
                                    <td className={styles.numCell}>{row.key === 'score' ? score(row.best) : count(row.best)}</td>
                                    <td>{row.verdictLabel || '-'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <p className={styles.note}>판정: 중간값 이상이면 &lsquo;앞섬&rsquo;, 중간값의 70% 이상이면 &lsquo;비슷&rsquo;, 그보다 낮으면 &lsquo;뒤처짐&rsquo;입니다(평점은 중간값과 0.2점 안쪽이면 &lsquo;비슷&rsquo;).</p>
                </div>
            )}
        </section>
    );
}

function DraftBody({ draft }) {
    switch (draft.kind) {
        case 'reply':
            return (
                <>
                    {draft.items.map((item, index) => (
                        <div key={item.key} className={styles.draftItem}>
                            <p className={styles.draftLabel}>{item.label}</p>
                            <p className={styles.draftText}>{item.text}</p>
                            {draft.note && index === draft.items.length - 1 && <p className={styles.draftNote}>{draft.note}</p>}
                        </div>
                    ))}
                </>
            );
        case 'feed':
            return (
                <>
                    {draft.items.map((item, index) => (
                        <div key={item.key} className={styles.draftItem}>
                            <p className={styles.draftLabel}>{item.label}</p>
                            <p className={styles.draftText}><b>제목</b> {item.title}</p>
                            <p className={styles.draftText}><b>본문</b> {item.body}</p>
                            {draft.altTitle && index === draft.items.length - 1 && <p className={styles.draftNote}>AI 질문형 제목으로 써도 됩니다: {draft.altTitle}</p>}
                        </div>
                    ))}
                </>
            );
        case 'intro':
            return (
                <>
                    <div className={styles.draftItem}>
                        <p className={styles.draftLabel}>소개글 ({draft.length}자 · {draft.sentences}문장)</p>
                        <p className={styles.draftText}>{draft.text}</p>
                        {draft.existingLength > 0 && (
                            <p className={styles.draftNote}>지금 소개글({formatNumber(draft.existingLength)}자)은 지우지 마세요. 이 글을 지금 소개글 맨 앞에 붙이세요.</p>
                        )}
                    </div>
                    {draft.oneLine && (
                        <div className={styles.draftItem}>
                            <p className={styles.draftLabel}>한 줄 소개</p>
                            <p className={styles.draftText}>{draft.oneLine}</p>
                        </div>
                    )}
                </>
            );
        case 'menu':
            return (
                <div className={styles.draftItem}>
                    <table className={`${styles.table} ${styles.tableTight} ${styles.tableFlush}`}>
                        <thead>
                            <tr>
                                <th scope="col" className={styles.colMenu}>이름</th>
                                <th scope="col" className={styles.colPrice}>가격</th>
                                <th scope="col" className={styles.colWhy}>고른 까닭</th>
                                <th scope="col">설명 틀(이름·가격에서 읽히는 것만 채움)</th>
                            </tr>
                        </thead>
                        <tbody>
                            {draft.rows.map((row) => (
                                <tr key={row.name}>
                                    <th scope="row">{row.name}</th>
                                    <td className={styles.numCell}>{row.price || '-'}</td>
                                    <td className={styles.sub}>{row.why || '-'}</td>
                                    <td>{row.frame}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <p className={styles.draftNote}>어느 것에 이미 설명이 있는지는 조회한 자료로 알 수 없어, 설명이 비어 있는 것만 채우세요.</p>
                </div>
            );
        case 'list':
            return (
                <div className={styles.draftItem}>
                    <p className={styles.draftLabel}>{draft.label}</p>
                    {draft.items.some((entry) => entry.length > 20)
                        ? <ul className={styles.draftList}>{draft.items.map((entry) => <li key={entry}>{entry}</li>)}</ul>
                        : <p className={styles.draftText}>{draft.items.join(' · ')}</p>}
                </div>
            );
        default:
            return null;
    }
}

function Tasks({ section }) {
    return (
        <section className={styles.section}>
            <SectionTitle section={section} />
            <p className={styles.lead}>{section.lead}</p>
            {section.guide?.length > 0 && (
                <div className={styles.guide}>
                    <p className={styles.guideHead}>스마트플레이스에서 하는 일 — 모든 &lsquo;하는 법&rsquo;에 앞서</p>
                    {section.guide.map((line) => (
                        <p key={line.label}><b>{line.label}</b> {line.text}</p>
                    ))}
                </div>
            )}
            {section.items.map((task, index) => (
                <article key={task.key} className={styles.task}>
                    {/* 머리·왜·하는 법은 한 덩어리로 두어 쪽 넘김이 한가운데를 가르지 않게 합니다. */}
                    <div className={styles.taskTop} data-draft={task.draft ? 'true' : undefined}>
                        <header className={styles.taskHead}>
                            <span className={styles.box} aria-hidden="true" />
                            <span className={styles.actionNo}>{index + 1}</span>
                            <span className={styles.level} data-level={task.level}>{task.levelLabel}</span>
                            <strong className={styles.taskTitle}>{task.title}</strong>
                            {task.sourceLabel && <span className={styles.tag}>{task.sourceLabel}</span>}
                            <span className={styles.taskMeta}>{task.timeLabel} · {task.where}</span>
                        </header>
                        <dl className={styles.advice}>
                            {(task.problem || task.why.length > 0) && (
                                <div className={styles.adviceRow}>
                                    <dt>왜</dt>
                                    <dd>
                                        {task.problem && task.why.length === 0 && <p>{task.problem}</p>}
                                        {task.why.map((line) => <p key={line}>{line}</p>)}
                                        {task.gain && <p className={styles.sub}>{task.gain}</p>}
                                    </dd>
                                </div>
                            )}
                            {task.steps.length > 0 && (
                                <div className={styles.adviceRow}>
                                    <dt>하는 법</dt>
                                    <dd>
                                        {task.preface && <p className={styles.preface}>{task.preface}</p>}
                                        <ol className={styles.steps}>
                                            {task.steps.map((step, i) => <li key={step}><span>{i + 1}</span>{step}</li>)}
                                        </ol>
                                        {task.wait && (
                                            <p className={styles.waitLine}>
                                                <b>기다리는 시간</b> {task.wait}<span className={styles.sub}> — 내가 하는 시간({task.timeLabel})과 별개로 네이버가 처리하는 시간입니다.</span>
                                            </p>
                                        )}
                                    </dd>
                                </div>
                            )}
                        </dl>
                    </div>
                    {task.draft && (
                        <div className={styles.draft}>
                            <p className={styles.draftMark}>{DRAFT_MARK}</p>
                            <DraftBody draft={task.draft} />
                        </div>
                    )}
                </article>
            ))}
            {section.rest.length > 0 && (
                <div className={listPartClass(section.rest.length)}>
                    <h3 className={styles.partTitle}>그 밖의 할 일</h3>
                    <ul className={styles.restList}>
                        {section.rest.map((task) => (
                            <li key={task.key}>
                                <span className={styles.box} aria-hidden="true" />
                                <div>
                                    <p><strong>{task.title}</strong> <span className={styles.sub}>{task.timeLabel} · {task.where}{task.wait ? ` · 기다리는 시간 ${task.wait}` : ''}</span></p>
                                    {task.preface && <p className={styles.preface}>{task.preface}</p>}
                                    {task.steps?.length > 0
                                        ? <ol className={`${styles.steps} ${styles.stepsSmall}`}>{task.steps.map((step, i) => <li key={step}><span>{i + 1}</span>{step}</li>)}</ol>
                                        : task.how && <p className={styles.sub}>{task.how}</p>}
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </section>
    );
}

function Keywords({ section }) {
    return (
        <section className={styles.section}>
            <SectionTitle section={section} />
            {section.rows.length > 0 && (
                <div className={partClass(section.rows.length)}>
                    <h3 className={styles.partTitle}>바꾸는 칸과 근거</h3>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th scope="col" className={styles.colNo}>칸</th>
                                <th scope="col" className={styles.colSwap}>지금 → 제안</th>
                                <th scope="col">왜 바꾸나</th>
                                <th scope="col">새 키워드의 근거</th>
                            </tr>
                        </thead>
                        <tbody>
                            {section.rows.map((row) => (
                                <tr key={row.no}>
                                    <td className={styles.num}>{row.no}</td>
                                    <td>
                                        {row.now ? <span>{row.now}{row.nowRank ? ` (${row.nowRank})` : ''}</span> : <span className={styles.sub}>빈 칸</span>}
                                        <br />→ <b>{row.next}</b>{row.nextRank ? ` (내 ${row.nextRank})` : ''}
                                    </td>
                                    <td>{row.why || row.problem}</td>
                                    <td className={styles.sub}>{row.basis}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {section.legend.length > 0 && (
                        <p className={styles.legend}>
                            <span className={styles.legendHead}>읽는 법</span>
                            {section.legend.map((entry) => (
                                <span key={entry.term}><b>{entry.term}</b> = {entry.meaning}</span>
                            ))}
                        </p>
                    )}
                </div>
            )}
            {section.next && (
                <div className={partClass(section.next.rows.length)}>
                    <h3 className={styles.partTitle}>
                        5칸에 들지 못한 다음 후보
                        <span>{section.next.why} 교체할 칸이 더 생기면 위에서부터 넣으세요(근거는 위 표와 같은 표기)</span>
                    </h3>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th scope="col" className={styles.colWord}>키워드</th>
                                <th scope="col">근거</th>
                            </tr>
                        </thead>
                        <tbody>
                            {section.next.rows.map((row) => (
                                <tr key={row.keyword}>
                                    <th scope="row">{row.keyword}</th>
                                    <td>{row.basis}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            {section.placements.length > 0 && (
                <div className={partClass(section.placements.length)}>
                    <h3 className={styles.partTitle}>
                        새 키워드를 넣을 자리와 예문
                        <span>{section.hint}</span>
                    </h3>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th scope="col" className={styles.colWord}>키워드</th>
                                <th scope="col" className={styles.colWhere}>넣을 자리</th>
                                <th scope="col">예문(초안)</th>
                            </tr>
                        </thead>
                        <tbody>
                            {section.placements.map((row) => (
                                <tr key={row.keyword}>
                                    <th scope="row">{row.keyword}</th>
                                    <td>{row.where}</td>
                                    <td>
                                        {row.sentence || <span className={styles.sub}>(직접 적기)</span>}
                                        {row.basis.length > 0 && <span className={styles.metricNote}>근거: {row.basis.join(' · ')}</span>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            {section.rivalKeywords && (
                <div className={partClass(section.rivalKeywords.rows.length)}>
                    <h3 className={styles.partTitle}>
                        상위 매장이 등록한 대표키워드
                        <span>검색 상위 매장이 어떤 말로 등록했는지 참고하세요{section.rivalKeywords.total > section.rivalKeywords.rows.length ? ` · ${section.rivalKeywords.total}곳 중 ${section.rivalKeywords.rows.length}곳` : ''}</span>
                    </h3>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th scope="col" className={styles.colWord}>매장(검색 순위)</th>
                                <th scope="col">등록한 대표키워드</th>
                            </tr>
                        </thead>
                        {rowChunks(section.rivalKeywords.rows).map((chunk, index, all) => (
                            <tbody key={chunk[0].name} className={chunkClass(index, all.length)}>
                                {chunk.map((row) => (
                                    <tr key={row.name}>
                                        <th scope="row">
                                            {row.name}
                                            {row.best && <span className={styles.metricNote}>{row.best.keyword} {row.best.rank}위</span>}
                                        </th>
                                        <td>
                                            {row.words.map((entry, wordIndex) => (
                                                <span key={entry.word}>
                                                    {wordIndex > 0 && ' · '}
                                                    {entry.mine || entry.next ? <b>{entry.word}</b> : entry.word}
                                                    {entry.mine && <small className={styles.wordMark}>내 매장도 씀</small>}
                                                    {entry.next && !entry.mine && <small className={styles.wordMark}>5칸 최종안에 든 말</small>}
                                                </span>
                                            ))}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        ))}
                    </table>
                    {section.rivalKeywords.common.length > 0 && (
                        <p className={styles.note}>
                            두 곳 이상이 함께 쓰는 키워드: {section.rivalKeywords.common.map((entry) => `${entry.word} ${entry.count}곳${entry.mine ? '(내 매장도 씀)' : entry.next ? '(5칸 최종안에 든 말)' : ''}`).join(' · ')}
                        </p>
                    )}
                </div>
            )}
            {section.notes.map((note) => <p key={note} className={styles.note}>{note}</p>)}
            {section.excluded && (
                <div className={partClass(section.excluded.rows.length)}>
                    <h3 className={styles.partTitle}>
                        추천에서 뺀 키워드와 이유
                        {section.excluded.more > 0 && <span>이 밖에 {section.excluded.more}개</span>}
                    </h3>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th scope="col" className={styles.colKind}>구분</th>
                                <th scope="col" className={styles.colExcluded}>낱말·조합</th>
                                <th scope="col">이유</th>
                            </tr>
                        </thead>
                        {rowChunks(section.excluded.rows).map((chunk, index, all) => (
                            <tbody key={`${chunk[0].label}-${chunk[0].words}`} className={chunkClass(index, all.length)}>
                                {chunk.map((row) => (
                                    <tr key={`${row.label}-${row.words}`}>
                                        <td className={styles.sub}>{row.label}</td>
                                        <th scope="row">{row.words}</th>
                                        <td>{row.reason}</td>
                                    </tr>
                                ))}
                            </tbody>
                        ))}
                    </table>
                </div>
            )}
        </section>
    );
}

function Ai({ section }) {
    return (
        <section className={styles.section}>
            <SectionTitle section={section} />
            {section.lead && <p className={styles.lead}>{section.lead}</p>}
            <p className={styles.scores}>
                {section.scores.map((entry) => (
                    <span key={entry.key}>
                        {entry.label} <b>{entry.score}점</b>{entry.grade ? ` (${entry.grade})` : ''}
                    </span>
                ))}
            </p>
            {section.questions.length > 0 && (
                <div className={partClass(section.questions.length)}>
                    <h3 className={styles.partTitle}>손님이 AI에게 묻는 질문 가운데 지금 답이 없거나 모자란 것</h3>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th scope="col">질문</th>
                                <th scope="col" className={styles.colState}>지금</th>
                                <th scope="col">채울 자리</th>
                            </tr>
                        </thead>
                        {rowChunks(section.questions).map((chunk, index, all) => (
                            <tbody key={chunk[0].key} className={chunkClass(index, all.length)}>
                                {chunk.map((row) => (
                                    <tr key={row.key}>
                                        <th scope="row">{row.question}</th>
                                        <td>
                                            <span className={styles.tag}>{row.status}</span>
                                            {row.now && <span className={styles.metricNote}>{row.now}</span>}
                                        </td>
                                        <td>{row.fix}</td>
                                    </tr>
                                ))}
                            </tbody>
                        ))}
                    </table>
                </div>
            )}
            {section.more.length > 0 && (
                <div className={listPartClass(section.more.length)}>
                    <h3 className={styles.partTitle}>AI 검색 점검 점수가 오르는 일(처방 상세에 없는 것)</h3>
                    <ul className={styles.restList}>
                        {section.more.map((item) => (
                            <li key={item.id}>
                                <span className={styles.box} aria-hidden="true" />
                                <div>
                                    <p><strong>{item.title}</strong>{item.timeLabel && <span className={styles.sub}> · {item.timeLabel}</span>}</p>
                                    {item.now && item.target && <p className={styles.sub}>지금 {item.now} → 목표 {item.target}</p>}
                                    {item.how && <p className={styles.sub}>{item.how}</p>}
                                    {item.caution && <p className={styles.caution}>{item.caution}</p>}
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {section.quick.length > 0 && (
                <div className={listPartClass(section.quick.length)}>
                    <h3 className={styles.partTitle}>하루 안에 해 볼 수 있는 일(네이버)</h3>
                    <ul className={styles.plainList}>
                        {section.quick.map((item) => (
                            <li key={item.id}>
                                {item.title}{item.timeLabel ? ` — ${item.timeLabel}` : ''}
                                {item.how && <span className={styles.metricNote}>{item.how}</span>}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </section>
    );
}

function Plan({ section }) {
    return (
        <section className={styles.section}>
            <SectionTitle section={section} />
            <p className={styles.lead}>{section.lead}</p>
            <div className={styles.planBlock}>
            <table className={`${styles.table} ${styles.planTable}`}>
                <tbody>
                    {section.weeks.map((week) => (
                        <tr key={week.no}>
                            <th scope="row" className={styles.colWeek}>{week.no}주차</th>
                            <td>
                                <ul className={styles.checks}>
                                    {week.items.map((item) => (
                                        <li key={item.title}>
                                            <span className={styles.box} aria-hidden="true" />
                                            <span>{item.recheck ? <b>{item.title}</b> : item.title}{item.timeLabel ? <span className={styles.sub}> · {item.timeLabel}</span> : null}</span>
                                        </li>
                                    ))}
                                </ul>
                            </td>
                        </tr>
                    ))}
                    {section.overflow.length > 0 && (
                        <tr>
                            <th scope="row" className={styles.colWeek}>이 밖에 {section.overflow.length}개</th>
                            <td>
                                <ul className={styles.checks}>
                                    {section.overflow.map((item) => (
                                        <li key={item.title}>
                                            <span className={styles.box} aria-hidden="true" />
                                            <span>{item.title}{item.timeLabel ? <span className={styles.sub}> · {item.timeLabel}</span> : null}</span>
                                        </li>
                                    ))}
                                </ul>
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
            </div>
            {/* 실행표와 다시 조회 상자는 각각 통째로 두고, 둘 사이에서는 쪽이 넘어가도 됩니다. */}
            <div className={styles.recheck}>
                <p><b>다시 조회해 비교</b> <span className={styles.sub}>{section.recheck.label} 무렵, 1쪽 &lsquo;4주 뒤 다시 볼 숫자&rsquo; 표의 오른쪽 칸에 적습니다. {section.recheck.note}</span></p>
                {section.recheck.keywords.length > 0 && (
                    <table className={`${styles.table} ${styles.tableTight} ${styles.recheckTable}`}>
                        <thead>
                            <tr>
                                <th scope="col">1쪽 &lsquo;대표키워드 5칸 최종안&rsquo;의 키워드(이 키워드로 다시 조회)</th>
                                <th scope="col" className={styles.colRank}>지금 순위</th>
                                <th scope="col" className={styles.colRank}>{section.recheck.label}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {section.recheck.keywords.map((row) => (
                                <tr key={row.keyword}>
                                    <th scope="row">{row.keyword}</th>
                                    <td>{row.now || <><span className={styles.fillIn} />위</>}</td>
                                    <td><span className={styles.fillIn} />위</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
                <p className={styles.writeLine}>다시 조회한 날 <span /> 달라진 점 <span className={styles.wide} /></p>
                <p className={styles.writeLine}>다음 4주에 할 일 <span className={styles.wider} /></p>
            </div>
            {/* 매주 반복할 일: 실행표·다시 조회 상자 바로 아래의 작은 표(한 쪽에 다 못 들어가면 다음 쪽으로 통째로) */}
            {section.repeat.length > 0 && (
                <div className={`${styles.part} ${styles.keep} ${styles.repeatPart}`}>
                    <h3 className={styles.partTitle}>매주 반복할 일<span>한 주를 끝낼 때마다 칸에 표시하세요</span></h3>
                    <table className={`${styles.table} ${styles.tableTight}`}>
                        <thead>
                            <tr>
                                <th scope="col">반복할 일</th>
                                {[1, 2, 3, 4].map((no) => <th key={no} scope="col" className={styles.colTick}>{no}주</th>)}
                            </tr>
                        </thead>
                        <tbody>
                            {section.repeat.map((item) => (
                                <tr key={item.title}>
                                    <td>{item.title}<span className={styles.sub}> · {item.timeLabel}</span></td>
                                    {[1, 2, 3, 4].map((no) => <td key={no} className={styles.colTick}><span className={styles.box} aria-hidden="true" /></td>)}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
}

const SECTION_VIEW = { rivals: Rivals, tasks: Tasks, keywords: Keywords, ai: Ai, plan: Plan };

// 분석 결과가 있을 때 화면 어디에든 한 번 넣어 둡니다. 평소에는 아무것도 그리지 않고,
// 버튼(PRESCRIPTION_REQUEST 신호)이나 브라우저 인쇄(beforeprint) 때만 문서를 그립니다. 인쇄가 끝나면(afterprint) 치웁니다.
//   fetchedAt: 매장을 조회한 시각(ms)
export default function Prescription(props) {
    // 0 이면 그리지 않음. 요청마다 1씩 늘려 오류 경계를 새로 시작합니다(한 번 실패해도 다음 요청에서 다시 해 봄).
    const [request, setRequest] = useState(0);
    const hasPlace = Boolean(props.place);

    useEffect(() => {
        if (!hasPlace) return undefined;
        const draw = () => flushSync(() => setRequest((n) => n + 1));
        const before = () => {
            // 버튼으로 이미 그렸으면 다시 그리지 않습니다(브라우저 메뉴 인쇄일 때만 여기서 그림).
            if (!document.querySelector('[data-prescription]')) draw();
            const doc = document.querySelector('[data-prescription]');
            if (doc) swapTitle(doc.dataset.store);
        };
        const after = () => {
            restoreTitle();
            setRequest(0);
        };
        window.addEventListener(PRESCRIPTION_REQUEST, draw);
        window.addEventListener('beforeprint', before);
        window.addEventListener('afterprint', after);
        return () => {
            window.removeEventListener(PRESCRIPTION_REQUEST, draw);
            window.removeEventListener('beforeprint', before);
            window.removeEventListener('afterprint', after);
            restoreTitle();
        };
    }, [hasPlace]);

    if (!hasPlace || request === 0) return null;
    return (
        <PrescriptionBoundary key={request}>
            <PrescriptionDocument {...props} />
        </PrescriptionBoundary>
    );
}

// AI 검색 진단은 화면의 GEO·AEO 패널과 같은 계산입니다(같은 값이 나옵니다). 진단이 실패하면 AI 검색 구역만 빼고 만듭니다.
function safeGeo(place, activity, ranks, nowMs) {
    try {
        return analyzeGeoAeo({ place, activity, ranks, ...(Number.isFinite(nowMs) ? { nowMs } : {}) });
    } catch (error) {
        console.warn('[처방전] AI 검색 진단을 건너뜁니다:', error?.message || error);
        return null;
    }
}

// rivals: 상위 매장이 등록한 대표키워드 모음 [{ placeId, name, keywords }] — 화면의 rivalPool. 없으면 그 표만 뺍니다.
// nowMs: 문서를 만드는 시각(ms). 정하지 않으면 지금. 견본·시험에서 AI 검색 진단과 문서가 같은 시각으로 계산되게 한 번만 넘깁니다.
function PrescriptionDocument({ place, activity, ranks, recommendation, actions, rivals, fetchedAt, nowMs }) {
    const geo = useMemo(() => safeGeo(place, activity, ranks, nowMs), [place, activity, ranks, nowMs]);
    const doc = useMemo(
        () => buildPrescription({ place, activity, ranks, recommendation, actions, geo, rivals, fetchedAt, ...(Number.isFinite(nowMs) ? { nowMs } : {}) }),
        [place, activity, ranks, recommendation, actions, geo, rivals, fetchedAt, nowMs],
    );
    const storeName = doc?.store.name || '';

    // 문서가 있는 동안만 <html> 에 표시를 붙여 인쇄 규칙(문서만 보이기)이 듣게 합니다.
    // 그린 직후(인쇄 창이 열리기 전)에 붙어야 해서 useLayoutEffect 를 씁니다.
    const ready = Boolean(doc);
    useLayoutEffect(() => {
        if (!ready) return undefined;
        const root = document.documentElement;
        root.classList.add(styles.printRoot);
        return () => root.classList.remove(styles.printRoot);
    }, [ready]);

    if (!doc) return null;
    return createPortal(
        <article className={styles.doc} data-prescription="" data-store={storeName} lang="ko">
            <header className={styles.head}>
                <div className={styles.headTop}>
                    <h1>{doc.title}</h1>
                    <span className={styles.brand}>{doc.brand}</span>
                </div>
                {doc.store.name && <p className={styles.storeName}>{doc.store.name}</p>}
                <p className={styles.storeMeta}>
                    {[doc.store.category, doc.store.address, doc.lookedUp].filter(Boolean).map((text) => <span key={text}>{text}</span>)}
                </p>
            </header>
            <SummaryPage doc={doc} />
            {doc.sections.map((section) => {
                const View = SECTION_VIEW[section.id];
                return View ? <Fragment key={section.id}><View section={section} /></Fragment> : null;
            })}
            <footer className={styles.foot}>
                <ul>
                    {doc.notes.map((note) => <li key={note}>{note}</li>)}
                </ul>
            </footer>
        </article>,
        document.body,
    );
}
