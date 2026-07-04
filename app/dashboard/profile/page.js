'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/layout/DashboardLayout';
import styles from './page.module.css';
import {
    User, Shield, Building, ChevronRight, Settings,
    Bell, TrendingUp, Wallet, Megaphone, MessageCircle, Info,
} from 'lucide-react';
import { toast } from 'sonner';

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
        }
    }, [userInfo]);

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
                                    <h3>소셜 연동</h3>
                                    <div className={styles.socialItem}>
                                        <div className={styles.socialInfo}>
                                            <div className={styles.kakaoIcon}>K</div>
                                            <span>카카오</span>
                                        </div>
                                        <span className={styles.notConnected}>미연동</span>
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
                                <div className={styles.businessNotice}>
                                    <p>사업자 정보를 등록하면 세금계산서 발행이 가능합니다.</p>
                                    <Link href="/dashboard/support" className={styles.registerBtn}>
                                        1:1 문의로 등록 요청하기
                                    </Link>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </DashboardLayout>
    );
}
