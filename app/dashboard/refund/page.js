'use client';

import DashboardLayout from '@/components/layout/DashboardLayout';
import styles from '../ranking/shopping/page.module.css';
import { DollarSign, BadgePercent } from 'lucide-react';

export default function RefundPage() {
    return (
        <DashboardLayout>
            <div className={styles.container}>
                <div className={styles.header}>
                    <div className={styles.headerContent}>
                        <h1 className={styles.title}>매체별 광고비 환급</h1>
                        <p className={styles.subtitle}>네이버, 카카오 광고비의 10%를 환급받으세요</p>
                    </div>
                    <div className={styles.headerBadge}>
                        <span className={styles.badge}>광고비 10% 환급</span>
                    </div>
                </div>

                <div className={styles.emptyState}>
                    <BadgePercent size={48} className={styles.emptyIcon} />
                    <h4>광고 계정을 연동해주세요.</h4>
                    <p>네이버/카카오 광고 계정을 연동하면 광고비 환급을 받을 수 있습니다.</p>
                    <button className={styles.emptyBtn}>
                        <DollarSign size={18} />
                        광고 계정 연동하기
                    </button>
                </div>
            </div>
        </DashboardLayout>
    );
}
