'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import DashboardLayout from '@/components/layout/DashboardLayout';
import styles from './page.module.css';
import { analyzeSeo } from '@/lib/seo-analyzer';
import { CheckCircle2, Copy, Search, Sparkles, Wand2, XCircle } from 'lucide-react';
import { toast } from 'sonner';

const PRESETS = [
    {
        label: '예시: 좋은 상품명',
        productName: 'Nike 에어맥스 270 남자 운동화 쿠션 런닝화 270mm',
        keyword: '남자 운동화',
    },
    {
        label: '예시: 개선 필요 상품명',
        productName: '★초특가★무료배송 최저가 이벤트 세일세일 정품 신발!!',
        keyword: '운동화',
    },
];

const GRADE_CLASS = { A: 'gradeA', B: 'gradeB', C: 'gradeC', D: 'gradeD' };
const GRADE_LABEL = { A: '우수', B: '양호', C: '보완 필요', D: '위험' };

function ScoreGauge({ score, grade }) {
    const radius = 54;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference * (1 - score / 100);
    const gradeClass = styles[GRADE_CLASS[grade]] || styles.gradeD;

    return (
        <div className={styles.gaugeWrap}>
            <svg width="140" height="140" viewBox="0 0 140 140">
                <circle cx="70" cy="70" r={radius} className={styles.gaugeTrack} />
                <circle
                    cx="70" cy="70" r={radius}
                    className={`${styles.gaugeProgress} ${gradeClass}`}
                    style={{ strokeDasharray: circumference, strokeDashoffset: offset }}
                />
            </svg>
            <div className={styles.gaugeCenter}>
                <strong>{score}</strong>
                <span>{grade}등급 · {GRADE_LABEL[grade]}</span>
            </div>
        </div>
    );
}

export default function SeoPage() {
    const { data: session, status } = useSession();
    const router = useRouter();

    const [productName, setProductName] = useState('');
    const [keyword, setKeyword] = useState('');
    const [result, setResult] = useState(null);

    useEffect(() => {
        if (status === 'unauthenticated') {
            router.push('/login');
        }
    }, [router, status]);

    const handleAnalyze = (event) => {
        event.preventDefault();

        if (!productName.trim() || !keyword.trim()) {
            toast.error('상품명과 타겟 키워드를 입력해주세요.');
            return;
        }

        const analysis = analyzeSeo({ productName, keyword });
        setResult(analysis);
        toast.success('SEO 분석이 완료되었습니다.');
    };

    const applyPreset = (preset) => {
        setProductName(preset.productName);
        setKeyword(preset.keyword);
        setResult(null);
    };

    const handleCopy = async (text) => {
        try {
            await navigator.clipboard.writeText(text);
            toast.success('상품명이 복사되었습니다.');
        } catch {
            toast.error('복사에 실패했습니다.');
        }
    };

    if (status === 'loading') {
        return <DashboardLayout><div className={styles.container}>로딩 중...</div></DashboardLayout>;
    }

    return (
        <DashboardLayout>
            <div className={styles.container}>
                <div className={styles.header}>
                    <div className={styles.headerContent}>
                        <h1 className={styles.title}>쇼핑 SEO 분석</h1>
                        <p className={styles.subtitle}>상품명과 타겟 키워드만 입력하면 네이버 쇼핑 SEO 기준으로 즉시 점수를 확인할 수 있어요</p>
                    </div>
                    <span className={styles.badge}>
                        <Sparkles size={14} />
                        빠른 진단
                    </span>
                </div>

                {/* Input Form */}
                <form className={styles.formCard} onSubmit={handleAnalyze}>
                    <div className={styles.formGrid}>
                        <div className={styles.formField}>
                            <label htmlFor="seo-name">상품명</label>
                            <input
                                id="seo-name"
                                type="text"
                                placeholder="예: 나이키 에어맥스 270 남성 러닝화 쿠션 운동화 270mm"
                                value={productName}
                                onChange={(e) => setProductName(e.target.value)}
                                required
                            />
                        </div>
                        <div className={styles.formField}>
                            <label htmlFor="seo-keyword">타겟 키워드</label>
                            <input
                                id="seo-keyword"
                                type="text"
                                placeholder="예: 남자 운동화"
                                value={keyword}
                                onChange={(e) => setKeyword(e.target.value)}
                                required
                            />
                        </div>
                    </div>

                    <div className={styles.presetRow}>
                        <span>빠른 예시로 확인해보기</span>
                        <div className={styles.presetBtns}>
                            {PRESETS.map((preset) => (
                                <button key={preset.label} type="button" onClick={() => applyPreset(preset)}>
                                    {preset.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <button type="submit" className={styles.submitBtn}>
                        <Wand2 size={16} />
                        분석 시작
                    </button>
                </form>

                {/* Result */}
                {!result ? (
                    <div className={styles.emptyState}>
                        <Search size={48} className={styles.emptyIcon} />
                        <h4>아직 분석 결과가 없습니다.</h4>
                        <p>상품명과 타겟 키워드를 입력하고 분석 버튼을 눌러보세요.</p>
                    </div>
                ) : (
                    <div className={styles.resultLayout}>
                        <div className={styles.scoreCard}>
                            <ScoreGauge score={result.score} grade={result.grade} />
                            <Link href="/dashboard/keyword" className={styles.keywordLink}>
                                <Search size={14} />
                                키워드 분석에서 검색량 확인하기
                            </Link>
                        </div>

                        <div className={styles.checkCard}>
                            <h3>체크리스트</h3>
                            <div className={styles.checkList}>
                                {result.checks.map((check) => (
                                    <div
                                        key={check.id}
                                        className={`${styles.checkItem} ${check.passed ? styles.checkPass : styles.checkFail}`}
                                    >
                                        <div className={styles.checkHeader}>
                                            {check.passed ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                                            <span>{check.label}</span>
                                            <em>{check.points}점</em>
                                        </div>
                                        <p>{check.advice}</p>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className={styles.suggestionCard}>
                            <h3>추천 상품명</h3>
                            <div className={styles.suggestionGrid}>
                                {result.suggestions.map((suggestion, idx) => (
                                    <div key={idx} className={styles.suggestionItem}>
                                        <p>{suggestion}</p>
                                        <button type="button" onClick={() => handleCopy(suggestion)}>
                                            <Copy size={13} />
                                            복사
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </DashboardLayout>
    );
}
