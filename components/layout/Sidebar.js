'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import {
    MapPin,
    ShoppingCart,
    Package,
    TrendingUp,
    BarChart3,
    Search,
    DollarSign,
    FileText,
    Image,
    User,
    LogOut,
    MessageCircle,
    Menu,
    X,
} from 'lucide-react';
import styles from './Sidebar.module.css';

const menuItems = [
    {
        category: '광고 관리',
        items: [
            { name: '플레이스', href: '/dashboard/place', icon: MapPin },
            { name: '쇼핑', href: '/dashboard/shopping', icon: ShoppingCart },
            { name: '쿠팡', href: '/dashboard/coupang', icon: Package, badge: '별도 문의' },
        ]
    },
    {
        category: '순위 추적',
        badge: '무료 사용',
        items: [
            { name: '플레이스 순위추적', href: '/dashboard/ranking/place', icon: TrendingUp },
            { name: '쇼핑 순위추적', href: '/dashboard/ranking/shopping', icon: BarChart3 },
        ]
    },
    {
        category: 'SEO 분석',
        items: [
            { name: '쇼핑 SEO 분석', href: '/dashboard/seo', icon: Search },
        ]
    },
    {
        category: '광고 대행',
        badge: '광고비 10% 환급',
        items: [
            { name: '매체별 광고비 환급', href: '/dashboard/refund', icon: DollarSign },
        ]
    },
    {
        category: '블로그 관리',
        items: [
            { name: '플레이스 블로그 배포', href: '/dashboard/blog', icon: FileText },
        ]
    },
    {
        category: 'AI 부가서비스',
        items: [
            { name: 'AI 이미지 생성', href: '/dashboard/ai', icon: Image },
        ]
    },
];

export default function Sidebar() {
    const pathname = usePathname();
    const { data: session, status } = useSession();
    const [isMobileOpen, setIsMobileOpen] = useState(false);
    const [userInfo, setUserInfo] = useState(null);

    useEffect(() => {
        if (session?.user) {
            fetchUserInfo();
        }
    }, [session]);

    const fetchUserInfo = async () => {
        try {
            const res = await fetch('/api/user');
            if (res.ok) {
                const data = await res.json();
                setUserInfo(data.user);
            }
        } catch (error) {
            console.error('Error fetching user info:', error);
        }
    };

    const toggleMobile = () => setIsMobileOpen(!isMobileOpen);

    const handleLogout = async () => {
        await signOut({ callbackUrl: '/login' });
    };

    return (
        <>
            {/* Mobile Menu Button */}
            <button className={styles.mobileToggle} onClick={toggleMobile}>
                {isMobileOpen ? <X size={24} /> : <Menu size={24} />}
            </button>

            {/* Overlay */}
            {isMobileOpen && (
                <div className={styles.overlay} onClick={toggleMobile} />
            )}

            {/* Sidebar */}
            <aside className={`${styles.sidebar} ${isMobileOpen ? styles.open : ''}`}>
                {/* Logo */}
                <div className={styles.logo}>
                    <Link href="/">
                        <div className={styles.logoIcon}>
                            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                                <rect width="32" height="32" rx="8" fill="#2563EB" />
                                <path d="M10 16L14 20L22 12" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </div>
                        <span className={styles.logoText}>셀프마케팅</span>
                    </Link>
                </div>

                {/* Navigation */}
                <nav className={styles.nav}>
                    {menuItems.map((section, idx) => (
                        <div key={idx} className={styles.section}>
                            <div className={styles.sectionHeader}>
                                <span className={styles.sectionTitle}>{section.category}</span>
                                {section.badge && (
                                    <span className={`${styles.sectionBadge} ${section.badge.includes('무료') ? styles.badgeGreen : styles.badgeBlue
                                        }`}>
                                        {section.badge}
                                    </span>
                                )}
                            </div>
                            <ul className={styles.menuList}>
                                {section.items.map((item, itemIdx) => {
                                    const Icon = item.icon;
                                    const isActive = pathname === item.href;
                                    return (
                                        <li key={itemIdx}>
                                            <Link
                                                href={item.href}
                                                className={`${styles.menuItem} ${isActive ? styles.active : ''}`}
                                                onClick={() => setIsMobileOpen(false)}
                                            >
                                                <Icon size={18} />
                                                <span>{item.name}</span>
                                                {item.badge && (
                                                    <span className={styles.itemBadge}>{item.badge}</span>
                                                )}
                                            </Link>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    ))}
                </nav>

                {/* User Section */}
                <div className={styles.userSection}>
                    {session ? (
                        <>
                            <div className={styles.userCard}>
                                <div className={styles.userInfo}>
                                    <span className={styles.userLabel}>사용자</span>
                                    <span className={styles.userName}>{userInfo?.name || session.user?.name || '사용자'}님</span>
                                </div>
                                <div className={styles.userBalance}>
                                    <span className={styles.balanceLabel}>남은 광고비:</span>
                                    <span className={styles.balanceAmount}>
                                        {userInfo?.balance?.toLocaleString() || 0}원
                                    </span>
                                </div>
                                <div className={styles.userActions}>
                                    <Link href="/dashboard/profile" className={styles.userBtn}>
                                        <User size={16} />
                                        마이페이지
                                    </Link>
                                    <button className={styles.userBtn} onClick={handleLogout}>
                                        <LogOut size={16} />
                                        로그아웃
                                    </button>
                                </div>
                            </div>
                        </>
                    ) : (
                        <Link href="/login" className={styles.loginBtn}>
                            로그인 / 회원가입
                        </Link>
                    )}

                    {/* Kakao Button */}
                    <button className={styles.kakaoBtn}>
                        <MessageCircle size={20} />
                        카카오톡 문의
                    </button>
                </div>
            </aside>
        </>
    );
}
