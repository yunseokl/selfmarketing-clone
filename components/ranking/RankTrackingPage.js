'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import LoadError from '@/components/ui/LoadError';
import styles from './RankTrackingPage.module.css';
import {
    ChevronDown,
    ExternalLink,
    Info,
    Minus,
    Pencil,
    Plus,
    RefreshCw,
    ScanSearch,
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
    if ((tracking.recordCount || 0) < 2) {
        return { type: 'same', label: tracking.recordCount ? '첫 기록' : '기록 전', Icon: Minus };
    }
    // 둘 중 하나가 "순위권 밖"이면 계단 수를 계산할 수 없습니다.
    if (!tracking.previousRank || !tracking.currentRank) {
        return { type: 'same', label: '-', Icon: Minus };
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

// 차트용: 순위 숫자가 있는 기록만 (순위권 밖은 선에서 제외)
function chartPoints(tracking) {
    return (tracking.history || [])
        .filter(point => typeof point.rank === 'number')
        .map(point => ({ label: point.date.slice(5).replace('-', '/'), rank: point.rank }));
}

function rankText(tracking) {
    if (!tracking.recordCount) return '기록 없음';
    return tracking.currentRank ? `${tracking.currentRank}위` : '순위권 밖';
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
    const [loadError, setLoadError] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [recordingId, setRecordingId] = useState('');
    const [lookingUpId, setLookingUpId] = useState('');
    const [today, setToday] = useState('');
    const [recordForm, setRecordForm] = useState({ date: '', rank: '', outOfRank: false });
    const [deletingId, setDeletingId] = useState('');
    const [expandedId, setExpandedId] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [formData, setFormData] = useState({
        url: '',
        name: '',
        keyword: '',
        rank: '',
    });
    const [formErrors, setFormErrors] = useState({});

    const fetchTrackings = useCallback(async () => {
        try {
            setLoading(true);
            const res = await fetch(`/api/rank-tracking?type=${type}`);
            const data = await res.json();

            if (res.ok) {
                setTrackings(data.trackings || []);
                setToday(data.today || '');
                setLoadError(false);
            } else {
                setLoadError(true);
            }
        } catch (error) {
            console.error('Error fetching rank trackings:', error);
            setLoadError(true);
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

    const atLimit = trackings.length >= MAX_TRACKINGS;

    // 한도에 닿아도 버튼을 꺼 두지 않고, 눌렀을 때 이유와 방법을 알려 줍니다.
    const openAddModal = () => {
        if (atLimit) {
            toast.error(`최대 ${MAX_TRACKINGS}개까지 등록할 수 있습니다. 쓰지 않는 항목을 삭제한 뒤 추가해주세요.`);
            return;
        }
        setIsModalOpen(true);
    };

    const resetForm = () => {
        setFormData({ url: '', name: '', keyword: '', rank: '' });
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
        } else if (!/naver\.(com|me)/i.test(url)) {
            errors.url = type === 'shopping'
                ? '네이버 쇼핑 또는 스마트스토어 상품 URL을 입력해주세요.'
                : '네이버 플레이스 또는 지도 URL을 입력해주세요.';
        }

        if (!keyword) {
            errors.keyword = '기록할 키워드를 입력해주세요.';
        }

        const rank = formData.rank.trim();
        if (rank && !(Number.isInteger(Number(rank)) && Number(rank) >= 1 && Number(rank) <= 1000)) {
            errors.rank = '순위는 1~1000 사이 숫자로 입력해주세요.';
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
                    rank: formData.rank.trim() ? Number(formData.rank.trim()) : undefined,
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
            toast.error('등록 중 오류가 발생했습니다.');
        } finally {
            setSaving(false);
        }
    };

    const openRecord = (id) => {
        setExpandedId(id);
        setRecordForm({ date: today, rank: '', outOfRank: false });
    };

    const toggleExpand = (id) => {
        if (expandedId === id) {
            setExpandedId('');
        } else {
            openRecord(id);
        }
    };

    const sendRecord = async (id, payload, failMessage) => {
        try {
            setRecordingId(id);
            const res = await fetch('/api/rank-tracking', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, ...payload }),
            });
            const data = await res.json();

            if (res.ok) {
                toast.success(data.message);
                setTrackings(prev => prev.map(item => item.id === id ? data.tracking : item));
                return true;
            }
            toast.error(getValidationMessage(data.error));
        } catch (error) {
            console.error('Error recording rank:', error);
            toast.error(failMessage);
        } finally {
            setRecordingId('');
        }
        return false;
    };

    const handleRecord = async (event, id) => {
        event.preventDefault();
        const rankNumber = Number(recordForm.rank);
        if (!recordForm.outOfRank && !(Number.isInteger(rankNumber) && rankNumber >= 1 && rankNumber <= 1000)) {
            toast.error('순위는 1~1000 사이 숫자로 입력하거나 "순위권 밖"을 선택해주세요.');
            return;
        }
        const ok = await sendRecord(
            id,
            { date: recordForm.date || today, rank: recordForm.outOfRank ? null : rankNumber },
            '순위 기록 중 오류가 발생했습니다.'
        );
        if (ok) setRecordForm(prev => ({ ...prev, rank: '', outOfRank: false }));
    };

    // 플레이스 전용: 네이버 목록에서 실제 순위를 찾아 오늘 기록으로 저장합니다.
    const handleLookup = async (id) => {
        try {
            setLookingUpId(id);
            const res = await fetch('/api/place-insight/rank', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ trackingId: id }),
            });
            const data = await res.json();
            if (!res.ok) {
                toast.error(data.disabled
                    ? "실제 순위 조회가 지금 꺼져 있습니다. 직접 확인한 순위는 '기록'으로 남길 수 있어요."
                    : typeof data.error === 'string' ? data.error : '순위를 조회하지 못했습니다.');
                return;
            }
            if (!data.recorded?.saved) {
                toast.error('이 키워드로 검색된 매장이 없어 기록하지 않았습니다. 키워드를 확인해주세요.');
                return;
            }
            toast.success(data.result.status === 'found'
                ? `지금 ${data.result.rank}위입니다. 오늘 기록으로 저장했습니다.`
                : '1,000위 안에서 찾지 못해 순위권 밖으로 기록했습니다.');
            // 화면을 '불러오는 중'으로 바꾸지 않고 목록만 새로 받아옵니다.
            const fresh = await fetch(`/api/rank-tracking?type=${type}`);
            if (fresh.ok) {
                const list = await fresh.json();
                setTrackings(list.trackings || []);
                setToday(list.today || '');
            }
        } catch (error) {
            console.error('Error looking up rank:', error);
            toast.error('순위 조회 중 오류가 발생했습니다.');
        } finally {
            setLookingUpId('');
        }
    };

    const handleRemoveRecord = async (id, date) => {
        if (!confirm(`${date} 기록을 삭제하시겠습니까?`)) return;
        await sendRecord(id, { date, remove: true }, '기록 삭제 중 오류가 발생했습니다.');
    };

    const handleDelete = async (id) => {
        if (!confirm('이 항목과 기록을 모두 삭제하시겠습니까?')) return;

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
            toast.error('삭제 중 오류가 발생했습니다.');
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
                    <span className={styles.badge}>무료 · {MAX_TRACKINGS}개까지</span>
                </div>

                <div className={styles.toolbar}>
                    <button className={styles.addBtn} onClick={openAddModal}>
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

                <div className={styles.estimateBar}>
                    <Info size={15} />
                    <span>
                        {type === 'shopping'
                            ? '네이버 쇼핑에서 키워드를 검색해 내 상품이 광고를 빼고 몇 번째인지 세어 기록하세요.'
                            : '네이버 지도·플레이스에서 키워드를 검색해 내 가게가 광고를 빼고 몇 번째인지 세어 기록하세요.'}
                        {' '}매주 같은 요일·시간, {type === 'place' ? '같은 위치에서 ' : '로그아웃 상태에서 '}확인하면 추이를 비교하기 좋아요.
                        {type === 'place'
                            ? " '지금 조회'를 누르면 네이버 목록에서 실제 순위를 찾아 오늘 기록으로 저장합니다. 지어낸 값은 보여 드리지 않습니다."
                            : ' 순위는 자동으로 조회하지 않으며, 직접 적은 값만 보여 드립니다.'}
                    </span>
                </div>

                {loading ? (
                    <div className={styles.emptyState}>순위 기록장을 불러오는 중입니다.</div>
                ) : loadError ? (
                    <div className={styles.emptyState}>
                        <LoadError message="순위 기록장을 불러오지 못했습니다." onRetry={fetchTrackings} />
                    </div>
                ) : filteredTrackings.length === 0 && trackings.length > 0 ? (
                    <div className={styles.emptyState}>
                        <Search size={40} className={styles.emptyIcon} />
                        <h4>검색 결과가 없습니다.</h4>
                        <p>&lsquo;{searchQuery.trim()}&rsquo;에 맞는 항목이 없어요. 등록한 항목은 {trackings.length}개입니다.</p>
                        <button className={styles.emptyBtn} onClick={() => setSearchQuery('')}>
                            검색어 지우기
                        </button>
                    </div>
                ) : filteredTrackings.length === 0 ? (
                    <div className={styles.emptyState}>
                        <Icon size={48} className={styles.emptyIcon} />
                        <h4>{emptyTitle}</h4>
                        <p>{emptyDescription}</p>
                        <div className={styles.emptyExample}>
                            <span>예시</span>
                            {type === 'shopping'
                                ? '스마트스토어 상품 URL + "남자 겨울 패딩" 키워드를 등록하고, 검색해서 확인한 순위를 주 1회 적어 보세요.'
                                : '네이버 플레이스 URL + "강남 미용실" 키워드를 등록하고, 검색해서 확인한 순위를 주 1회 적어 보세요.'}
                        </div>
                        <button className={styles.emptyBtn} onClick={openAddModal}>
                            <Plus size={18} />
                            {addLabel}
                        </button>
                    </div>
                ) : (
                    <div className={styles.trackingList}>
                        {filteredTrackings.map((tracking) => {
                            const change = getRankChange(tracking);
                            const ChangeIcon = change.Icon;
                            const history = chartPoints(tracking);
                            const sparkData = history.slice(-14);
                            const expandData = history.slice(-30);
                            const bestRank = history.length ? Math.min(...history.map(p => p.rank)) : null;
                            const expanded = expandedId === tracking.id;
                            const recording = recordingId === tracking.id;
                            const recentRecords = [...(tracking.history || [])].reverse().slice(0, 8);

                            return (
                                <article key={tracking.id} className={`${styles.row} ${expanded ? styles.rowOpen : ''}`}>
                                    <div
                                        className={styles.rowMain}
                                        onClick={() => toggleExpand(tracking.id)}
                                        role="button"
                                        tabIndex={0}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter' || event.key === ' ') {
                                                event.preventDefault();
                                                toggleExpand(tracking.id);
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
                                            <strong className={`${styles.rankValue} ${tracking.currentRank ? rankClass(tracking.currentRank) : styles.rankNone}`}>
                                                {rankText(tracking)}
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
                                                <span className={styles.sparkEmpty}>2회 기록부터 추이 표시</span>
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
                                            {type === 'place' && (
                                                <button
                                                    type="button"
                                                    className={styles.lookupBtn}
                                                    onClick={() => handleLookup(tracking.id)}
                                                    disabled={lookingUpId !== ''}
                                                >
                                                    <ScanSearch size={14} />
                                                    {lookingUpId === tracking.id ? '조회 중' : '지금 조회'}
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                className={styles.recordBtn}
                                                onClick={() => openRecord(tracking.id)}
                                            >
                                                <Pencil size={14} />
                                                기록
                                            </button>
                                            <button
                                                className={`${styles.iconBtn} ${styles.dangerBtn}`}
                                                onClick={() => handleDelete(tracking.id)}
                                                disabled={deletingId === tracking.id}
                                                aria-label="항목 삭제"
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
                                            <form className={styles.recordForm} onSubmit={(event) => handleRecord(event, tracking.id)}>
                                                <div className={styles.recordField}>
                                                    <label htmlFor={`record-date-${tracking.id}`}>확인한 날짜</label>
                                                    <input
                                                        id={`record-date-${tracking.id}`}
                                                        type="date"
                                                        max={today || undefined}
                                                        value={recordForm.date}
                                                        onChange={(event) => setRecordForm(prev => ({ ...prev, date: event.target.value }))}
                                                        required
                                                    />
                                                </div>
                                                <div className={styles.recordField}>
                                                    <label htmlFor={`record-rank-${tracking.id}`}>순위</label>
                                                    <input
                                                        id={`record-rank-${tracking.id}`}
                                                        type="number"
                                                        inputMode="numeric"
                                                        min="1"
                                                        max="1000"
                                                        placeholder="예: 12"
                                                        value={recordForm.rank}
                                                        disabled={recordForm.outOfRank}
                                                        onChange={(event) => setRecordForm(prev => ({ ...prev, rank: event.target.value }))}
                                                    />
                                                </div>
                                                <label className={styles.recordCheck}>
                                                    <input
                                                        type="checkbox"
                                                        checked={recordForm.outOfRank}
                                                        onChange={(event) => setRecordForm(prev => ({ ...prev, outOfRank: event.target.checked, rank: '' }))}
                                                    />
                                                    순위권 밖 (찾지 못함)
                                                </label>
                                                <button type="submit" className={styles.recordSubmit} disabled={recording}>
                                                    {recording ? '기록 중...' : '순위 기록'}
                                                </button>
                                            </form>

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
                                                        순위를 2회 이상 기록하면 여기에 추이 그래프가 그려집니다.
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
                                                    <span>최근 기록</span>
                                                    <strong>{tracking.recordCount ? rankText(tracking) : '-'}</strong>
                                                </div>
                                            </div>

                                            {recentRecords.length > 0 && (
                                                <div className={styles.recordList}>
                                                    <h4>최근 기록</h4>
                                                    <ul>
                                                        {recentRecords.map((record) => (
                                                            <li key={record.date}>
                                                                <span>{record.date}</span>
                                                                <strong>{record.rank ? `${record.rank}위` : '순위권 밖'}</strong>
                                                                <em>{record.src === 'live' ? '실제 조회' : '직접 기록'}</em>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleRemoveRecord(tracking.id, record.date)}
                                                                    disabled={recording}
                                                                    aria-label={`${record.date} 기록 삭제`}
                                                                >
                                                                    <Trash2 size={14} />
                                                                </button>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            )}
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

                                <label htmlFor="rank-keyword">검색 키워드</label>
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

                                <label htmlFor="rank-first">오늘 확인한 순위 (선택)</label>
                                <input
                                    id="rank-first"
                                    type="number"
                                    inputMode="numeric"
                                    min="1"
                                    max="1000"
                                    className={formErrors.rank ? styles.inputError : ''}
                                    placeholder="예: 12 (나중에 기록해도 됩니다)"
                                    value={formData.rank}
                                    onChange={(event) => {
                                        setFormData(prev => ({ ...prev, rank: event.target.value }));
                                        if (formErrors.rank) setFormErrors(prev => ({ ...prev, rank: '' }));
                                    }}
                                />
                                {formErrors.rank && <p className={styles.fieldError}>{formErrors.rank}</p>}

                                <p className={styles.modalHint}>
                                    {type === 'place'
                                        ? "등록한 뒤 '지금 조회'를 누르면 실제 순위를 찾아 기록합니다. 직접 확인한 순위를 적어도 됩니다."
                                        : '순위는 자동으로 조회되지 않습니다. 검색해서 직접 확인한 순위를 기록하면 날짜별 추이를 그래프로 보여 드립니다.'}
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
