'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/layout/DashboardLayout';
import CreateAdModal from '@/components/shopping/CreateAdModal';
import styles from './page.module.css';
import { Users, DollarSign, Link2, Search, RefreshCw, Plus, Package, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

const infoCards = [
    {
        icon: Users,
        title: '실제 유저 유입',
        description: '유저의 자발적 클릭을 통해 자연스럽게 검색 결과를 올립니다.',
        color: '#2563EB'
    },
    {
        icon: DollarSign,
        title: '저렴한 광고비용',
        description: '대행사 거품 없이 개발사 직영가로, 필요한 만큼만 결제하세요.',
        color: '#10B981'
    },
    {
        icon: Link2,
        title: '대형 매체 연동',
        description: '국내 500+ 매체 네트워크를 통해 고효율 트래픽을 안정적으로 공급합니다.',
        color: '#8B5CF6'
    },
];

const PAGE_SIZE = 10;

const tabs = [
    { id: 'active', label: '진행중' },
    { id: 'expired', label: '만료됨' },
    { id: 'refunded', label: '환불됨' },
    { id: 'all', label: '전체' },
];

const tableColumns = [
    '썸네일',
    '상품명',
    '키워드',
    '일 유입',
    '광고기간',
    '순위',
    '상태',
    '작업',
];

export default function ShoppingPage() {
    const { data: session, status } = useSession();
    const router = useRouter();
    const [activeTab, setActiveTab] = useState('active');
    const [searchQuery, setSearchQuery] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [ads, setAds] = useState([]);
    const [loading, setLoading] = useState(true);
    const [currentPage, setCurrentPage] = useState(1);
    const [tabCounts, setTabCounts] = useState({ active: 0, expired: 0, refunded: 0, all: 0 });

    const fetchAds = useCallback(async () => {
        try {
            setLoading(true);
            const res = await fetch(`/api/shopping-ads?status=${activeTab}`);
            if (res.ok) {
                const data = await res.json();
                setAds(data.ads || []);
            }
        } catch (error) {
            console.error('Error fetching ads:', error);
        } finally {
            setLoading(false);
        }
    }, [activeTab]);

    const fetchTabCounts = useCallback(async () => {
        try {
            const res = await fetch('/api/shopping-ads?status=all');
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
        if (status === 'unauthenticated') {
            router.push('/login');
        } else if (status === 'authenticated') {
            fetchAds();
            fetchTabCounts();
        }
    }, [fetchAds, fetchTabCounts, router, status]);

    const handleRefresh = () => {
        fetchAds();
    };

    const handleDelete = async (id) => {
        if (!confirm('정말 이 광고를 취소하시겠습니까? 남은 기간에 대해 환불됩니다.')) return;

        try {
            const res = await fetch(`/api/shopping-ads/${id}`, { method: 'DELETE' });
            const data = await res.json();
            if (res.ok) {
                toast.success(data.message);
                window.dispatchEvent(new Event('balance-refresh'));
                fetchAds();
                fetchTabCounts();
            } else {
                toast.error(data.error);
            }
        } catch (error) {
            console.error('Error deleting ad:', error);
            toast.error('광고 삭제 중 오류가 발생했습니다.');
        }
    };

    const handleAdCreated = () => {
        setIsModalOpen(false);
        fetchAds();
        fetchTabCounts();
    };

    const getStatusBadge = (status) => {
        const styles = {
            active: { bg: 'rgba(16, 185, 129, 0.1)', color: '#10B981', text: '진행중' },
            expired: { bg: 'rgba(107, 114, 128, 0.1)', color: '#6B7280', text: '만료됨' },
            refunded: { bg: 'rgba(239, 68, 68, 0.1)', color: '#EF4444', text: '환불됨' },
        };
        const s = styles[status] || styles.active;
        return (
            <span style={{
                backgroundColor: s.bg,
                color: s.color,
                padding: '4px 10px',
                borderRadius: '4px',
                fontSize: '12px',
                fontWeight: 500
            }}>
                {s.text}
            </span>
        );
    };

    const formatDate = (dateStr) => {
        const date = new Date(dateStr);
        return date.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' });
    };

    const filteredAds = useMemo(() => ads.filter(ad =>
        !searchQuery ||
        ad.productName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
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

    if (status === 'loading') {
        return <DashboardLayout><div className={styles.container}>로딩 중...</div></DashboardLayout>;
    }

    return (
        <DashboardLayout>
            <div className={styles.container}>
                {/* Header */}
                <div className={styles.header}>
                    <div className={styles.headerContent}>
                        <h1 className={styles.title}>쇼핑 광고</h1>
                        <p className={styles.subtitle}>유입 점수를 높여 상위 노출에 도움을 드려요</p>
                    </div>
                    <button
                        className={styles.createBtn}
                        onClick={() => setIsModalOpen(true)}
                    >
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
                        <strong className={styles.statValue}>{stats.totalGoal.toLocaleString()}건</strong>
                    </div>
                    <div className={styles.statCell}>
                        <span className={styles.statLabel}>평균 순위</span>
                        <strong className={styles.statValue}>{stats.avgRank ? `${stats.avgRank}위` : '-'}</strong>
                    </div>
                </div>

                {/* Management Section */}
                <div className={styles.management}>
                    {/* Tabs */}
                    <div className={styles.tabs}>
                        {tabs.map((tab) => (
                            <button
                                key={tab.id}
                                className={`${styles.tab} ${activeTab === tab.id ? styles.active : ''}`}
                                onClick={() => setActiveTab(tab.id)}
                            >
                                {tab.label}
                                <span className={styles.tabCount}>{tabCounts[tab.id]}</span>
                            </button>
                        ))}
                    </div>

                    {/* Search Bar */}
                    <div className={styles.searchBar}>
                        <div className={styles.searchInput}>
                            <Search size={18} className={styles.searchIcon} />
                            <input
                                type="text"
                                placeholder="상품명, 키워드 검색..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>
                        <button className={styles.refreshBtn} onClick={handleRefresh}>
                            <RefreshCw size={18} />
                        </button>
                    </div>

                    {/* Table */}
                    <div className={styles.tableContainer}>
                        <table className={styles.table}>
                            <thead>
                                <tr>
                                    {tableColumns.map((col, idx) => (
                                        <th key={idx}>{col}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    <tr>
                                        <td colSpan={tableColumns.length}>
                                            <div className={styles.emptyState}>
                                                <p>로딩 중...</p>
                                            </div>
                                        </td>
                                    </tr>
                                ) : filteredAds.length === 0 ? (
                                    <tr>
                                        <td colSpan={tableColumns.length}>
                                            <div className={styles.emptyState}>
                                                <Package size={48} className={styles.emptyIcon} />
                                                <h4>쇼핑 광고가 없습니다.</h4>
                                                <p>새 광고를 만들어 시작해보세요.</p>
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                    pagedAds.map((ad) => (
                                        <tr key={ad.id}>
                                            <td>
                                                <div className={styles.thumbnail}>
                                                    {ad.productImage ? (
                                                        // 사용자가 입력한 외부 이미지라 도메인을 미리 고정할 수 없어 기본 img를 씁니다.
                                                        // eslint-disable-next-line @next/next/no-img-element
                                                        <img src={ad.productImage} alt="" />
                                                    ) : (
                                                        <Package size={24} />
                                                    )}
                                                </div>
                                            </td>
                                            <td>{ad.productName}</td>
                                            <td>{ad.keyword}</td>
                                            <td>{ad.dailyGoal}건</td>
                                            <td>{formatDate(ad.startDate)} ~ {formatDate(ad.endDate)}</td>
                                            <td>
                                                {ad.currentRank ? (
                                                    <span className={`${styles.rankBadge} ${ad.currentRank <= 10 ? styles.rankBadgeTop : ''}`}>
                                                        {ad.currentRank}위
                                                    </span>
                                                ) : '-'}
                                            </td>
                                            <td>{getStatusBadge(ad.status)}</td>
                                            <td>
                                                {ad.status === 'active' && (
                                                    <button
                                                        className={styles.deleteBtn}
                                                        onClick={() => handleDelete(ad.id)}
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination */}
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

            {/* Create Ad Modal */}
            <CreateAdModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSuccess={handleAdCreated}
            />
        </DashboardLayout>
    );
}
