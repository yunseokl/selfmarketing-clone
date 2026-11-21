'use client';

// 플레이스 처방전 — 분석 결과를 A4 세로 문서로 뽑습니다.
// 새 패키지 없이 브라우저 인쇄를 씁니다: 버튼을 누르면 인쇄 화면이 열리고, 거기서 PDF로 저장하면 됩니다(휴대폰은 공유·저장 메뉴).
//  - 문서는 평소에는 그리지 않습니다(분석 화면이 무거워지지 않게). 버튼을 누르거나 브라우저 메뉴로 인쇄(Ctrl+P, beforeprint)할 때
//    그 자리에서 바로(flushSync) body 아래 포털에 그리고, 인쇄할 때만 보이게 합니다(Prescription.module.css). 인쇄가 끝나면 다시 치웁니다.
//    분석 전에는 평소처럼 화면을 인쇄합니다.
//  - 처방전 안에서 오류가 나도 오류 경계(PrescriptionBoundary)가 처방전만 빼고 분석 화면은 그대로 둡니다.
//    그때 버튼 옆에 "처방전을 만들지 못했습니다…" 한 줄을 띄우고 인쇄 창은 열지 않습니다.
//  - 저장되는 파일 이름이 "혼잘마 처방전 - 매장이름 - 날짜"가 되도록 인쇄하는 동안만 문서 제목(document.title)을 바꿉니다.
//  - 1쪽은 처방 요약(핵심 진단·이번 주 할 일·대표키워드 5칸·4주 뒤 다시 볼 숫자)이고, 2쪽부터 상세입니다.
//  - 문서에 들어갈 자료는 lib/place-prescription.js 의 순수 함수가 만듭니다. 3D 그래프는 싣지 않습니다.
//  - 확인 스크립트는 window.dispatchEvent(new Event(PRESCRIPTION_REQUEST)) 로 인쇄 창 없이 문서만 그릴 수 있습니다.

import { Component, Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { FileDown } from 'lucide-react';
import { toast } from 'sonner';
import { analyzeGeoAeo } from '@/lib/place-geo';
import { buildPrescription, prescriptionFileName, slotsNote, DRAFT_MARK, PAGE1_BUDGET_MM, PAGE1_LIMIT_MM, PAGE1_TIGHTEN_MM } from '@/lib/place-prescription';
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

// 인쇄 창을 여는 동안은 같은 버튼을 또 눌러도 한 번만 열게 합니다.
//  - 문서를 그리고 쪽 나눔을 재는 데 0.7~1.7초가 걸리고 그동안 화면이 멈춥니다. 그 사이에 다시 누른 클릭은 줄을 서 있다가 인쇄 창이 닫힌 뒤에 처리되어
//    인쇄 창이 한 번 더 열리거나 문서가 두 번 그려질 수 있습니다. 클릭한 시각(event.timeStamp)이 지난 인쇄가 끝난 시각보다 앞서면 줄 서 있던 클릭이라 무시합니다.
//  - window.print() 는 한 번의 클릭에 한 번만 부릅니다(문서를 만들지 못했거나 이미 인쇄 중이면 부르지 않음).
let printing = false;
let lastPrintEndedAt = 0;

// 처방전을 인쇄 창으로 보냅니다. clickedAt: 누른 시각(event.timeStamp, 선택).
// 돌려주는 값: 'ok' · 'failed'(문서를 만들지 못함) · 'unsupported'(인쇄 창 없음) · 'busy'(이미 인쇄 중이거나 줄 서 있던 클릭이라 무시함)
export function printPrescription(clickedAt) {
    if (printing || (Number.isFinite(clickedAt) && clickedAt <= lastPrintEndedAt)) return 'busy';
    if (typeof window.print !== 'function') {
        toast.error('이 브라우저에서는 인쇄 창을 열 수 없습니다. 크롬이나 사파리에서 열어 주세요.');
        return 'unsupported';
    }
    printing = true;
    try {
        const doc = requestDocument();
        if (!doc) return 'failed';
        swapTitle(doc.dataset.store);
        window.print();
        return 'ok';
    } finally {
        printing = false;
        lastPrintEndedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    }
}

// 저장 버튼 + 한 줄 안내. className 을 주면 그 화면의 버튼 모양을 그대로 씁니다.
//   block: 구역 머리 아래처럼 한 줄을 통째로 차지하게 놓을 때 / hint: 안내 문구를 함께 보일지
export function PrescriptionButton({ className, block = false, hint = true }) {
    const [failed, setFailed] = useState(false);
    const onClick = (event) => {
        const result = printPrescription(event?.timeStamp);
        if (result !== 'busy') setFailed(result === 'failed');
    };
    return (
        <span className={styles.save} data-block={block ? 'true' : undefined}>
            <button type="button" className={className || styles.saveBtn} onClick={onClick}>
                <FileDown size={16} aria-hidden="true" />
                처방전 PDF로 저장
            </button>
            {failed
                ? <span className={styles.saveError} role="status">{FAILED_TEXT}</span>
                : hint && <span className={styles.saveHint}>인쇄 화면에서 PDF로 저장하세요(휴대폰은 공유·저장 메뉴)</span>}
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

// 쪽 넘김 규칙: 10줄 이하 표는 통째로 한 쪽에, 11줄 이상 표는 쪼개져도 되지만 양쪽에 2줄 이상 남게
// (앞 2줄·뒤 2줄을 각각 한 묶음으로 둠). 쪽이 넘어간 표는 머리 줄(칸 이름)이 다시 나오고, 표 제목은 표와 떨어지지 않습니다.
export const TABLE_WHOLE_MAX = 10;
// '추천에서 뺀 키워드' 표는 이유 문장이 길어 10줄이어도 한 쪽의 3분의 1이 넘습니다. 평소에는 다른 표처럼 통째로 두고,
// 그러면 앞 쪽 아래가 너무 비는 문서만(쪽 아래 빈 공간 25% 이내가 우선) 앞 2줄·뒤 2줄을 지키며 쪽을 넘겨 이어지게 합니다(문서의 data-split).
export const EXCLUDED_CHUNK_MIN = 5;

// edge: 앞·뒤에 한 묶음으로 남기는 줄 수(기본 2, 나눌 수 있는 표는 3)
function rowChunks(rows, whole = TABLE_WHOLE_MAX, edge = 2) {
    if (rows.length <= whole) return [rows];
    return [rows.slice(0, edge), rows.slice(edge, rows.length - edge), rows.slice(-edge)].filter((chunk) => chunk.length > 0);
}

function chunkClass(index, total) {
    return total === 1 || index === 0 || index === total - 1 ? styles.rowKeep : undefined;
}

// 쪽을 넘겨 이어질 수 있는 표(나눔 방식 true)는 앞 3줄·뒤 3줄이 한 묶음(rowChunks)이라 6줄 이상일 때만 나눕니다. 5줄 이하 표는 어느 방식에서도
// 통째로 움직여 "3줄/2줄"·"2줄/1줄"처럼 한두 줄만 따로 떨어지지 않습니다(쪽 아래가 비면 다른 간격 배율을 고릅니다).
const SPLIT_EDGE = 3;
const SPLIT_MIN_ROWS = SPLIT_EDGE * 2;
// 메뉴·시술 설명 초안 표(보통 5줄)는 앞 2줄·뒤 2줄을 지키는 대신 5줄부터 나눌 수 있게 합니다(조회 전 문서의 쪽 아래 빈 공간을 줄이려는 것, 나눔 방식 true 일 때만).
const MENU_SPLIT_MIN_ROWS = 5;

// 3줄 이하 표가 든 묶음은 통째로(제목·표·풀이가 한 쪽에), 더 긴 표는 위 묶음으로 나눠 끊습니다.
function partClass(rowCount, extra, whole = TABLE_WHOLE_MAX) {
    return [styles.part, rowCount <= whole ? styles.keep : null, extra].filter(Boolean).join(' ');
}

// 항목 목록(그 밖의 할 일·AI 점검 일): 항목이 하나면 통째로, 둘 이상이면 항목 사이에서 끊습니다(항목 하나는 쪼개지 않음).
// 항목마다 순서(하는 법)까지 있어 길어질 수 있으므로, 통째로 두면 앞 쪽 아래가 비는 것보다 항목 사이에서 끊는 쪽을 택합니다.
function listPartClass(itemCount) {
    return [styles.part, itemCount <= 1 ? styles.keep : null].filter(Boolean).join(' ');
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
        </section>
    );
}

function Slots({ slots, index }) {
    // 표 아래 한 줄: 아직 조회하지 않은 순위 안내(바꿀 칸이 있으면 그 키워드 이름과 함께) · 순위를 아직 하나도 조회하지 않았을 때의 다음 행동 · 근거 약한 채움 안내
    const slotNote = [slots.unranked.length > 0 ? slots.unrankedText : '', slots.rankText, slots.weakText].filter(Boolean).join(' ');
    return (
        <section className={styles.block}>
            <BlockTitle index={index} note={slotsNote(slots)}>대표키워드 5칸 최종안</BlockTitle>
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
            {slotNote && <p className={styles.note}>{slotNote}</p>}
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
                                        <b className={metric.key === 'ai' ? styles.nowrap : undefined}>{metric.now}</b>
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

// 1쪽에 처음 나오는 용어(GEO·AEO·'AI 검색 점검' 표시·분류 이름)의 한 줄 풀이. 이 쪽만 떼어 줘도 뜻이 통하게 합니다.
function Terms({ terms }) {
    return (
        <p className={styles.terms}>
            <span className={styles.legendHead}>용어</span>
            {terms.map((text) => <span key={text}>{text}</span>)}
        </p>
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
        <div className={styles.page1} data-page1="">
            <p className={styles.pageLabel}>처방 요약 — 이 쪽만 보셔도 됩니다</p>
            {blocks.map((render, index) => render(index))}
            {summary.terms?.length > 0 && <Terms terms={summary.terms} />}
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
            {section.firsts.length > 0 && <p className={styles.note}>내 {section.noun}이 1위인 키워드: {section.firsts.join(', ')}</p>}
            {section.more > 0 && <p className={styles.note}>이 밖에 키워드 {section.more}개는 이 표에 싣지 않았습니다.</p>}
            {section.pool && (
                <div className={`${styles.part} ${styles.keep}`}>
                    <h3 className={styles.partTitle}>
                        조회한 상위 {formatNumber(section.pool.count)}곳 전체와 비교
                        <span>{section.pool.keyword} 검색 결과 기준(광고 제외, 내 {section.noun} 제외)</span>
                    </h3>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th scope="col">항목</th>
                                <th scope="col" className={styles.colCount}>내 {section.noun}</th>
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
                <div className={draft.rows.length >= MENU_SPLIT_MIN_ROWS ? `${styles.draftItem} ${styles.splitPart}` : styles.draftItem}>
                    <table className={`${styles.table} ${styles.tableTight} ${styles.tableFlush}`}>
                        <thead>
                            <tr>
                                <th scope="col" className={styles.colMenu}>이름</th>
                                <th scope="col" className={styles.colPrice}>가격</th>
                                <th scope="col" className={styles.colWhy}>{draft.reasonHead || '이 메뉴를 고른 까닭'}</th>
                                <th scope="col">설명 초안(이름에서 읽히는 것만 채움, (직접 적기)는 사장님만 아는 것)</th>
                            </tr>
                        </thead>
                        {/* 5줄 이상 표는 나눔 방식 true 에서 쪽을 넘겨 이어질 수 있습니다. 앞 2줄은 한 묶음(첫 줄만 앞 쪽 아래에 남지 않음), 나머지는 쪽이 끝나는 곳에서 자연스럽게 넘어가고,
                            표 뒤의 보기·안내 글은 마지막 줄과 같은 쪽에 둡니다(CSS). 뒤 줄을 묶음으로 막으면 크롬이 표를 쪽 끝까지 늘려 상자 안이 비어 보입니다. */}
                        {(draft.rows.length >= MENU_SPLIT_MIN_ROWS ? [draft.rows.slice(0, 2), draft.rows.slice(2)] : [draft.rows]).map((chunk, index) => (
                            <tbody key={chunk[0].name} className={index === 0 ? styles.rowKeep : undefined}>
                                {chunk.map((row) => (
                                    <tr key={row.name}>
                                        <th scope="row">{row.name}</th>
                                        <td className={styles.numCell}>{row.price || '-'}</td>
                                        <td className={styles.sub}>{row.why || '-'}</td>
                                        <td>{row.frame}</td>
                                    </tr>
                                ))}
                            </tbody>
                        ))}
                    </table>
                    {draft.model && <p className={styles.draftNote}><b>{draft.model.head}</b> — {draft.model.text}</p>}
                    {draft.note && <p className={styles.draftNote}>{draft.note}</p>}
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
                                        {task.why.map((line, i) => (
                                            <p key={line}>
                                                {line}
                                                {/* 'AI 검색 점검: 지금 … → 목표 …' 줄이 있으면 점수 증가를 같은 줄에 이어 적어 줄을 아낍니다. */}
                                                {task.gain && i === task.why.length - 1 && /^AI 검색 점검:/.test(line) && <span className={styles.sub}> · {task.gain.replace(/^AI 검색 점검 /, '')}</span>}
                                            </p>
                                        ))}
                                        {task.gain && !(task.why.length > 0 && /^AI 검색 점검:/.test(task.why[task.why.length - 1])) && <p className={styles.sub}>{task.gain}</p>}
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
                            <p className={styles.draftMark}>{section.draftMark || DRAFT_MARK}</p>
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
                <div className={partClass(section.rows.length, section.rows.length >= SPLIT_MIN_ROWS ? styles.splitPart : undefined)}>
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
                                    <td className={styles.sub}>
                                        {row.basis}
                                        {Number.isFinite(row.points) && <span className={styles.score}> · 근거 점수 {row.points}{row.weak ? '(근거 약함)' : ''}</span>}
                                        {row.confirmed && <span className={styles.metricNote}>확인한 곳: {row.confirmed}</span>}
                                    </td>
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
            {section.scoreNote && <p className={styles.note}>{section.scoreNote}</p>}
            {section.next && (
                <div className={partClass(section.next.rows.length)}>
                    <h3 className={styles.partTitle}>
                        5칸에 들지 못한 다음 후보
                        <span>교체할 칸이 더 생기면 위에서부터 넣으세요(근거는 위 표와 같은 표기)</span>
                    </h3>
                    <p className={styles.note}>{section.next.why}</p>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th scope="col" className={styles.colWord}>키워드</th>
                                <th scope="col">근거</th>
                                {section.next.rows.some((row) => row.note) && <th scope="col" className={styles.colNextWhy}>이 줄만 다른 점</th>}
                            </tr>
                        </thead>
                        <tbody>
                            {section.next.rows.map((row) => (
                                <tr key={row.keyword}>
                                    <th scope="row">{row.keyword}</th>
                                    <td>
                                        {row.basis}
                                        {Number.isFinite(row.points) && <span className={styles.score}> · 근거 점수 {row.points}{row.weak ? '(근거 약함)' : ''}</span>}
                                        {row.confirmed && <span className={styles.metricNote}>확인한 곳: {row.confirmed}</span>}
                                    </td>
                                    {section.next.rows.some((entry) => entry.note) && <td className={styles.sub}>{row.note || '-'}</td>}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            {section.judge && (
                <div className={partClass(section.judgeGroups.length)}>
                    <h3 className={styles.partTitle}>
                        직접 판단할 말
                        <span>{section.judgeNote}</span>
                    </h3>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th scope="col">키워드와 근거</th>
                                <th scope="col" className={styles.colJudgeWhy}>넣지 않은 까닭</th>
                            </tr>
                        </thead>
                        <tbody>
                            {section.judgeGroups.map((group) => (
                                <tr key={group.why}>
                                    <td>
                                        {group.items.map((row) => (
                                            <p key={row.keyword} className={styles.judgeLine}>
                                                <b>{row.keyword}</b>
                                                {row.tag && <> <span className={styles.tag}>{row.tag}</span></>}
                                                <span className={styles.sub}>{row.basis ? ` — ${row.basis}` : ''}{Number.isFinite(row.points) ? ` · 근거 점수 ${row.points}` : ''}</span>
                                            </p>
                                        ))}
                                    </td>
                                    <td className={styles.sub}>{group.why}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {section.judgeMore > 0 && <p className={styles.judgeMore}>외 {section.judgeMore}개</p>}
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
                                        {row.sentence || <span className={styles.sub}>{row.blankWhy || '(직접 적기)'}</span>}
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
                        상위 {section.noun}이 등록한 대표키워드
                        <span>검색 상위 {section.noun}이 어떤 말로 등록했는지 참고하세요{section.rivalKeywords.total > section.rivalKeywords.rows.length ? ` · ${section.rivalKeywords.total}곳 중 ${section.rivalKeywords.rows.length}곳` : ''}</span>
                    </h3>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th scope="col" className={styles.colWord}>{section.noun}(검색 순위)</th>
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
                                                    {entry.mine && <small className={styles.wordMark}>내 {section.noun}도 씀</small>}
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
                            두 곳 이상이 함께 쓰는 키워드: {section.rivalKeywords.common.map((entry) => `${entry.word} ${entry.count}곳${entry.mine ? `(내 ${section.noun}도 씀)` : entry.next ? '(5칸 최종안에 든 말)' : ''}`).join(' · ')}
                        </p>
                    )}
                </div>
            )}
            {section.notes.map((note) => <p key={note} className={styles.note}>{note}</p>)}
            {section.excluded && (
                <div className={partClass(section.excluded.rows.length, section.excluded.rows.length >= SPLIT_MIN_ROWS ? styles.excludedPart : undefined)}>
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
                        {rowChunks(section.excluded.rows, SPLIT_MIN_ROWS - 1, SPLIT_EDGE).map((chunk, index, all) => (
                            <tbody key={`${chunk[0].label}-${chunk[0].words}`} className={chunkClass(index, all.length)}>
                                {chunk.map((row) => (
                                    <tr key={`${row.label}-${row.words}`}>
                                        <td className={styles.sub}>{row.label}</td>
                                        <th scope="row">{row.wide ? row.short : row.words}</th>
                                        <td className={styles.sub}>
                                            {row.wide && <span className={styles.wordList}>{row.words}</span>}
                                            {row.reason}
                                        </td>
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
                                    {item.steps?.length > 0 && (
                                        <ol className={`${styles.steps} ${styles.stepsSmall}`}>
                                            {item.steps.map((step, i) => <li key={step}><span>{i + 1}</span>{step}</li>)}
                                        </ol>
                                    )}
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
    // 주차 줄(+ 넘치는 일 줄). 나눔 방식 true 에서는 앞 2줄·뒤 2줄을 지키며 쪽을 넘겨 이어질 수 있습니다(rowChunks: 4줄이면 2·2줄).
    const planRows = [
        ...section.weeks.map((week) => ({ key: `week-${week.no}`, head: `${week.no}주차`, items: week.items, mark: true })),
        ...(section.overflow.length > 0 ? [{ key: 'overflow', head: `이 밖에 ${section.overflow.length}개`, items: section.overflow, mark: false }] : []),
    ];
    return (
        <section className={styles.section}>
            <SectionTitle section={section} />
            <p className={styles.lead}>{section.lead}</p>
            <div className={`${styles.planBlock} ${styles.splitPart}`}>
            <table className={`${styles.table} ${styles.planTable}`}>
                {rowChunks(planRows, 3, 2).map((chunk, index, all) => (
                    <tbody key={chunk[0].key} className={chunkClass(index, all.length)}>
                        {chunk.map((row) => (
                            <tr key={row.key}>
                                <th scope="row" className={styles.colWeek}>{row.head}</th>
                                <td>
                                    <ul className={styles.checks}>
                                        {row.items.map((item) => (
                                            <li key={item.title}>
                                                <span className={styles.box} aria-hidden="true" />
                                                <span>{row.mark && item.recheck ? <b>{item.title}</b> : item.title}{item.timeLabel ? <span className={styles.sub}> · {item.timeLabel}</span> : null}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                ))}
            </table>
            </div>
            {/* 매주 반복할 일: 4주 실행표 바로 아래의 작은 표(같은 쪽에 두고, 못 들어가면 다음 쪽으로 통째로) */}
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
// 1쪽(머리 + 처방 요약)의 실제 높이(mm). 문서는 화면에서 감춰 두므로, 잠깐 화면 밖에 A4 안쪽 너비(182mm)로 펼쳐 잰 뒤 되돌립니다.
// 글자 크기·표 규칙은 인쇄와 같으므로(pt·mm 단위) 인쇄한 1쪽 높이와 거의 같습니다.
function measurePage1Mm(article) {
    const head = article.querySelector('header');
    const page = article.querySelector('[data-page1]');
    if (!head || !page) return null;
    const before = article.getAttribute('style');
    try {
        article.style.cssText = 'display:block;position:absolute;left:-9999px;top:0;width:182mm;visibility:hidden;';
        const mm = ((page.getBoundingClientRect().bottom - head.getBoundingClientRect().top) * 25.4) / 96;
        return Number.isFinite(mm) && mm > 0 ? mm : null;
    } finally {
        // 재다가 오류가 나도 문서의 style 을 되돌립니다(화면 밖에 펼친 채로 남지 않게).
        if (before === null) article.removeAttribute('style');
        else article.setAttribute('style', before);
    }
}

const TIGHTEN_MAX = 8;

/* ───────── 쪽 나눔 어림 ─────────
 * 2쪽부터의 구역을 A4 안쪽 크기(182×271mm) 단 하나짜리 다단 상자에 흘려 보내, 인쇄와 같은 쪽 나눔 규칙(break-inside 등)으로 몇 쪽이 되고
 * 쪽마다 아래가 얼마나 비는지 잽니다. 세로 간격 배율(--rx-s)을 몇 가지 바꿔 보고, 마지막 쪽이 너무 비거나 쪽 아래가 크게 비는 정도가
 * 가장 작은 배율을 고릅니다(같으면 1에 가까운 것). 재지 못하면 1 입니다.
 * 배율은 1.2 까지만 씁니다. 1.3·1.5 는 어림이 마지막 쪽을 87~88%로 재는데 인쇄에서는 한 쪽이 더 생겨(음식점 9쪽 → 10쪽, 마지막 쪽에 꼬리글만 남음)
 * 어림이 낙관적인 배율이라 뺐습니다(1.2 이하는 인쇄에서도 같은 쪽 수였음). */
const SPACING_CHOICES = [1, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 1.05, 1.1, 1.2];
const EMULATE_PAGE_MM = 268;
const PRINT_PAGE_MM = 271;
const GAP_OK = 0.2; // 마지막 쪽을 뺀 쪽 아래 빈 공간이 이 비율을 넘으면 감점(목표는 25% 이내지만 어림이 인쇄보다 조금 낙관적이라 더 엄격하게 잼)
const LAST_MIN = 0.5; // 마지막 쪽이 이만큼은 차야 함
// 마지막 쪽이 절반에 못 미치는 정도의 가중. 쪽 아래 빈 공간이 20%를 몇 %p 넘는 것(가중 30)과 견줘, 마지막 쪽이 절반 아래로 떨어지는 배율보다
// 쪽 아래가 20%를 1~2%p 넘는 배율을 고르게 하는 값(긴 견본: 마지막 쪽 46%인 0.85 대신 쪽 아래 21%가 한 곳인 1.2).
const LAST_WEIGHT = 20;

function emulatePages(article, scale, split) {
    const rest = [...article.children].filter((node) => node.tagName !== 'HEADER' && !node.hasAttribute('data-page1'));
    if (rest.length === 0) return null;
    const wrap = document.createElement('div');
    wrap.className = article.className;
    // 인쇄 쪽(271mm)보다 3mm 낮게 잡아, 재는 값이 인쇄 결과보다 낙관적으로 나오지 않게 합니다(인쇄는 머리 줄 되풀이 등으로 조금 더 큼).
    wrap.style.cssText = `display:block;position:absolute;left:0;top:0;visibility:hidden;pointer-events:none;width:182mm;height:${EMULATE_PAGE_MM}mm;column-width:182mm;column-gap:0;column-fill:auto;`;
    wrap.style.setProperty('--rx-s', String(scale));
    wrap.setAttribute('data-split', String(split));
    for (const node of rest) wrap.appendChild(node.cloneNode(true));
    document.body.appendChild(wrap);
    try {
        const box = wrap.getBoundingClientRect();
        const width = box.width;
        const height = box.height;
        if (!(width > 0 && height > 0)) return null;
        const bottoms = [];
        for (const el of wrap.querySelectorAll('p,li,td,th,h2,h3,dt,dd,div')) {
            for (const rect of el.getClientRects()) {
                if (rect.height <= 0) continue;
                const col = Math.max(0, Math.floor((rect.left - box.left + 1) / width));
                bottoms[col] = Math.max(bottoms[col] || 0, rect.bottom - box.top);
            }
        }
        const pages = bottoms.length;
        if (pages === 0) return null;
        // 찬 정도는 인쇄 쪽 높이(271mm) 기준
        const printHeight = (height / EMULATE_PAGE_MM) * PRINT_PAGE_MM;
        return { pages, fill: bottoms.map((bottom) => Math.min(1, (bottom || 0) / printHeight)) };
    } finally {
        wrap.remove();
    }
}

// 쪽 규칙을 어긴 정도(0 이면 모두 지킴): 마지막 쪽을 뺀 쪽 아래 빈 공간이 25%를 넘는 만큼 + 마지막 쪽이 절반 미만인 만큼
function pageIssues(result) {
    if (!result) return Infinity;
    const gaps = result.fill.slice(0, -1).map((fill) => 1 - fill);
    const last = result.fill[result.fill.length - 1];
    // 쪽 아래 빈 공간은 쪽 수보다 앞서 지킵니다(가중 30: 빈 공간이 20%를 6%p 넘는 것이 쪽 하나보다 나쁨). 실제 인쇄와 어림은 몇 %p 어긋날 수 있어 기준을 20%로 엄격하게 둡니다.
    return gaps.reduce((sum, gap) => sum + Math.max(0, gap - GAP_OK), 0) * 30 + Math.max(0, LAST_MIN - last) * LAST_WEIGHT;
}

function pagePenalty(result) {
    return result ? pageIssues(result) + result.pages * 1 : Infinity;
}

// 10줄 이하 표를 나누는 방식(data-split): false 나누지 않음(한 쪽에 통째로, 한두 줄만 따로 떨어지지 않음) · true 나눔(앞 2줄·뒤 2줄은 같은 쪽).
// 쪽 아래 25% 이내·마지막 쪽 절반 규칙이 먼저라, 나누지 않고는 그 규칙을 못 지키는 문서만 나눕니다(감점이 같으면 나누지 않는 쪽).
// 줄 사이에 break-after/before: avoid 를 걸거나 tbody 묶음을 늘려 "앞뒤 3줄"을 지키게 하는 방식은 인쇄는 지키지만 쪽 나눔 어림(다단 상자)이
// 같게 지키지 못해 어림과 인쇄가 어긋나서(어림은 7쪽, 인쇄는 쪽 아래 24%·33%가 빈 9쪽) 쓰지 않습니다.
const SPLIT_MODES = [false, true];
const SPLIT_COST = { false: 0, true: 0.8 };

// 쪽 나눔을 재는 데 쓰는 시간의 상한(밀리초). 느린 기기에서 인쇄 창이 늦게 열리지 않게, 넘으면 그때까지 가장 좋았던 값으로 정합니다.
const FIT_BUDGET_MS = 1500;

function choosePageFit(article) {
    let best = { scale: 1, split: false, penalty: Infinity };
    const tries = [];
    const started = typeof performance !== 'undefined' ? performance.now() : 0;
    const overBudget = () => typeof performance !== 'undefined' && performance.now() - started > FIT_BUDGET_MS;
    for (const split of SPLIT_MODES) {
        for (const scale of SPACING_CHOICES) {
            if (overBudget() && Number.isFinite(best.penalty)) break;
            let result = null;
            try {
                result = emulatePages(article, scale, split);
            } catch {
                result = null;
            }
            const penalty = pagePenalty(result) + SPLIT_COST[String(split)];
            tries.push([SPLIT_MODES.indexOf(split), scale, result?.pages ?? 0, result ? Math.round(result.fill[result.fill.length - 1] * 100) : 0, Math.round(penalty * 10) / 10]);
            // 같은 정도면 먼저 본 것(나누지 않고 1에 가까운 것)을 씁니다.
            if (penalty < best.penalty - 0.05) best = { scale, split, penalty };
            // 처음(간격 1, 표 나누지 않음)부터 쪽 규칙을 모두 지키면 더 찾지 않습니다(인쇄 직전 계산을 짧게).
            if (!split && scale === 1 && result && pageIssues(result) === 0) {
                article.dataset.fit = JSON.stringify(tries);
                return { scale: 1, split: false };
            }
        }
    }
    // 어림 기록(나눔·배율·쪽 수·마지막 쪽 찬 정도·감점): 확인용으로 문서 요소에 남깁니다.
    article.dataset.fit = JSON.stringify(tries);
    return Number.isFinite(best.penalty) ? { scale: best.scale, split: best.split } : { scale: 1, split: false };
}

function PrescriptionDocument({ place, activity, ranks, recommendation, actions, rivals, fetchedAt, nowMs }) {
    const geo = useMemo(() => safeGeo(place, activity, ranks, nowMs), [place, activity, ranks, nowMs]);
    // 1쪽이 한 쪽을 넘으면 어림 예산을 줄여 덜 중요한 것부터 더 빼고 다시 만들고(tighten),
    // 1쪽이 정해지면 2쪽부터의 쪽 나눔을 재어 세로 간격 배율(scale)을 고릅니다(아래 useLayoutEffect).
    const [fit, setFit] = useState({ tighten: 0, scale: null, split: false });
    const { tighten, scale, split } = fit;
    const doc = useMemo(
        () => buildPrescription({
            place, activity, ranks, recommendation, actions, geo, rivals, fetchedAt, page1Budget: PAGE1_BUDGET_MM - tighten * PAGE1_TIGHTEN_MM,
            ...(Number.isFinite(nowMs) ? { nowMs } : {}),
        }),
        [place, activity, ranks, recommendation, actions, geo, rivals, fetchedAt, nowMs, tighten],
    );
    const storeName = doc?.store.name || '';
    const articleRef = useRef(null);
    useLayoutEffect(() => {
        const article = articleRef.current;
        if (!doc || !article) return;
        // 재기(1쪽 높이·쪽 나눔)는 인쇄를 더 보기 좋게 하려는 보정입니다. 어떤 이유로든 재지 못하면 보정 없이(간격 1, 표 나누지 않음) 기본 인쇄 배치로 인쇄합니다.
        if (tighten < TIGHTEN_MAX) {
            let mm = null;
            try {
                mm = measurePage1Mm(article);
            } catch {
                mm = null;
            }
            if (mm !== null && mm > PAGE1_LIMIT_MM) {
                setFit((state) => ({ tighten: state.tighten + 1, scale: null, split: false }));
                return;
            }
        }
        if (scale === null) {
            // 간격 배율은 쪽 나눔 어림이 잰 값입니다. 재지 못하면(화면 밖 계산이 안 되는 환경) 1.
            const before = article.getAttribute('style');
            let chosen = { scale: 1, split: false };
            try {
                article.style.cssText = 'display:block;position:absolute;left:-9999px;top:0;width:182mm;visibility:hidden;';
                chosen = choosePageFit(article);
            } catch {
                chosen = { scale: 1, split: false };
            } finally {
                if (before === null) article.removeAttribute('style');
                else article.setAttribute('style', before);
            }
            setFit((state) => ({ ...state, scale: chosen.scale, split: chosen.split }));
        }
    }, [doc, tighten, scale]);

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
        <article ref={articleRef} className={styles.doc} data-prescription="" data-store={storeName} data-scale={scale ?? 1} data-split={String(split)} style={{ '--rx-s': scale ?? 1 }} lang="ko">
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
