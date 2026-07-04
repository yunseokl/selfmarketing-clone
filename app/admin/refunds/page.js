'use client';

import { Fragment, useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import styles from './page.module.css';
import { ArrowLeft, RefreshCw, DollarSign, ChevronDown, Save } from 'lucide-react';
import { toast } from 'sonner';

const statusOptions = [
    { id: 'all', label: '전체' },
    { id: 'pending', label: '대기중' },
    { id: 'reviewing', label: '검토중' },
    { id: 'approved', label: '승인' },
    { id: 'paid', label: '지급완료' },
    { id: 'rejected', label: '거절' },
];

const mediaTypeLabels = {
    naver_sa: '네이버 검색광고',
    naver_gfa: '네이버 GFA',
    kakao: '카카오',
    google: '구글',
    meta: '메타',
    coupang: '쿠팡',
};

const statusLabel = (status) => statusOptions.find(s => s.id === status)?.label || status;
const mediaLabel = (mediaType) => mediaTypeLabels[mediaType] || mediaType;

export default function AdminRefundsPage() {
    const { status: sessionStatus } = useSession();
    const router = useRouter();
    const [refundRequests, setRefundRequests] = useState([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState('all');
    const [expandedId, setExpandedId] = useState(null);
    const [editStatus, setEditStatus] = useState('pending');
    const [editMemo, setEditMemo] = useState('');
    const [saving, setSaving] = useState(false);

    const fetchRefundRequests = useCallback(async () => {
        try {
            setLoading(true);
            const params = new URLSearchParams();
            if (statusFilter !== 'all') params.set('status', statusFilter);
            const res = await fetch(`/api/admin/refund-requests?${params.toString()}`);
            if (res.ok) {
                const data = await res.json();
                setRefundRequests(data.refundRequests || []);
            }
        } catch (error) {
            console.error('Error fetching refund requests:', error);
        } finally {
            setLoading(false);
        }
    }, [statusFilter]);

    useEffect(() => {
        if (sessionStatus === 'unauthenticated') {
            router.push('/login');
        } else if (sessionStatus === 'authenticated') {
            fetchRefundRequests();
        }
    }, [fetchRefundRequests, router, sessionStatus]);

    const handleToggleRow = (item) => {
        if (expandedId === item.id) {
            setExpandedId(null);
            return;
        }
        setExpandedId(item.id);
        setEditStatus(item.status);
        setEditMemo(item.adminMemo || '');
    };

    const handleSave = async (itemId) => {
        setSaving(true);
        try {
            const res = await fetch(`/api/admin/refund-requests/${itemId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: editStatus, adminMemo: editMemo }),
            });
            if (res.ok) {
                toast.success('환급 신청이 업데이트되었습니다.');
                setExpandedId(null);
                fetchRefundRequests();
            } else {
                const data = await res.json();
                toast.error(data.error || '업데이트에 실패했습니다.');
            }
        } catch (error) {
            console.error('Error updating refund request:', error);
            toast.error('업데이트 중 오류가 발생했습니다.');
        } finally {
            setSaving(false);
        }
    };

    const formatDate = (dateStr) => {
        return new Date(dateStr).toLocaleDateString('ko-KR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
    };

    const getStatusBadge = (status) => {
        const config = {
            pending: { bg: '#FEF3C7', color: '#D97706' },
            reviewing: { bg: '#E0E7FF', color: '#4F46E5' },
            approved: { bg: '#D1FAE5', color: '#059669' },
            paid: { bg: '#DCFCE7', color: '#16A34A' },
            rejected: { bg: '#FEE2E2', color: '#DC2626' },
        };
        const s = config[status] || config.pending;
        return (
            <span className={styles.statusBadge} style={{ backgroundColor: s.bg, color: s.color }}>
                {statusLabel(status)}
            </span>
        );
    };

    return (
        <div className={styles.container}>
            {/* Header */}
            <div className={styles.header}>
                <div className={styles.headerLeft}>
                    <Link href="/admin" className={styles.backBtn}>
                        <ArrowLeft size={20} />
                    </Link>
                    <div>
                        <h1 className={styles.title}>환급 신청 관리</h1>
                        <p className={styles.subtitle}>매체별 광고비 환급 신청 처리</p>
                    </div>
                </div>
            </div>

            {/* Filters */}
            <div className={styles.filters}>
                <div className={styles.tabs}>
                    {statusOptions.map(opt => (
                        <button
                            key={opt.id}
                            className={`${styles.tab} ${statusFilter === opt.id ? styles.active : ''}`}
                            onClick={() => setStatusFilter(opt.id)}
                        >
                            {opt.label}
                        </button>
                    ))}
                </div>
                <button className={styles.refreshBtn} onClick={fetchRefundRequests}>
                    <RefreshCw size={18} />
                </button>
            </div>

            {/* Table */}
            <div className={styles.tableWrapper}>
                <table className={styles.table}>
                    <thead>
                        <tr>
                            <th>신청일</th>
                            <th>회원</th>
                            <th>매체</th>
                            <th>월 광고비</th>
                            <th>예상 환급액</th>
                            <th>연락처</th>
                            <th>상태</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr>
                                <td colSpan={7} className={styles.emptyCell}>로딩 중...</td>
                            </tr>
                        ) : refundRequests.length === 0 ? (
                            <tr>
                                <td colSpan={7} className={styles.emptyCell}>
                                    <DollarSign size={48} className={styles.emptyIcon} />
                                    <p>환급 신청이 없습니다.</p>
                                </td>
                            </tr>
                        ) : (
                            refundRequests.map(item => (
                                <Fragment key={item.id}>
                                    <tr
                                        className={styles.clickableRow}
                                        onClick={() => handleToggleRow(item)}
                                    >
                                        <td>{formatDate(item.createdAt)}</td>
                                        <td>{item.user?.name || item.user?.email || '-'}</td>
                                        <td><span className={styles.mediaBadge}>{mediaLabel(item.mediaType)}</span></td>
                                        <td>{item.monthlySpend?.toLocaleString()}원</td>
                                        <td className={styles.amount}>
                                            {item.expectedRefund != null ? `${item.expectedRefund.toLocaleString()}원` : '-'}
                                        </td>
                                        <td>{item.contact}</td>
                                        <td className={styles.statusCell}>
                                            {getStatusBadge(item.status)}
                                            <ChevronDown
                                                size={16}
                                                className={`${styles.chevron} ${expandedId === item.id ? styles.chevronOpen : ''}`}
                                            />
                                        </td>
                                    </tr>
                                    {expandedId === item.id && (
                                        <tr className={styles.detailRow}>
                                            <td colSpan={7}>
                                                <div className={styles.detailContent}>
                                                    <div className={styles.detailInfo}>
                                                        <span className={styles.detailLabel}>광고 계정 ID</span>
                                                        <p className={styles.detailText}>{item.accountId}</p>
                                                    </div>
                                                    {item.memo && (
                                                        <div className={styles.detailInfo}>
                                                            <span className={styles.detailLabel}>신청 메모</span>
                                                            <p className={styles.detailText}>{item.memo}</p>
                                                        </div>
                                                    )}

                                                    <div className={styles.editRow}>
                                                        <div className={styles.detailBlock}>
                                                            <span className={styles.detailLabel}>상태 변경</span>
                                                            <select
                                                                className={styles.statusSelect}
                                                                value={editStatus}
                                                                onChange={(e) => setEditStatus(e.target.value)}
                                                            >
                                                                <option value="pending">대기중</option>
                                                                <option value="reviewing">검토중</option>
                                                                <option value="approved">승인</option>
                                                                <option value="paid">지급완료</option>
                                                                <option value="rejected">거절</option>
                                                            </select>
                                                        </div>
                                                        <div className={styles.detailBlockGrow}>
                                                            <span className={styles.detailLabel}>관리자 메모</span>
                                                            <textarea
                                                                className={styles.memoTextarea}
                                                                value={editMemo}
                                                                onChange={(e) => setEditMemo(e.target.value)}
                                                                placeholder="처리 내용을 입력하세요..."
                                                                rows={3}
                                                            />
                                                        </div>
                                                    </div>
                                                    <button
                                                        className={styles.saveBtn}
                                                        onClick={() => handleSave(item.id)}
                                                        disabled={saving}
                                                    >
                                                        <Save size={14} />
                                                        {saving ? '저장 중...' : '저장'}
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </Fragment>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
