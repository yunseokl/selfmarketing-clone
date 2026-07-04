'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/layout/DashboardLayout';
import styles from './page.module.css';
import {
    BarChart3, CheckCircle2, Clock, MessageSquareText, Package, Send, Target, UserCheck,
} from 'lucide-react';
import { toast } from 'sonner';

const FEATURES = [
    { icon: Target, title: '맞춤 전략', desc: '스토어와 상품 특성에 맞는 노출 전략을 설계해드려요' },
    { icon: UserCheck, title: '전담 매니저', desc: '전담 매니저가 상담부터 운영까지 함께해요' },
    { icon: BarChart3, title: '성과 리포트', desc: '매월 성과를 리포트로 투명하게 공유해요' },
];

const BUDGET_OPTIONS = [
    { value: 'under_1m', label: '100만원 미만' },
    { value: '1m_3m', label: '100~300만원' },
    { value: '3m_5m', label: '300~500만원' },
    { value: 'over_5m', label: '500만원 이상' },
];

function formatDate(dateStr) {
    return new Date(dateStr).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export default function CoupangPage() {
    const { data: session, status } = useSession();
    const router = useRouter();

    const [storeName, setStoreName] = useState('');
    const [productUrl, setProductUrl] = useState('');
    const [budget, setBudget] = useState(BUDGET_OPTIONS[0].value);
    const [message, setMessage] = useState('');
    const [inquiries, setInquiries] = useState([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);

    const fetchInquiries = useCallback(async () => {
        try {
            setLoading(true);
            const res = await fetch('/api/inquiries?category=coupang');
            if (res.ok) {
                const data = await res.json();
                setInquiries(data.inquiries || []);
            } else {
                setInquiries([]);
            }
        } catch (error) {
            console.error('Error fetching coupang inquiries:', error);
            setInquiries([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (status === 'unauthenticated') {
            router.push('/login');
        } else if (status === 'authenticated') {
            fetchInquiries();
        }
    }, [fetchInquiries, router, status]);

    const handleSubmit = async (event) => {
        event.preventDefault();

        if (!storeName.trim() || !productUrl.trim()) {
            toast.error('스토어명과 상품 URL을 입력해주세요.');
            return;
        }

        setSubmitting(true);
        try {
            const budgetLabel = BUDGET_OPTIONS.find(b => b.value === budget)?.label || '';
            const content = [
                `스토어명: ${storeName.trim()}`,
                `상품 URL: ${productUrl.trim()}`,
                `월 예산: ${budgetLabel}`,
                '',
                message.trim() || '(추가 문의 내용 없음)',
            ].join('\n');

            const res = await fetch('/api/inquiries', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    category: 'coupang',
                    title: `쿠팡 광고 견적 문의 - ${storeName.trim()}`,
                    content,
                }),
            });

            if (!res.ok) {
                const data = await res.json().catch(() => null);
                toast.error(data?.error || '문의 접수 중 오류가 발생했습니다.');
                return;
            }

            toast.success('견적 문의가 접수되었습니다. 담당자가 확인 후 연락드릴게요.');
            setStoreName('');
            setProductUrl('');
            setBudget(BUDGET_OPTIONS[0].value);
            setMessage('');
            fetchInquiries();
        } catch (error) {
            console.error('Error submitting coupang inquiry:', error);
            toast.error('문의 접수 중 오류가 발생했습니다.');
        } finally {
            setSubmitting(false);
        }
    };

    if (status === 'loading') {
        return <DashboardLayout><div className={styles.container}>로딩 중...</div></DashboardLayout>;
    }

    return (
        <DashboardLayout>
            <div className={styles.container}>
                {/* Hero */}
                <div className={styles.hero}>
                    <span className={styles.heroBadge}><Package size={14} />쿠팡 파트너</span>
                    <h1 className={styles.heroTitle}>쿠팡 노출 최적화,<br />전담 매니저가 설계해드립니다</h1>
                    <p className={styles.heroSubtitle}>상품 등록부터 광고 운영까지, 쿠팡 노출을 높이기 위한 맞춤 전략을 제안해드려요</p>

                    <div className={styles.featureGrid}>
                        {FEATURES.map((feature) => {
                            const Icon = feature.icon;
                            return (
                                <div key={feature.title} className={styles.featureCard}>
                                    <div className={styles.featureIcon}><Icon size={22} /></div>
                                    <h4>{feature.title}</h4>
                                    <p>{feature.desc}</p>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Inquiry Form */}
                <form className={styles.formCard} onSubmit={handleSubmit}>
                    <h2 className={styles.formTitle}>견적 문의하기</h2>
                    <div className={styles.formGrid}>
                        <div className={styles.formField}>
                            <label htmlFor="storeName">스토어명</label>
                            <input
                                id="storeName"
                                type="text"
                                placeholder="예: 혼잘마 스토어"
                                value={storeName}
                                onChange={(e) => setStoreName(e.target.value)}
                                required
                            />
                        </div>
                        <div className={styles.formField}>
                            <label htmlFor="productUrl">상품 URL</label>
                            <input
                                id="productUrl"
                                type="url"
                                placeholder="https://www.coupang.com/vp/products/..."
                                value={productUrl}
                                onChange={(e) => setProductUrl(e.target.value)}
                                required
                            />
                        </div>
                        <div className={styles.formField}>
                            <label htmlFor="budget">월 예산</label>
                            <select
                                id="budget"
                                value={budget}
                                onChange={(e) => setBudget(e.target.value)}
                            >
                                {BUDGET_OPTIONS.map((opt) => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                    <div className={styles.formField}>
                        <label htmlFor="message">문의 내용</label>
                        <textarea
                            id="message"
                            rows={4}
                            placeholder="현재 상황, 목표, 궁금한 점 등을 자유롭게 적어주세요."
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                        />
                    </div>
                    <button type="submit" className={styles.submitBtn} disabled={submitting}>
                        <Send size={16} />
                        {submitting ? '접수 중...' : '견적 문의하기'}
                    </button>
                </form>

                {/* My Inquiries */}
                <div className={styles.listSection}>
                    <h2 className={styles.listTitle}>내 문의 내역</h2>
                    {loading ? (
                        <div className={styles.emptyState}><p>로딩 중...</p></div>
                    ) : inquiries.length === 0 ? (
                        <div className={styles.emptyState}>
                            <MessageSquareText size={48} className={styles.emptyIcon} />
                            <h4>문의 내역이 없습니다.</h4>
                            <p>견적 문의를 남기면 담당자가 확인 후 답변해드려요.</p>
                        </div>
                    ) : (
                        <div className={styles.inquiryList}>
                            {inquiries.map((inquiry) => {
                                const isAnswered = inquiry.status === 'answered' || !!inquiry.answer;
                                return (
                                    <div key={inquiry.id} className={styles.inquiryCard}>
                                        <div className={styles.inquiryTop}>
                                            <div>
                                                <h3>{inquiry.title}</h3>
                                                <p>{formatDate(inquiry.createdAt)}</p>
                                            </div>
                                            <span className={`${styles.statusBadge} ${isAnswered ? styles.statusAnswered : styles.statusPending}`}>
                                                {isAnswered ? <CheckCircle2 size={13} /> : <Clock size={13} />}
                                                {isAnswered ? '답변완료' : '답변대기'}
                                            </span>
                                        </div>
                                        <p className={styles.inquiryContent}>{inquiry.content}</p>
                                        {isAnswered && (
                                            <div className={styles.answerBox}>
                                                <span className={styles.answerLabel}>담당자 답변</span>
                                                <p>{inquiry.answer}</p>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </DashboardLayout>
    );
}
