'use client';

import DashboardLayout from '@/components/layout/DashboardLayout';
import styles from '@/styles/glass-feature.module.css';
import { Package, ExternalLink } from 'lucide-react';

export default function CoupangPage() {
    return (
        <DashboardLayout>
            <div className={styles.container}>
                <div className={styles.header}>
                    <div className={styles.headerContent}>
                        <h1 className={styles.title}>쿠팡 광고</h1>
                        <p className={styles.subtitle}>쿠팡 상품의 노출을 높이세요</p>
                    </div>
                    <div className={styles.headerBadge}>
                        <span className={styles.badge}>별도 문의</span>
                    </div>
                </div>

                <div className={styles.emptyState}>
                    <Package size={48} className={styles.emptyIcon} />
                    <h4>쿠팡 광고는 별도 문의가 필요합니다.</h4>
                    <p>카카오톡으로 문의해주시면 안내해드리겠습니다.</p>
                    <button className={styles.emptyBtn}>
                        <ExternalLink size={18} />
                        카카오톡 문의하기
                    </button>
                </div>
            </div>
        </DashboardLayout>
    );
}
