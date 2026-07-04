'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/layout/DashboardLayout';
import styles from './page.module.css';
import {
    BadgePercent, Check, Globe, Image as ImageIcon, Link2,
    MessageCircle, RefreshCw, Search, ShoppingBag, Users, Wallet,
} from 'lucide-react';
import { toast } from 'sonner';

const MEDIA_OPTIONS = [
    { value: 'naver_sa', label: '네이버 검색광고', icon: Search },
    { value: 'naver_gfa', label: '네이버 GFA', icon: ImageIcon },
    { value: 'kakao', label: '카카오모먼트', icon: MessageCircle },
    { value: 'google', label: '구글 애즈', icon: Globe },
    { value: 'meta', label: '메타', icon: Users },
    { value: 'coupang', label: '쿠팡', icon: ShoppingBag },
];

const STAGES = [
    { key: 'pending', label: '신청됨' },
    { key: 'reviewing', label: '검토중' },
    { key: 'approved', label: '승인' },
    { key: 'paid', label: '지급' },
];

const HOW_IT_WORKS = [
    { icon: Link2, title: '계정 연결 신청', desc: '환급받을 광고 매체와 계정 정보를 입력해요' },
    { icon: RefreshCw, title: '담당자 검토·연결', desc: '담당자가 계정을 확인하고 연동을 진행해요' },
    { icon: Wallet, title: '매월 환급', desc: '집행한 광고비의 10%를 매달 돌려받아요' },
];

function getMediaMeta(value) {
    return MEDIA_OPTIONS.find(m => m.value === value) || MEDIA_OPTIONS[0];
}

function formatDate(dateStr) {
    return new Date(dateStr).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export default function RefundPage() {
    const { data: session, status } = useSession();
    const router = useRouter();

    const [selectedMedia, setSelectedMedia] = useState('naver_sa');
    const [monthlySpend, setMonthlySpend] = useState('');
    const [accountId, setAccountId] = useState('');
    const [contact, setContact] = useState('');
    const [memo, setMemo] = useState('');
    const [requests, setRequests] = useState([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);

    const fetchRequests = useCallback(async () => {
        try {
            setLoading(true);
            const res = await fetch('/api/refund-requests');
            if (res.ok) {
                const data = await res.json();
                setRequests(data.requests || []);
            }
        } catch (error) {
            console.error('Error fetching refund requests:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (status === 'unauthenticated') {
            router.push('/login');
        } else if (status === 'authenticated') {
            fetchRequests();
        }
    }, [fetchRequests, router, status]);

    const spendNumber = Number(monthlySpend) || 0;
    const expectedMonthly = useMemo(() => Math.round(spendNumber * 0.1), [spendNumber]);
    const expectedYearly = expectedMonthly * 12;

    const handleSubmit = async (event) => {
        event.preventDefault();

        if (spendNumber < 100000) {
            toast.error('월 광고비는 최소 100,000원 이상이어야 합니다.');
            return;
        }
        if (!accountId.trim() || !contact.trim()) {
            toast.error('광고 계정 ID와 연락처를 입력해주세요.');
            return;
        }

        setSubmitting(true);
        try {
            const res = await fetch('/api/refund-requests', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mediaType: selectedMedia,
                    accountId: accountId.trim(),
                    monthlySpend: spendNumber,
                    contact: contact.trim(),
                    memo: memo.trim() || undefined,
                }),
            });
            const data = await res.json();

            if (!res.ok) {
                toast.error(data.error || '신청 중 오류가 발생했습니다.');
                return;
            }

            toast.success(data.message);
            setMonthlySpend('');
            setAccountId('');
            setContact('');
            setMemo('');
            fetchRequests();
        } catch (error) {
            console.error('Error creating refund request:', error);
            toast.error('신청 중 오류가 발생했습니다.');
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
                    <span className={styles.heroBadge}><BadgePercent size={14} />광고비 10% 환급</span>
                    <h1 className={styles.heroTitle}>이미 집행 중인 광고비,<br />매달 10%를 돌려받으세요</h1>
                    <p className={styles.heroSubtitle}>네이버, 카카오, 구글, 메타, 쿠팡 광고 계정을 연결하면 매달 광고비의 10%를 환급해드려요</p>

                    <div className={styles.stepsRow}>
                        {HOW_IT_WORKS.map((step, idx) => {
                            const Icon = step.icon;
                            return (
                                <div key={step.title} className={styles.stepCard}>
                                    <div className={styles.stepNumber}>{idx + 1}</div>
                                    <Icon size={22} className={styles.stepIcon} />
                                    <h4>{step.title}</h4>
                                    <p>{step.desc}</p>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Application Form */}
                <form className={styles.formCard} onSubmit={handleSubmit}>
                    <h2 className={styles.formTitle}>환급 신청하기</h2>

                    <label className={styles.groupLabel}>광고 매체 선택</label>
                    <div className={styles.mediaGrid}>
                        {MEDIA_OPTIONS.map((media) => {
                            const Icon = media.icon;
                            const selected = selectedMedia === media.value;
                            return (
                                <button
                                    key={media.value}
                                    type="button"
                                    className={`${styles.mediaCard} ${selected ? styles.mediaSelected : ''}`}
                                    onClick={() => setSelectedMedia(media.value)}
                                >
                                    <Icon size={20} />
                                    <span>{media.label}</span>
                                </button>
                            );
                        })}
                    </div>

                    <div className={styles.formGrid}>
                        <div className={styles.formField}>
                            <label htmlFor="monthlySpend">월 광고비</label>
                            <input
                                id="monthlySpend"
                                type="number"
                                min={0}
                                placeholder="예: 1000000"
                                value={monthlySpend}
                                onChange={(e) => setMonthlySpend(e.target.value)}
                                required
                            />
                        </div>
                        <div className={styles.formField}>
                            <label htmlFor="accountId">광고 계정 ID (이메일/CID)</label>
                            <input
                                id="accountId"
                                type="text"
                                placeholder="예: ad-account@company.com"
                                value={accountId}
                                onChange={(e) => setAccountId(e.target.value)}
                                required
                            />
                        </div>
                        <div className={styles.formField}>
                            <label htmlFor="contact">연락처</label>
                            <input
                                id="contact"
                                type="text"
                                placeholder="예: 010-1234-5678"
                                value={contact}
                                onChange={(e) => setContact(e.target.value)}
                                required
                            />
                        </div>
                    </div>

                    <div className={styles.formField}>
                        <label htmlFor="memo">메모 (선택)</label>
                        <textarea
                            id="memo"
                            rows={2}
                            placeholder="담당자에게 전달할 내용이 있다면 적어주세요."
                            value={memo}
                            onChange={(e) => setMemo(e.target.value)}
                        />
                    </div>

                    <div className={styles.calcRow}>
                        <div className={styles.calcBox}>
                            <span>예상 월 환급액</span>
                            <strong>{expectedMonthly.toLocaleString()}원</strong>
                        </div>
                        <div className={styles.calcBox}>
                            <span>예상 연 환급액</span>
                            <strong className={styles.calcAccent}>{expectedYearly.toLocaleString()}원</strong>
                        </div>
                    </div>

                    <button type="submit" className={styles.submitBtn} disabled={submitting}>
                        {submitting ? '신청 중...' : '환급 신청하기'}
                    </button>
                </form>

                {/* My Requests */}
                <div className={styles.listSection}>
                    <h2 className={styles.listTitle}>내 신청 내역</h2>
                    {loading ? (
                        <div className={styles.emptyState}><p>로딩 중...</p></div>
                    ) : requests.length === 0 ? (
                        <div className={styles.emptyState}>
                            <BadgePercent size={48} className={styles.emptyIcon} />
                            <h4>신청한 환급 내역이 없습니다.</h4>
                            <p>광고 매체를 선택하고 환급을 신청해보세요.</p>
                        </div>
                    ) : (
                        <div className={styles.requestList}>
                            {requests.map((req) => {
                                const media = getMediaMeta(req.mediaType);
                                const MediaIcon = media.icon;
                                const currentIndex = STAGES.findIndex(s => s.key === req.status);
                                const isRejected = req.status === 'rejected';

                                return (
                                    <div key={req.id} className={styles.requestCard}>
                                        <div className={styles.requestTop}>
                                            <div className={styles.requestMedia}>
                                                <MediaIcon size={18} />
                                                <div>
                                                    <h3>{media.label}</h3>
                                                    <p>{formatDate(req.createdAt)}</p>
                                                </div>
                                            </div>
                                            <div className={styles.requestAmounts}>
                                                <span>월 광고비 {req.monthlySpend.toLocaleString()}원</span>
                                                <strong>예상 환급 {(req.expectedRefund || 0).toLocaleString()}원</strong>
                                            </div>
                                        </div>

                                        {isRejected ? (
                                            <div className={styles.rejectedBox}>
                                                <span className={styles.rejectedBadge}>거절됨</span>
                                                <p>{req.adminMemo || '거절 사유가 등록되지 않았습니다. 문의를 통해 확인해주세요.'}</p>
                                            </div>
                                        ) : (
                                            <div className={styles.timeline}>
                                                {STAGES.map((stage, idx) => (
                                                    <Fragment key={stage.key}>
                                                        <div className={styles.timelineNode}>
                                                            <div className={`${styles.timelineDot} ${idx <= currentIndex ? styles.dotActive : ''}`}>
                                                                {idx < currentIndex ? <Check size={12} /> : idx + 1}
                                                            </div>
                                                            <span className={idx <= currentIndex ? styles.timelineLabelActive : styles.timelineLabel}>
                                                                {stage.label}
                                                            </span>
                                                        </div>
                                                        {idx < STAGES.length - 1 && (
                                                            <div className={`${styles.timelineConnector} ${idx < currentIndex ? styles.connectorActive : ''}`} />
                                                        )}
                                                    </Fragment>
                                                ))}
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
