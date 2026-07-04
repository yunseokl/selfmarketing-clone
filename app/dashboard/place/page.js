'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import CreatePlaceAdModal from '@/components/place/CreatePlaceAdModal';
import styles from './page.module.css';
import { Users, DollarSign, MapPin, Search, RefreshCw, Plus, Building2, X } from 'lucide-react';
import { toast } from 'sonner';

const PAGE_SIZE = 10;

const infoCards = [
    {
        icon: Users,
        title: '실제 유저 유입',
        description: '실제 사용자의 검색과 방문으로 플레이스 순위를 높여드립니다.',
        color: '#10B981'
    },
    {
        icon: DollarSign,
        title: '저렴한 광고비용',
        description: '대행사 없이 직접 운영하여 합리적인 비용으로 이용하세요.',
        color: '#2563EB'
    },
    {
        icon: MapPin,
        title: '지역 타겟팅',
        description: '원하는 지역의 고객에게 효과적으로 노출됩니다.',
        color: '#F59E0B'
    },
];

export default function PlacePage() {
    const [activeTab, setActiveTab] = useState('active');
    const [searchQuery, setSearchQuery] = useState('');
    const [ads, setAds] = useState([]);
    const [loading, setLoading] = useState(true);
    const [currentPage, setCurrentPage] = useState(1);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [tabCounts, setTabCounts] = useState({
        active: 0,
        expired: 0,
        refunded: 0,
        all: 0,
    });

    const fetchAds = useCallback(async () => {
        try {
            setLoading(true);
            const res = await fetch(`/api/place-ads?status=${activeTab}`);
            if (res.ok) {
                const data = await res.json();
                setAds(data.ads || []);
            } else {
                toast.error('광고 목록을 불러오는데 실패했습니다.');
            }
        } catch (error) {
            console.error('Error fetching ads:', error);
            toast.error('광고 목록을 불러오는데 실패했습니다.');
        } finally {
            setLoading(false);
        }
    }, [activeTab]);

    const fetchTabCounts = useCallback(async () => {
        try {
            const res = await fetch('/api/place-ads?status=all');
            if (res.ok) {
                const data = await res.json();
                const allAds = data.ads || [];
                setTabCounts({
                    active: allAds.filter(ad => ad.status === 'active').length,
                    expired: allAds.filter(ad => ad.status === 'expired' || ad.status === 'completed').length,
                    refunded: allAds.filter(ad => ad.status === 'refunded').length,
                    all: allAds.length,
                });
            }
        } catch (error) {
            console.error('Error fetching tab counts:', error);
        }
    }, []);

    useEffect(() => {
        fetchAds();
    }, [fetchAds]);

    useEffect(() => {
        fetchTabCounts();
    }, [fetchTabCounts]);

    const handleRefresh = () => {
        fetchAds();
        fetchTabCounts();
        toast.success('목록을 새로고침했습니다.');
    };

    const handleCancelAd = async (adId) => {
        if (!confirm('정말 이 광고를 취소하시겠습니까? 남은 기간에 대한 환불이 진행됩니다.')) {
            return;
        }
        try {
            const res = await fetch(`/api/place-ads/${adId}`, { method: 'DELETE' });
            const data = await res.json();
            if (res.ok) {
                toast.success(data.message);
                window.dispatchEvent(new Event('balance-refresh'));
                fetchAds();
                fetchTabCounts();
            } else {
                toast.error(data.error || '광고 취소에 실패했습니다.');
            }
        } catch (error) {
            console.error('Error canceling ad:', error);
            toast.error('광고 취소 중 오류가 발생했습니다.');
        }
    };

    const filteredAds = useMemo(() => ads.filter(ad =>
        ad.placeName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        ad.keyword?.toLowerCase().includes(searchQuery.toLowerCase())
    ), [ads, searchQuery]);

    const stats = useMemo(() => {
        const active = ads.filter(ad => ad.status === 'active').length;
        const totalGoal = ads.reduce((sum, ad) => sum + (ad.dailyGoal || 0), 0);
        const ranked = ads.filter(ad => typeof ad.currentRank === 'number');
        const avgRank = ranked.length
            ? Math.round(ranked.reduce((sum, ad) => sum + ad.currentRank, 0) / ranked.length)
            : null;
        return { active, totalGoal, avgRank };
    }, [ads]);

    const totalPages = Math.max(1, Math.ceil(filteredAds.length / PAGE_SIZE));
    const pagedAds = filteredAds.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

    useEffect(() => {
        setCurrentPage(1);
    }, [activeTab, searchQuery]);

    const tabs = [
        { id: 'active', label: '진행중', count: tabCounts.active },
        { id: 'expired', label: '만료됨', count: tabCounts.expired },
        { id: 'refunded', label: '환불됨', count: tabCounts.refunded },
        { id: 'all', label: '전체', count: tabCounts.all },
    ];

    return (
        <DashboardLayout>
            <div className={styles.container}>
                {/* Header */}
                <div className={styles.header}>
                    <div className={styles.headerContent}>
                        <h1 className={styles.title}>플레이스 광고</h1>
                        <p className={styles.subtitle}>지역 검색에서 상위 노출되어 더 많은 고객을 만나세요</p>
                    </div>
                    <button className={styles.createBtn} onClick={() => setIsModalOpen(true)}>
                        <Plus size={20} />
                        광고 시작하기
                    </button>
                </div>

                {/* Info Cards */}
                <div className={styles.infoCards}>
                    {infoCards.map((card, idx) => {
                        const Icon = card.icon;
                        return (
                            <div key={idx} className={styles.infoCard}>
                                <div
                                    className={styles.infoIcon}
                                    style={{ backgroundColor: `${card.color}15`, color: card.color }}
                                >
                                    <Icon size={28} />
                                </div>
                                <h3 className={styles.infoTitle}>{card.title}</h3>
                                <p className={styles.infoDesc}>{card.description}</p>
                            </div>
                        );
                    })}
                </div>

                {/* Summary Stats */}
                <div className={styles.statsBar}>
                    <div className={styles.statCell}>
                        <span className={styles.statLabel}>활성 광고</span>
                        <strong className={styles.statValue}>{stats.active}개</strong>
                    </div>
                    <div className={styles.statCell}>
                        <span className={styles.statLabel}>총 일 목표 유입</span>
                        <strong className={styles.statValue}>{stats.totalGoal.toLocaleString()}회</strong>
                    </div>
                    <div className={styles.statCell}>
                        <span className={styles.statLabel}>평균 순위</span>
                        <strong className={styles.statValue}>{stats.avgRank ? `${stats.avgRank}위` : '-'}</strong>
                    </div>
                </div>

                {/* Management Section */}
                <div className={styles.management}>
                    <div className={styles.tabs}>
                        {tabs.map((tab) => (
                            <button
                                key={tab.id}
                                className={`${styles.tab} ${activeTab === tab.id ? styles.active : ''}`}
                                onClick={() => setActiveTab(tab.id)}
                            >
                                {tab.label}
                                <span className={styles.tabCount}>{tab.count}</span>
                            </button>
                        ))}
                    </div>

                    <div className={styles.searchBar}>
                        <div className={styles.searchInput}>
                            <Search size={18} className={styles.searchIcon} />
                            <input
                                type="text"
                                placeholder="업체명, 키워드 검색..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>
                        <button className={styles.refreshBtn} onClick={handleRefresh}>
                            <RefreshCw size={18} />
                        </button>
                    </div>

                    {loading ? (
                        <div className={styles.emptyState}>
                            <RefreshCw size={48} className={`${styles.emptyIcon} ${styles.spinning}`} />
                            <h4>로딩 중...</h4>
                        </div>
                    ) : filteredAds.length === 0 ? (
                        <div className={styles.emptyState}>
                            <Building2 size={48} className={styles.emptyIcon} />
                            <h4>플레이스 광고가 없습니다.</h4>
                            <p>새 광고를 만들어 시작해보세요.</p>
                        </div>
                    ) : (
                        <div className={styles.adsList}>
                            {pagedAds.map((ad) => (
                                <div key={ad.id} className={styles.adCard}>
                                    <div className={styles.adInfo}>
                                        <h4 className={styles.adName}>{ad.placeName}</h4>
                                        <p className={styles.adKeyword}>키워드: {ad.keyword}</p>
                                        <p className={styles.adMeta}>
                                            일일 목표: {ad.dailyGoal}회 · 기간: {ad.duration}일
                                        </p>
                                        <p className={styles.adCost}>
                                            총 비용: {ad.totalCost?.toLocaleString()}원
                                        </p>
                                    </div>
                                    <div className={styles.adActions}>
                                        {typeof ad.currentRank === 'number' && (
                                            <span className={`${styles.rankBadge} ${ad.currentRank <= 10 ? styles.rankBadgeTop : ''}`}>
                                                {ad.currentRank}위
                                            </span>
                                        )}
                                        <span className={`${styles.statusBadge} ${styles[ad.status]}`}>
                                            {ad.status === 'active' ? '진행중' :
                                             ad.status === 'refunded' ? '환불됨' :
                                             ad.status === 'completed' ? '완료' : '만료됨'}
                                        </span>
                                        {ad.status === 'active' && (
                                            <button
                                                className={styles.cancelBtn}
                                                onClick={() => handleCancelAd(ad.id)}
                                            >
                                                <X size={16} />
                                                취소
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {filteredAds.length > 0 && (
                        <div className={styles.pagination}>
                            <button
                                className={styles.pageBtn}
                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                disabled={currentPage === 1}
                            >
                                ◀
                            </button>
                            {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                                <button
                                    key={page}
                                    className={page === currentPage ? styles.pageNum : styles.pageBtn}
                                    onClick={() => setCurrentPage(page)}
                                >
                                    {page}
                                </button>
                            ))}
                            <button
                                className={styles.pageBtn}
                                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                disabled={currentPage === totalPages}
                            >
                                ▶
                            </button>
                        </div>
                    )}
                </div>
            </div>

            <CreatePlaceAdModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSuccess={() => {
                    setIsModalOpen(false);
                    fetchAds();
                    fetchTabCounts();
                }}
            />
        </DashboardLayout>
    );
}
