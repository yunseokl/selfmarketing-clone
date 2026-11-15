'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
    AlertTriangle, ChevronDown, Copy, Info, MessageSquareReply, RotateCcw, ShieldCheck, Sparkles, Store,
} from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import {
    INDUSTRIES,
    SENTIMENTS,
    COMPLAINT_TYPES,
    TONES,
    INCLUDE_OPTIONS,
    MAX_REVIEW_LENGTH,
    MAX_MENTIONS,
    POLICY_SOURCES,
    POLICY_BASIS_DATE,
    SEVERITY_LABELS,
    countChars,
    validateReview,
    detectSentiment,
    detectComplaintType,
    defaultIncludes,
    extractMentionCandidates,
    parseMentions,
    generateReplies,
    checkPolicy,
} from '@/lib/review-reply';
import styles from './page.module.css';

const EXAMPLE = {
    industry: 'restaurant',
    storeName: '다온식당',
    review: '파스타가 정말 맛있었고 직원분들도 친절해서 만족했어요. 분위기도 좋았습니다. 다음에 또 올게요!',
};

const SEVERITY_STYLES = {
    danger: { item: styles.sevDanger, tag: styles.tagDanger },
    warn: { item: styles.sevWarn, tag: styles.tagWarn },
    info: { item: styles.sevInfo, tag: styles.tagInfo },
};

function PolicyCheck({ text, industry }) {
    const findings = useMemo(() => checkPolicy(text, { industry }), [text, industry]);
    const real = findings.filter((f) => f.severity !== 'info');

    return (
        <div className={styles.policy}>
            <h4 className={styles.policyTitle}>
                {real.length === 0 ? <ShieldCheck size={15} /> : <AlertTriangle size={15} />}
                정책 점검 {real.length === 0 ? '· 걸린 표현 없음' : `· ${real.length}건 확인하세요`}
            </h4>
            {real.length === 0 && (
                <p className={styles.policyOk}>
                    <strong>걸린 표현이 없어요.</strong> 다만 이 점검은 정해 둔 규칙으로 찾는 것이라 모든 문제를 잡아 주지는 못해요. 등록 전에 한 번 더 읽어 보세요.
                </p>
            )}
            {findings.length > 0 && (
                <ul className={styles.policyList}>
                    {findings.map((f, index) => {
                        const style = SEVERITY_STYLES[f.severity];
                        return (
                            <li key={`${f.id}-${f.phrase}-${index}`} className={`${styles.policyItem} ${style.item}`}>
                                <span className={`${styles.sevTag} ${style.tag}`}>{SEVERITY_LABELS[f.severity]}</span>
                                {f.phrase && <q>{f.phrase}</q>}{f.phrase ? ' · ' : ''}
                                {f.reason}
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}

function DraftCard({ draft, text, edited, industry, onChange, onReset }) {
    const copy = async () => {
        try {
            if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('clipboard unavailable');
            await navigator.clipboard.writeText(text);
            toast.success('복사했어요. 스마트플레이스에서 붙여넣어 등록하세요.');
        } catch {
            toast.error('복사하지 못했어요. 글을 직접 선택해서 복사해 주세요.');
        }
    };

    const textareaId = `reply-${draft.id}`;
    return (
        <section className={styles.resultCard} aria-label={draft.label}>
            <div className={styles.draftHead}>
                <label htmlFor={textareaId}>{draft.label}</label>
                {edited && <span className={styles.editedTag}>직접 고침</span>}
            </div>
            <textarea
                id={textareaId}
                className={styles.draftText}
                rows={9}
                value={text}
                onChange={(e) => onChange(e.target.value)}
            />
            <div className={styles.draftMeta}>
                <span className={styles.count}>공백 포함 {countChars(text).toLocaleString('ko-KR')}자</span>
                {edited && (
                    <button type="button" className={styles.ghostBtn} onClick={onReset}>
                        <RotateCcw size={14} /> 처음 초안으로
                    </button>
                )}
                <button type="button" className={styles.primaryBtn} onClick={copy}>
                    <Copy size={15} /> 복사
                </button>
            </div>
            <PolicyCheck text={text} industry={industry} />
        </section>
    );
}

export default function ReviewReplyPage() {
    const { status } = useSession();
    const router = useRouter();

    const [industry, setIndustry] = useState('restaurant');
    const [storeName, setStoreName] = useState('');
    const [review, setReview] = useState('');
    const [sentimentOverride, setSentimentOverride] = useState(null);
    const [typeOverride, setTypeOverride] = useState(null);
    const [tone, setTone] = useState('polite');
    const [includeOverride, setIncludeOverride] = useState(null);
    const [mentionsText, setMentionsText] = useState('');
    const [edits, setEdits] = useState({});

    useEffect(() => {
        if (status === 'unauthenticated') router.push('/login');
    }, [status, router]);

    const validation = useMemo(() => validateReview(review), [review]);
    const hasReview = review.trim().length > 0;

    const autoSentiment = useMemo(() => (hasReview ? detectSentiment(review) : 'neutral'), [review, hasReview]);
    const sentiment = sentimentOverride ?? autoSentiment;
    const autoType = useMemo(() => (hasReview ? detectComplaintType(review) : 'etc'), [review, hasReview]);
    const complaintType = typeOverride ?? autoType;

    const include = useMemo(
        () => (includeOverride && includeOverride.sentiment === sentiment ? includeOverride.value : defaultIncludes(sentiment)),
        [includeOverride, sentiment]
    );
    const mentions = useMemo(() => parseMentions(mentionsText), [mentionsText]);
    const candidates = useMemo(() => extractMentionCandidates(review), [review]);

    const drafts = useMemo(
        () => generateReplies({ industry, storeName, review, sentiment, complaintType, tone, include, mentions }),
        [industry, storeName, review, sentiment, complaintType, tone, include, mentions]
    );

    const textOf = (draft) => {
        const edit = edits[draft.id];
        return edit && edit.base === draft.text ? edit.text : draft.text;
    };
    const isEdited = (draft) => textOf(draft) !== draft.text;

    const setDraftText = (draft, value) => {
        setEdits((prev) => ({ ...prev, [draft.id]: { base: draft.text, text: value } }));
    };
    const resetDraft = (draft) => {
        setEdits((prev) => {
            const next = { ...prev };
            delete next[draft.id];
            return next;
        });
    };

    const pickSentiment = (id) => {
        setSentimentOverride(id);
        setIncludeOverride(null);
    };

    const toggleInclude = (id) => {
        setIncludeOverride({ sentiment, value: { ...include, [id]: !include[id] } });
    };

    const toggleMention = (word) => {
        if (mentions.includes(word)) {
            setMentionsText(mentions.filter((m) => m !== word).join(', '));
        } else if (mentions.length < MAX_MENTIONS) {
            setMentionsText([...mentions, word].join(', '));
        } else {
            toast.error(`언급할 내용은 최대 ${MAX_MENTIONS}개까지 넣을 수 있어요.`);
        }
    };

    const fillExample = () => {
        setIndustry(EXAMPLE.industry);
        setStoreName(EXAMPLE.storeName);
        setReview(EXAMPLE.review);
        setSentimentOverride(null);
        setTypeOverride(null);
        setIncludeOverride(null);
        setMentionsText('');
        setEdits({});
    };

    const resetForm = () => {
        setIndustry('restaurant');
        setStoreName('');
        setReview('');
        setSentimentOverride(null);
        setTypeOverride(null);
        setTone('polite');
        setIncludeOverride(null);
        setMentionsText('');
        setEdits({});
    };

    const reviewLength = validation.length;
    const overLimit = reviewLength > MAX_REVIEW_LENGTH;
    const sentimentLabel = SENTIMENTS.find((s) => s.id === sentiment)?.label;

    return (
        <DashboardLayout>
            <div className={styles.container}>
                <header className={styles.header}>
                    <div>
                        <h1>리뷰 답글 도우미</h1>
                        <p>받은 리뷰를 붙여넣으면 상황에 맞는 답글 초안 3개를 만들고, 올리기 전에 정책 위반 소지를 점검해 드려요.</p>
                    </div>
                    <span className={styles.freeBadge}>무료 · 횟수 제한 없음</span>
                </header>

                <div className={styles.layout}>
                    {/* ===== 입력 ===== */}
                    <section className={styles.formCard} aria-label="답글 설정">
                        <div className={styles.cardHead}>
                            <h2><Store size={16} /> 리뷰와 가게 정보</h2>
                            <div className={styles.headActions}>
                                <button type="button" className={styles.ghostBtn} onClick={fillExample}>
                                    <Sparkles size={14} /> 예시 넣기
                                </button>
                                <button type="button" className={styles.ghostBtn} onClick={resetForm}>
                                    <RotateCcw size={14} /> 초기화
                                </button>
                            </div>
                        </div>

                        <div className={styles.grid2}>
                            <div className={styles.field}>
                                <label htmlFor="industry">업종</label>
                                <div className={styles.selectWrap}>
                                    <select id="industry" value={industry} onChange={(e) => setIndustry(e.target.value)}>
                                        {INDUSTRIES.map((i) => (
                                            <option key={i.id} value={i.id}>{i.label}</option>
                                        ))}
                                    </select>
                                    <ChevronDown size={16} aria-hidden="true" />
                                </div>
                            </div>
                            <div className={styles.field}>
                                <label htmlFor="storeName">가게 이름 (선택)</label>
                                <div className={styles.inputWrap}>
                                    <input
                                        id="storeName"
                                        type="text"
                                        maxLength={30}
                                        value={storeName}
                                        placeholder="예: 다온식당"
                                        onChange={(e) => setStoreName(e.target.value)}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className={styles.field}>
                            <label htmlFor="review">리뷰 본문</label>
                            <textarea
                                id="review"
                                className={styles.textarea}
                                rows={7}
                                value={review}
                                placeholder="고객이 남긴 리뷰를 그대로 붙여넣어 주세요."
                                aria-invalid={hasReview && !validation.ok}
                                aria-describedby="review-help"
                                onChange={(e) => setReview(e.target.value)}
                            />
                            <div className={styles.counterRow} id="review-help">
                                <p className={styles.hint}>리뷰 본문은 서버로 보내지 않고 이 브라우저 안에서만 처리해요.</p>
                                <span className={`${styles.counter} ${overLimit ? styles.counterOver : ''}`}>
                                    {reviewLength.toLocaleString('ko-KR')} / {MAX_REVIEW_LENGTH.toLocaleString('ko-KR')}자
                                </span>
                            </div>
                            {hasReview && !validation.ok && <p className={styles.fieldError} role="alert">{validation.message}</p>}
                        </div>

                        <h3 className={styles.groupTitle}>답글 방향</h3>

                        <div className={styles.field}>
                            <span className={styles.fieldLabel} id="sentiment-label">리뷰 성격</span>
                            <div className={`${styles.segment} ${styles.segment3}`} role="group" aria-labelledby="sentiment-label">
                                {SENTIMENTS.map((s) => (
                                    <button
                                        key={s.id}
                                        type="button"
                                        aria-pressed={sentiment === s.id}
                                        className={sentiment === s.id ? styles.segmentActive : ''}
                                        onClick={() => pickSentiment(s.id)}
                                    >
                                        {s.label}
                                    </button>
                                ))}
                            </div>
                            <p className={styles.hint}>
                                {sentimentOverride === null
                                    ? (hasReview ? `본문에서 ‘${sentimentLabel}’으로 추정했어요. 다르면 눌러서 바꾸세요.` : '리뷰를 붙여넣으면 본문에서 성격을 추정해요. 직접 고를 수도 있어요.')
                                    : '직접 고른 값을 쓰고 있어요.'}
                                {sentimentOverride !== null && (
                                    <button type="button" className={styles.inlineLink} onClick={() => { setSentimentOverride(null); setIncludeOverride(null); }}>
                                        자동 추정으로 되돌리기
                                    </button>
                                )}
                            </p>
                        </div>

                        {sentiment === 'complaint' && (
                            <div className={styles.field}>
                                <label htmlFor="complaintType">불만 유형</label>
                                <div className={styles.selectWrap}>
                                    <select id="complaintType" value={complaintType} onChange={(e) => setTypeOverride(e.target.value)}>
                                        {COMPLAINT_TYPES.map((c) => (
                                            <option key={c.id} value={c.id}>{c.label}</option>
                                        ))}
                                    </select>
                                    <ChevronDown size={16} aria-hidden="true" />
                                </div>
                                <p className={styles.hint}>
                                    {typeOverride === null ? '본문에서 유형을 추정했어요. 다르면 바꿔 주세요.' : '직접 고른 값을 쓰고 있어요.'}
                                    {typeOverride !== null && (
                                        <button type="button" className={styles.inlineLink} onClick={() => setTypeOverride(null)}>
                                            자동 추정으로 되돌리기
                                        </button>
                                    )}
                                </p>
                            </div>
                        )}

                        <div className={styles.field}>
                            <span className={styles.fieldLabel} id="tone-label">말투</span>
                            <div className={styles.segment} role="group" aria-labelledby="tone-label">
                                {TONES.map((t) => (
                                    <button
                                        key={t.id}
                                        type="button"
                                        aria-pressed={tone === t.id}
                                        className={tone === t.id ? styles.segmentActive : ''}
                                        onClick={() => setTone(t.id)}
                                    >
                                        {t.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <fieldset className={styles.fieldset}>
                            <legend className={styles.fieldLabel}>포함할 내용</legend>
                            <div className={styles.checks}>
                                {INCLUDE_OPTIONS.map((opt) => (
                                    <label key={opt.id} className={styles.check}>
                                        <input type="checkbox" checked={Boolean(include[opt.id])} onChange={() => toggleInclude(opt.id)} />
                                        <span>{opt.label}</span>
                                    </label>
                                ))}
                            </div>
                        </fieldset>

                        <div className={styles.field}>
                            <label htmlFor="mentions">답글에서 언급할 내용 (선택)</label>
                            <div className={styles.inputWrap}>
                                <input
                                    id="mentions"
                                    type="text"
                                    value={mentionsText}
                                    placeholder="예: 파스타, 분위기 (쉼표로 구분, 최대 3개)"
                                    aria-describedby="mentions-help"
                                    onChange={(e) => setMentionsText(e.target.value)}
                                />
                            </div>
                            {candidates.length > 0 && (
                                <div className={styles.chips} role="group" aria-label="리뷰에 나온 단어">
                                    {candidates.map((word) => (
                                        <button
                                            key={word}
                                            type="button"
                                            aria-pressed={mentions.includes(word)}
                                            className={`${styles.chip} ${mentions.includes(word) ? styles.chipActive : ''}`}
                                            onClick={() => toggleMention(word)}
                                        >
                                            {word}
                                        </button>
                                    ))}
                                </div>
                            )}
                            <p className={styles.hint} id="mentions-help">
                                여기에 넣거나 위 단어를 눌러 고른 말만 답글에 들어가요. 고르지 않은 메뉴나 서비스 이름은 지어내서 넣지 않아요.
                            </p>
                        </div>
                    </section>

                    {/* ===== 결과 ===== */}
                    <aside className={styles.resultCol} aria-label="답글 초안" aria-live="polite">
                        <div className={styles.notice}>
                            <Info size={16} />
                            <div>
                                <p><strong>초안입니다.</strong> 내용을 확인하고 스마트플레이스에서 직접 등록하세요. 자동으로 등록해 주는 기능은 없어요.</p>
                                <p>정해 둔 규칙과 문장 조합으로 만든 초안이며, 같은 입력이면 같은 초안이 나와요. 리뷰 본문은 이 브라우저 안에서만 처리돼요.</p>
                            </div>
                        </div>

                        {industry === 'clinic' && (
                            <div className={`${styles.notice} ${styles.noticeWarn}`}>
                                <AlertTriangle size={16} />
                                <p><strong>병원·의원 답글은 반드시 직접 검토한 뒤 등록하세요.</strong> 진료 사실이나 내용이 드러나지 않는지, 치료 효과를 단정하지 않는지 확인해 주세요.</p>
                            </div>
                        )}

                        {!validation.ok ? (
                            <div className={`${styles.resultCard} ${styles.emptyResult}`}>
                                <MessageSquareReply size={36} />
                                <strong>
                                    {validation.code === 'empty' ? '리뷰를 붙여넣어 보세요' : validation.code === 'short' ? '리뷰가 너무 짧아요' : '리뷰가 너무 길어요'}
                                </strong>
                                <p>
                                    {validation.code === 'empty'
                                        ? '답글 초안 3개가 바로 만들어져요. 리뷰는 5자 이상 1,000자 이하로 붙여넣어 주세요.'
                                        : validation.message}
                                </p>
                                {validation.code === 'empty' && (
                                    <button type="button" className={styles.primaryBtn} onClick={fillExample}>
                                        <Sparkles size={15} /> 예시로 먼저 보기
                                    </button>
                                )}
                            </div>
                        ) : (
                            drafts.map((draft) => (
                                <DraftCard
                                    key={draft.id}
                                    draft={draft}
                                    text={textOf(draft)}
                                    edited={isEdited(draft)}
                                    industry={industry}
                                    onChange={(value) => setDraftText(draft, value)}
                                    onReset={() => resetDraft(draft)}
                                />
                            ))
                        )}

                        <section className={styles.resultCard} aria-label="점검 근거">
                            <h3 className={styles.cardTitle}><ShieldCheck size={16} /> 점검 기준과 근거</h3>
                            <ul className={styles.sources}>
                                {POLICY_SOURCES.map((source) => (
                                    <li key={source.id}>
                                        <a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>
                                        <br />
                                        {source.summary}
                                    </li>
                                ))}
                            </ul>
                            <p className={styles.muted}>
                                네이버 공식 안내 기준일 {POLICY_BASIS_DATE}. 환불·보상 약속과 병원의 효과 단정 표현은 네이버 규정이 아니라 분쟁을 막기 위한 일반적인 주의 사항이에요.
                                정책은 바뀔 수 있으니 등록 전에 최신 안내를 확인하세요.
                            </p>
                        </section>
                    </aside>
                </div>
            </div>
        </DashboardLayout>
    );
}
