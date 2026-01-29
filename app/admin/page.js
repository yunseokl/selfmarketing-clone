'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import styles from './page.module.css';
import {
    ShoppingCart,
    MapPin,
    Users,
    Download,
    DollarSign,
    TrendingUp,
    Clock,
    CheckCircle
} from 'lucide-react';
import { toast } from 'sonner';

export default function AdminDashboard() {
    const { data: session, status } = useSession();
    const router = useRouter();
    const [stats, setStats] = useState({
        totalOrders: 0,
        pendingOrders: 0,
        activeOrders: 0,
        completedOrders: 0,
        totalUsers: 0,
        totalRevenue: 0,
    });
    const [isAdmin, setIsAdmin] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (status === 'unauthenticated') {
            router.push('/login');
        } else if (status === 'authenticated') {
            checkAdminAccess();
        }
    }, [status]);

    const checkAdminAccess = async () => {
        try {
            const res = await fetch('/api/user');
            if (res.ok) {
                const data = await res.json();
                if (data.user?.role !== 'admin') {
                    toast.error('관리자만 접근할 수 있습니다.');
                    router.push('/');
                    return;
                }
                setIsAdmin(true);
                fetchStats();
            } else {
                router.push('/login');
            }
        } catch (error) {
            console.error('Error:', error);
            router.push('/');
        }
    };

    const fetchStats = async () => {
        try {
            const res = await fetch('/api/admin/stats');
            if (res.ok) {
                const data = await res.json();
                setStats(data);
            }
        } catch (error) {
            console.error('Error fetching stats:', error);
        } finally {
            setLoading(false);
        }
    };

    if (status === 'loading' || loading || !isAdmin) {
        return <div className={styles.loading}>로딩 중...</div>;
    }

    return (
        <div className={styles.container}>
            {/* Header */}
            <div className={styles.header}>
                <div>
                    <h1 className={styles.title}>관리자 대시보드</h1>
                    <p className={styles.subtitle}>주문 관리 및 엑셀 다운로드</p>
                </div>
                <Link href="/" className={styles.backBtn}>
                    ← 사용자 페이지로 돌아가기
                </Link>
            </div>

            {/* Stats Cards */}
            <div className={styles.statsGrid}>
                <div className={styles.statCard}>
                    <div className={styles.statIcon} style={{ backgroundColor: '#EBF5FF', color: '#2563EB' }}>
                        <ShoppingCart size={24} />
                    </div>
                    <div className={styles.statInfo}>
                        <span className={styles.statLabel}>전체 주문</span>
                        <span className={styles.statValue}>{stats.totalOrders}</span>
                    </div>
                </div>

                <div className={styles.statCard}>
                    <div className={styles.statIcon} style={{ backgroundColor: '#FEF3C7', color: '#D97706' }}>
                        <Clock size={24} />
                    </div>
                    <div className={styles.statInfo}>
                        <span className={styles.statLabel}>대기중</span>
                        <span className={styles.statValue}>{stats.pendingOrders}</span>
                    </div>
                </div>

                <div className={styles.statCard}>
                    <div className={styles.statIcon} style={{ backgroundColor: '#D1FAE5', color: '#059669' }}>
                        <TrendingUp size={24} />
                    </div>
                    <div className={styles.statInfo}>
                        <span className={styles.statLabel}>진행중</span>
                        <span className={styles.statValue}>{stats.activeOrders}</span>
                    </div>
                </div>

                <div className={styles.statCard}>
                    <div className={styles.statIcon} style={{ backgroundColor: '#E0E7FF', color: '#4F46E5' }}>
                        <CheckCircle size={24} />
                    </div>
                    <div className={styles.statInfo}>
                        <span className={styles.statLabel}>완료</span>
                        <span className={styles.statValue}>{stats.completedOrders}</span>
                    </div>
                </div>

                <div className={styles.statCard}>
                    <div className={styles.statIcon} style={{ backgroundColor: '#FCE7F3', color: '#DB2777' }}>
                        <Users size={24} />
                    </div>
                    <div className={styles.statInfo}>
                        <span className={styles.statLabel}>전체 회원</span>
                        <span className={styles.statValue}>{stats.totalUsers}</span>
                    </div>
                </div>

                <div className={styles.statCard}>
                    <div className={styles.statIcon} style={{ backgroundColor: '#ECFDF5', color: '#10B981' }}>
                        <DollarSign size={24} />
                    </div>
                    <div className={styles.statInfo}>
                        <span className={styles.statLabel}>총 매출</span>
                        <span className={styles.statValue}>{stats.totalRevenue?.toLocaleString()}원</span>
                    </div>
                </div>
            </div>

            {/* Quick Actions */}
            <div className={styles.section}>
                <h2 className={styles.sectionTitle}>빠른 작업</h2>
                <div className={styles.actionGrid}>
                    <Link href="/admin/orders/shopping" className={styles.actionCard}>
                        <ShoppingCart size={32} />
                        <h3>쇼핑 광고 주문</h3>
                        <p>쇼핑 광고 주문 목록 및 엑셀 다운로드</p>
                    </Link>

                    <Link href="/admin/orders/place" className={styles.actionCard}>
                        <MapPin size={32} />
                        <h3>플레이스 광고 주문</h3>
                        <p>플레이스 광고 주문 목록 및 엑셀 다운로드</p>
                    </Link>

                    <Link href="/admin/users" className={styles.actionCard}>
                        <Users size={32} />
                        <h3>회원 관리</h3>
                        <p>회원 목록 조회 및 잔액 관리</p>
                    </Link>
                </div>
            </div>
        </div>
    );
}
