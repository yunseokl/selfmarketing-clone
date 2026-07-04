'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/layout/DashboardLayout';
import styles from './page.module.css';
import { Check, ExternalLink, FileText, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

const PACKAGES = [
    { id: 'basic', postCount: 5, price: 150000, label: '베이직' },
    { id: 'standard', postCount: 10, price: 280000, label: '스탠다드', discount: 6, popular: true },
    { id: 'pro', postCount: 20, price: 520000, label: '프로', discount: 13 },
];

const STATUS_META = {
    pending: { text: '접수됨', className: 'statusPending' },
    in_progress: { text: '진행중', className: 'statusProgress' },
    completed: { text: '완료', className: 'statusCompleted' },
    cancelled: { text: '취소됨', className: 'statusCancelled' },
};

function parseLinks(json) {
    if (!json) return [];
    try {
        const parsed = JSON.parse(json);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function formatDate(dateStr) {
    return new Date(dateStr).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export default function BlogPage() {
    const { data: session, status } = useSession();
    const router = useRouter();

    const [selectedPackage, setSelectedPackage] = useState('standard');
    const [formData, setFormData] = useState({ placeName: '', placeUrl: '', keyword: '', requirement: '' });
    const [balance, setBalance] = useState(null);
    const [campaigns, setCampaigns] = useState([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);

    const fetchData = useCallback(async () => {
        try {
            setLoading(true);
            const [userRes, campaignsRes] = await Promise.all([
                fetch('/api/user'),
                fetch('/api/blog-campaigns'),
            ]);
            if (userRes.ok) {
                const userData = await userRes.json();
                setBalance(userData.user?.balance ?? 0);
            }
            if (campaignsRes.ok) {
                const campaignsData = await campaignsRes.json();
                setCampaigns(campaignsData.campaigns || []);
            }
        } catch (error) {
            console.error('Error fetching blog data:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (status === 'unauthenticated') {
            router.push('/login');
        } else if (status === 'authenticated') {
            fetchData();
        }
    }, [fetchData, router, status]);

    const currentPackage = PACKAGES.find(pkg => pkg.id === selectedPackage) || PACKAGES[0];

    const handleSubmit = async (event) => {
        event.preventDefault();

        if (!formData.placeName.trim() || !formData.placeUrl.trim() || !formData.keyword.trim()) {
            toast.error('업체명, 플레이스 URL, 대표 키워드를 입력해주세요.');
            return;
        }

        if (balance !== null && balance < currentPackage.price) {
            toast.error('잔액이 부족합니다. 충전 후 다시 신청해주세요.', {
                action: { label: '충전하러 가기', onClick: () => router.push('/dashboard/charge') },
            });
            return;
        }

        setSubmitting(true);
        try {
            const res = await fetch('/api/blog-campaigns', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    placeName: formData.placeName.trim(),
                    placeUrl: formData.placeUrl.trim(),
                    keyword: formData.keyword.trim(),
                    postCount: currentPackage.postCount,
                    requirement: formData.requirement.trim() || undefined,
                }),
            });
            const data = await res.json();

            if (!res.ok) {
                if (data.error === '잔액이 부족합니다.') {
                    toast.error(data.error, {
                        action: { label: '충전하러 가기', onClick: () => router.push('/dashboard/charge') },
                    });
                } else {
                    toast.error(data.error || '신청 중 오류가 발생했습니다.');
                }
                return;
            }

            toast.success(data.message);
            window.dispatchEvent(new Event('balance-refresh'));
            setFormData({ placeName: '', placeUrl: '', keyword: '', requirement: '' });
            fetchData();
        } catch (error) {
            console.error('Error creating blog campaign:', error);
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
                <div className={styles.header}>
                    <div className={styles.headerContent}>
                        <h1 className={styles.title}>플레이스 블로그 배포</h1>
                        <p className={styles.subtitle}>플레이스 홍보를 위한 블로그 포스팅을 전문 작가가 대신 작성·배포해드립니다</p>
                    </div>
                    {balance !== null && (
                        <div className={styles.balanceBox}>
                            <span>보유 잔액</span>
                            <strong>{balance.toLocaleString()}원</strong>
                        </div>
                    )}
                </div>

                {/* Package Cards */}
                <div className={styles.packageGrid}>
                    {PACKAGES.map((pkg) => (
                        <button
                            key={pkg.id}
                            type="button"
                            className={`${styles.packageCard} ${selectedPackage === pkg.id ? styles.packageSelected : ''}`}
                            onClick={() => setSelectedPackage(pkg.id)}
                        >
                            {pkg.popular && <span className={styles.popularBadge}><Sparkles size={12} />인기</span>}
                            <div className={styles.packageCheck}>
                                {selectedPackage === pkg.id && <Check size={14} />}
                            </div>
                            <h3>{pkg.label}</h3>
                            <p className={styles.packageCount}>{pkg.postCount}건 발행</p>
                            <p className={styles.packagePrice}>{pkg.price.toLocaleString()}원</p>
                            {pkg.discount ? (
                                <span className={styles.packageDiscount}>{pkg.discount}% 할인</span>
                            ) : (
                                <span className={styles.packageDiscount}>&nbsp;</span>
                            )}
                            <p className={styles.packagePerUnit}>건당 {Math.round(pkg.price / pkg.postCount).toLocaleString()}원</p>
                        </button>
                    ))}
                </div>

                {/* Application Form */}
                <form className={styles.formCard} onSubmit={handleSubmit}>
                    <h2 className={styles.formTitle}>신청 정보 입력</h2>
                    <div className={styles.formGrid}>
                        <div className={styles.formField}>
                            <label htmlFor="placeName">업체명</label>
                            <input
                                id="placeName"
                                type="text"
                                placeholder="예: 혼잘마 카페"
                                value={formData.placeName}
                                onChange={(e) => setFormData(prev => ({ ...prev, placeName: e.target.value }))}
                                required
                            />
                        </div>
                        <div className={styles.formField}>
                            <label htmlFor="placeUrl">플레이스 URL</label>
                            <input
                                id="placeUrl"
                                type="url"
                                placeholder="https://naver.me/..."
                                value={formData.placeUrl}
                                onChange={(e) => setFormData(prev => ({ ...prev, placeUrl: e.target.value }))}
                                required
                            />
                        </div>
                        <div className={styles.formField}>
                            <label htmlFor="keyword">대표 키워드</label>
                            <input
                                id="keyword"
                                type="text"
                                placeholder="예: 강남 카페 추천"
                                value={formData.keyword}
                                onChange={(e) => setFormData(prev => ({ ...prev, keyword: e.target.value }))}
                                required
                            />
                        </div>
                    </div>
                    <div className={styles.formField}>
                        <label htmlFor="requirement">원고 요청사항 (선택)</label>
                        <textarea
                            id="requirement"
                            rows={3}
                            placeholder="포함하고 싶은 내용, 강조하고 싶은 특징 등을 자유롭게 적어주세요."
                            value={formData.requirement}
                            onChange={(e) => setFormData(prev => ({ ...prev, requirement: e.target.value }))}
                        />
                    </div>
                    <div className={styles.formFooter}>
                        <p className={styles.formTotal}>
                            선택한 패키지 <strong>{currentPackage.label} ({currentPackage.postCount}건)</strong> · 결제 금액
                            <strong className={styles.formTotalPrice}> {currentPackage.price.toLocaleString()}원</strong>
                        </p>
                        <button type="submit" className={styles.submitBtn} disabled={submitting}>
                            {submitting ? '신청 중...' : '블로그 배포 신청하기'}
                        </button>
                    </div>
                </form>

                {/* My Campaigns */}
                <div className={styles.listSection}>
                    <h2 className={styles.listTitle}>내 캠페인</h2>
                    {loading ? (
                        <div className={styles.emptyState}><p>로딩 중...</p></div>
                    ) : campaigns.length === 0 ? (
                        <div className={styles.emptyState}>
                            <FileText size={48} className={styles.emptyIcon} />
                            <h4>배포된 블로그가 없습니다.</h4>
                            <p>패키지를 선택하고 블로그 포스팅을 신청해보세요.</p>
                        </div>
                    ) : (
                        <div className={styles.campaignGrid}>
                            {campaigns.map((campaign) => {
                                const meta = STATUS_META[campaign.status] || STATUS_META.pending;
                                const links = parseLinks(campaign.publishedLinks);
                                const progress = Math.min(100, Math.round((campaign.publishedCount / campaign.postCount) * 100));

                                return (
                                    <div key={campaign.id} className={styles.campaignCard}>
                                        <div className={styles.campaignTop}>
                                            <div>
                                                <h3>{campaign.placeName}</h3>
                                                <p>{campaign.keyword}</p>
                                            </div>
                                            <span className={`${styles.statusBadge} ${styles[meta.className]}`}>{meta.text}</span>
                                        </div>

                                        <div className={styles.progressRow}>
                                            <div className={styles.progressBar}>
                                                <div className={styles.progressFill} style={{ width: `${progress}%` }} />
                                            </div>
                                            <span>{campaign.publishedCount}/{campaign.postCount}건</span>
                                        </div>

                                        {links.length > 0 && (
                                            <div className={styles.linkList}>
                                                {links.map((link, idx) => (
                                                    <a key={idx} href={link} target="_blank" rel="noopener noreferrer">
                                                        <ExternalLink size={13} />
                                                        발행글 {idx + 1}
                                                    </a>
                                                ))}
                                            </div>
                                        )}

                                        <div className={styles.campaignFooter}>
                                            <span>{campaign.postCount}건 · {campaign.totalCost.toLocaleString()}원</span>
                                            <span>{formatDate(campaign.createdAt)}</span>
                                        </div>
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
