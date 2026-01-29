'use client';

import { useState, useEffect } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import styles from './page.module.css';
import {
    MapPin,
    ShoppingCart,
    FileText,
    DollarSign,
    ArrowRight,
    TrendingUp,
    MousePointer,
    Users,
    Sparkles
} from 'lucide-react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { motion } from 'framer-motion';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

// Mock Data for Charts
const chartData = [
    { name: '월', visits: 4000, clicks: 2400 },
    { name: '화', visits: 3000, clicks: 1398 },
    { name: '수', visits: 2000, clicks: 9800 },
    { name: '목', visits: 2780, clicks: 3908 },
    { name: '금', visits: 1890, clicks: 4800 },
    { name: '토', visits: 2390, clicks: 3800 },
    { name: '일', visits: 3490, clicks: 4300 },
];

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

export default function DashboardHome() {
    const { data: session } = useSession();
    const [greeting, setGreeting] = useState('');

    useEffect(() => {
        const hour = new Date().getHours();
        if (hour < 12) setGreeting('좋은 아침입니다');
        else if (hour < 18) setGreeting('즐거운 오후입니다');
        else setGreeting('편안한 저녁되세요');
    }, []);

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
                        <div className={styles.statsRow}>
                            <div className={styles.statItem}>
                                <span className={styles.statLabel}>활성 광고</span>
                                <span className={styles.statValue}>12<span className={styles.statUnit}>개</span></span>
                            </div>
                            <div className={styles.statDivider} />
                            <div className={styles.statItem}>
                                <span className={styles.statLabel}>이번 달 효율</span>
                                <span className={`${styles.statValue} ${styles.textSuccess}`}>+24%</span>
                            </div>
                        </div>
                    </div>
                    <div className={styles.welcomeDecor}>
                        <div className={styles.circle1} />
                        <div className={styles.circle2} />
                    </div>
                </motion.div>

                {/* 1.5 Onboarding Guide (Span 2) */}
                <motion.div className={styles.onboardingCard} variants={itemVariants}>
                    <div className={styles.onboardingHeader}>
                        <div className={styles.onboardingHeaderLeft}>
                            <div className={styles.onboardingIcon}>🚀</div>
                            <div>
                                <h3 className={styles.onboardingTitle}>마케팅 고수 되기 (1/3)</h3>
                                <p className={styles.onboardingSubtitle}>필수 설정을 완료하고 분석을 시작해보세요!</p>
                            </div>
                        </div>
                        <span className={styles.onboardingBadge}>진행중</span>
                    </div>

                    <div className={styles.onboardingSteps}>
                        {/* Step 1: Active */}
                        <div className={`${styles.stepCard} ${styles.stepCardActive}`}>
                            <div className={styles.stepBadge}>STEP 1</div>
                            <h4 className={styles.stepTitle}>내 스토어 등록</h4>
                            <p className={styles.stepDescription}>URL만 입력하면 끝나요.</p>
                            <Link href="/dashboard/shopping" className={styles.stepButton}>등록하기</Link>
                        </div>

                        {/* Step 2: Inactive */}
                        <div className={`${styles.stepCard} ${styles.stepCardInactive}`}>
                            <h4 className={`${styles.stepTitle} ${styles.stepTitleInactive}`}>첫 키워드 분석</h4>
                            <p className={`${styles.stepDescription} ${styles.stepDescriptionInactive}`}>내 상품의 순위는?</p>
                            <button disabled className={styles.stepButtonDisabled}>대기중</button>
                        </div>

                        {/* Step 3: Inactive */}
                        <div className={`${styles.stepCard} ${styles.stepCardInactive}`}>
                            <h4 className={`${styles.stepTitle} ${styles.stepTitleInactive}`}>알림 설정</h4>
                            <p className={`${styles.stepDescription} ${styles.stepDescriptionInactive}`}>매일 아침 리포트 받기</p>
                            <button disabled className={styles.stepButtonDisabled}>대기중</button>
                        </div>
                    </div>
                </motion.div>

                {/* 2. Main Chart Widget (Span 2) */}
                <motion.div className={`${styles.card} ${styles.chartCard}`} variants={itemVariants}>
                    <div className={styles.cardHeader}>
                        <h3 className={styles.cardTitle}>주간 퍼포먼스</h3>
                        <div className={styles.cardAction}>
                            <select className={styles.select}>
                                <option>이번 주</option>
                                <option>지난 주</option>
                            </select>
                        </div>
                    </div>
                    <div className={styles.chartContainer}>
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={chartData}> // AreaChart 사용
                                <defs>
                                    <linearGradient id="colorVisits" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#8884d8" stopOpacity={0.8} />
                                        <stop offset="95%" stopColor="#8884d8" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="colorClicks" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#82ca9d" stopOpacity={0.8} />
                                        <stop offset="95%" stopColor="#82ca9d" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.1)" />
                                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 12 }} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff' }}
                                    itemStyle={{ color: '#fff' }}
                                />
                                <Area type="monotone" dataKey="visits" stroke="#8884d8" fillOpacity={1} fill="url(#colorVisits)" />
                                <Area type="monotone" dataKey="clicks" stroke="#82ca9d" fillOpacity={1} fill="url(#colorClicks)" />
                            </AreaChart>
                        </ResponsiveContainer>
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
                </motion.div>

                {/* 4. Stats Summary (Vertical) */}
                <motion.div className={`${styles.card} ${styles.statsCard}`} variants={itemVariants}>
                    <h3 className={styles.cardTitle}>실시간 인사이트</h3>
                    <div className={styles.insightList}>
                        <div className={styles.insightItem}>
                            <div className={styles.insightIcon}><TrendingUp size={16} /></div>
                            <div className={styles.insightContent}>
                                <span className={styles.insightValue}>1,234</span>
                                <span className={styles.insightLabel}>오늘의 유입</span>
                            </div>
                        </div>
                        <div className={styles.insightItem}>
                            <div className={styles.insightIcon}><MousePointer size={16} /></div>
                            <div className={styles.insightContent}>
                                <span className={styles.insightValue}>8.5%</span>
                                <span className={styles.insightLabel}>평균 클릭률</span>
                            </div>
                        </div>
                        <div className={styles.insightItem}>
                            <div className={styles.insightIcon}><Users size={16} /></div>
                            <div className={styles.insightContent}>
                                <span className={styles.insightValue}>32</span>
                                <span className={styles.insightLabel}>신규 구매</span>
                            </div>
                        </div>
                    </div>
                    <div className={styles.tipBox}>
                        <span className={styles.tipTitle}>💡 마케팅 팁</span>
                        <p className={styles.tipText}>주말 오전 10시에 쇼핑 검색량이 가장 많습니다.</p>
                    </div>
                </motion.div>

                {/* 5. Banner/Ad (Span 2) */}
                <motion.div className={`${styles.card} ${styles.bannerCard}`} variants={itemVariants}>
                    <div className={styles.bannerContent}>
                        <h3>AI가 분석하는<br />우리 가게 SEO 점수는?</h3>
                        <Link href="/dashboard/seo" className={styles.bannerBtn}>
                            무료 분석하기
                        </Link>
                    </div>
                    <div className={styles.bannerImage}>
                        {/* Placeholder for 3D or Illustration */}
                        <div className={styles.glowCircle} />
                    </div>
                </motion.div>

            </motion.div>
        </DashboardLayout>
    );
}
