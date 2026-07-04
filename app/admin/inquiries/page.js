'use client';

import { Fragment, useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import styles from './page.module.css';
import { ArrowLeft, RefreshCw, MessageSquare, ChevronDown, Send } from 'lucide-react';
import { toast } from 'sonner';

const statusOptions = [
    { id: 'all', label: '전체' },
    { id: 'open', label: '답변대기' },
    { id: 'answered', label: '답변완료' },
];

const categoryOptions = [
    { id: 'all', label: '전체 카테고리' },
    { id: 'general', label: '일반' },
    { id: 'payment', label: '결제' },
    { id: 'ad', label: '광고' },
    { id: 'coupang', label: '쿠팡' },
    { id: 'refund', label: '환급' },
    { id: 'etc', label: '기타' },
];

const categoryLabel = (category) => categoryOptions.find(c => c.id === category)?.label || category;

export default function AdminInquiriesPage() {
    const { status: sessionStatus } = useSession();
    const router = useRouter();
    const [inquiries, setInquiries] = useState([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState('all');
    const [categoryFilter, setCategoryFilter] = useState('all');
    const [expandedId, setExpandedId] = useState(null);
    const [answerDraft, setAnswerDraft] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const fetchInquiries = useCallback(async () => {
        try {
            setLoading(true);
            const params = new URLSearchParams();
            if (statusFilter !== 'all') params.set('status', statusFilter);
            if (categoryFilter !== 'all') params.set('category', categoryFilter);
            const res = await fetch(`/api/admin/inquiries?${params.toString()}`);
            if (res.ok) {
                const data = await res.json();
                setInquiries(data.inquiries || []);
            }
        } catch (error) {
            console.error('Error fetching inquiries:', error);
        } finally {
            setLoading(false);
        }
    }, [statusFilter, categoryFilter]);

    useEffect(() => {
        if (sessionStatus === 'unauthenticated') {
            router.push('/login');
        } else if (sessionStatus === 'authenticated') {
            fetchInquiries();
        }
    }, [fetchInquiries, router, sessionStatus]);

    const handleToggleRow = (inquiry) => {
        if (expandedId === inquiry.id) {
            setExpandedId(null);
            return;
        }
        setExpandedId(inquiry.id);
        setAnswerDraft(inquiry.answer || '');
    };

    const handleSubmitAnswer = async (inquiryId) => {
        if (!answerDraft.trim()) {
            toast.error('답변 내용을 입력해주세요.');
            return;
        }
        setSubmitting(true);
        try {
            const res = await fetch(`/api/admin/inquiries/${inquiryId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ answer: answerDraft }),
            });

            if (res.ok) {
                toast.success('답변이 등록되었습니다.');
                setExpandedId(null);
                fetchInquiries();
            } else {
                const data = await res.json();
                toast.error(data.error || '답변 등록에 실패했습니다.');
            }
        } catch (error) {
            console.error('Error submitting answer:', error);
            toast.error('답변 등록 중 오류가 발생했습니다.');
        } finally {
            setSubmitting(false);
        }
    };

    const formatDate = (dateStr) => {
        return new Date(dateStr).toLocaleDateString('ko-KR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const getStatusBadge = (status) => {
        const config = {
            open: { bg: '#FEF3C7', color: '#D97706', text: '답변대기' },
            answered: { bg: '#D1FAE5', color: '#059669', text: '답변완료' },
            closed: { bg: '#E5E7EB', color: '#6B7280', text: '종료' },
        };
        const s = config[status] || config.open;
        return (
            <span className={styles.statusBadge} style={{ backgroundColor: s.bg, color: s.color }}>
                {s.text}
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
                        <h1 className={styles.title}>1:1 문의 관리</h1>
                        <p className={styles.subtitle}>회원 문의 확인 및 답변 등록</p>
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
                <select
                    className={styles.categorySelect}
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                >
                    {categoryOptions.map(opt => (
                        <option key={opt.id} value={opt.id}>{opt.label}</option>
                    ))}
                </select>
                <button className={styles.refreshBtn} onClick={fetchInquiries}>
                    <RefreshCw size={18} />
                </button>
            </div>

            {/* Table */}
            <div className={styles.tableWrapper}>
                <table className={styles.table}>
                    <thead>
                        <tr>
                            <th>날짜</th>
                            <th>회원</th>
                            <th>카테고리</th>
                            <th>제목</th>
                            <th>상태</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr>
                                <td colSpan={5} className={styles.emptyCell}>로딩 중...</td>
                            </tr>
                        ) : inquiries.length === 0 ? (
                            <tr>
                                <td colSpan={5} className={styles.emptyCell}>
                                    <MessageSquare size={48} className={styles.emptyIcon} />
                                    <p>문의가 없습니다.</p>
                                </td>
                            </tr>
                        ) : (
                            inquiries.map(inquiry => (
                                <Fragment key={inquiry.id}>
                                    <tr
                                        className={styles.clickableRow}
                                        onClick={() => handleToggleRow(inquiry)}
                                    >
                                        <td>{formatDate(inquiry.createdAt)}</td>
                                        <td>{inquiry.user?.name || inquiry.user?.email || '-'}</td>
                                        <td><span className={styles.categoryBadge}>{categoryLabel(inquiry.category)}</span></td>
                                        <td className={styles.inquiryTitle}>{inquiry.title}</td>
                                        <td className={styles.statusCell}>
                                            {getStatusBadge(inquiry.status)}
                                            <ChevronDown
                                                size={16}
                                                className={`${styles.chevron} ${expandedId === inquiry.id ? styles.chevronOpen : ''}`}
                                            />
                                        </td>
                                    </tr>
                                    {expandedId === inquiry.id && (
                                        <tr className={styles.detailRow}>
                                            <td colSpan={5}>
                                                <div className={styles.detailContent}>
                                                    <div className={styles.detailBlock}>
                                                        <span className={styles.detailLabel}>문의 내용</span>
                                                        <p className={styles.detailText}>{inquiry.content}</p>
                                                    </div>
                                                    {inquiry.status === 'answered' && inquiry.answeredAt && (
                                                        <div className={styles.detailBlock}>
                                                            <span className={styles.detailLabel}>
                                                                답변일: {formatDate(inquiry.answeredAt)}
                                                            </span>
                                                        </div>
                                                    )}
                                                    <div className={styles.detailBlock}>
                                                        <span className={styles.detailLabel}>
                                                            {inquiry.status === 'answered' ? '답변 수정' : '답변 등록'}
                                                        </span>
                                                        <textarea
                                                            className={styles.answerTextarea}
                                                            value={answerDraft}
                                                            onChange={(e) => setAnswerDraft(e.target.value)}
                                                            placeholder="답변 내용을 입력하세요..."
                                                            rows={4}
                                                        />
                                                        <button
                                                            className={styles.submitBtn}
                                                            onClick={() => handleSubmitAnswer(inquiry.id)}
                                                            disabled={submitting}
                                                        >
                                                            <Send size={14} />
                                                            {submitting ? '등록 중...' : '답변 등록'}
                                                        </button>
                                                    </div>
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
