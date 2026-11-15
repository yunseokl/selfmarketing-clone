'use client';

import { useState, useEffect, useCallback } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import styles from './page.module.css';
import {
    MapPin,
    ShoppingCart,
    FileText,
    DollarSign,
    ArrowRight,
    TrendingUp,
    Sparkles,
    Target,
    BarChart3,
    Wallet,
    Check,
    PartyPopper,
    Inbox,
    Megaphone,
    MessageCircle,
    Info,
    Bell,
    Calculator,
    Search,
    Store,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { motion } from 'framer-motion';
import { AreaChart, Area, XAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
        opacity: 1,
        transition: {
            staggerChildren: 0.1
        }
    }
};

const itemVariants = {
    hidden: { y: 20, opacity: 0 },
    visible: {
        y: 0,
        opacity: 1,
        transition: { type: 'spring', stiffness: 100 }
    }
};

const LANDING_FEATURES = [
    { icon: MapPin, title: '플레이스 트래픽', desc: '네이버 플레이스 방문·저장을 늘려 상위노출을 돕습니다.', color: '#34D399', bg: 'rgba(16, 185, 129, 0.15)' },
    { icon: ShoppingCart, title: '쇼핑 트래픽', desc: '스마트스토어 유입과 클릭을 늘려 순위를 끌어올립니다.', color: '#60A5FA', bg: 'rgba(37, 99, 235, 0.15)' },
    { icon: Calculator, title: '마진·ROAS 계산기', desc: '스마트스토어·쿠팡 수수료와 광고비까지 넣고 실제로 남는 돈을 계산합니다.', color: '#A3E635', bg: 'rgba(163, 230, 53, 0.15)' },
    { icon: Target, title: '키워드 트렌드', desc: '네이버 검색 추이로 성수기와 키워드별 수요 차이를 확인합니다.', color: '#38BDF8', bg: 'rgba(56, 189, 248, 0.15)' },
    { icon: BarChart3, title: '순위 기록장', desc: '플레이스는 실제 순위를 조회해 기록하고, 쇼핑은 직접 확인한 순위를 적어 변화를 그래프로 봅니다.', color: '#A78BFA', bg: 'rgba(139, 92, 246, 0.15)' },
    { icon: Search, title: '상품명 SEO 분석', desc: '상품명을 네이버 쇼핑 가이드 기준으로 점검하고 고칠 점을 알려드립니다.', color: '#FB923C', bg: 'rgba(249, 115, 22, 0.15)' },
    { icon: Store, title: '플레이스 분석·진단', desc: '숨은 대표키워드와 실제 검색 순위를 조회하고, 정보 빈칸 점검과 리뷰 답글 초안까지 도와드립니다.', color: '#2DD4BF', bg: 'rgba(20, 184, 166, 0.15)' },
    { icon: FileText, title: '블로그 배포', desc: '플레이스 홍보에 최적화된 블로그 포스팅을 대신 배포합니다.', color: '#F472B6', bg: 'rgba(236, 72, 153, 0.15)' },
    { icon: DollarSign, title: '광고비 환급', desc: '이미 집행 중인 광고비의 일부를 돌려받아 보세요.', color: '#FBBF24', bg: 'rgba(245, 158, 11, 0.15)' },
];

const NOTIF_STYLE = {
    rank: { icon: TrendingUp, color: '#A78BFA', bg: 'rgba(139, 92, 246, 0.15)' },
    cash: { icon: Wallet, color: '#FBBF24', bg: 'rgba(245, 158, 11, 0.15)' },
    ad: { icon: Megaphone, color: '#60A5FA', bg: 'rgba(37, 99, 235, 0.15)' },
    inquiry: { icon: MessageCircle, color: '#34D399', bg: 'rgba(16, 185, 129, 0.15)' },
    notice: { icon: Bell, color: '#F472B6', bg: 'rgba(236, 72, 153, 0.15)' },
    system: { icon: Info, color: '#94A3B8', bg: 'rgba(148, 163, 184, 0.15)' },
};

// 대시보드 정보를 불러오지 못했을 때도 화면이 그려지도록 하는 기본값
const EMPTY_DASHBOARD = {
    balance: 0,
    activeAds: { place: 0, shopping: 0, total: 0 },
    todayGoal: 0,
    trackingCount: 0,
    trackingBest: null,
    weeklyPlan: [],
    onboarding: { hasAd: false, hasKeyword: false, hasTracking: false },
    recentNotifications: [],
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

function LandingPage() {
    return (
        <div className={styles.landingContainer}>
            <section className={styles.hero}>
                <div className={styles.heroDecor}>
                    <div className={styles.circle1} />
                    <div className={styles.circle2} />
                </div>
                <nav className={styles.landingNav}>
                    <span className={styles.landingLogo}>혼잘마</span>
                    <Link href="/login" className={styles.navLoginBtn}>로그인</Link>
                </nav>
                <div className={styles.heroContent}>
                    <div className={styles.heroBadge}>
                        <Sparkles size={14} />
                        <span>Premium Self Marketing</span>
                    </div>
                    <h1 className={styles.heroTitle}>
                        대행사 없이,<br />
                        <span className={styles.heroTitleAccent}>혼자서도 잘하는 마케팅</span>
                    </h1>
                    <p className={styles.heroSubtitle}>
                        플레이스·쇼핑 상위노출부터 순위추적, 키워드 분석까지 한 곳에서.
                    </p>
                    <div className={styles.heroCtas}>
                        <Link href="/login?mode=register" className={styles.ctaPrimary}>
                            무료로 시작하기 <ArrowRight size={18} />
                        </Link>
                        <Link href="/login?mode=register" className={styles.ctaSecondary}>
                            무료 도구 둘러보기
                        </Link>
                    </div>
                </div>
            </section>

            <section className={styles.trustBar}>
                <div className={styles.trustItem}>
                    <span className={styles.trustValue}>6가지</span>
                    <span className={styles.trustLabel}>무료 분석·계산 도구</span>
                </div>
                <div className={styles.trustDivider} />
                <div className={styles.trustItem}>
                    <span className={styles.trustValue}>10,000원</span>
                    <span className={styles.trustLabel}>가입 축하 캐시</span>
                </div>
                <div className={styles.trustDivider} />
                <div className={styles.trustItem}>
                    <span className={styles.trustValue}>30초</span>
                    <span className={styles.trustLabel}>이메일 가입</span>
                </div>
            </section>

            <section className={styles.featureSection}>
                <h2 className={styles.sectionTitle}>혼잘마 하나로 끝내는 마케팅</h2>
                <div className={styles.featureGrid}>
                    {LANDING_FEATURES.map((feature) => {
                        const Icon = feature.icon;
                        return (
                            <div key={feature.title} className={styles.featureCard}>
                                <div className={styles.featureIconBox} style={{ background: feature.bg, color: feature.color }}>
                                    <Icon size={22} />
                                </div>
                                <h3 className={styles.featureTitle}>{feature.title}</h3>
                                <p className={styles.featureDesc}>{feature.desc}</p>
                            </div>
                        );
                    })}
                </div>
            </section>

            <section className={styles.stepsSection}>
                <h2 className={styles.sectionTitle}>3단계면 충분해요</h2>
                <div className={styles.stepsGrid}>
                    <div className={styles.usageStep}>
                        <span className={styles.usageStepNum}>1</span>
                        <h3>가입하기</h3>
                        <p>이메일로 30초 만에 무료 가입</p>
                    </div>
                    <div className={styles.usageStep}>
                        <span className={styles.usageStepNum}>2</span>
                        <h3>충전하기</h3>
                        <p>필요한 만큼만 광고비 충전</p>
                    </div>
                    <div className={styles.usageStep}>
                        <span className={styles.usageStepNum}>3</span>
                        <h3>캠페인 시작</h3>
                        <p>몇 번의 클릭으로 캠페인 시작</p>
                    </div>
                </div>
            </section>

            <section className={styles.finalCta}>
                <h2>지금 바로 무료로 시작해보세요</h2>
                <p>가입 후 30초 안에 첫 캠페인을 만들 수 있어요.</p>
                <Link href="/login?mode=register" className={styles.ctaPrimary}>
                    무료로 시작하기 <ArrowRight size={18} />
                </Link>
            </section>

            <footer className={styles.landingFooter}>
                <span className={styles.footerBrand}>혼잘마</span>
                <div className={styles.footerLinks}>
                    <Link href="/terms">이용약관</Link>
                    <Link href="/privacy">개인정보처리방침</Link>
                </div>
                <p className={styles.footerCopy}>© 2026 혼잘마</p>
            </footer>
        </div>
    );
}

function PageLoading() {
    return <div className={styles.pageLoading} aria-hidden="true" />;
}

function DashboardHomeAuthed() {
    const { data: session } = useSession();
    const router = useRouter();
    const [greeting, setGreeting] = useState('');
    const [isChartReady, setIsChartReady] = useState(false);
    const [data, setData] = useState(EMPTY_DASHBOARD);
    const [loadError, setLoadError] = useState(false);
    const [loading, setLoading] = useState(true);
    const [notifications, setNotifications] = useState([]);
    const [markingAll, setMarkingAll] = useState(false);

    useEffect(() => {
        const hour = new Date().getHours();
        if (hour < 12) setGreeting('좋은 아침입니다');
        else if (hour < 18) setGreeting('즐거운 오후입니다');
        else setGreeting('편안한 저녁되세요');
        setIsChartReady(true);
    }, []);

    const fetchDashboard = useCallback(async () => {
        try {
            const res = await fetch('/api/dashboard');
            if (res.ok) {
                const json = await res.json();
                setData({ ...EMPTY_DASHBOARD, ...json });
                setNotifications(json.recentNotifications || []);
                setLoadError(false);
            } else {
                setLoadError(true);
            }
        } catch (error) {
            console.error('Error fetching dashboard:', error);
            setLoadError(true);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchDashboard();
    }, [fetchDashboard]);

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

    const onboardingSteps = data ? [
        { key: 'hasAd', title: '첫 광고 시작', desc: 'URL만 입력하면 끝나요.', href: '/dashboard/shopping', done: data.onboarding.hasAd },
        { key: 'hasKeyword', title: '키워드 트렌드 보기', desc: '성수기와 검색 추이 확인', href: '/dashboard/keyword', done: data.onboarding.hasKeyword },
        { key: 'hasTracking', title: '순위 기록 시작', desc: '확인한 순위를 적어 추이 보기', href: '/dashboard/ranking/shopping', done: data.onboarding.hasTracking },
    ] : [];
    const completedSteps = onboardingSteps.filter(s => s.done).length;
    const allStepsDone = onboardingSteps.length > 0 && completedSteps === onboardingSteps.length;
    const nextActiveStep = onboardingSteps.find(s => !s.done);
    const hasUnread = notifications.some(n => !n.isRead);

    return (
        <DashboardLayout>
            <motion.div
                className={styles.dashboardGrid}
                variants={containerVariants}
                initial="hidden"
                animate="visible"
            >
                {/* 1. Welcome Widget (Span 2) */}
                <motion.div className={`${styles.card} ${styles.welcomeCard}`} variants={itemVariants}>
                    <div className={styles.welcomeContent}>
                        <div className={styles.welcomeBadge}>
                            <Sparkles size={14} className={styles.sparkleIcon} />
                            <span>Premium Self Marketing</span>
                        </div>
                        <h1 className={styles.welcomeTitle}>
                            {greeting}, <br />
                            <span className={styles.userName}>{session?.user?.name || '마케터'}님</span>
                        </h1>
                        <p className={styles.welcomeDesc}>오늘의 마케팅 성과를 확인하고 새로운 캠페인을 시작해보세요.</p>
                        {loading ? (
                            <div className={styles.statsRow}>
                                <div className={styles.skeletonLine} style={{ width: 80 }} />
                                <div className={styles.statDivider} />
                                <div className={styles.skeletonLine} style={{ width: 100 }} />
                            </div>
                        ) : (
                            <>
                                <div className={styles.statsRow}>
                                    <div className={styles.statItem}>
                                        <span className={styles.statLabel}>활성 광고</span>
                                        <span className={styles.statValue}>{data.activeAds.total}<span className={styles.statUnit}>개</span></span>
                                    </div>
                                    <div className={styles.statDivider} />
                                    <div className={styles.statItem}>
                                        <span className={styles.statLabel}>남은 광고비</span>
                                        <span className={styles.statValue}>{data.balance.toLocaleString()}<span className={styles.statUnit}>원</span></span>
                                    </div>
                                </div>
                                {data.balance === 0 && (
                                    <Link href="/dashboard/charge" className={styles.chargeCta}>
                                        <Wallet size={14} /> 충전하고 시작하기
                                    </Link>
                                )}
                            </>
                        )}
                    </div>
                    <div className={styles.welcomeDecor}>
                        <div className={styles.circle1} />
                        <div className={styles.circle2} />
                    </div>
                </motion.div>

                {/* 1.5 Onboarding Guide (Span 2) */}
                {!loading && allStepsDone ? (
                    <motion.div className={styles.onboardingDoneBanner} variants={itemVariants}>
                        <div className={styles.onboardingDoneIcon}><PartyPopper size={22} /></div>
                        <div>
                            <h3 className={styles.onboardingDoneTitle}>설정 완료! 이제 도구를 자유롭게 써 보세요</h3>
                            <p className={styles.onboardingDoneDesc}>마진 계산과 순위 기록을 꾸준히 쌓아 보세요.</p>
                        </div>
                    </motion.div>
                ) : (
                    <motion.div className={styles.onboardingCard} variants={itemVariants}>
                        <div className={styles.onboardingHeader}>
                            <div className={styles.onboardingHeaderLeft}>
                                <div className={styles.onboardingIcon}>🚀</div>
                                <div>
                                    <h3 className={styles.onboardingTitle}>마케팅 고수 되기 ({loading ? '-' : completedSteps}/3)</h3>
                                    <p className={styles.onboardingSubtitle}>필수 설정을 완료하고 분석을 시작해보세요!</p>
                                </div>
                            </div>
                            <span className={styles.onboardingBadge}>진행중</span>
                        </div>

                        <div className={styles.onboardingSteps}>
                            {loading ? (
                                [1, 2, 3].map(i => <div key={i} className={`${styles.stepCard} ${styles.stepSkeleton}`} />)
                            ) : (
                                onboardingSteps.map((step, idx) => {
                                    const isActive = nextActiveStep?.key === step.key;
                                    const cardClass = step.done
                                        ? styles.stepCardDone
                                        : isActive
                                            ? styles.stepCardActive
                                            : styles.stepCardInactive;
                                    const showInactiveText = !step.done && !isActive;
                                    return (
                                        <div key={step.key} className={`${styles.stepCard} ${cardClass}`}>
                                            {step.done ? (
                                                <div className={styles.stepBadgeDone}><Check size={12} /> 완료</div>
                                            ) : (
                                                <div className={styles.stepBadge}>STEP {idx + 1}</div>
                                            )}
                                            <h4 className={`${styles.stepTitle} ${showInactiveText ? styles.stepTitleInactive : ''}`}>{step.title}</h4>
                                            <p className={`${styles.stepDescription} ${showInactiveText ? styles.stepDescriptionInactive : ''}`}>{step.desc}</p>
                                            {step.done ? (
                                                <span className={styles.stepButtonDone}>완료됨</span>
                                            ) : isActive ? (
                                                <Link href={step.href} className={styles.stepButton}>시작하기</Link>
                                            ) : (
                                                <button disabled className={styles.stepButtonDisabled}>대기중</button>
                                            )}
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </motion.div>
                )}

                {/* 2. Main Chart Widget (Span 2) */}
                <motion.div className={`${styles.card} ${styles.chartCard}`} variants={itemVariants}>
                    <div className={styles.cardHeader}>
                        <h3 className={styles.cardTitle}>최근 7일 목표 유입량</h3>
                        <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>주문한 일일 목표 합계 (실제 유입 실적 아님)</span>
                    </div>
                    <div className={styles.chartContainer}>
                        {loading || !isChartReady ? (
                            <div className={styles.chartSkeleton} aria-hidden="true" />
                        ) : data.activeAds.total === 0 ? (
                            <div className={styles.chartEmptyState}>
                                <BarChart3 size={40} className={styles.emptyIcon} />
                                <p>광고를 시작하면 날짜별 목표 유입량이 표시됩니다.</p>
                                <Link href="/dashboard/shopping" className={styles.emptyCta}>광고 시작하기</Link>
                            </div>
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={data.weeklyPlan}>
                                    <defs>
                                        <linearGradient id="colorPlanned" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#3987e5" stopOpacity={0.5} />
                                            <stop offset="95%" stopColor="#3987e5" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.08)" />
                                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 12 }} />
                                    <Tooltip
                                        formatter={(value) => [`${Number(value).toLocaleString('ko-KR')}건`, '주문한 목표 유입']}
                                        contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff' }}
                                        itemStyle={{ color: '#fff' }}
                                        cursor={{ stroke: 'rgba(255,255,255,0.25)', strokeWidth: 1 }}
                                    />
                                    <Area type="monotone" dataKey="planned" stroke="#3987e5" strokeWidth={2} fillOpacity={1} fill="url(#colorPlanned)" isAnimationActive={false} />
                                </AreaChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </motion.div>

                {/* 3. Service Cards (Grid) */}
                <motion.div className={styles.serviceGrid} variants={itemVariants}>
                    {/* Shopping */}
                    <Link href="/dashboard/shopping" className={`${styles.miniCard} ${styles.cardShopping}`}>
                        <div className={styles.miniIconBox} style={{ background: 'rgba(37, 99, 235, 0.2)', color: '#60A5FA' }}>
                            <ShoppingCart size={20} />
                        </div>
                        <div className={styles.miniInfo}>
                            <span className={styles.miniLabel}>네이버 쇼핑</span>
                            <span className={styles.miniAction}>관리하기 <ArrowRight size={12} /></span>
                        </div>
                    </Link>

                    {/* Place */}
                    <Link href="/dashboard/place" className={`${styles.miniCard} ${styles.cardPlace}`}>
                        <div className={styles.miniIconBox} style={{ background: 'rgba(16, 185, 129, 0.2)', color: '#34D399' }}>
                            <MapPin size={20} />
                        </div>
                        <div className={styles.miniInfo}>
                            <span className={styles.miniLabel}>플레이스</span>
                            <span className={styles.miniAction}>관리하기 <ArrowRight size={12} /></span>
                        </div>
                    </Link>

                    {/* Keyword */}
                    <Link href="/dashboard/keyword" className={`${styles.miniCard} ${styles.cardKeyword}`}>
                        <div className={styles.miniIconBox} style={{ background: 'rgba(163, 230, 53, 0.2)', color: '#A3E635' }}>
                            <Target size={20} />
                        </div>
                        <div className={styles.miniInfo}>
                            <span className={styles.miniLabel}>키워드 트렌드</span>
                            <span className={styles.miniAction}>시작하기 <ArrowRight size={12} /></span>
                        </div>
                    </Link>

                    {/* Blog */}
                    <Link href="/dashboard/blog" className={`${styles.miniCard} ${styles.cardBlog}`}>
                        <div className={styles.miniIconBox} style={{ background: 'rgba(139, 92, 246, 0.2)', color: '#A78BFA' }}>
                            <FileText size={20} />
                        </div>
                        <div className={styles.miniInfo}>
                            <span className={styles.miniLabel}>블로그 배포</span>
                            <span className={styles.miniAction}>관리하기 <ArrowRight size={12} /></span>
                        </div>
                    </Link>

                    {/* Refund */}
                    <Link href="/dashboard/refund" className={`${styles.miniCard} ${styles.cardRefund}`}>
                        <div className={styles.miniIconBox} style={{ background: 'rgba(245, 158, 11, 0.2)', color: '#FBBF24' }}>
                            <DollarSign size={20} />
                        </div>
                        <div className={styles.miniInfo}>
                            <span className={styles.miniLabel}>광고비 환급</span>
                            <span className={styles.miniAction}>신청하기 <ArrowRight size={12} /></span>
                        </div>
                    </Link>

                    {/* Margin calculator */}
                    <Link href="/dashboard/margin" className={`${styles.miniCard} ${styles.cardCharge}`}>
                        <div className={styles.miniIconBox} style={{ background: 'rgba(59, 130, 246, 0.2)', color: '#3B82F6' }}>
                            <Calculator size={20} />
                        </div>
                        <div className={styles.miniInfo}>
                            <span className={styles.miniLabel}>마진·ROAS 계산기</span>
                            <span className={styles.miniAction}>계산하기 <ArrowRight size={12} /></span>
                        </div>
                    </Link>
                </motion.div>

                {/* 4. Stats Summary (Vertical) */}
                <motion.div className={`${styles.card} ${styles.statsCard}`} variants={itemVariants}>
                    <h3 className={styles.cardTitle}>한눈에 보기</h3>
                    {loading ? (
                        <div className={styles.insightList}>
                            {[1, 2, 3].map(i => <div key={i} className={styles.insightSkeletonRow} />)}
                        </div>
                    ) : (
                        <>
                            <div className={styles.insightList}>
                                <div className={styles.insightItem}>
                                    <div className={styles.insightIcon}><TrendingUp size={16} /></div>
                                    <div className={styles.insightContent}>
                                        <span className={styles.insightValue}>{data.todayGoal.toLocaleString()}</span>
                                        <span className={styles.insightLabel}>오늘 목표 유입</span>
                                    </div>
                                </div>
                                <div className={styles.insightItem}>
                                    <div className={styles.insightIcon}><Megaphone size={16} /></div>
                                    <div className={styles.insightContent}>
                                        <span className={styles.insightValue}>{data.activeAds.total}</span>
                                        <span className={styles.insightLabel}>활성 광고</span>
                                    </div>
                                </div>
                                <div className={styles.insightItem}>
                                    <div className={styles.insightIcon}><BarChart3 size={16} /></div>
                                    <div className={styles.insightContent}>
                                        <span className={styles.insightValue}>{data.trackingCount}</span>
                                        <span className={styles.insightLabel}>순위 기록 키워드</span>
                                    </div>
                                </div>
                            </div>
                            {data.trackingBest ? (
                                <div className={styles.tipBox}>
                                    <span className={styles.tipTitle}>🏆 가장 높은 기록</span>
                                    <p className={styles.tipText}>&apos;{data.trackingBest.keyword}&apos; 최근 기록 {data.trackingBest.currentRank}위</p>
                                </div>
                            ) : (
                                <div className={styles.tipBox}>
                                    <span className={styles.tipTitle}>💡 마케팅 팁</span>
                                    <p className={styles.tipText}>광고를 켜기 전에 마진 계산기로 손익분기 ROAS부터 확인해 보세요.</p>
                                </div>
                            )}
                        </>
                    )}
                </motion.div>

                {/* 5. Banner/Ad (Span 1) */}
                <motion.div className={`${styles.card} ${styles.bannerCard}`} variants={itemVariants}>
                    <div className={styles.bannerContent}>
                        <h3>한 건 팔면<br />실제로 얼마 남을까?</h3>
                        <Link href="/dashboard/margin" className={styles.bannerBtn}>
                            마진 계산하기
                        </Link>
                    </div>
                    <div className={styles.bannerImage}>
                        <div className={styles.glowCircle} />
                    </div>
                </motion.div>

                {/* 6. Notifications Widget (Span 2) */}
                <motion.div className={`${styles.card} ${styles.notificationCard}`} variants={itemVariants}>
                    <div className={styles.cardHeader}>
                        <h3 className={styles.cardTitle}>알림</h3>
                        {!loading && hasUnread && (
                            <button className={styles.markAllBtn} onClick={markAllAsRead} disabled={markingAll}>
                                모두 읽음
                            </button>
                        )}
                    </div>
                    {loading ? (
                        <div className={styles.notifList}>
                            {[1, 2, 3].map(i => <div key={i} className={styles.notifSkeletonRow} />)}
                        </div>
                    ) : notifications.length === 0 ? (
                        <div className={styles.notifEmpty}>
                            <Inbox size={28} className={styles.emptyIcon} />
                            <p>새 알림이 없습니다.</p>
                        </div>
                    ) : (
                        <div className={styles.notifList}>
                            {notifications.map((notif) => {
                                const notifStyle = NOTIF_STYLE[notif.type] || NOTIF_STYLE.system;
                                const NotifIcon = notifStyle.icon;
                                return (
                                    <button
                                        key={notif.id}
                                        type="button"
                                        className={styles.notifItem}
                                        onClick={() => handleNotificationClick(notif)}
                                    >
                                        <div className={styles.notifIconBox} style={{ background: notifStyle.bg, color: notifStyle.color }}>
                                            <NotifIcon size={16} />
                                        </div>
                                        <div className={styles.notifContent}>
                                            <span className={styles.notifTitle}>{notif.title}</span>
                                            <span className={styles.notifMessage}>{notif.message}</span>
                                        </div>
                                        <div className={styles.notifMeta}>
                                            {!notif.isRead && <span className={styles.notifDot} />}
                                            <span className={styles.notifTime}>{timeAgo(notif.createdAt)}</span>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </motion.div>

            </motion.div>
        </DashboardLayout>
    );
}

export default function DashboardHome() {
    const { status } = useSession();

    if (status === 'loading') {
        return <PageLoading />;
    }

    if (status === 'unauthenticated') {
        return <LandingPage />;
    }

    return <DashboardHomeAuthed />;
}
