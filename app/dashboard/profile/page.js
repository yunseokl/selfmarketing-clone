'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/layout/DashboardLayout';
import LoadError from '@/components/ui/LoadError';
import styles from './page.module.css';
import {
    User, Shield, Building, ChevronRight, Settings,
    Bell, TrendingUp, Wallet, Megaphone, MessageCircle, Info, Mail, CheckCircle2, Clock,
} from 'lucide-react';
import { toast } from 'sonner';
import { buildBusinessRequest, formatBusinessNumber, isBusinessRequest } from '@/lib/business';

const EMPTY_BUSINESS_FORM = { company: '', number: '', owner: '', email: '', businessType: '', address: '' };

const tabs = [
    { id: 'profile', label: '프로필 정보', icon: User },
    { id: 'notifications', label: '알림', icon: Bell },
    { id: 'security', label: '보안 설정', icon: Shield },
    { id: 'business', label: '사업자 정보', icon: Building },
];

const NOTIF_STYLE = {
    rank: { icon: TrendingUp, color: '#A78BFA', bg: 'rgba(139, 92, 246, 0.15)' },
    cash: { icon: Wallet, color: '#FBBF24', bg: 'rgba(245, 158, 11, 0.15)' },
    ad: { icon: Megaphone, color: '#60A5FA', bg: 'rgba(37, 99, 235, 0.15)' },
    inquiry: { icon: MessageCircle, color: '#34D399', bg: 'rgba(16, 185, 129, 0.15)' },
    notice: { icon: Bell, color: '#F472B6', bg: 'rgba(236, 72, 153, 0.15)' },
    system: { icon: Info, color: '#94A3B8', bg: 'rgba(148, 163, 184, 0.15)' },
};

function timeAgo(dateStr) {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return '방금 전';
    if (diffMin < 60) return `${diffMin}분 전`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}시간 전`;
    const diffDay = Math.floor(diffHour / 24);
    if (diffDay < 7) return `${diffDay}일 전`;
    return new Date(dateStr).toLocaleDateString('ko-KR');
}

import { Skeleton } from '@/components/ui/skeleton';

export default function ProfilePage() {
    const { data: session } = useSession();
    const router = useRouter();
    const [activeTab, setActiveTab] = useState('profile');
    const [userInfo, setUserInfo] = useState(null);
    const [loading, setLoading] = useState(true);
    const [notifications, setNotifications] = useState([]);
    const [notifLoading, setNotifLoading] = useState(true);
    const [markingAll, setMarkingAll] = useState(false);
    const [cashSummary, setCashSummary] = useState(null);
    const [editForm, setEditForm] = useState({ name: '', phone: '' });
    const [savingProfile, setSavingProfile] = useState(false);
    const [showPasswordForm, setShowPasswordForm] = useState(false);
    const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
    const [changingPassword, setChangingPassword] = useState(false);
    const [businessForm, setBusinessForm] = useState(EMPTY_BUSINESS_FORM);
    const [businessErrors, setBusinessErrors] = useState({});
    const [businessRequests, setBusinessRequests] = useState([]);
    const [businessLoading, setBusinessLoading] = useState(false);
    const [businessLoadError, setBusinessLoadError] = useState(false);
    const [submittingBusiness, setSubmittingBusiness] = useState(false);

    useEffect(() => {
        // Minimum loading time for smooth transition
        const timer = setTimeout(() => {
            fetchUserInfo();
        }, 800);
        return () => clearTimeout(timer);
    }, []);

    useEffect(() => {
        fetchNotifications();
        fetchCashSummary();
    }, []);

    useEffect(() => {
        if (userInfo) {
            setEditForm({ name: userInfo.name || '', phone: userInfo.phone || '' });
            // 세금계산서 이메일은 가입 이메일을 기본으로 채워 둡니다(직접 바꿀 수 있음).
            setBusinessForm((prev) => (prev.email ? prev : { ...prev, email: userInfo.email || '' }));
        }
    }, [userInfo]);

    // 사업자 정보 등록 요청은 1:1 문의(충전·결제)로 접수되므로, 그중 등록 요청만 골라 보여 줍니다.
    const fetchBusinessRequests = useCallback(async () => {
        try {
            setBusinessLoading(true);
            const res = await fetch('/api/inquiries?category=payment');
            if (!res.ok) {
                setBusinessLoadError(true);
                return;
            }
            const data = await res.json();
            setBusinessRequests((data.inquiries || []).filter(isBusinessRequest));
            setBusinessLoadError(false);
        } catch (error) {
            console.error('Error fetching business requests:', error);
            setBusinessLoadError(true);
        } finally {
            setBusinessLoading(false);
        }
    }, []);

    useEffect(() => {
        if (activeTab === 'business') fetchBusinessRequests();
    }, [activeTab, fetchBusinessRequests]);

    const fetchUserInfo = async () => {
        try {
            const res = await fetch('/api/user');
            if (res.ok) {
                const data = await res.json();
                setUserInfo(data.user);
            }
        } catch (error) {
            console.error('Error fetching user info:', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchNotifications = async () => {
        try {
            const res = await fetch('/api/notifications');
            if (res.ok) {
                const data = await res.json();
                setNotifications(data.notifications || []);
            }
        } catch (error) {
            console.error('Error fetching notifications:', error);
        } finally {
            setNotifLoading(false);
        }
    };

    const fetchCashSummary = async () => {
        try {
            const res = await fetch('/api/cash');
            if (res.ok) {
                const data = await res.json();
                const transactions = data.transactions || [];
                const totalCharged = transactions
                    .filter(t => t.type === 'charge' && t.status === 'completed')
                    .reduce((sum, t) => sum + t.amount, 0);
                const totalUsed = transactions
                    .filter(t => t.type === 'use')
                    .reduce((sum, t) => sum + Math.abs(t.amount), 0);
                setCashSummary({ totalCharged, totalUsed });
            }
        } catch (error) {
            console.error('Error fetching cash summary:', error);
        }
    };

    const markAsRead = async (id) => {
        setNotifications(prev => prev.map(n => (n.id === id ? { ...n, isRead: true } : n)));
        try {
            await fetch('/api/notifications', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id }),
            });
        } catch (error) {
            console.error('Error marking notification as read:', error);
        }
    };

    const markAllAsRead = async () => {
        setMarkingAll(true);
        setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
        try {
            await fetch('/api/notifications', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ all: true }),
            });
        } catch (error) {
            console.error('Error marking all notifications as read:', error);
        } finally {
            setMarkingAll(false);
        }
    };

    const handleNotificationClick = (notif) => {
        if (!notif.isRead) markAsRead(notif.id);
        if (notif.link) router.push(notif.link);
    };

    const handleProfileSave = async (e) => {
        e.preventDefault();
        setSavingProfile(true);
        try {
            const res = await fetch('/api/user', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: editForm.name, phone: editForm.phone }),
            });
            const data = await res.json();
            if (res.ok) {
                toast.success(data.message || '정보가 수정되었습니다.');
                fetchUserInfo();
            } else {
                toast.error(data.error || '정보 수정에 실패했습니다.');
            }
        } catch (error) {
            console.error('Error saving profile:', error);
            toast.error('정보 수정 중 오류가 발생했습니다.');
        } finally {
            setSavingProfile(false);
        }
    };

    const handlePasswordChange = async (e) => {
        e.preventDefault();
        if (passwordForm.newPassword !== passwordForm.confirmPassword) {
            toast.error('새 비밀번호가 일치하지 않습니다.');
            return;
        }
        if (passwordForm.newPassword.length < 8) {
            toast.error('새 비밀번호는 8자 이상이어야 합니다.');
            return;
        }
        setChangingPassword(true);
        try {
            const res = await fetch('/api/user', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    currentPassword: passwordForm.currentPassword,
                    newPassword: passwordForm.newPassword,
                }),
            });
            const data = await res.json();
            if (res.ok) {
                toast.success(data.message || '비밀번호가 변경되었습니다.');
                setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
                setShowPasswordForm(false);
            } else {
                toast.error(data.error || '비밀번호 변경에 실패했습니다.');
            }
        } catch (error) {
            console.error('Error changing password:', error);
            toast.error('비밀번호 변경 중 오류가 발생했습니다.');
        } finally {
            setChangingPassword(false);
        }
    };

    const setBusinessField = (key, value) => {
        setBusinessForm((prev) => ({ ...prev, [key]: value }));
        if (businessErrors[key]) setBusinessErrors((prev) => ({ ...prev, [key]: '' }));
    };

    const handleBusinessSubmit = async (e) => {
        e.preventDefault();
        const request = buildBusinessRequest(businessForm);
        if (!request.ok) {
            setBusinessErrors(request.errors);
            toast.error(Object.values(request.errors)[0]);
            return;
        }
        setBusinessErrors({});
        setSubmittingBusiness(true);
        try {
            const res = await fetch('/api/inquiries', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ category: 'payment', title: request.title, content: request.content }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok) {
                toast.error(data?.error || '등록 요청을 보내지 못했습니다.');
                return;
            }
            toast.success('사업자 정보 등록을 요청했습니다. 담당자가 확인 후 답변드릴게요.');
            setBusinessForm({ ...EMPTY_BUSINESS_FORM, email: userInfo?.email || '' });
            fetchBusinessRequests();
        } catch (error) {
            console.error('Error submitting business request:', error);
            toast.error('등록 요청 중 오류가 발생했습니다.');
        } finally {
            setSubmittingBusiness(false);
        }
    };

    const openPasswordChange = () => {
        setActiveTab('security');
        setShowPasswordForm(true);
    };

    const isAdmin = userInfo?.role === 'admin';
    const hasUnreadNotifications = notifications.some(n => !n.isRead);

    return (
        <DashboardLayout>
            <div className={styles.container}>
                <div className={styles.header}>
                    <h1 className={styles.title}>내 정보</h1>
                    {isAdmin && (
                        <Link href="/admin" className={styles.adminLink}>
                            <Settings size={18} />
                            관리자 페이지
                        </Link>
                    )}
                </div>

                <div className={styles.content}>
                    {/* Tabs */}
                    <div className={styles.sidebar}>
                        {tabs.map(tab => {
                            const Icon = tab.icon;
                            return (
                                <button
                                    key={tab.id}
                                    className={`${styles.tabBtn} ${activeTab === tab.id ? styles.active : ''}`}
                                    onClick={() => setActiveTab(tab.id)}
                                >
                                    <Icon size={18} />
                                    <span>{tab.label}</span>
                                    <ChevronRight size={16} className={styles.arrow} />
                                </button>
                            );
                        })}
                    </div>

                    {/* Content */}
                    <div className={styles.main}>
                        {activeTab === 'profile' && (
                            <div className={styles.section}>
                                <h2 className={styles.sectionTitle}>프로필 정보</h2>
                                <div className={styles.infoGrid}>
                                    <div className={styles.infoItem}>
                                        <label>이메일</label>
                                        {loading ? <Skeleton className="h-6 w-48" /> : <span>{userInfo?.email || '-'}</span>}
                                    </div>
                                    <div className={styles.infoItem}>
                                        <label>이름</label>
                                        {loading ? <Skeleton className="h-6 w-24" /> : <span>{userInfo?.name || '-'}</span>}
                                    </div>
                                    <div className={styles.infoItem}>
                                        <label>휴대폰 번호</label>
                                        {loading ? <Skeleton className="h-6 w-32" /> : <span>{userInfo?.phone || '-'}</span>}
                                    </div>
                                    <div className={styles.infoItem}>
                                        <label>잔액</label>
                                        {loading ? <Skeleton className="h-8 w-24" /> : <span className={styles.balance}>{userInfo?.balance?.toLocaleString() || 0}원</span>}
                                    </div>
                                    <div className={styles.infoItem}>
                                        <label>회원 등급</label>
                                        {loading ? <Skeleton className="h-6 w-20" /> : (
                                            <span className={`${styles.badge} ${isAdmin ? styles.adminBadge : ''}`}>
                                                {isAdmin ? '관리자' : '일반 회원'}
                                            </span>
                                        )}
                                    </div>
                                    <div className={styles.infoItem}>
                                        <label>가입일</label>
                                        <span>{userInfo?.createdAt ? new Date(userInfo.createdAt).toLocaleDateString('ko-KR') : '-'}</span>
                                    </div>
                                </div>

                                <form className={styles.editForm} onSubmit={handleProfileSave}>
                                    <h3>정보 수정</h3>
                                    <div className={styles.editFieldRow}>
                                        <div className={styles.editField}>
                                            <label htmlFor="editName">이름</label>
                                            <input
                                                id="editName"
                                                type="text"
                                                className="glass-input"
                                                value={editForm.name}
                                                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                                                placeholder="이름을 입력하세요"
                                            />
                                        </div>
                                        <div className={styles.editField}>
                                            <label htmlFor="editPhone">휴대폰 번호</label>
                                            <input
                                                id="editPhone"
                                                type="tel"
                                                className="glass-input"
                                                value={editForm.phone}
                                                onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                                                placeholder="010-0000-0000"
                                            />
                                        </div>
                                    </div>
                                    <button type="submit" className="btn btn-primary" disabled={savingProfile || loading}>
                                        {savingProfile ? '저장 중...' : '저장하기'}
                                    </button>
                                </form>

                                <div className={styles.socialSection}>
                                    <h3>로그인 방법</h3>
                                    <div className={styles.socialItem}>
                                        <div className={styles.socialInfo}>
                                            <div className={styles.loginIcon}><Mail size={16} aria-hidden="true" /></div>
                                            <div>
                                                <span>이메일·비밀번호</span>
                                                <p className={styles.loginHint}>
                                                    {loading ? '계정 정보를 불러오는 중...' : `${userInfo?.email || '가입한 이메일'} 계정으로 로그인하고 있어요.`}
                                                </p>
                                            </div>
                                        </div>
                                        {userInfo?.hasPassword !== false && (
                                            <button type="button" className={styles.actionBtn} onClick={openPasswordChange}>
                                                비밀번호 변경
                                            </button>
                                        )}
                                    </div>
                                </div>

                                <div className={styles.activitySection}>
                                    <h3>내 활동 요약</h3>
                                    <div className={styles.activityGrid}>
                                        <div className={styles.activityItem}>
                                            <span className={styles.activityLabel}>가입일</span>
                                            <span className={styles.activityValue}>
                                                {userInfo?.createdAt ? new Date(userInfo.createdAt).toLocaleDateString('ko-KR') : '-'}
                                            </span>
                                        </div>
                                        {cashSummary && (
                                            <>
                                                <div className={styles.activityItem}>
                                                    <span className={styles.activityLabel}>총 충전액</span>
                                                    <span className={styles.activityValue}>{cashSummary.totalCharged.toLocaleString()}원</span>
                                                </div>
                                                <div className={styles.activityItem}>
                                                    <span className={styles.activityLabel}>총 사용액</span>
                                                    <span className={styles.activityValue}>{cashSummary.totalUsed.toLocaleString()}원</span>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeTab === 'notifications' && (
                            <div className={styles.section}>
                                <div className={styles.notifSectionHeader}>
                                    <h2 className={styles.sectionTitle}>알림</h2>
                                    {!notifLoading && hasUnreadNotifications && (
                                        <button className={styles.actionBtn} onClick={markAllAsRead} disabled={markingAll}>
                                            모두 읽음
                                        </button>
                                    )}
                                </div>
                                {notifLoading ? (
                                    <div className={styles.notifFullList}>
                                        {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-16 w-full" />)}
                                    </div>
                                ) : notifications.length === 0 ? (
                                    <div className={styles.notifEmptyState}>
                                        <Bell size={32} />
                                        <p>새 알림이 없습니다.</p>
                                    </div>
                                ) : (
                                    <div className={styles.notifFullList}>
                                        {notifications.map((notif) => {
                                            const notifStyle = NOTIF_STYLE[notif.type] || NOTIF_STYLE.system;
                                            const NotifIcon = notifStyle.icon;
                                            return (
                                                <button
                                                    key={notif.id}
                                                    type="button"
                                                    className={styles.notifRow}
                                                    onClick={() => handleNotificationClick(notif)}
                                                >
                                                    <div className={styles.notifRowIcon} style={{ background: notifStyle.bg, color: notifStyle.color }}>
                                                        <NotifIcon size={16} />
                                                    </div>
                                                    <div className={styles.notifRowContent}>
                                                        <span className={styles.notifRowTitle}>{notif.title}</span>
                                                        <span className={styles.notifRowMessage}>{notif.message}</span>
                                                    </div>
                                                    <div className={styles.notifRowMeta}>
                                                        {!notif.isRead && <span className={styles.notifRowDot} />}
                                                        <span className={styles.notifRowTime}>{timeAgo(notif.createdAt)}</span>
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        )}

                        {activeTab === 'security' && (
                            <div className={styles.section}>
                                <h2 className={styles.sectionTitle}>보안 설정</h2>
                                <div className={styles.securityList}>
                                    <div className={styles.securityItem}>
                                        <div>
                                            <h4>비밀번호 변경</h4>
                                            <p>
                                                {userInfo?.hasPassword === false
                                                    ? '소셜 로그인 계정은 비밀번호 변경이 필요하지 않습니다.'
                                                    : '계정 보안을 위해 주기적으로 비밀번호를 변경하세요.'}
                                            </p>
                                        </div>
                                        {userInfo?.hasPassword !== false && (
                                            <button className={styles.actionBtn} onClick={() => setShowPasswordForm(v => !v)}>
                                                {showPasswordForm ? '취소' : '변경'}
                                            </button>
                                        )}
                                    </div>

                                    {showPasswordForm && (
                                        <form className={styles.passwordForm} onSubmit={handlePasswordChange}>
                                            <div className={styles.editField}>
                                                <label htmlFor="currentPassword">현재 비밀번호</label>
                                                <input
                                                    id="currentPassword"
                                                    type="password"
                                                    className="glass-input"
                                                    value={passwordForm.currentPassword}
                                                    onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
                                                    autoComplete="current-password"
                                                    required
                                                />
                                            </div>
                                            <div className={styles.editField}>
                                                <label htmlFor="newPassword">새 비밀번호</label>
                                                <input
                                                    id="newPassword"
                                                    type="password"
                                                    className="glass-input"
                                                    value={passwordForm.newPassword}
                                                    onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                                                    autoComplete="new-password"
                                                    minLength={8}
                                                    required
                                                />
                                            </div>
                                            <div className={styles.editField}>
                                                <label htmlFor="confirmPassword">새 비밀번호 확인</label>
                                                <input
                                                    id="confirmPassword"
                                                    type="password"
                                                    className="glass-input"
                                                    value={passwordForm.confirmPassword}
                                                    onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                                                    autoComplete="new-password"
                                                    minLength={8}
                                                    required
                                                />
                                            </div>
                                            <button type="submit" className="btn btn-primary" disabled={changingPassword}>
                                                {changingPassword ? '변경 중...' : '비밀번호 변경하기'}
                                            </button>
                                        </form>
                                    )}
                                </div>
                            </div>
                        )}

                        {activeTab === 'business' && (
                            <div className={styles.section}>
                                <h2 className={styles.sectionTitle}>사업자 정보</h2>
                                <p className={styles.businessLead}>
                                    세금계산서를 받으려면 사업자 정보를 보내 주세요. 담당자가 확인해 등록하고, 결과는 아래 요청 내역에 답변으로 남깁니다.
                                    사업자등록증 사본이 필요하면 답변으로 따로 안내드려요.
                                </p>

                                <form className={styles.businessForm} onSubmit={handleBusinessSubmit} noValidate>
                                    <div className={styles.editFieldRow}>
                                        <div className={styles.editField}>
                                            <label htmlFor="bizCompany">상호(법인명)</label>
                                            <input
                                                id="bizCompany"
                                                type="text"
                                                className="glass-input"
                                                maxLength={60}
                                                value={businessForm.company}
                                                onChange={(e) => setBusinessField('company', e.target.value)}
                                                placeholder="예: 다온상회"
                                                aria-invalid={Boolean(businessErrors.company)}
                                            />
                                            {businessErrors.company && <p className={styles.fieldError} role="alert">{businessErrors.company}</p>}
                                        </div>
                                        <div className={styles.editField}>
                                            <label htmlFor="bizNumber">사업자등록번호</label>
                                            <input
                                                id="bizNumber"
                                                type="text"
                                                inputMode="numeric"
                                                className="glass-input"
                                                value={businessForm.number}
                                                onChange={(e) => setBusinessField('number', formatBusinessNumber(e.target.value))}
                                                placeholder="000-00-00000"
                                                aria-invalid={Boolean(businessErrors.number)}
                                            />
                                            {businessErrors.number && <p className={styles.fieldError} role="alert">{businessErrors.number}</p>}
                                        </div>
                                    </div>
                                    <div className={styles.editFieldRow}>
                                        <div className={styles.editField}>
                                            <label htmlFor="bizOwner">대표자명</label>
                                            <input
                                                id="bizOwner"
                                                type="text"
                                                className="glass-input"
                                                maxLength={30}
                                                value={businessForm.owner}
                                                onChange={(e) => setBusinessField('owner', e.target.value)}
                                                placeholder="예: 홍길동"
                                                aria-invalid={Boolean(businessErrors.owner)}
                                            />
                                            {businessErrors.owner && <p className={styles.fieldError} role="alert">{businessErrors.owner}</p>}
                                        </div>
                                        <div className={styles.editField}>
                                            <label htmlFor="bizEmail">세금계산서 받을 이메일</label>
                                            <input
                                                id="bizEmail"
                                                type="email"
                                                className="glass-input"
                                                maxLength={100}
                                                value={businessForm.email}
                                                onChange={(e) => setBusinessField('email', e.target.value)}
                                                placeholder="tax@example.com"
                                                aria-invalid={Boolean(businessErrors.email)}
                                            />
                                            {businessErrors.email && <p className={styles.fieldError} role="alert">{businessErrors.email}</p>}
                                        </div>
                                    </div>
                                    <div className={styles.editFieldRow}>
                                        <div className={styles.editField}>
                                            <label htmlFor="bizType">업태·종목 (선택)</label>
                                            <input
                                                id="bizType"
                                                type="text"
                                                className="glass-input"
                                                maxLength={60}
                                                value={businessForm.businessType}
                                                onChange={(e) => setBusinessField('businessType', e.target.value)}
                                                placeholder="예: 도소매 / 전자상거래"
                                            />
                                        </div>
                                        <div className={styles.editField}>
                                            <label htmlFor="bizAddress">사업장 주소 (선택)</label>
                                            <input
                                                id="bizAddress"
                                                type="text"
                                                className="glass-input"
                                                maxLength={150}
                                                value={businessForm.address}
                                                onChange={(e) => setBusinessField('address', e.target.value)}
                                                placeholder="사업자등록증에 적힌 주소"
                                            />
                                        </div>
                                    </div>
                                    <button type="submit" className="btn btn-primary" disabled={submittingBusiness}>
                                        {submittingBusiness ? '보내는 중...' : '등록 요청 보내기'}
                                    </button>
                                </form>

                                <div className={styles.businessHistory}>
                                    <h3>요청 내역</h3>
                                    {businessLoading && businessRequests.length === 0 ? (
                                        <Skeleton className="h-16 w-full" />
                                    ) : businessLoadError ? (
                                        <LoadError compact message="요청 내역을 불러오지 못했습니다." onRetry={fetchBusinessRequests} />
                                    ) : businessRequests.length === 0 ? (
                                        <p className={styles.businessEmpty}>아직 보낸 등록 요청이 없습니다.</p>
                                    ) : (
                                        <ul className={styles.businessList}>
                                            {businessRequests.map((request) => {
                                                const answered = request.status === 'answered' || Boolean(request.answer);
                                                return (
                                                    <li key={request.id}>
                                                        <div className={styles.businessItemHead}>
                                                            <strong>{request.title}</strong>
                                                            <span className={answered ? styles.businessDone : styles.businessWaiting}>
                                                                {answered ? <CheckCircle2 size={13} aria-hidden="true" /> : <Clock size={13} aria-hidden="true" />}
                                                                {answered ? '답변완료' : '확인 대기'}
                                                            </span>
                                                        </div>
                                                        <p className={styles.businessDate}>{new Date(request.createdAt).toLocaleDateString('ko-KR')} 요청</p>
                                                        {request.answer && <p className={styles.businessAnswer}>{request.answer}</p>}
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                    )}
                                    <p className={styles.businessFootnote}>
                                        같은 내용은 <Link href="/dashboard/support">고객센터 &gt; 내 문의 내역</Link>에서도 볼 수 있어요.
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </DashboardLayout>
    );
}
