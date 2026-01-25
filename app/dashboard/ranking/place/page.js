'use client';

import { useState } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import styles from '../shopping/page.module.css';
import { TrendingUp, Plus, MapPin } from 'lucide-react';

export default function PlaceRankingPage() {
    const [isModalOpen, setIsModalOpen] = useState(false);

    return (
        <DashboardLayout>
            <div className={styles.container}>
                <div className={styles.header}>
                    <div className={styles.headerContent}>
                        <h1 className={styles.title}>플레이스 순위추적</h1>
                        <p className={styles.subtitle}>네이버 플레이스 업체의 순위 변화를 실시간으로 추적하세요</p>
                    </div>
                    <div className={styles.headerBadge}>
                        <span className={styles.badge}>무료 사용</span>
                    </div>
                </div>

                <div className={styles.actionBar}>
                    <button
                        className={styles.addBtn}
                        onClick={() => setIsModalOpen(true)}
                    >
                        <Plus size={18} />
                        플레이스 추가
                    </button>
                    <span className={styles.counter}>등록: 0/5건</span>
                </div>

                <div className={styles.emptyState}>
                    <MapPin size={48} className={styles.emptyIcon} />
                    <h4>추적 중인 플레이스가 없습니다.</h4>
                    <p>플레이스를 추가하여 순위 변화를 확인하세요.</p>
                    <button
                        className={styles.emptyBtn}
                        onClick={() => setIsModalOpen(true)}
                    >
                        <Plus size={18} />
                        플레이스 추가하기
                    </button>
                </div>

                {isModalOpen && (
                    <div className={styles.modalOverlay} onClick={() => setIsModalOpen(false)}>
                        <div className={styles.modal} onClick={e => e.stopPropagation()}>
                            <div className={styles.modalHeader}>
                                <h3>플레이스 링크 추가</h3>
                                <button onClick={() => setIsModalOpen(false)}>✕</button>
                            </div>
                            <div className={styles.modalBody}>
                                <label>플레이스 URL</label>
                                <input type="text" placeholder="네이버 플레이스 URL 입력" />
                                <label>추적 키워드</label>
                                <input type="text" placeholder="순위를 확인할 키워드 입력" />
                            </div>
                            <div className={styles.modalFooter}>
                                <button className={styles.cancelBtn} onClick={() => setIsModalOpen(false)}>취소</button>
                                <button className={styles.submitBtn}>추가</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </DashboardLayout>
    );
}
