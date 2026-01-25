'use client';

import { useState } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import styles from '@/styles/glass-feature.module.css';
import { Search, Plus, BarChart2 } from 'lucide-react';

export default function SeoPage() {
    const [isModalOpen, setIsModalOpen] = useState(false);

    return (
        <DashboardLayout>
            <div className={styles.container}>
                <div className={styles.header}>
                    <div className={styles.headerContent}>
                        <h1 className={styles.title}>쇼핑 SEO 분석</h1>
                        <p className={styles.subtitle}>상품의 SEO 점수를 분석하고 개선점을 확인하세요</p>
                    </div>
                </div>

                <div className={styles.actionBar}>
                    <button
                        className={styles.addBtn}
                        onClick={() => setIsModalOpen(true)}
                    >
                        <Plus size={18} />
                        상품 분석하기
                    </button>
                </div>

                <div className={styles.emptyState}>
                    <BarChart2 size={48} className={styles.emptyIcon} />
                    <h4>분석된 상품이 없습니다.</h4>
                    <p>상품 URL을 입력하여 SEO 점수를 확인하세요.</p>
                    <button
                        className={styles.emptyBtn}
                        onClick={() => setIsModalOpen(true)}
                    >
                        <Search size={18} />
                        상품 분석 시작하기
                    </button>
                </div>

                {isModalOpen && (
                    <div className={styles.modalOverlay} onClick={() => setIsModalOpen(false)}>
                        <div className={styles.modal} onClick={e => e.stopPropagation()}>
                            <div className={styles.modalHeader}>
                                <h3>쇼핑 SEO 분석</h3>
                                <button onClick={() => setIsModalOpen(false)}>✕</button>
                            </div>
                            <div className={styles.modalBody}>
                                <label>상품 URL</label>
                                <input type="text" placeholder="네이버 쇼핑 상품 URL 입력" />
                                <label>분석 키워드</label>
                                <input type="text" placeholder="분석할 키워드 입력" />
                            </div>
                            <div className={styles.modalFooter}>
                                <button className={styles.cancelBtn} onClick={() => setIsModalOpen(false)}>취소</button>
                                <button className={styles.submitBtn}>분석 시작</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </DashboardLayout>
    );
}
