'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import DashboardLayout from '@/components/layout/DashboardLayout';
import styles from './page.module.css';
import { HelpCircle, ChevronDown, Send, Inbox, Clock, CheckCircle2, LogIn } from 'lucide-react';
import { toast } from 'sonner';

const faqCategories = [
    { id: 'all', label: '전체' },
    { id: 'ad', label: '광고' },
    { id: 'payment', label: '충전·결제' },
    { id: 'ranking', label: '순위추적' },
    { id: 'etc', label: '기타' },
];

const faqs = [
    {
        id: 1,
        category: 'ad',
        question: '트래픽 광고는 어떤 원리로 순위를 올려주나요?',
        answer: '혼잘마의 트래픽 광고는 실제 사용자가 검색부터 클릭, 체류까지 자연스러운 흐름으로 상품이나 플레이스에 유입되도록 설계되어 있습니다. 네이버 검색 알고리즘은 클릭률, 체류시간, 재방문율 등 다양한 사용자 반응 지표를 반영하는데, 실사용자 트래픽 유입을 통해 이 지표들이 자연스럽게 개선되는 원리입니다.\n\n다만 검색 알고리즘은 수시로 업데이트되고 경쟁업체 상황에 따라서도 결과가 달라질 수 있어 상승 폭과 시점을 정확히 보장해드리기는 어렵습니다. 통상적으로 광고 시작 후 3~7일 이내에 유의미한 변화가 나타나는 경우가 많으니 최소 1주일 이상 지켜봐 주시는 것을 권장드립니다.',
    },
    {
        id: 2,
        category: 'payment',
        question: '캐시는 어떻게 충전하나요?',
        answer: "대시보드 상단의 '충전' 버튼을 누르시면 무통장입금 신청 화면으로 이동합니다. 입금하실 금액과 입금자명을 입력해 신청하시면, 확인 후 보통 영업일 기준 30분~1시간 이내에 캐시가 충전됩니다(운영 시간 외 신청 시 다음 영업일 처리).\n\n일정 금액 이상 충전 시 보너스 캐시가 추가로 지급되는 프로모션이 진행 중이니 공지사항을 참고해주세요. 입금자명이 실제 입금자와 다르면 확인이 지연될 수 있으니 정확히 입력해주시기 바랍니다.",
    },
    {
        id: 3,
        category: 'ranking',
        question: '순위는 언제, 어떻게 반영되나요?',
        answer: "등록하신 키워드의 순위는 매일 1회 자동으로 갱신됩니다. 정확한 갱신 시간은 서버 상황에 따라 다소 유동적일 수 있습니다.\n\n지금 바로 최신 순위를 확인하고 싶으시다면 순위추적 페이지에서 '새로고침' 버튼을 눌러 수동으로 갱신하실 수 있습니다. 다만 짧은 시간 내 반복 새로고침은 정확도에 영향을 줄 수 있어 일부 제한이 있을 수 있습니다.",
    },
    {
        id: 4,
        category: 'ad',
        question: '광고를 중도에 취소하면 환불되나요?',
        answer: "네, 가능합니다. 진행 중인 광고를 취소하시면 이미 소진된 기간을 제외한 잔여 기간에 대해 일할 계산으로 자동 환불되어 캐시로 즉시 반환됩니다.\n\n단, 충전 시 지급된 보너스 캐시는 환불 대상에서 제외되며, 실제 결제하신 금액을 기준으로 환불액이 산정됩니다. 취소는 각 광고 관리 화면의 '취소' 버튼을 통해 즉시 처리하실 수 있습니다.",
    },
    {
        id: 5,
        category: 'payment',
        question: '세금계산서를 발행받을 수 있나요?',
        answer: "네, 발행 가능합니다. 고객센터의 1:1 문의에서 카테고리를 '충전·결제'로 선택하신 뒤 사업자등록증과 함께 세금계산서 발행을 요청해주시면, 담당자가 확인 후 순차적으로 발행해드립니다.\n\n세금계산서는 신청 접수 기준 영업일 3~5일 내 발행되며, 발행 관련 안내는 답변을 통해 개별로 안내드립니다.",
    },
    {
        id: 6,
        category: 'ad',
        question: '쿠팡 광고는 왜 별도로 문의해야 하나요?',
        answer: "쿠팡은 네이버와 광고 정책, 시스템 구조가 크게 달라 상품·카테고리별로 견적과 운영 방식이 달라집니다. 이러한 이유로 쿠팡 광고는 대시보드에서 즉시 결제하는 방식이 아니라, 1:1 문의(카테고리: 쿠팡)를 통해 상품 정보를 남겨주시면 담당자가 검토 후 맞춤 견적을 안내해드리는 방식으로 운영하고 있습니다.\n\n문의를 남겨주시면 영업일 기준 1일 이내 답변드리는 것을 목표로 하고 있습니다.",
    },
    {
        id: 7,
        category: 'etc',
        question: '네이버 API 키를 등록하면 무엇이 달라지나요?',
        answer: '네이버 검색광고 API 키(Client ID/Secret)를 등록하시면 추정치가 아닌 네이버 공식 데이터를 기반으로 한 키워드 검색량, 경쟁강도, 예상 입찰가 등 실데이터 분석을 이용하실 수 있습니다. API 키가 없어도 서비스 이용은 가능하지만, 일부 지표는 추정치로 제공됩니다.\n\nAPI 키는 네이버 검색광고 관리 시스템에서 직접 발급받으실 수 있으며, 발급받은 키는 안전하게 서버 환경변수로 보관되어 타 사용자와 공유되지 않습니다.',
    },
    {
        id: 8,
        category: 'etc',
        question: "키워드 분석의 '추정 데이터'는 무엇인가요?",
        answer: "네이버 API 키가 등록되어 있지 않거나 특정 데이터를 API에서 직접 제공하지 않는 경우, 혼잘마는 검색 결과 노출 패턴과 관련 키워드 트렌드 등을 기반으로 자체 로직을 통해 근사값을 계산해 제공합니다. 이렇게 계산된 값에는 '추정' 표시가 함께 붙습니다.\n\n추정 데이터는 실제 값과 차이가 있을 수 있으므로, 더 정확한 분석을 원하시는 경우 네이버 API 키 등록을 권장드립니다.",
    },
    {
        id: 9,
        category: 'etc',
        question: '플레이스 블로그 배포는 며칠 정도 걸리나요?',
        answer: '신청하신 포스팅 수와 원고 난이도에 따라 다르지만, 통상 신청일로부터 3~5 영업일 이내에 순차적으로 발행됩니다. 배포가 진행되는 동안 대시보드에서 진행 상태와 발행된 게시글 링크를 실시간으로 확인하실 수 있습니다.\n\n원고 작성 시 특별히 강조하고 싶은 내용이 있다면 신청 시 요청사항 란에 자세히 남겨주세요.',
    },
    {
        id: 10,
        category: 'etc',
        question: '회원 탈퇴를 하면 개인정보는 어떻게 되나요?',
        answer: '회원 탈퇴를 원하시는 경우 1:1 문의(카테고리: 기타)로 탈퇴 요청을 남겨주시면 본인 확인 후 처리해드립니다. 탈퇴가 완료되면 관련 법령에서 별도로 보관을 요구하는 정보(전자상거래법상 결제·환불 기록 등)를 제외한 개인정보는 지체 없이 파기됩니다.\n\n보관 의무가 있는 정보의 항목과 보관 기간은 개인정보처리방침 페이지에서 자세히 확인하실 수 있습니다.',
    },
];

const inquiryCategories = [
    { value: 'general', label: '일반' },
    { value: 'payment', label: '충전·결제' },
    { value: 'ad', label: '광고' },
    { value: 'coupang', label: '쿠팡' },
    { value: 'refund', label: '환급' },
    { value: 'etc', label: '기타' },
];

const inquiryCategoryLabel = (value) => inquiryCategories.find((c) => c.value === value)?.label || value;

const statusInfo = {
    open: { label: '답변대기', className: 'statusOpen' },
    answered: { label: '답변완료', className: 'statusAnswered' },
    closed: { label: '종료', className: 'statusClosed' },
};

export default function SupportPage() {
    const { status } = useSession();

    const [activeFaqCategory, setActiveFaqCategory] = useState('all');
    const [openFaqId, setOpenFaqId] = useState(null);

    const [form, setForm] = useState({ category: 'general', title: '', content: '' });
    const [submitting, setSubmitting] = useState(false);

    const [inquiries, setInquiries] = useState([]);
    const [loadingInquiries, setLoadingInquiries] = useState(true);
    const [openInquiryId, setOpenInquiryId] = useState(null);

    const fetchInquiries = useCallback(async () => {
        try {
            setLoadingInquiries(true);
            const res = await fetch('/api/inquiries');
            if (res.ok) {
                const data = await res.json();
                setInquiries(data.inquiries || []);
            }
        } catch (error) {
            console.error('Error fetching inquiries:', error);
        } finally {
            setLoadingInquiries(false);
        }
    }, []);

    // FAQ는 비로그인에도 공개 — 문의 작성/내역만 로그인 필요
    useEffect(() => {
        if (status === 'authenticated') {
            fetchInquiries();
        }
    }, [status, fetchInquiries]);

    const filteredFaqs = activeFaqCategory === 'all'
        ? faqs
        : faqs.filter((f) => f.category === activeFaqCategory);

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (form.title.trim().length < 2 || form.content.trim().length < 5) {
            toast.error('제목은 2자 이상, 내용은 5자 이상 입력해주세요.');
            return;
        }

        setSubmitting(true);
        try {
            const res = await fetch('/api/inquiries', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(form),
            });
            const data = await res.json();
            if (res.ok) {
                toast.success('문의가 접수되었습니다.');
                setForm({ category: 'general', title: '', content: '' });
                fetchInquiries();
            } else {
                toast.error(data.error || '문의 접수 중 오류가 발생했습니다.');
            }
        } catch (error) {
            console.error('Error submitting inquiry:', error);
            toast.error('문의 접수 중 오류가 발생했습니다.');
        } finally {
            setSubmitting(false);
        }
    };

    const formatDate = (dateStr) => {
        const date = new Date(dateStr);
        return date.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
    };

    if (status === 'loading') {
        return <DashboardLayout><div className={styles.container}>로딩 중...</div></DashboardLayout>;
    }

    return (
        <DashboardLayout>
            <div className={styles.container}>
                {/* Header */}
                <div className={styles.header}>
                    <h1 className={styles.title}>고객센터</h1>
                    <p className={styles.subtitle}>궁금한 점을 빠르게 해결하세요</p>
                </div>

                {/* FAQ Section */}
                <section className={styles.section}>
                    <div className={styles.sectionTitleRow}>
                        <HelpCircle size={20} />
                        <h2>자주 묻는 질문</h2>
                    </div>

                    <div className={styles.faqTabs}>
                        {faqCategories.map((cat) => (
                            <button
                                key={cat.id}
                                className={`${styles.faqTab} ${activeFaqCategory === cat.id ? styles.active : ''}`}
                                onClick={() => setActiveFaqCategory(cat.id)}
                            >
                                {cat.label}
                            </button>
                        ))}
                    </div>

                    <div className={styles.faqList}>
                        {filteredFaqs.map((faq) => {
                            const isOpen = openFaqId === faq.id;
                            return (
                                <div key={faq.id} className={styles.faqItem}>
                                    <button
                                        className={styles.faqQuestion}
                                        onClick={() => setOpenFaqId(isOpen ? null : faq.id)}
                                    >
                                        <span className={styles.faqQ}>Q</span>
                                        <span className={styles.faqQuestionText}>{faq.question}</span>
                                        <ChevronDown size={18} className={`${styles.chevron} ${isOpen ? styles.open : ''}`} />
                                    </button>
                                    {isOpen && (
                                        <div className={styles.faqAnswer}>
                                            <span className={styles.faqA}>A</span>
                                            <p>{faq.answer}</p>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </section>

                {/* Inquiry Form Section */}
                <section className={styles.section}>
                    <div className={styles.sectionTitleRow}>
                        <Send size={20} />
                        <h2>1:1 문의하기</h2>
                    </div>

                    {status !== 'authenticated' ? (
                        <div className={styles.loginPrompt}>
                            <LogIn size={32} className={styles.loginPromptIcon} />
                            <h4>로그인 후 문의를 남길 수 있어요</h4>
                            <p>비밀번호 분실 등 계정 문제라면, 가입하신 이메일로 임시 비밀번호 발급을 요청해주세요.</p>
                            <Link href="/login" className={styles.loginPromptBtn}>
                                로그인 / 회원가입
                            </Link>
                        </div>
                    ) : (
                    <form className={styles.inquiryForm} onSubmit={handleSubmit}>
                        <div className={styles.formRow}>
                            <label className={styles.formLabel}>카테고리</label>
                            <select
                                className={styles.select}
                                value={form.category}
                                onChange={(e) => setForm({ ...form, category: e.target.value })}
                            >
                                {inquiryCategories.map((c) => (
                                    <option key={c.value} value={c.value}>{c.label}</option>
                                ))}
                            </select>
                        </div>

                        <div className={styles.formRow}>
                            <label className={styles.formLabel}>제목</label>
                            <input
                                type="text"
                                className={styles.input}
                                placeholder="문의 제목을 입력해주세요"
                                value={form.title}
                                onChange={(e) => setForm({ ...form, title: e.target.value })}
                                maxLength={100}
                                required
                            />
                        </div>

                        <div className={styles.formRow}>
                            <label className={styles.formLabel}>내용</label>
                            <textarea
                                className={styles.textarea}
                                placeholder="문의하실 내용을 자세히 입력해주세요"
                                value={form.content}
                                onChange={(e) => setForm({ ...form, content: e.target.value })}
                                maxLength={2000}
                                rows={6}
                                required
                            />
                        </div>

                        <button type="submit" className={styles.submitBtn} disabled={submitting}>
                            {submitting ? '접수 중...' : '문의 접수하기'}
                        </button>
                    </form>
                    )}
                </section>

                {/* My Inquiries Section — 로그인 시에만 노출 */}
                {status === 'authenticated' && (
                <section className={styles.section}>
                    <div className={styles.sectionTitleRow}>
                        <Inbox size={20} />
                        <h2>내 문의 내역</h2>
                    </div>

                    <div className={styles.inquiryList}>
                        {loadingInquiries ? (
                            <div className={styles.emptyState}>
                                <p>로딩 중...</p>
                            </div>
                        ) : inquiries.length === 0 ? (
                            <div className={styles.emptyState}>
                                <Inbox size={40} className={styles.emptyIcon} />
                                <h4>문의 내역이 없습니다.</h4>
                                <p>궁금한 점을 남겨주시면 빠르게 답변드릴게요.</p>
                            </div>
                        ) : (
                            inquiries.map((inq) => {
                                const s = statusInfo[inq.status] || statusInfo.open;
                                const isOpen = openInquiryId === inq.id;
                                return (
                                    <div key={inq.id} className={styles.inquiryItem}>
                                        <button
                                            className={styles.inquiryHeader}
                                            onClick={() => setOpenInquiryId(isOpen ? null : inq.id)}
                                        >
                                            <span className={styles.inquiryCategoryBadge}>{inquiryCategoryLabel(inq.category)}</span>
                                            <span className={styles.inquiryTitle}>{inq.title}</span>
                                            <span className={`${styles.statusBadge} ${styles[s.className]}`}>
                                                {inq.status === 'answered' ? <CheckCircle2 size={13} /> : <Clock size={13} />}
                                                {s.label}
                                            </span>
                                            <span className={styles.inquiryDate}>{formatDate(inq.createdAt)}</span>
                                            <ChevronDown size={16} className={`${styles.chevron} ${isOpen ? styles.open : ''}`} />
                                        </button>
                                        {isOpen && (
                                            <div className={styles.inquiryBody}>
                                                <p className={styles.inquiryContent}>{inq.content}</p>
                                                {inq.answer ? (
                                                    <div className={styles.answerBox}>
                                                        <span className={styles.answerLabel}>관리자 답변</span>
                                                        <p>{inq.answer}</p>
                                                    </div>
                                                ) : (
                                                    <p className={styles.noAnswer}>아직 답변이 등록되지 않았습니다. 조금만 기다려주세요.</p>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })
                        )}
                    </div>
                </section>
                )}
            </div>
        </DashboardLayout>
    );
}
