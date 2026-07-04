'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/layout/DashboardLayout';
import styles from './page.module.css';
import { Wallet, Building2, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { calculateChargeBonus } from '@/lib/validations/cash';

const PRESETS = [50000, 100000, 300000, 500000, 1000000];

const tabs = [
    { id: 'all', label: '전체' },
    { id: 'charge', label: '충전' },
    { id: 'use', label: '사용' },
    { id: 'refund', label: '환불' },
];

const typeLabels = {
    charge: '충전',
    use: '사용',
    refund: '환불',
    reward: '적립',
};

const statusLabels = {
    pending: '대기중',
    completed: '완료',
    rejected: '거절',
};

export default function ChargePage() {
    const { data: session, status } = useSession();
    const router = useRouter();
    const [balance, setBalance] = useState(0);
    const [amount, setAmount] = useState('');
    const [depositorName, setDepositorName] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [activeTab, setActiveTab] = useState('all');
    const [transactions, setTransactions] = useState([]);
    const [loading, setLoading] = useState(true);

    const fetchBalance = useCallback(async () => {
        try {
            const res = await fetch('/api/user');
            if (res.ok) {
                const data = await res.json();
                setBalance(data.user?.balance || 0);
            }
        } catch (error) {
            console.error('Error fetching balance:', error);
        }
    }, []);

    const fetchTransactions = useCallback(async () => {
        try {
            setLoading(true);
            const res = await fetch(`/api/cash?type=${activeTab}`);
            if (res.ok) {
                const data = await res.json();
                setTransactions(data.transactions || []);
            }
        } catch (error) {
            console.error('Error fetching transactions:', error);
        } finally {
            setLoading(false);
        }
    }, [activeTab]);

    useEffect(() => {
        if (status === 'unauthenticated') {
            router.push('/login');
        } else if (status === 'authenticated') {
            fetchBalance();
        }
    }, [status, router, fetchBalance]);

    useEffect(() => {
        if (status === 'authenticated') {
            fetchTransactions();
        }
    }, [status, fetchTransactions]);

    const numericAmount = Number(amount) || 0;
    const bonus = useMemo(() => calculateChargeBonus(numericAmount), [numericAmount]);

    const handlePreset = (value) => {
        setAmount(String(value));
    };

    const handleCopyAccount = () => {
        navigator.clipboard.writeText('123456-04-567890');
        toast.success('계좌번호가 복사되었습니다.');
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (numericAmount < 10000 || numericAmount > 5000000) {
            toast.error('충전 금액은 최소 1만원, 최대 500만원입니다.');
            return;
        }
        if (!depositorName.trim()) {
            toast.error('입금자명을 입력해주세요.');
            return;
        }

        try {
            setSubmitting(true);
            const res = await fetch('/api/cash', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ amount: numericAmount, depositorName: depositorName.trim() }),
            });
            const data = await res.json();
            if (res.ok) {
                toast.success(data.message);
                setAmount('');
                setDepositorName('');
                fetchTransactions();
            } else {
                toast.error(data.error);
            }
        } catch (error) {
            console.error('Error submitting charge request:', error);
            toast.error('충전 신청 중 오류가 발생했습니다.');
        } finally {
            setSubmitting(false);
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

    if (status === 'loading') {
        return <DashboardLayout><div className={styles.container}>로딩 중...</div></DashboardLayout>;
    }

    return (
        <DashboardLayout>
            <div className={styles.container}>
                <div className={styles.header}>
                    <h1 className={styles.title}>캐시 충전</h1>
                    <p className={styles.subtitle}>광고비로 사용할 캐시를 충전하세요</p>
                </div>

                {/* Balance Card */}
                <div className={styles.balanceCard}>
                    <div className={styles.balanceIcon}>
                        <Wallet size={28} />
                    </div>
                    <div>
                        <span className={styles.balanceLabel}>현재 잔액</span>
                        <p className={styles.balanceValue}>{balance.toLocaleString()}원</p>
                    </div>
                </div>

                <div className={styles.grid}>
                    {/* Charge Form */}
                    <form className={styles.chargeCard} onSubmit={handleSubmit}>
                        <h2 className={styles.cardTitle}>충전 신청</h2>

                        <div className={styles.presetGrid}>
                            {PRESETS.map((preset) => (
                                <button
                                    type="button"
                                    key={preset}
                                    className={`${styles.presetBtn} ${numericAmount === preset ? styles.active : ''}`}
                                    onClick={() => handlePreset(preset)}
                                >
                                    {(preset / 10000).toLocaleString()}만원
                                </button>
                            ))}
                        </div>

                        <label className={styles.label} htmlFor="chargeAmount">충전 금액 (직접 입력 가능)</label>
                        <input
                            id="chargeAmount"
                            type="number"
                            className={styles.input}
                            placeholder="최소 10,000원, 최대 5,000,000원"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            min={10000}
                            max={5000000}
                        />

                        {bonus > 0 && (
                            <div className={styles.bonusBox}>
                                보너스 <strong>+{bonus.toLocaleString()}원</strong> 추가 지급 예정 (승인 시 총 {(numericAmount + bonus).toLocaleString()}원)
                            </div>
                        )}

                        <label className={styles.label} htmlFor="depositorName">입금자명</label>
                        <input
                            id="depositorName"
                            type="text"
                            className={styles.input}
                            placeholder="입금하실 분의 성함을 입력해주세요"
                            value={depositorName}
                            onChange={(e) => setDepositorName(e.target.value)}
                        />

                        <div className={styles.bankBox}>
                            <div className={styles.bankBoxHeader}>
                                <Building2 size={18} />
                                <span>무통장입금 안내</span>
                            </div>
                            <div className={styles.bankAccount}>
                                <span>국민은행 123456-04-567890 (예금주: (주)혼잘마)</span>
                                <button type="button" className={styles.copyBtn} onClick={handleCopyAccount}>
                                    <Copy size={14} />
                                    복사
                                </button>
                            </div>
                            <p className={styles.bankNote}>신청 후 24시간 내 입금 확인 후 충전됩니다.</p>
                        </div>

                        <button type="submit" className={styles.submitBtn} disabled={submitting}>
                            {submitting ? '신청 중...' : '충전 신청하기'}
                        </button>
                    </form>

                    {/* Bonus Info */}
                    <div className={styles.infoCard}>
                        <h2 className={styles.cardTitle}>보너스 안내</h2>
                        <ul className={styles.bonusList}>
                            <li><span className={styles.bonusTier}>30만원 이상</span><span className={styles.bonusRate}>+3%</span></li>
                            <li><span className={styles.bonusTier}>50만원 이상</span><span className={styles.bonusRate}>+5%</span></li>
                            <li><span className={styles.bonusTier}>100만원 이상</span><span className={styles.bonusRate}>+10%</span></li>
                        </ul>
                        <p className={styles.bonusFootnote}>보너스 캐시는 관리자 승인 시 신청 금액과 함께 자동으로 지급됩니다.</p>
                    </div>
                </div>

                {/* Transaction History */}
                <div className={styles.historySection}>
                    <h2 className={styles.cardTitle}>이용 내역</h2>
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

                    <div className={styles.tableContainer}>
                        <table className={styles.table}>
                            <thead>
                                <tr>
                                    <th>일시</th>
                                    <th>유형</th>
                                    <th>설명</th>
                                    <th>금액</th>
                                    <th>처리 후 잔액</th>
                                    <th>상태</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    <tr><td colSpan={6} className={styles.emptyCell}>로딩 중...</td></tr>
                                ) : transactions.length === 0 ? (
                                    <tr><td colSpan={6} className={styles.emptyCell}>이용 내역이 없습니다.</td></tr>
                                ) : (
                                    transactions.map((tx) => (
                                        <tr key={tx.id}>
                                            <td>{formatDateTime(tx.createdAt)}</td>
                                            <td><span className={styles.typeBadge}>{typeLabels[tx.type] || tx.type}</span></td>
                                            <td>{tx.description || '-'}</td>
                                            <td className={tx.amount >= 0 ? styles.amountPlus : styles.amountMinus}>
                                                {tx.amount >= 0 ? '+' : '-'}{Math.abs(tx.amount).toLocaleString()}원
                                            </td>
                                            <td>{tx.balanceAfter != null ? `${tx.balanceAfter.toLocaleString()}원` : '-'}</td>
                                            <td><span className={`${styles.badge} ${getStatusBadgeClass(tx.status)}`}>{statusLabels[tx.status] || tx.status}</span></td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </DashboardLayout>
    );
}
