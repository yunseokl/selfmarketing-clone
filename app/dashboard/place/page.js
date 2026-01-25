'use client';

import { useState } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import styles from '../shopping/page.module.css';
import { Users, DollarSign, MapPin, Search, RefreshCw, Plus, Building2 } from 'lucide-react';

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

const tabs = [
    { id: 'active', label: '진행중', count: 0 },
    { id: 'expired', label: '만료됨', count: 0 },
    { id: 'refunded', label: '환불됨', count: 0 },
    { id: 'all', label: '전체', count: 0 },
];

export default function PlacePage() {
    const [activeTab, setActiveTab] = useState('active');
    const [searchQuery, setSearchQuery] = useState('');
    const [ads, setAds] = useState([]);

    return (
        <DashboardLayout>
            <div className={styles.container}>
                {/* Header */}
                <div className={styles.header}>
                    <div className={styles.headerContent}>
                        <h1 className={styles.title}>플레이스 광고</h1>
                        <p className={styles.subtitle}>지역 검색에서 상위 노출되어 더 많은 고객을 만나세요</p>
                    </div>
                    <button className={styles.createBtn}>
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
                        <button className={styles.refreshBtn}>
                            <RefreshCw size={18} />
                        </button>
                    </div>

                    <div className={styles.emptyState}>
                        <Building2 size={48} className={styles.emptyIcon} />
                        <h4>플레이스 광고가 없습니다.</h4>
                        <p>새 광고를 만들어 시작해보세요.</p>
                    </div>

                    <div className={styles.pagination}>
                        <button className={styles.pageBtn} disabled>◀</button>
                        <span className={styles.pageNum}>1</span>
                        <button className={styles.pageBtn} disabled>▶</button>
                    </div>
                </div>
            </div>
        </DashboardLayout>
    );
}
