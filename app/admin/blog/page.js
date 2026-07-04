'use client';

import { Fragment, useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import styles from './page.module.css';
import { ArrowLeft, RefreshCw, FileText, ChevronDown, Plus, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

const statusOptions = [
    { id: 'all', label: '전체' },
    { id: 'pending', label: '접수' },
    { id: 'in_progress', label: '진행중' },
    { id: 'completed', label: '완료' },
    { id: 'cancelled', label: '취소' },
];

const statusLabel = (status) => statusOptions.find(s => s.id === status)?.label || status;

export default function AdminBlogCampaignsPage() {
    const { status: sessionStatus } = useSession();
    const router = useRouter();
    const [campaigns, setCampaigns] = useState([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState('all');
    const [expandedId, setExpandedId] = useState(null);
    const [linkDraft, setLinkDraft] = useState('');
    const [saving, setSaving] = useState(false);

    const fetchCampaigns = useCallback(async () => {
        try {
            setLoading(true);
            const params = new URLSearchParams();
            if (statusFilter !== 'all') params.set('status', statusFilter);
            const res = await fetch(`/api/admin/blog-campaigns?${params.toString()}`);
            if (res.ok) {
                const data = await res.json();
                setCampaigns(data.campaigns || []);
            }
        } catch (error) {
            console.error('Error fetching blog campaigns:', error);
        } finally {
            setLoading(false);
        }
    }, [statusFilter]);

    useEffect(() => {
        if (sessionStatus === 'unauthenticated') {
            router.push('/login');
        } else if (sessionStatus === 'authenticated') {
            fetchCampaigns();
        }
    }, [fetchCampaigns, router, sessionStatus]);

    const handleToggleRow = (campaign) => {
        setExpandedId(expandedId === campaign.id ? null : campaign.id);
        setLinkDraft('');
    };

    const handleUpdateStatus = async (campaignId, newStatus) => {
        try {
            const res = await fetch(`/api/admin/blog-campaigns/${campaignId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus }),
            });
            if (res.ok) {
                toast.success('상태가 변경되었습니다.');
                fetchCampaigns();
            } else {
                const data = await res.json();
                toast.error(data.error || '상태 변경에 실패했습니다.');
            }
        } catch (error) {
            console.error('Error updating status:', error);
            toast.error('상태 변경 중 오류가 발생했습니다.');
        }
    };

    const handleAddLink = async (campaignId) => {
        if (!linkDraft.trim()) {
            toast.error('발행 링크 URL을 입력해주세요.');
            return;
        }
        setSaving(true);
        try {
            const res = await fetch(`/api/admin/blog-campaigns/${campaignId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ addLink: linkDraft.trim() }),
            });
            if (res.ok) {
                toast.success('발행 링크가 추가되었습니다.');
                setLinkDraft('');
                fetchCampaigns();
            } else {
                const data = await res.json();
                toast.error(data.error || '링크 추가에 실패했습니다.');
            }
        } catch (error) {
            console.error('Error adding link:', error);
            toast.error('링크 추가 중 오류가 발생했습니다.');
        } finally {
            setSaving(false);
        }
    };

    const parseLinks = (publishedLinks) => {
        if (!publishedLinks) return [];
        try {
            return JSON.parse(publishedLinks);
        } catch {
            return [];
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
            in_progress: { bg: '#D1FAE5', color: '#059669' },
            completed: { bg: '#E0E7FF', color: '#4F46E5' },
            cancelled: { bg: '#FEE2E2', color: '#DC2626' },
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
                        <h1 className={styles.title}>블로그 캠페인 관리</h1>
                        <p className={styles.subtitle}>플레이스 블로그 배포 신청 관리</p>
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
                <button className={styles.refreshBtn} onClick={fetchCampaigns}>
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
                            <th>업체명</th>
                            <th>키워드</th>
                            <th>배포 수</th>
                            <th>금액</th>
                            <th>상태</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr>
                                <td colSpan={7} className={styles.emptyCell}>로딩 중...</td>
                            </tr>
                        ) : campaigns.length === 0 ? (
                            <tr>
                                <td colSpan={7} className={styles.emptyCell}>
                                    <FileText size={48} className={styles.emptyIcon} />
                                    <p>블로그 캠페인이 없습니다.</p>
                                </td>
                            </tr>
                        ) : (
                            campaigns.map(campaign => (
                                <Fragment key={campaign.id}>
                                    <tr
                                        className={styles.clickableRow}
                                        onClick={() => handleToggleRow(campaign)}
                                    >
                                        <td>{formatDate(campaign.createdAt)}</td>
                                        <td>{campaign.user?.name || campaign.user?.email || '-'}</td>
                                        <td className={styles.placeName}>{campaign.placeName}</td>
                                        <td><span className={styles.keyword}>{campaign.keyword}</span></td>
                                        <td>{campaign.publishedCount}/{campaign.postCount}건</td>
                                        <td className={styles.amount}>{campaign.totalCost?.toLocaleString()}원</td>
                                        <td className={styles.statusCell}>
                                            {getStatusBadge(campaign.status)}
                                            <ChevronDown
                                                size={16}
                                                className={`${styles.chevron} ${expandedId === campaign.id ? styles.chevronOpen : ''}`}
                                            />
                                        </td>
                                    </tr>
                                    {expandedId === campaign.id && (
                                        <tr className={styles.detailRow}>
                                            <td colSpan={7}>
                                                <div className={styles.detailContent}>
                                                    <div className={styles.detailInfo}>
                                                        <a
                                                            href={campaign.placeUrl}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className={styles.urlLink}
                                                        >
                                                            플레이스 링크 보기
                                                            <ExternalLink size={12} />
                                                        </a>
                                                        {campaign.requirement && (
                                                            <p className={styles.requirement}>
                                                                요청사항: {campaign.requirement}
                                                            </p>
                                                        )}
                                                    </div>

                                                    <div className={styles.detailBlock}>
                                                        <span className={styles.detailLabel}>상태 변경</span>
                                                        <select
                                                            className={styles.statusSelect}
                                                            value={campaign.status}
                                                            onChange={(e) => handleUpdateStatus(campaign.id, e.target.value)}
                                                        >
                                                            <option value="pending">접수</option>
                                                            <option value="in_progress">진행중</option>
                                                            <option value="completed">완료</option>
                                                            <option value="cancelled">취소</option>
                                                        </select>
                                                    </div>

                                                    <div className={styles.detailBlock}>
                                                        <span className={styles.detailLabel}>
                                                            발행 링크 ({campaign.publishedCount}/{campaign.postCount}건)
                                                        </span>
                                                        {parseLinks(campaign.publishedLinks).length > 0 && (
                                                            <ul className={styles.linkList}>
                                                                {parseLinks(campaign.publishedLinks).map((link, idx) => (
                                                                    <li key={idx}>
                                                                        <a href={link} target="_blank" rel="noopener noreferrer">
                                                                            {link}
                                                                        </a>
                                                                    </li>
                                                                ))}
                                                            </ul>
                                                        )}
                                                        <div className={styles.linkAddRow}>
                                                            <input
                                                                type="text"
                                                                className={styles.linkInput}
                                                                placeholder="발행된 블로그 글 URL을 입력하세요"
                                                                value={linkDraft}
                                                                onChange={(e) => setLinkDraft(e.target.value)}
                                                            />
                                                            <button
                                                                className={styles.addLinkBtn}
                                                                onClick={() => handleAddLink(campaign.id)}
                                                                disabled={saving}
                                                            >
                                                                <Plus size={14} />
                                                                추가
                                                            </button>
                                                        </div>
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
