'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import styles from './RankTrackingPage.module.css';
import {
    ChevronDown,
    ExternalLink,
    Info,
    Minus,
    Plus,
    RefreshCw,
    Search,
    Trash2,
    TrendingDown,
    TrendingUp,
} from 'lucide-react';
import {
    CartesianGrid,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import { toast } from 'sonner';

const MAX_TRACKINGS = 10;

function getValidationMessage(error) {
    if (!error) return '요청을 처리하지 못했습니다.';
    if (typeof error === 'string') return error;

    const firstField = Object.values(error).find(messages => Array.isArray(messages) && messages.length > 0);
    return firstField?.[0] || '입력값을 확인해주세요.';
}

function getRankChange(tracking) {
    if (!tracking.previousRank || !tracking.currentRank) {
        return { type: 'same', label: '신규', Icon: Minus };
    }

    // previousRank - currentRank 가 양수면 순위 숫자가 줄어든 것 = 상승
    const diff = tracking.previousRank - tracking.currentRank;
    if (diff > 0) return { type: 'up', label: `${diff}`, Icon: TrendingUp };
    if (diff < 0) return { type: 'down', label: `${Math.abs(diff)}`, Icon: TrendingDown };
    return { type: 'same', label: '유지', Icon: Minus };
}

function formatDate(value) {
    if (!value) return '-';
    return new Date(value).toLocaleDateString('ko-KR', {
        month: '2-digit',
        day: '2-digit',
    });
}

function parseHistory(tracking) {
    try {
        const parsed = tracking.rankHistory ? JSON.parse(tracking.rankHistory) : [];
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter(point => point && typeof point.rank === 'number')
            .map(point => ({
                // 신규 스냅샷은 date, 구형 데이터는 checkedAt 을 라벨로 사용
                label: point.date || (point.checkedAt ? String(point.checkedAt).slice(5, 10) : ''),
                rank: point.rank,
            }));
    } catch {
        return [];
    }
}

function rankClass(rank) {
    if (rank === 1) return styles.rank1;
    if (rank === 2) return styles.rank2;
    if (rank === 3) return styles.rank3;
    return '';
}

function RankTooltip({ active, payload, label }) {
    if (!active || !payload?.length) return null;
    return (
        <div className={styles.chartTooltip}>
            <span>{label}</span>
            <strong>{payload[0].value}위</strong>
        </div>
    );
}

export default function RankTrackingPage({
    type,
    title,
    subtitle,
    addLabel,
    emptyTitle,
    emptyDescription,
    urlLabel,
    urlPlaceholder,
    nameLabel,
    namePlaceholder,
    keywordPlaceholder,
    Icon,
}) {
    const router = useRouter();
    const { status } = useSession();
    const [trackings, setTrackings] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [refreshingId, setRefreshingId] = useState('');
    const [deletingId, setDeletingId] = useState('');
    const [expandedId, setExpandedId] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [formData, setFormData] = useState({
        url: '',
        name: '',
        keyword: '',
    });
    const [formErrors, setFormErrors] = useState({});

    const fetchTrackings = useCallback(async () => {
        try {
            setLoading(true);
            const res = await fetch(`/api/rank-tracking?type=${type}`);
            const data = await res.json();

            if (res.ok) {
                setTrackings(data.trackings || []);
            } else {
                toast.error(getValidationMessage(data.error));
            }
        } catch (error) {
            console.error('Error fetching rank trackings:', error);
            toast.error('순위 추적 목록을 불러오지 못했습니다.');
        } finally {
            setLoading(false);
        }
    }, [type]);

    useEffect(() => {
        if (status === 'unauthenticated') {
            router.push('/login');
        } else if (status === 'authenticated') {
            fetchTrackings();
        }
    }, [fetchTrackings, router, status]);

    const filteredTrackings = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        if (!query) return trackings;

        return trackings.filter(item =>
            item.name?.toLowerCase().includes(query) ||
            item.keyword?.toLowerCase().includes(query) ||
            item.url?.toLowerCase().includes(query)
        );
    }, [searchQuery, trackings]);

    const isEstimate = useMemo(
        () => trackings.some(item => item.source === 'estimate'),
        [trackings]
    );

    const atLimit = trackings.length >= MAX_TRACKINGS;

    const resetForm = () => {
        setFormData({ url: '', name: '', keyword: '' });
        setFormErrors({});
    };

    const closeModal = () => {
        if (saving) return;
        setIsModalOpen(false);
        resetForm();
    };

    const validateForm = () => {
        const errors = {};
        const url = formData.url.trim();
        const keyword = formData.keyword.trim();

        if (!url) {
            errors.url = 'URL을 입력해주세요.';
        } else if (!/naver\.com/i.test(url)) {
            errors.url = type === 'shopping'
                ? '네이버 쇼핑 또는 스마트스토어 상품 URL을 입력해주세요.'
                : '네이버 플레이스 또는 지도 URL을 입력해주세요.';
        }

        if (!keyword) {
            errors.keyword = '추적할 키워드를 입력해주세요.';
        }

        return errors;
    };

    const handleSubmit = async (event) => {
        event.preventDefault();

        const errors = validateForm();
        if (Object.keys(errors).length > 0) {
            setFormErrors(errors);
            return;
        }

        try {
            setSaving(true);
            const res = await fetch('/api/rank-tracking', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type,
                    url: formData.url.trim(),
                    name: formData.name.trim() || undefined,
                    keyword: formData.keyword.trim(),
                }),
            });
            const data = await res.json();

            if (res.ok) {
                toast.success(data.message);
                closeModal();
                fetchTrackings();
            } else {
                toast.error(getValidationMessage(data.error));
            }
        } catch (error) {
            console.error('Error creating rank tracking:', error);
            toast.error('순위 추적 등록 중 오류가 발생했습니다.');
        } finally {
            setSaving(false);
        }
    };

    const handleRefresh = async (id) => {
        try {
            setRefreshingId(id);
            const res = await fetch('/api/rank-tracking', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id }),
            });
            const data = await res.json();

            if (res.ok) {
                toast.success(data.message);
                setTrackings(prev => prev.map(item => item.id === id ? data.tracking : item));
            } else {
                toast.error(getValidationMessage(data.error));
            }
        } catch (error) {
            console.error('Error refreshing rank tracking:', error);
            toast.error('순위 갱신 중 오류가 발생했습니다.');
        } finally {
            setRefreshingId('');
        }
    };

    const handleDelete = async (id) => {
        if (!confirm('이 순위 추적 항목을 삭제하시겠습니까?')) return;

        try {
            setDeletingId(id);
            const res = await fetch(`/api/rank-tracking?id=${id}`, { method: 'DELETE' });
            const data = await res.json();

            if (res.ok) {
                toast.success(data.message);
                setTrackings(prev => prev.filter(item => item.id !== id));
            } else {
                toast.error(getValidationMessage(data.error));
            }
        } catch (error) {
            console.error('Error deleting rank tracking:', error);
            toast.error('순위 추적 삭제 중 오류가 발생했습니다.');
        } finally {
            setDeletingId('');
        }
    };

    if (status === 'loading') {
        return (
            <DashboardLayout>
                <div className={styles.container}>로딩 중...</div>
            </DashboardLayout>
        );
    }

    return (
        <DashboardLayout>
            <div className={styles.container}>
                <div className={styles.header}>
                    <div className={styles.headerContent}>
                        <h1 className={styles.title}>{title}</h1>
                        <p className={styles.subtitle}>{subtitle}</p>
                    </div>
                    <span className={styles.badge}>무료 {MAX_TRACKINGS}개</span>
                </div>

                <div className={styles.toolbar}>
                    <button
                        className={styles.addBtn}
                        onClick={() => setIsModalOpen(true)}
                        disabled={atLimit}
                    >
                        <Plus size={18} />
                        {addLabel}
                    </button>
                    <div className={styles.searchBox}>
                        <Search size={18} />
                        <input
                            type="text"
                            placeholder="이름, 키워드, URL 검색"
                            value={searchQuery}
                            onChange={(event) => setSearchQuery(event.target.value)}
                        />
                    </div>
                    <button className={styles.refreshListBtn} onClick={fetchTrackings} aria-label="목록 새로고침">
                        <RefreshCw size={18} />
                    </button>
                    <span className={styles.counter}>{trackings.length}/{MAX_TRACKINGS}</span>
                </div>

                {isEstimate && (
                    <div className={styles.estimateBar}>
                        <Info size={15} />
                        현재 추정 데이터로 표시 중 — 네이버 API 키 등록 시 실순위로 전환됩니다.
                    </div>
                )}

                {loading ? (
                    <div className={styles.emptyState}>순위 추적 목록을 불러오는 중입니다.</div>
                ) : filteredTrackings.length === 0 ? (
                    <div className={styles.emptyState}>
                        <Icon size={48} className={styles.emptyIcon} />
                        <h4>{emptyTitle}</h4>
                        <p>{emptyDescription}</p>
                        <div className={styles.emptyExample}>
                            <span>예시</span>
                            {type === 'shopping'
                                ? '스마트스토어 상품 URL + "남자 겨울 패딩" 키워드를 등록하면 매일 순위를 자동으로 기록합니다.'
                                : '네이버 플레이스 URL + "강남 미용실" 키워드를 등록하면 매일 노출 순위를 자동으로 기록합니다.'}
                        </div>
                        <button
                            className={styles.emptyBtn}
                            onClick={() => setIsModalOpen(true)}
                            disabled={atLimit}
                        >
                            <Plus size={18} />
                            {addLabel}
                        </button>
                    </div>
                ) : (
                    <div className={styles.trackingList}>
                        {filteredTrackings.map((tracking) => {
                            const change = getRankChange(tracking);
                            const ChangeIcon = change.Icon;
                            const history = parseHistory(tracking);
                            const sparkData = history.slice(-14);
                            const expandData = history.slice(-30);
                            const bestRank = history.length ? Math.min(...history.map(p => p.rank)) : null;
                            const expanded = expandedId === tracking.id;
                            const refreshing = refreshingId === tracking.id;

                            return (
                                <article key={tracking.id} className={`${styles.row} ${expanded ? styles.rowOpen : ''}`}>
                                    <div
                                        className={styles.rowMain}
                                        onClick={() => setExpandedId(expanded ? '' : tracking.id)}
                                        role="button"
                                        tabIndex={0}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter' || event.key === ' ') {
                                                event.preventDefault();
                                                setExpandedId(expanded ? '' : tracking.id);
                                            }
                                        }}
                                    >
                                        <div className={styles.iconBox}>
                                            {tracking.image ? (
                                                // 사용자가 등록한 외부 이미지라 도메인을 미리 고정할 수 없어 기본 img를 씁니다.
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img src={tracking.image} alt="" />
                                            ) : (
                                                <Icon size={22} />
                                            )}
                                        </div>

                                        <div className={styles.rowInfo}>
                                            <h3 className={styles.itemName}>{tracking.name}</h3>
                                            <p className={styles.keyword}>{tracking.keyword}</p>
                                        </div>

                                        <div className={styles.rankBlock}>
                                            <strong className={`${styles.rankValue} ${tracking.currentRank ? rankClass(tracking.currentRank) : ''}`}>
                                                {tracking.currentRank ? `${tracking.currentRank}위` : '-'}
                                            </strong>
                                            <span className={`${styles.rankChange} ${styles[change.type]}`}>
                                                <ChangeIcon size={13} />
                                                {change.label}
                                            </span>
                                        </div>

                                        <div className={styles.spark}>
                                            {sparkData.length >= 2 ? (
                                                <ResponsiveContainer width="100%" height={44}>
                                                    <LineChart data={sparkData} margin={{ top: 6, bottom: 6, left: 2, right: 2 }}>
                                                        <YAxis hide reversed domain={['dataMin', 'dataMax']} />
                                                        <Line
                                                            type="monotone"
                                                            dataKey="rank"
                                                            stroke="var(--accent)"
                                                            strokeWidth={2}
                                                            dot={false}
                                                            isAnimationActive={false}
                                                        />
                                                    </LineChart>
                                                </ResponsiveContainer>
                                            ) : (
                                                <span className={styles.sparkEmpty}>추이 수집 중</span>
                                            )}
                                        </div>

                                        <div className={styles.rowActions} onClick={(event) => event.stopPropagation()}>
                                            <a
                                                href={tracking.url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className={styles.iconBtn}
                                                aria-label="등록 URL 열기"
                                            >
                                                <ExternalLink size={16} />
                                            </a>
                                            <button
                                                className={styles.iconBtn}
                                                onClick={() => handleRefresh(tracking.id)}
                                                disabled={refreshing}
                                                aria-label="순위 갱신"
                                            >
                                                <RefreshCw size={16} className={refreshing ? styles.spinning : ''} />
                                            </button>
                                            <button
                                                className={`${styles.iconBtn} ${styles.dangerBtn}`}
                                                onClick={() => handleDelete(tracking.id)}
                                                disabled={deletingId === tracking.id}
                                                aria-label="순위 추적 삭제"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                            <ChevronDown
                                                size={18}
                                                className={`${styles.chevron} ${expanded ? styles.chevronOpen : ''}`}
                                            />
                                        </div>
                                    </div>

                                    {expanded && (
                                        <div className={styles.expand}>
                                            <div className={styles.expandChart}>
                                                {expandData.length >= 2 ? (
                                                    <ResponsiveContainer width="100%" height={200}>
                                                        <LineChart data={expandData} margin={{ top: 10, bottom: 4, left: -12, right: 8 }}>
                                                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                                                            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                                                            <YAxis
                                                                reversed
                                                                allowDecimals={false}
                                                                domain={[(min) => Math.max(1, min - 2), (max) => max + 2]}
                                                                tick={{ fontSize: 11, fill: '#94A3B8' }}
                                                                axisLine={false}
                                                                tickLine={false}
                                                                width={44}
                                                            />
                                                            <Tooltip content={<RankTooltip />} />
                                                            <Line
                                                                type="monotone"
                                                                dataKey="rank"
                                                                stroke="var(--accent)"
                                                                strokeWidth={2}
                                                                dot={{ r: 3, fill: 'var(--accent)' }}
                                                                activeDot={{ r: 5 }}
                                                                isAnimationActive={false}
                                                            />
                                                        </LineChart>
                                                    </ResponsiveContainer>
                                                ) : (
                                                    <div className={styles.expandEmpty}>
                                                        아직 추이 데이터가 부족합니다. 매일 접속하거나 새로고침하면 순위 기록이 쌓입니다.
                                                    </div>
                                                )}
                                            </div>
                                            <div className={styles.expandSummary}>
                                                <div>
                                                    <span>등록일</span>
                                                    <strong>{formatDate(tracking.createdAt)}</strong>
                                                </div>
                                                <div>
                                                    <span>최고 순위</span>
                                                    <strong>{bestRank ? `${bestRank}위` : '-'}</strong>
                                                </div>
                                                <div>
                                                    <span>현재 순위</span>
                                                    <strong>{tracking.currentRank ? `${tracking.currentRank}위` : '-'}</strong>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </article>
                            );
                        })}
                    </div>
                )}

                {isModalOpen && (
                    <div className={styles.modalOverlay} onClick={closeModal}>
                        <form className={styles.modal} onSubmit={handleSubmit} onClick={event => event.stopPropagation()}>
                            <div className={styles.modalHeader}>
                                <div>
                                    <h2>{addLabel}</h2>
                                    <span className={styles.modalCounter}>등록 {trackings.length}/{MAX_TRACKINGS}</span>
                                </div>
                                <button type="button" onClick={closeModal}>✕</button>
                            </div>
                            <div className={styles.modalBody}>
                                <label htmlFor="rank-url">{urlLabel}</label>
                                <input
                                    id="rank-url"
                                    type="url"
                                    className={formErrors.url ? styles.inputError : ''}
                                    placeholder={urlPlaceholder}
                                    value={formData.url}
                                    onChange={(event) => {
                                        setFormData(prev => ({ ...prev, url: event.target.value }));
                                        if (formErrors.url) setFormErrors(prev => ({ ...prev, url: '' }));
                                    }}
                                    required
                                />
                                {formErrors.url && <p className={styles.fieldError}>{formErrors.url}</p>}

                                <label htmlFor="rank-name">{nameLabel}</label>
                                <input
                                    id="rank-name"
                                    type="text"
                                    placeholder={namePlaceholder}
                                    value={formData.name}
                                    onChange={(event) => setFormData(prev => ({ ...prev, name: event.target.value }))}
                                />

                                <label htmlFor="rank-keyword">추적 키워드</label>
                                <input
                                    id="rank-keyword"
                                    type="text"
                                    className={formErrors.keyword ? styles.inputError : ''}
                                    placeholder={keywordPlaceholder}
                                    value={formData.keyword}
                                    onChange={(event) => {
                                        setFormData(prev => ({ ...prev, keyword: event.target.value }));
                                        if (formErrors.keyword) setFormErrors(prev => ({ ...prev, keyword: '' }));
                                    }}
                                    required
                                />
                                {formErrors.keyword && <p className={styles.fieldError}>{formErrors.keyword}</p>}

                                <p className={styles.modalHint}>
                                    등록 즉시 현재 순위를 1회 조회하고, 이후 매일 접속하거나 새로고침할 때마다 자동으로 추이가 기록됩니다.
                                </p>
                            </div>
                            <div className={styles.modalFooter}>
                                <button type="button" className={styles.cancelBtn} onClick={closeModal}>
                                    취소
                                </button>
                                <button type="submit" className={styles.submitBtn} disabled={saving}>
                                    {saving ? '등록 중...' : '추가'}
                                </button>
                            </div>
                        </form>
                    </div>
                )}
            </div>
        </DashboardLayout>
    );
}
