'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import {
    ArrowDownRight, ArrowUpRight, CalendarDays, Clock, Copy, ExternalLink, Info, Loader2, Minus, Search, Table2, TrendingUp,
} from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { buildKeywordLinks, SEARCHAD_URL } from '@/lib/keyword-links';
import styles from './page.module.css';

const EXAMPLE_KEYWORDS = ['캠핑의자', '단백질쉐이크', '무선청소기'];
const MAX_COMPARE = 4;

// 어두운 카드 배경(#1A2436) 기준으로 색각 이상 구분·명도 대비를 검증한 고정 순서 색상.
// 색만으로 구분하지 않도록 선 모양(실선·점선)도 함께 다르게 씁니다.
const SERIES_STYLES = [
    { color: '#3987e5', dash: undefined },
    { color: '#d95926', dash: '7 4' },
    { color: '#199e70', dash: '2 4' },
    { color: '#c98500', dash: '10 4 2 4' },
    { color: '#d55181', dash: '4 2' },
];

function splitCompare(text) {
    return text.split(/[,\n]/).map((v) => v.trim()).filter(Boolean);
}

function periodLabel(period) {
    return `${period.slice(2, 4)}.${period.slice(5, 7)}`;
}

function formatChange(value) {
    if (value == null) return { text: '자료 부족', tone: 'flat', Icon: Minus };
    const rounded = Math.round(value);
    if (rounded > 0) return { text: `${rounded}% 늘었어요`, tone: 'up', Icon: ArrowUpRight };
    if (rounded < 0) return { text: `${Math.abs(rounded)}% 줄었어요`, tone: 'down', Icon: ArrowDownRight };
    return { text: '비슷해요', tone: 'flat', Icon: Minus };
}

function LineSample({ index }) {
    const style = SERIES_STYLES[index];
    return (
        <svg width="26" height="8" viewBox="0 0 26 8" aria-hidden="true" className={styles.lineSample}>
            <line x1="1" y1="4" x2="25" y2="4" stroke={style.color} strokeWidth="2.5" strokeDasharray={style.dash} strokeLinecap="round" />
        </svg>
    );
}

function TrendTooltip({ active, payload, label, keywords }) {
    if (!active || !payload?.length) return null;
    return (
        <div className={styles.tooltip}>
            <strong>{label.slice(0, 4)}년 {Number(label.slice(5, 7))}월</strong>
            <ul>
                {payload.map((item) => {
                    const index = Number(item.dataKey.slice(1));
                    return (
                        <li key={item.dataKey}>
                            <LineSample index={index} />
                            <span>{keywords[index]}</span>
                            <b>{Math.round(item.value * 10) / 10}</b>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}

export default function KeywordTrendPage() {
    const { status } = useSession();
    const router = useRouter();

    const [keyword, setKeyword] = useState('');
    const [compareText, setCompareText] = useState('');
    const [recent, setRecent] = useState([]);
    const [configured, setConfigured] = useState(null);
    const [canConfigure, setCanConfigure] = useState(false);
    const [result, setResult] = useState(null);
    // 연동 키가 없을 때: 그래프 대신 입력한 키워드로 여는 외부 도구 바로가기
    const [links, setLinks] = useState(null);
    const [loading, setLoading] = useState(false);
    const [showTable, setShowTable] = useState(false);

    const fetchMeta = useCallback(async () => {
        try {
            const res = await fetch('/api/keyword');
            if (!res.ok) return;
            const data = await res.json();
            setRecent(data.recent || []);
            setConfigured(Boolean(data.configured));
            setCanConfigure(Boolean(data.canConfigure));
        } catch (error) {
            console.error('Error fetching keyword meta:', error);
        }
    }, []);

    useEffect(() => {
        if (status === 'unauthenticated') {
            router.push('/login');
        } else if (status === 'authenticated') {
            fetchMeta();
        }
    }, [status, router, fetchMeta]);

    const analyze = async (mainKeyword, compareKeywords) => {
        const main = mainKeyword.trim();
        if (main.length < 2) {
            toast.error('키워드는 2자 이상 입력해주세요.');
            return;
        }
        if (compareKeywords.length > MAX_COMPARE) {
            toast.error(`비교 키워드는 최대 ${MAX_COMPARE}개까지 입력할 수 있습니다.`);
            return;
        }

        setLoading(true);
        try {
            const res = await fetch('/api/keyword', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ keyword: main, compare: compareKeywords }),
            });
            const data = await res.json();

            if (!res.ok) {
                toast.error(typeof data.error === 'string' ? data.error : '요청을 처리하지 못했습니다.');
                return;
            }

            if (data.configured === false) {
                setConfigured(false);
                setResult(null);
                setLinks(buildKeywordLinks(data.keywords));
                fetchMeta();
                return;
            }

            setLinks(null);
            setResult(data.result);
            setShowTable(false);
            fetchMeta();
        } catch (error) {
            console.error('Error fetching keyword trend:', error);
            toast.error('키워드 트렌드 조회 중 오류가 발생했습니다.');
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = (event) => {
        event.preventDefault();
        analyze(keyword, splitCompare(compareText));
    };

    const runExample = (value) => {
        setKeyword(value);
        setCompareText('');
        analyze(value, []);
    };

    const copyKeyword = async (value) => {
        try {
            if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
            await navigator.clipboard.writeText(value);
            toast.success(`'${value}' 복사했어요. 데이터랩의 주제어 칸에 붙여넣으세요.`);
        } catch {
            toast.error('복사하지 못했어요. 키워드를 직접 입력해 주세요.');
        }
    };

    // 차트·표용: 달마다 한 줄, 키워드별 값은 k0, k1 … 에
    const chartData = useMemo(() => {
        if (!result) return [];
        const rows = new Map();
        result.series.forEach((series, index) => {
            for (const point of series.points) {
                if (!rows.has(point.period)) rows.set(point.period, { period: point.period });
                rows.get(point.period)[`k${index}`] = point.ratio;
            }
        });
        return [...rows.values()].sort((a, b) => a.period.localeCompare(b.period));
    }, [result]);

    const hasAnyData = result?.summary.some((s) => s.hasData);
    const linkMode = configured === false;

    return (
        <DashboardLayout>
            <div className={styles.container}>
                <section className={styles.hero}>
                    <h1>키워드 트렌드</h1>
                    <p>네이버 검색 추이로 언제 많이 찾는지, 어떤 키워드를 더 많이 찾는지 확인하세요.</p>

                    <form className={styles.form} onSubmit={handleSubmit}>
                        <div className={styles.field}>
                            <label htmlFor="trend-keyword">기준 키워드</label>
                            <div className={styles.inputWrap}>
                                <Search size={18} aria-hidden="true" />
                                <input
                                    id="trend-keyword"
                                    type="text"
                                    maxLength={30}
                                    value={keyword}
                                    placeholder="예: 캠핑의자"
                                    onChange={(e) => setKeyword(e.target.value)}
                                />
                            </div>
                        </div>
                        <div className={styles.field}>
                            <label htmlFor="trend-compare">비교할 키워드 <span>(선택 · 쉼표로 구분 · 최대 {MAX_COMPARE}개)</span></label>
                            <div className={styles.inputWrap}>
                                <input
                                    id="trend-compare"
                                    type="text"
                                    maxLength={140}
                                    value={compareText}
                                    placeholder="예: 캠핑테이블, 캠핑체어"
                                    onChange={(e) => setCompareText(e.target.value)}
                                />
                            </div>
                        </div>
                        <button type="submit" className={styles.submitBtn} disabled={loading}>
                            {loading ? <Loader2 size={18} className={styles.spin} /> : <TrendingUp size={18} />}
                            {loading ? '조회 중...' : linkMode ? '바로 확인하기' : '추이 보기'}
                        </button>
                    </form>

                    <div className={styles.chips}>
                        <span>예시</span>
                        {EXAMPLE_KEYWORDS.map((example) => (
                            <button key={example} type="button" onClick={() => runExample(example)} disabled={loading}>
                                {example}
                            </button>
                        ))}
                    </div>
                </section>

                {linkMode && (
                    <section className={styles.notice} role="status">
                        <Info size={20} aria-hidden="true" />
                        <div>
                            <strong>지금은 그래프 대신 바로가기로 안내해요</strong>
                            <p>
                                이 화면에 추이 그래프를 그리려면 네이버 검색어 트렌드 연동 키가 서버에 등록되어 있어야 하는데, 아직 등록되지 않았어요.
                                키워드를 입력하면 같은 자료를 볼 수 있는 도구를 그 키워드로 바로 열어 드립니다.
                            </p>
                            {canConfigure ? (
                                <p className={styles.adminNote}>
                                    <b>관리자 안내</b>
                                    서버 환경변수에 <code>NAVER_API_HUB_KEY_ID</code>, <code>NAVER_API_HUB_KEY</code>
                                    (NAVER API HUB의 &lsquo;검색어 트렌드&rsquo; 키)를 등록하고 다시 배포하면 이 화면에 그래프가 바로 나옵니다.
                                    기존 네이버 개발자센터 키는 <code>NAVER_CLIENT_ID</code>, <code>NAVER_CLIENT_SECRET</code>으로도 동작합니다.
                                </p>
                            ) : (
                                <p className={styles.noticeLinks}>
                                    그래프 연동이 필요하면 <Link href="/dashboard/support">고객센터</Link>로 알려 주세요.
                                    지금 바로 쓸 수 있는 도구: <Link href="/dashboard/margin">마진·ROAS 계산기</Link> · <Link href="/dashboard/seo">상품명 SEO 분석</Link>
                                </p>
                            )}
                        </div>
                    </section>
                )}

                {recent.length > 0 && (
                    <div className={styles.recent}>
                        <Clock size={14} aria-hidden="true" />
                        <span>최근 조회</span>
                        {recent.map((item) => (
                            <button key={item.id} type="button" onClick={() => runExample(item.keyword)} disabled={loading}>
                                {item.keyword}
                            </button>
                        ))}
                    </div>
                )}

                {links && (
                    <section className={styles.card} aria-live="polite" aria-label="검색 추이 바로가기">
                        <div className={styles.cardHead}>
                            <div>
                                <h2>&lsquo;{links.keywords.join(', ')}&rsquo; 검색 추이 바로 확인</h2>
                                <p>아래 도구에서 같은 자료를 볼 수 있어요 · 기준 기간 {links.range.startDate.slice(0, 7)} ~ {links.range.endDate.slice(0, 7)}</p>
                            </div>
                        </div>

                        <div className={styles.linkGrid}>
                            <article className={styles.linkTile}>
                                <h3>네이버 데이터랩 검색어 트렌드</h3>
                                <p>네이버 검색 기준이고 로그인 없이 무료예요. 주소로 키워드를 넘길 수 없어서, 키워드를 복사한 뒤 열린 화면의 &lsquo;주제어&rsquo; 칸에 붙여넣어 주세요.</p>
                                <ul className={styles.copyList}>
                                    {links.keywords.map((name) => (
                                        <li key={name}>
                                            <span>{name}</span>
                                            <button type="button" onClick={() => copyKeyword(name)}>
                                                <Copy size={13} aria-hidden="true" /> 복사
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                                <a className={styles.linkBtn} href={links.datalab} target="_blank" rel="noopener noreferrer">
                                    데이터랩 열기 <ExternalLink size={14} aria-hidden="true" />
                                </a>
                            </article>

                            <article className={styles.linkTile}>
                                <h3>구글 트렌드</h3>
                                <p>
                                    {links.keywords.length > 1 ? '입력한 키워드 비교와 ' : '입력한 키워드와 '}
                                    기간(한국 · 최근 3년)이 미리 들어간 채로 열려요. 구글 검색 기준이라 네이버와는 차이가 날 수 있어요.
                                </p>
                                <p className={styles.tileHint}>처음 열 때 오류(429) 화면이 보이면 새로고침을 한 번 눌러 주세요.</p>
                                <a className={styles.linkBtn} href={links.googleTrends} target="_blank" rel="noopener noreferrer">
                                    구글 트렌드에서 보기 <ExternalLink size={14} aria-hidden="true" />
                                </a>
                            </article>

                            <article className={styles.linkTile}>
                                <h3>네이버 검색 결과</h3>
                                <p>지금 이 키워드로 어떤 상품·가게가 보이는지, 연관 검색어는 무엇인지 확인하세요.</p>
                                <div className={styles.linkRow}>
                                    {links.naverSearch.map((item) => (
                                        <a key={item.keyword} href={item.url} target="_blank" rel="noopener noreferrer">
                                            {item.keyword} <ExternalLink size={12} aria-hidden="true" />
                                        </a>
                                    ))}
                                </div>
                            </article>
                        </div>

                        <p className={styles.basis}>
                            <Info size={13} aria-hidden="true" />
                            <span>
                                실제 월간 검색수는 네이버 검색광고의 키워드 도구(광고 계정 로그인 &gt; 도구 &gt; 키워드 도구)에서 볼 수 있어요.{' '}
                                <a className={styles.inlineLink} href={SEARCHAD_URL} target="_blank" rel="noopener noreferrer">검색광고 열기</a>
                            </span>
                        </p>
                    </section>
                )}

                {result && (
                    <div aria-live="polite">
                        <section className={styles.card}>
                            <div className={styles.cardHead}>
                                <div>
                                    <h2>월별 검색 추이</h2>
                                    <p>{result.range.startDate.slice(0, 7)} ~ {result.range.endDate.slice(0, 7)} · 네이버 통합검색 기준</p>
                                </div>
                                <button type="button" className={styles.ghostBtn} onClick={() => setShowTable((v) => !v)} aria-pressed={showTable}>
                                    <Table2 size={14} /> {showTable ? '그래프로 보기' : '표로 보기'}
                                </button>
                            </div>

                            {!hasAnyData ? (
                                <p className={styles.empty}>검색량이 너무 적어 추이를 보여 드릴 수 없어요. 더 넓은 키워드로 조회해 보세요.</p>
                            ) : (
                                <>
                                    {result.keywords.length > 1 && (
                                        <ul className={styles.legend}>
                                            {result.keywords.map((name, index) => (
                                                <li key={name}><LineSample index={index} />{name}</li>
                                            ))}
                                        </ul>
                                    )}

                                    {showTable ? (
                                        <div className={styles.tableWrap}>
                                            <table className={styles.table}>
                                                <thead>
                                                    <tr>
                                                        <th scope="col">월</th>
                                                        {result.keywords.map((name) => <th key={name} scope="col">{name}</th>)}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {[...chartData].reverse().map((row) => (
                                                        <tr key={row.period}>
                                                            <th scope="row">{row.period}</th>
                                                            {result.keywords.map((name, index) => (
                                                                <td key={name}>{row[`k${index}`] != null ? Math.round(row[`k${index}`] * 10) / 10 : '-'}</td>
                                                            ))}
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    ) : (
                                        <div className={styles.chart}>
                                            <ResponsiveContainer width="100%" height={300}>
                                                <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
                                                    <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                                                    <XAxis
                                                        dataKey="period"
                                                        tickFormatter={periodLabel}
                                                        interval={5}
                                                        tick={{ fontSize: 11, fill: '#94A3B8' }}
                                                        axisLine={false}
                                                        tickLine={false}
                                                    />
                                                    <YAxis
                                                        domain={[0, 100]}
                                                        ticks={[0, 25, 50, 75, 100]}
                                                        tick={{ fontSize: 11, fill: '#94A3B8' }}
                                                        axisLine={false}
                                                        tickLine={false}
                                                        width={48}
                                                    />
                                                    <Tooltip
                                                        content={<TrendTooltip keywords={result.keywords} />}
                                                        cursor={{ stroke: 'rgba(255,255,255,0.25)', strokeWidth: 1 }}
                                                    />
                                                    {result.keywords.map((name, index) => (
                                                        <Line
                                                            key={name}
                                                            type="monotone"
                                                            dataKey={`k${index}`}
                                                            name={name}
                                                            stroke={SERIES_STYLES[index].color}
                                                            strokeWidth={2}
                                                            strokeDasharray={SERIES_STYLES[index].dash}
                                                            dot={false}
                                                            activeDot={{ r: 5, stroke: '#1A2436', strokeWidth: 2 }}
                                                            connectNulls
                                                            isAnimationActive={false}
                                                        />
                                                    ))}
                                                </LineChart>
                                            </ResponsiveContainer>
                                        </div>
                                    )}
                                </>
                            )}

                            <p className={styles.basis}>
                                <Info size={13} aria-hidden="true" />
                                숫자는 실제 검색 횟수가 아니라, 조회한 기간과 키워드 중 가장 많이 검색된 달을 100으로 둔 상대값입니다.
                                출처: 네이버 데이터랩 검색어 트렌드.
                            </p>
                        </section>

                        <section className={styles.summaryGrid} aria-label="키워드별 요약">
                            {result.summary.map((item, index) => {
                                const recentChange = formatChange(item.recentChange);
                                const yearChange = formatChange(item.yearChange);
                                return (
                                    <article key={item.keyword} className={styles.summaryCard}>
                                        <h3><LineSample index={index} />{item.keyword}</h3>
                                        {!item.hasData ? (
                                            <p className={styles.muted}>검색량이 너무 적어 추이를 볼 수 없어요.</p>
                                        ) : (
                                            <dl>
                                                {result.keywords.length > 1 && (
                                                    <div>
                                                        <dt>검색 수요 (기준 키워드 = 100)</dt>
                                                        <dd className={styles.big}>
                                                            {index === 0 ? '기준' : item.relativeIndex != null ? item.relativeIndex.toLocaleString('ko-KR') : '-'}
                                                        </dd>
                                                    </div>
                                                )}
                                                <div>
                                                    <dt><CalendarDays size={13} /> 많이 찾는 달</dt>
                                                    <dd>
                                                        {item.peakMonths.length > 0
                                                            ? item.peakMonths.map((m) => `${m.month}월`).join(', ')
                                                            : '뚜렷한 성수기 없음'}
                                                    </dd>
                                                </div>
                                                <div>
                                                    <dt>최근 3개월 (직전 3개월 대비)</dt>
                                                    <dd className={styles[recentChange.tone]}>
                                                        <recentChange.Icon size={15} /> {recentChange.text}
                                                    </dd>
                                                </div>
                                                <div>
                                                    <dt>작년 같은 기간 대비</dt>
                                                    <dd className={styles[yearChange.tone]}>
                                                        <yearChange.Icon size={15} /> {yearChange.text}
                                                    </dd>
                                                </div>
                                            </dl>
                                        )}
                                    </article>
                                );
                            })}
                        </section>
                    </div>
                )}

                {!result && !links && (
                    <section className={styles.guide}>
                        <div><b>1</b><h3>키워드 입력</h3><p>팔려는 상품이나 우리 가게를 찾을 때 쓰는 단어를 넣으세요.</p></div>
                        <div><b>2</b><h3>성수기 확인</h3><p>최근 3년 동안 어느 달에 검색이 몰리는지 보고 준비 시점을 잡으세요.</p></div>
                        <div><b>3</b><h3>키워드 비교</h3><p>후보 키워드를 함께 넣으면 어느 쪽을 더 많이 찾는지 비교할 수 있어요.</p></div>
                    </section>
                )}
            </div>
        </DashboardLayout>
    );
}
