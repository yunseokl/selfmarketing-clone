'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/layout/DashboardLayout';
import styles from './page.module.css';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ArrowRight,
    Clock,
    ExternalLink,
    Info,
    Loader2,
    Monitor,
    Package,
    Search,
    ShoppingBag,
    Smartphone,
    Sparkles,
    TrendingUp,
    Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { Cell, Pie, PieChart, PolarAngleAxis, RadialBar, RadialBarChart } from 'recharts';

const EXAMPLE_KEYWORDS = ['캠핑의자', '단백질쉐이크', '무선청소기'];

const COMPETITION_COLOR_VAR = {
    success: 'var(--success)',
    secondary: 'var(--secondary)',
    warning: 'var(--warning)',
    error: 'var(--error)',
};

function formatNumber(value) {
    if (value === null || value === undefined) return '-';
    return value.toLocaleString('ko-KR');
}

function getValidationMessage(error) {
    if (!error) return '요청을 처리하지 못했습니다.';
    if (typeof error === 'string') return error;

    const firstField = Object.values(error).find(messages => Array.isArray(messages) && messages.length > 0);
    return firstField?.[0] || '입력값을 확인해주세요.';
}

function getOpportunityMessage(score) {
    if (score >= 70) return '지금 진입하기 좋은 키워드예요.';
    if (score >= 40) return '경쟁이 있지만 차별화하면 해볼 만해요.';
    return '경쟁이 치열해요. 세부 키워드로 좁혀보는 걸 추천해요.';
}

function getOpportunityVisual(score) {
    if (score >= 70) return { hex: '#10B981', className: styles.oppHigh };
    if (score >= 40) return { hex: '#F59E0B', className: styles.oppMid };
    return { hex: '#EF4444', className: styles.oppLow };
}

export default function KeywordPage() {
    const { status } = useSession();
    const router = useRouter();

    const [keywordInput, setKeywordInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState(null);
    const [recentSearches, setRecentSearches] = useState([]);
    const [recentLoading, setRecentLoading] = useState(true);

    const fetchRecent = useCallback(async () => {
        try {
            setRecentLoading(true);
            const res = await fetch('/api/keyword');
            if (res.ok) {
                const data = await res.json();
                setRecentSearches(data.recent || []);
            }
        } catch (error) {
            console.error('Error fetching recent keyword searches:', error);
        } finally {
            setRecentLoading(false);
        }
    }, []);

    useEffect(() => {
        if (status === 'unauthenticated') {
            router.push('/login');
        } else if (status === 'authenticated') {
            fetchRecent();
        }
    }, [status, router, fetchRecent]);

    const runAnalysis = useCallback(async (rawKeyword) => {
        const keyword = rawKeyword.trim();
        if (keyword.length < 2) {
            toast.error('키워드는 2자 이상 입력해주세요.');
            return;
        }

        try {
            setLoading(true);
            const res = await fetch('/api/keyword', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ keyword }),
            });
            const data = await res.json();

            if (res.ok) {
                setResult(data.result);
                setKeywordInput(keyword);
                fetchRecent();
                window.scrollTo({ top: 0, behavior: 'smooth' });
            } else {
                toast.error(getValidationMessage(data.error));
            }
        } catch (error) {
            console.error('Error analyzing keyword:', error);
            toast.error('키워드 분석 중 오류가 발생했습니다.');
        } finally {
            setLoading(false);
        }
    }, [fetchRecent]);

    const handleSubmit = (event) => {
        event.preventDefault();
        runAnalysis(keywordInput);
    };

    if (status === 'loading') {
        return <DashboardLayout><div className={styles.container}>로딩 중...</div></DashboardLayout>;
    }

    const volumeChartData = result
        ? [{ name: 'PC', value: result.monthlySearchPc }, { name: '모바일', value: result.monthlySearchMobile }]
        : [];
    const opportunityChartData = result ? [{ value: result.opportunityScore }] : [];
    const opportunityVisual = result ? getOpportunityVisual(result.opportunityScore) : null;

    return (
        <DashboardLayout>
            <div className={styles.container}>
                {/* Hero */}
                <div className={styles.hero}>
                    <h1 className={styles.title}>키워드 분석</h1>
                    <p className={styles.subtitle}>판매 전에 키워드의 수요와 경쟁을 확인하세요</p>

                    <form className={styles.searchForm} onSubmit={handleSubmit}>
                        <Search size={20} className={styles.searchIcon} />
                        <input
                            type="text"
                            className={styles.searchInput}
                            placeholder="분석할 키워드를 입력하세요 (예: 캠핑의자)"
                            value={keywordInput}
                            onChange={(event) => setKeywordInput(event.target.value)}
                            maxLength={40}
                            disabled={loading}
                        />
                        <button type="submit" className={styles.searchBtn} disabled={loading}>
                            {loading ? <Loader2 size={18} className={styles.spin} /> : <Search size={18} />}
                            {loading ? '분석 중...' : '분석하기'}
                        </button>
                    </form>
                </div>

                {/* Recent chips */}
                {!recentLoading && recentSearches.length > 0 && (
                    <div className={styles.recentRow}>
                        <span className={styles.recentLabel}><Clock size={14} /> 최근 검색</span>
                        <div className={styles.chipList}>
                            {recentSearches.map((item) => (
                                <button
                                    key={item.id}
                                    type="button"
                                    className={styles.chip}
                                    onClick={() => runAnalysis(item.keyword)}
                                    disabled={loading}
                                >
                                    {item.keyword}
                                    {item.summary && (
                                        <span className={styles.chipScore}>{item.summary.opportunityScore}점</span>
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                <AnimatePresence mode="wait">
                    {loading ? (
                        <motion.div
                            key="loading"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className={styles.metricGrid}
                        >
                            {[0, 1, 2, 3].map((i) => (
                                <div key={i} className={styles.skeletonCard} />
                            ))}
                        </motion.div>
                    ) : result ? (
                        <motion.div
                            key={`${result.keyword}-${result.checkedAt}`}
                            initial={{ opacity: 0, y: 16 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.35 }}
                        >
                            {/* Result header */}
                            <div className={styles.resultHeader}>
                                <h2>{result.keyword}</h2>
                                {result.source === 'naver' ? (
                                    <span className={`${styles.sourceBadge} ${styles.sourceReal}`}>네이버 실데이터</span>
                                ) : (
                                    <span
                                        className={`${styles.sourceBadge} ${styles.sourceEstimate}`}
                                        title="NAVER_CLIENT_ID 등록 시 실데이터로 분석됩니다."
                                    >
                                        추정 데이터
                                    </span>
                                )}
                            </div>
                            {result.source === 'estimate' && (
                                <p className={styles.sourceCaption}>
                                    <Info size={13} /> NAVER_CLIENT_ID 등록 시 실데이터로 분석됩니다.
                                </p>
                            )}

                            {/* Metric cards */}
                            <div className={styles.metricGrid}>
                                <div className={styles.metricCard}>
                                    <span className={styles.metricLabel}><TrendingUp size={16} /> 월간 검색수</span>
                                    <strong className={styles.metricValue}>{formatNumber(result.monthlySearchTotal)}</strong>
                                    <div className={styles.donutRow}>
                                        <div className={styles.donutChart}>
                                            <PieChart width={72} height={72}>
                                                <Pie data={volumeChartData} dataKey="value" innerRadius={22} outerRadius={34} paddingAngle={2} stroke="none">
                                                    <Cell fill="#3B82F6" />
                                                    <Cell fill="#A3E635" />
                                                </Pie>
                                            </PieChart>
                                        </div>
                                        <div className={styles.donutLegend}>
                                            <span className={styles.legendPc}><Monitor size={12} /> PC {formatNumber(result.monthlySearchPc)}</span>
                                            <span className={styles.legendMobile}><Smartphone size={12} /> 모바일 {formatNumber(result.monthlySearchMobile)}</span>
                                        </div>
                                    </div>
                                </div>

                                <div className={styles.metricCard}>
                                    <span className={styles.metricLabel}><Package size={16} /> 등록 상품수</span>
                                    <strong className={styles.metricValue}>{formatNumber(result.productCount)}</strong>
                                    <p className={styles.metricSub}>평균가 {result.avgPrice ? `${formatNumber(result.avgPrice)}원` : '-'}</p>
                                </div>

                                <div className={styles.metricCard}>
                                    <span className={styles.metricLabel}><ShoppingBag size={16} /> 경쟁강도</span>
                                    <div className={styles.competitionRow}>
                                        <strong className={styles.metricValue}>{result.competitionRatio}</strong>
                                        <span
                                            className={`${styles.levelBadge} ${styles[`level_${result.competitionColor}`]}`}
                                        >
                                            {result.competitionLevel}
                                        </span>
                                    </div>
                                    <div className={styles.gaugeTrack}>
                                        <div
                                            className={styles.gaugeFill}
                                            style={{
                                                width: `${Math.min(100, result.competitionRatio * 5)}%`,
                                                background: COMPETITION_COLOR_VAR[result.competitionColor],
                                            }}
                                        />
                                    </div>
                                </div>

                                <div className={`${styles.metricCard} ${styles.opportunityCard}`}>
                                    <span className={styles.metricLabel}><Zap size={16} /> 기회 점수</span>
                                    <div className={styles.radialWrap}>
                                        <RadialBarChart
                                            width={100}
                                            height={100}
                                            innerRadius={34}
                                            outerRadius={48}
                                            data={opportunityChartData}
                                            startAngle={90}
                                            endAngle={-270}
                                        >
                                            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
                                            <RadialBar
                                                dataKey="value"
                                                cornerRadius={10}
                                                fill={opportunityVisual.hex}
                                                background={{ fill: 'rgba(255,255,255,0.08)' }}
                                            />
                                        </RadialBarChart>
                                        <span className={`${styles.radialValue} ${opportunityVisual.className}`}>
                                            {result.opportunityScore}
                                        </span>
                                    </div>
                                    <p className={styles.metricSub}>{getOpportunityMessage(result.opportunityScore)}</p>
                                </div>
                            </div>

                            {/* Top products / notice */}
                            {result.source === 'naver' ? (
                                <div className={styles.section}>
                                    <h3 className={styles.sectionTitle}>상위 노출 상품 TOP {result.topProducts.length}</h3>
                                    {result.topProducts.length > 0 ? (
                                        <div className={styles.tableContainer}>
                                            <table className={styles.table}>
                                                <thead>
                                                    <tr>
                                                        <th>순위</th>
                                                        <th>썸네일</th>
                                                        <th>상품명</th>
                                                        <th>가격</th>
                                                        <th>몰명</th>
                                                        <th></th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {result.topProducts.map((product) => (
                                                        <tr key={product.rank}>
                                                            <td>{product.rank}</td>
                                                            <td>
                                                                <div className={styles.thumbnail}>
                                                                    {product.image ? (
                                                                        // 네이버 API가 반환하는 외부 이미지라 도메인을 미리 고정할 수 없어 기본 img를 씁니다.
                                                                        // eslint-disable-next-line @next/next/no-img-element
                                                                        <img src={product.image} alt="" />
                                                                    ) : (
                                                                        <Package size={20} />
                                                                    )}
                                                                </div>
                                                            </td>
                                                            <td className={styles.productTitle}>{product.title}</td>
                                                            <td>{product.price ? `${formatNumber(product.price)}원` : '-'}</td>
                                                            <td>{product.mallName}</td>
                                                            <td>
                                                                <a
                                                                    href={product.link}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className={styles.linkBtn}
                                                                    aria-label="상품 페이지 열기"
                                                                >
                                                                    <ExternalLink size={14} />
                                                                </a>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    ) : (
                                        <p className={styles.emptyHint}>등록된 상품이 없습니다.</p>
                                    )}
                                </div>
                            ) : (
                                <div className={styles.noticeCard}>
                                    <Info size={20} />
                                    <div>
                                        <strong>네이버 API 키를 등록하면 실제 상위 노출 상품을 보여드려요</strong>
                                        <p>.env 파일에 NAVER_CLIENT_ID, NAVER_CLIENT_SECRET을 등록하면 실제 순위와 상품 데이터를 확인할 수 있습니다.</p>
                                    </div>
                                </div>
                            )}

                            {/* Related keywords */}
                            {result.relatedKeywords.length > 0 && (
                                <div className={styles.section}>
                                    <h3 className={styles.sectionTitle}>연관 키워드</h3>
                                    <div className={styles.tableContainer}>
                                        <table className={styles.table}>
                                            <thead>
                                                <tr>
                                                    <th>키워드</th>
                                                    <th>월간 검색수</th>
                                                    <th>상품수</th>
                                                    <th>경쟁강도</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {result.relatedKeywords.map((rk) => (
                                                    <tr
                                                        key={rk.keyword}
                                                        className={styles.clickableRow}
                                                        onClick={() => runAnalysis(rk.keyword)}
                                                    >
                                                        <td className={styles.relatedKeyword}>{rk.keyword}</td>
                                                        <td>{formatNumber(rk.monthlySearchTotal)}</td>
                                                        <td>{formatNumber(rk.productCount)}</td>
                                                        <td><span className={styles.competitionTag}>{rk.competition}</span></td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </motion.div>
                    ) : (
                        <motion.div
                            key="empty"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ duration: 0.3 }}
                        >
                            <div className={styles.guideGrid}>
                                <div className={styles.guideCard}>
                                    <span className={styles.guideNum}>1</span>
                                    <h4>키워드 입력</h4>
                                    <p>판매하려는 상품의 대표 키워드를 검색창에 입력하세요.</p>
                                </div>
                                <div className={styles.guideCard}>
                                    <span className={styles.guideNum}>2</span>
                                    <h4>수요와 경쟁 확인</h4>
                                    <p>월간 검색수, 등록 상품수, 경쟁강도를 한눈에 확인하세요.</p>
                                </div>
                                <div className={styles.guideCard}>
                                    <span className={styles.guideNum}>3</span>
                                    <h4>기회 점수로 판단</h4>
                                    <p>기회 점수와 연관 키워드로 진입 여부를 결정하세요.</p>
                                </div>
                            </div>

                            <div className={styles.exampleRow}>
                                <span className={styles.exampleLabel}><Sparkles size={14} /> 인기 예시 키워드</span>
                                <div className={styles.chipList}>
                                    {EXAMPLE_KEYWORDS.map((kw) => (
                                        <button
                                            key={kw}
                                            type="button"
                                            className={styles.exampleChip}
                                            onClick={() => runAnalysis(kw)}
                                            disabled={loading}
                                        >
                                            {kw}
                                            <ArrowRight size={13} />
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </DashboardLayout>
    );
}
