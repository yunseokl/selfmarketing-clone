'use client';

import { useState, useEffect, useCallback } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import styles from './page.module.css';
import { Pin, Megaphone, Search, ChevronDown, Eye } from 'lucide-react';

const categoryInfo = {
    notice: { label: '공지', className: 'catNotice' },
    update: { label: '업데이트', className: 'catUpdate' },
    event: { label: '이벤트', className: 'catEvent' },
};

export default function NoticePage() {
    const [notices, setNotices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [openId, setOpenId] = useState(null);
    const [viewedIds, setViewedIds] = useState(new Set());

    const fetchNotices = useCallback(async () => {
        try {
            setLoading(true);
            const res = await fetch('/api/notices');
            if (res.ok) {
                const data = await res.json();
                setNotices(data.notices || []);
            }
        } catch (error) {
            console.error('Error fetching notices:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchNotices();
    }, [fetchNotices]);

    const handleToggle = async (notice) => {
        const nextOpen = openId === notice.id ? null : notice.id;
        setOpenId(nextOpen);

        if (nextOpen && !viewedIds.has(notice.id)) {
            setViewedIds((prev) => new Set(prev).add(notice.id));
            setNotices((prev) => prev.map((n) => (n.id === notice.id ? { ...n, views: n.views + 1 } : n)));
            try {
                await fetch(`/api/notices/${notice.id}/view`, { method: 'POST' });
            } catch (error) {
                console.error('Error updating notice views:', error);
            }
        }
    };

    const formatDate = (dateStr) => {
        const date = new Date(dateStr);
        return date.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
    };

    const filteredNotices = notices.filter((n) =>
        !searchQuery || n.title.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <DashboardLayout>
            <div className={styles.container}>
                {/* Header */}
                <div className={styles.header}>
                    <h1 className={styles.title}>공지사항</h1>
                    <p className={styles.subtitle}>혼잘마의 새로운 소식을 확인하세요</p>
                </div>

                {/* Search */}
                <div className={styles.searchBar}>
                    <Search size={18} className={styles.searchIcon} />
                    <input
                        type="text"
                        placeholder="제목으로 검색..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>

                {/* List */}
                <div className={styles.list}>
                    {loading ? (
                        <div className={styles.emptyState}>
                            <p>로딩 중...</p>
                        </div>
                    ) : filteredNotices.length === 0 ? (
                        <div className={styles.emptyState}>
                            <Megaphone size={40} className={styles.emptyIcon} />
                            <h4>{searchQuery ? '검색 결과가 없습니다.' : '등록된 공지사항이 없습니다.'}</h4>
                        </div>
                    ) : (
                        filteredNotices.map((notice) => {
                            const cat = categoryInfo[notice.category] || categoryInfo.notice;
                            const isOpen = openId === notice.id;
                            return (
                                <div key={notice.id} className={`${styles.item} ${notice.isPinned ? styles.pinned : ''}`}>
                                    <button className={styles.itemHeader} onClick={() => handleToggle(notice)}>
                                        {notice.isPinned && <Pin size={14} className={styles.pinIcon} />}
                                        <span className={`${styles.categoryBadge} ${styles[cat.className]}`}>{cat.label}</span>
                                        <span className={styles.itemTitle}>{notice.title}</span>
                                        <span className={styles.itemMeta}>
                                            <span className={styles.metaItem}>
                                                <Eye size={13} />
                                                {notice.views}
                                            </span>
                                            <span className={styles.metaItem}>{formatDate(notice.createdAt)}</span>
                                        </span>
                                        <ChevronDown size={18} className={`${styles.chevron} ${isOpen ? styles.open : ''}`} />
                                    </button>
                                    {isOpen && (
                                        <div className={styles.itemBody}>
                                            {notice.content}
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        </DashboardLayout>
    );
}
