'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import styles from './page.module.css';
import {
    Download,
    Search,
    RefreshCw,
    ArrowLeft,
    CheckCircle,
    XCircle,
    Clock,
    Package
} from 'lucide-react';
import { toast } from 'sonner';

const statusOptions = [
    { id: 'all', label: '전체' },
    { id: 'pending', label: '대기중' },
    { id: 'active', label: '진행중' },
    { id: 'completed', label: '완료' },
    { id: 'refunded', label: '환불' },
];

export default function ShoppingOrdersPage() {
    const { data: session, status } = useSession();
    const router = useRouter();
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedOrders, setSelectedOrders] = useState([]);
    const [downloading, setDownloading] = useState(false);

    const fetchOrders = useCallback(async () => {
        try {
            setLoading(true);
            const res = await fetch(`/api/admin/orders/shopping?status=${statusFilter}`);
            if (res.ok) {
                const data = await res.json();
                setOrders(data.orders || []);
            }
        } catch (error) {
            console.error('Error fetching orders:', error);
        } finally {
            setLoading(false);
        }
    }, [statusFilter]);

    useEffect(() => {
        if (status === 'unauthenticated') {
            router.push('/login');
        } else if (status === 'authenticated') {
            fetchOrders();
        }
    }, [fetchOrders, router, status]);

    const handleSelectAll = (e) => {
        if (e.target.checked) {
            setSelectedOrders(orders.map(o => o.id));
        } else {
            setSelectedOrders([]);
        }
    };

    const handleSelectOrder = (id) => {
        if (selectedOrders.includes(id)) {
            setSelectedOrders(selectedOrders.filter(oid => oid !== id));
        } else {
            setSelectedOrders([...selectedOrders, id]);
        }
    };

    const handleDownloadExcel = async () => {
        setDownloading(true);
        try {
            const ids = selectedOrders.length > 0 ? selectedOrders : orders.map(o => o.id);
            const res = await fetch('/api/admin/export/shopping', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orderIds: ids }),
            });

            if (res.ok) {
                const blob = await res.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `쇼핑광고_주문목록_${new Date().toISOString().split('T')[0]}.csv`;
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                a.remove();
            }
        } catch (error) {
            console.error('Error downloading excel:', error);
            toast.error('다운로드 중 오류가 발생했습니다.');
        } finally {
            setDownloading(false);
        }
    };

    const handleUpdateStatus = async (orderId, newStatus) => {
        try {
            const res = await fetch(`/api/admin/orders/shopping/${orderId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus }),
            });

            if (res.ok) {
                fetchOrders();
            }
        } catch (error) {
            console.error('Error updating status:', error);
        }
    };

    const getStatusBadge = (status) => {
        const config = {
            pending: { bg: '#FEF3C7', color: '#D97706', icon: Clock, text: '대기중' },
            active: { bg: '#D1FAE5', color: '#059669', icon: CheckCircle, text: '진행중' },
            completed: { bg: '#E0E7FF', color: '#4F46E5', icon: CheckCircle, text: '완료' },
            refunded: { bg: '#FEE2E2', color: '#DC2626', icon: XCircle, text: '환불' },
        };
        const s = config[status] || config.pending;
        const Icon = s.icon;
        return (
            <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                backgroundColor: s.bg,
                color: s.color,
                padding: '4px 10px',
                borderRadius: '4px',
                fontSize: '12px',
                fontWeight: 500
            }}>
                <Icon size={12} />
                {s.text}
            </span>
        );
    };

    const formatDate = (dateStr) => {
        return new Date(dateStr).toLocaleDateString('ko-KR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
    };

    const filteredOrders = orders.filter(order =>
        !searchQuery ||
        order.productName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        order.keyword?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        order.user?.email?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className={styles.container}>
            {/* Header */}
            <div className={styles.header}>
                <div className={styles.headerLeft}>
                    <Link href="/admin" className={styles.backBtn}>
                        <ArrowLeft size={20} />
                    </Link>
                    <div>
                        <h1 className={styles.title}>쇼핑 광고 주문 관리</h1>
                        <p className={styles.subtitle}>원청 신청용 엑셀 다운로드</p>
                    </div>
                </div>
                <button
                    className={styles.downloadBtn}
                    onClick={handleDownloadExcel}
                    disabled={downloading}
                >
                    <Download size={18} />
                    {downloading ? '다운로드 중...' : `엑셀 다운로드 (${selectedOrders.length || orders.length}건)`}
                </button>
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
                <div className={styles.searchBar}>
                    <Search size={18} className={styles.searchIcon} />
                    <input
                        type="text"
                        placeholder="상품명, 키워드, 이메일 검색..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
                <button className={styles.refreshBtn} onClick={fetchOrders}>
                    <RefreshCw size={18} />
                </button>
            </div>

            {/* Table */}
            <div className={styles.tableWrapper}>
                <table className={styles.table}>
                    <thead>
                        <tr>
                            <th>
                                <input
                                    type="checkbox"
                                    onChange={handleSelectAll}
                                    checked={selectedOrders.length === orders.length && orders.length > 0}
                                />
                            </th>
                            <th>주문번호</th>
                            <th>회원</th>
                            <th>상품명</th>
                            <th>키워드</th>
                            <th>상품URL</th>
                            <th>일일목표</th>
                            <th>기간</th>
                            <th>금액</th>
                            <th>상태</th>
                            <th>주문일</th>
                            <th>작업</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr>
                                <td colSpan={12} className={styles.emptyCell}>로딩 중...</td>
                            </tr>
                        ) : filteredOrders.length === 0 ? (
                            <tr>
                                <td colSpan={12} className={styles.emptyCell}>
                                    <Package size={48} className={styles.emptyIcon} />
                                    <p>주문이 없습니다.</p>
                                </td>
                            </tr>
                        ) : (
                            filteredOrders.map(order => (
                                <tr key={order.id}>
                                    <td>
                                        <input
                                            type="checkbox"
                                            checked={selectedOrders.includes(order.id)}
                                            onChange={() => handleSelectOrder(order.id)}
                                        />
                                    </td>
                                    <td className={styles.orderId}>{order.id.slice(-8).toUpperCase()}</td>
                                    <td>{order.user?.email || '-'}</td>
                                    <td className={styles.productName}>{order.productName}</td>
                                    <td><span className={styles.keyword}>{order.keyword}</span></td>
                                    <td>
                                        <a
                                            href={order.productUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className={styles.urlLink}
                                        >
                                            링크 보기
                                        </a>
                                    </td>
                                    <td>{order.dailyGoal}건</td>
                                    <td>{order.duration}일</td>
                                    <td className={styles.amount}>{order.totalCost?.toLocaleString()}원</td>
                                    <td>{getStatusBadge(order.status)}</td>
                                    <td>{formatDate(order.createdAt)}</td>
                                    <td>
                                        <select
                                            className={styles.statusSelect}
                                            value={order.status}
                                            onChange={(e) => handleUpdateStatus(order.id, e.target.value)}
                                        >
                                            <option value="pending">대기중</option>
                                            <option value="active">진행중</option>
                                            <option value="completed">완료</option>
                                            <option value="refunded">환불</option>
                                        </select>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
