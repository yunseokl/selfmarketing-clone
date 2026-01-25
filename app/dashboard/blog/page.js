'use client';

import DashboardLayout from '@/components/layout/DashboardLayout';
import styles from '../ranking/shopping/page.module.css';
import { FileText, Plus } from 'lucide-react';

export default function BlogPage() {
    return (
        <DashboardLayout>
            <div className={styles.container}>
                <div className={styles.header}>
                    <div className={styles.headerContent}>
                        <h1 className={styles.title}>플레이스 블로그 배포</h1>
                        <p className={styles.subtitle}>플레이스 홍보를 위한 블로그 포스팅을 관리하세요</p>
                    </div>
                </div>

                <div className={styles.actionBar}>
                    <button className={styles.addBtn}>
                        <Plus size={18} />
                        블로그 포스팅 요청
                    </button>
                </div>

                <div className={styles.emptyState}>
                    <FileText size={48} className={styles.emptyIcon} />
                    <h4>배포된 블로그가 없습니다.</h4>
                    <p>블로그 포스팅을 요청하여 플레이스를 홍보하세요.</p>
                </div>
            </div>
        </DashboardLayout>
    );
}
