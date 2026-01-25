'use client';

import { useState } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import styles from './page.module.css';
import { BarChart3, Plus, Search, RefreshCw, TrendingUp, TrendingDown, Minus } from 'lucide-react';

const mockProducts = [];

export default function ShoppingRankingPage() {
    const [products, setProducts] = useState(mockProducts);
    const [isModalOpen, setIsModalOpen] = useState(false);

    return (
        <DashboardLayout>
            <div className={styles.container}>
                {/* Header */}
                <div className={styles.header}>
                    <div className={styles.headerContent}>
                        <h1 className={styles.title}>쇼핑 순위추적</h1>
                        <p className={styles.subtitle}>네이버 쇼핑 상품의 순위 변화를 실시간으로 추적하세요</p>
                    </div>
                    <div className={styles.headerBadge}>
                        <span className={styles.badge}>무료 사용</span>
                    </div>
                </div>

                {/* Action Bar */}
                <div className={styles.actionBar}>
                    <button
                        className={styles.addBtn}
                        onClick={() => setIsModalOpen(true)}
                    >
                        <Plus size={18} />
                        상품 추가
                    </button>
                    <span className={styles.counter}>등록: 0/5건</span>
                </div>

                {/* Products Grid */}
                {products.length === 0 ? (
                    <div className={styles.emptyState}>
                        <BarChart3 size={48} className={styles.emptyIcon} />
                        <h4>추적 중인 상품이 없습니다.</h4>
                        <p>상품을 추가하여 순위 변화를 확인하세요.</p>
                        <button
                            className={styles.emptyBtn}
                            onClick={() => setIsModalOpen(true)}
                        >
                            <Plus size={18} />
                            상품 추가하기
                        </button>
                    </div>
                ) : (
                    <div className={styles.productsGrid}>
                        {products.map((product, idx) => (
                            <div key={idx} className={styles.productCard}>
                                <div className={styles.productImage}>
                                    <img src={product.image} alt={product.name} />
                                </div>
                                <div className={styles.productInfo}>
                                    <h4 className={styles.productName}>{product.name}</h4>
                                    <p className={styles.productKeyword}>{product.keyword}</p>
                                    <div className={styles.rankInfo}>
                                        <span className={styles.currentRank}>{product.rank}위</span>
                                        {product.change > 0 && (
                                            <span className={styles.rankUp}>
                                                <TrendingUp size={14} /> +{product.change}
                                            </span>
                                        )}
                                        {product.change < 0 && (
                                            <span className={styles.rankDown}>
                                                <TrendingDown size={14} /> {product.change}
                                            </span>
                                        )}
                                        {product.change === 0 && (
                                            <span className={styles.rankSame}>
                                                <Minus size={14} /> -
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Add Product Modal */}
                {isModalOpen && (
                    <div className={styles.modalOverlay} onClick={() => setIsModalOpen(false)}>
                        <div className={styles.modal} onClick={e => e.stopPropagation()}>
                            <div className={styles.modalHeader}>
                                <h3>쇼핑 링크 추가</h3>
                                <button onClick={() => setIsModalOpen(false)}>✕</button>
                            </div>
                            <div className={styles.modalBody}>
                                <label>상품 URL</label>
                                <input type="text" placeholder="네이버 쇼핑 상품 URL 입력" />
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
