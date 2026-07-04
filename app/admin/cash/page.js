'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import styles from './page.module.css';
import { ArrowLeft, RefreshCw, Wallet, Check, X as XIcon } from 'lucide-react';
import { toast } from 'sonner';
import { calculateChargeBonus } from '@/lib/validations/cash';

const statusTabs = [
    { id: 'pending', label: '대기중' },
    { id: 'completed', label: '완료' },
    { id: 'rejected', label: '거절' },
    { id: 'all', label: '전체' },
];

const statusLabels = {
    pending: '대기중',
    completed: '완료',
    rejected: '거절',
};

export default function AdminCashPage() {
    const { data: session, status } = useSession();
    const router = useRouter();
    const [isAdmin, setIsAdmin] = useState(false);
    const [activeTab, setActiveTab] = useState('pending');
    const [transactions, setTransactions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [processingId, setProcessingId] = useState(null);

    const fetchTransactions = useCallback(async () => {
        try {
            setLoading(true);
            const res = await fetch(`/api/admin/cash?status=${activeTab}`);
            if (res.ok) {
                const data = await res.json();
                setTransactions(data.transactions || []);
            }
        } catch (error) {
            console.error('Error fetching cash requests:', error);
        } finally {
            setLoading(false);
        }
    }, [activeTab]);

    const checkAdminAccess = useCallback(async () => {
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
            } else {
                router.push('/login');
            }
        } catch (error) {
            console.error('Error:', error);
            router.push('/');
        }
    }, [router]);

    useEffect(() => {
        if (status === 'unauthenticated') {
            router.push('/login');
        } else if (status === 'authenticated') {
            checkAdminAccess();
        }
    }, [checkAdminAccess, router, status]);

    useEffect(() => {
        if (isAdmin) {
            fetchTransactions();
        }
    }, [isAdmin, fetchTransactions]);

    const handleProcess = async (id, action) => {
        const confirmMsg = action === 'approve'
            ? '이 충전 신청을 승인하시겠습니까? 보너스가 포함되어 즉시 지급됩니다.'
            : '이 충전 신청을 거절하시겠습니까?';
        if (!confirm(confirmMsg)) return;

        try {
            setProcessingId(id);
            const res = await fetch(`/api/admin/cash/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action }),
            });
            const data = await res.json();
            if (res.ok) {
                toast.success(data.message);
                fetchTransactions();
            } else {
                toast.error(data.error);
            }
        } catch (error) {
            console.error('Error processing cash request:', error);
            toast.error('처리 중 오류가 발생했습니다.');
        } finally {
            setProcessingId(null);
        }
    };

    const formatDateTime = (dateStr) => {
        return new Date(dateStr).toLocaleString('ko-KR', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit'
        });
    };

    const getStatusBadgeClass = (s) => {
        if (s === 'completed') return styles.badgeCompleted;
        if (s === 'rejected') return styles.badgeRejected;
        return styles.badgePending;
    };

    if (status === 'loading' || !isAdmin) {
        return <div className={styles.container}>로딩 중...</div>;
    }

    return (
        <div className={styles.container}>
            {/* Header */}
            <div className={styles.header}>
                <div className={styles.headerLeft}>
                    <Link href="/admin" className={styles.backBtn}>
                        <ArrowLeft size={20} />
                    </Link>
                    <div>
                        <h1 className={styles.title}>캐시 충전 관리</h1>
                        <p className={styles.subtitle}>회원 충전 신청 승인 및 거절</p>
                    </div>
                </div>
                <button className={styles.refreshBtn} onClick={fetchTransactions}>
                    <RefreshCw size={18} />
                </button>
            </div>

            {/* Status Tabs */}
            <div className={styles.tabs}>
                {statusTabs.map((tab) => (
                    <button
                        key={tab.id}
                        className={`${styles.tab} ${activeTab === tab.id ? styles.active : ''}`}
                        onClick={() => setActiveTab(tab.id)}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Table */}
            <div className={styles.tableWrapper}>
                <table className={styles.table}>
                    <thead>
                        <tr>
                            <th>신청일</th>
                            <th>회원</th>
                            <th>입금자명</th>
                            <th>신청 금액</th>
                            <th>예상 보너스</th>
                            <th>상태</th>
                            <th>작업</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr>
                                <td colSpan={7} className={styles.emptyCell}>로딩 중...</td>
                            </tr>
                        ) : transactions.length === 0 ? (
                            <tr>
                                <td colSpan={7} className={styles.emptyCell}>
                                    <Wallet size={40} className={styles.emptyIcon} />
                                    <p>충전 신청 내역이 없습니다.</p>
                                </td>
                            </tr>
                        ) : (
                            transactions.map((tx) => {
                                const bonus = tx.status === 'pending' ? calculateChargeBonus(tx.amount) : 0;
                                return (
                                    <tr key={tx.id}>
                                        <td>{formatDateTime(tx.createdAt)}</td>
                                        <td>
                                            <div className={styles.userCell}>
                                                <span>{tx.user?.email}</span>
                                                <span className={styles.userName}>{tx.user?.name || '-'}</span>
                                            </div>
                                        </td>
                                        <td>{tx.depositorName || '-'}</td>
                                        <td className={styles.amount}>{tx.amount.toLocaleString()}원</td>
                                        <td>{bonus > 0 ? `+${bonus.toLocaleString()}원` : '-'}</td>
                                        <td>
                                            <span className={`${styles.badge} ${getStatusBadgeClass(tx.status)}`}>
                                                {statusLabels[tx.status] || tx.status}
                                            </span>
                                        </td>
                                        <td>
                                            {tx.status === 'pending' ? (
                                                <div className={styles.actionBtns}>
                                                    <button
                                                        className={styles.approveBtn}
                                                        disabled={processingId === tx.id}
                                                        onClick={() => handleProcess(tx.id, 'approve')}
                                                    >
                                                        <Check size={14} />
                                                        승인
                                                    </button>
                                                    <button
                                                        className={styles.rejectBtn}
                                                        disabled={processingId === tx.id}
                                                        onClick={() => handleProcess(tx.id, 'reject')}
                                                    >
                                                        <XIcon size={14} />
                                                        거절
                                                    </button>
                                                </div>
                                            ) : (
                                                <span className={styles.doneText}>-</span>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
