'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import DashboardLayout from '@/components/layout/DashboardLayout';
import styles from './page.module.css';
import { User, Shield, Building, ChevronRight, Settings } from 'lucide-react';

const tabs = [
    { id: 'profile', label: '프로필 정보', icon: User },
    { id: 'security', label: '보안 설정', icon: Shield },
    { id: 'business', label: '사업자 정보', icon: Building },
];

import { Skeleton } from '@/components/ui/skeleton';

export default function ProfilePage() {
    const { data: session } = useSession();
    const [activeTab, setActiveTab] = useState('profile');
    const [userInfo, setUserInfo] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Minimum loading time for smooth transition
        const timer = setTimeout(() => {
            fetchUserInfo();
        }, 800);
        return () => clearTimeout(timer);
    }, []);

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

    const isAdmin = userInfo?.role === 'admin';

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
                            </div>
                        )}

                        {activeTab === 'security' && (
                            <div className={styles.section}>
                                <h2 className={styles.sectionTitle}>보안 설정</h2>
                                <div className={styles.securityList}>
                                    <div className={styles.securityItem}>
                                        <div>
                                            <h4>비밀번호 변경</h4>
                                            <p>계정 보안을 위해 주기적으로 비밀번호를 변경하세요.</p>
                                        </div>
                                        <button className={styles.actionBtn}>변경</button>
                                    </div>
                                    <div className={styles.securityItem}>
                                        <div>
                                            <h4>2단계 인증</h4>
                                            <p>추가 보안을 위해 2단계 인증을 설정하세요.</p>
                                        </div>
                                        <button className={styles.actionBtn}>설정</button>
                                    </div>
                                    <div className={styles.securityItem}>
                                        <div>
                                            <h4>로그인 기록</h4>
                                            <p>최근 로그인 활동을 확인하세요.</p>
                                        </div>
                                        <button className={styles.actionBtn}>확인</button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeTab === 'business' && (
                            <div className={styles.section}>
                                <h2 className={styles.sectionTitle}>사업자 정보</h2>
                                <div className={styles.businessNotice}>
                                    <p>사업자 정보를 등록하면 세금계산서 발행이 가능합니다.</p>
                                    <button className={styles.registerBtn}>사업자 등록하기</button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </DashboardLayout>
    );
}
