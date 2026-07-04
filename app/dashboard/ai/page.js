'use client';

import { useMemo, useState } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import styles from './page.module.css';
import { generateCopy, INDUSTRY_OPTIONS, TONE_OPTIONS } from '@/lib/copy-generator';
import {
    Check, Copy, Download, Image as ImageIcon, MessageSquareText, PenLine,
    RefreshCw, Sparkles, Wand2, X,
} from 'lucide-react';
import { toast } from 'sonner';

const TABS = [
    { id: 'copy', label: 'AI 마케팅 문구' },
    { id: 'banner', label: 'AI 홍보 배너' },
];

const COLOR_THEMES = [
    { id: 'purple', label: '보라', colors: ['#6D28D9', '#A855F7'] },
    { id: 'blue', label: '블루', colors: ['#1D4ED8', '#38BDF8'] },
    { id: 'lime', label: '라임', colors: ['#65A30D', '#A3E635'] },
    { id: 'sunset', label: '선셋', colors: ['#DB2777', '#F97316'] },
    { id: 'mono', label: '모노', colors: ['#1F2937', '#4B5563'] },
    { id: 'red', label: '레드', colors: ['#B91C1C', '#F87171'] },
];

const SIZES = [
    { id: 'square', label: '정방형 1080×1080', width: 1080, height: 1080 },
    { id: 'wide', label: '와이드 1200×628', width: 1200, height: 628 },
    { id: 'tall', label: '세로 1080×1350', width: 1080, height: 1350 },
];

const LAYOUTS = [
    { id: 'center', label: '중앙 정렬형' },
    { id: 'badge', label: '좌측 정렬 + 뱃지형' },
];

const BANNER_FONT_FAMILY = "'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";

function escapeSvgText(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function wrapText(text, maxCharsPerLine) {
    if (!text) return [];
    const words = text.split(' ');
    const lines = [];
    let current = '';

    words.forEach((word) => {
        const test = current ? `${current} ${word}` : word;
        if ([...test].length > maxCharsPerLine && current) {
            lines.push(current);
            current = word;
        } else {
            current = test;
        }
    });
    if (current) lines.push(current);
    return lines;
}

function buildBannerSvg({ mainText, subText, theme, size, layout }) {
    const { width, height } = size;
    const [c1, c2] = theme.colors;
    const mainSafe = escapeSvgText(mainText.trim() || '메인 문구를 입력해주세요');
    const subSafe = escapeSvgText(subText.trim());
    const baseUnit = Math.min(width, height);

    const mainFontSize = Math.round(baseUnit * (mainSafe.length > 14 ? 0.075 : 0.1));
    const subFontSize = Math.round(baseUnit * 0.045);
    // 한글은 폭이 넓은 전각 문자라 라틴 문자 기준 비율(0.5~0.6)로는 줄바꿈 폭을 과소 추정해 넘침이 발생합니다.
    const maxMainChars = Math.max(4, Math.floor(width / (mainFontSize * 1.05)));
    const maxSubChars = Math.max(4, Math.floor(width / (subFontSize * 1.0)));

    const isBadge = layout === 'badge';
    const mainLines = wrapText(mainSafe, isBadge ? Math.round(maxMainChars * 0.75) : maxMainChars).slice(0, 3);
    const subLines = subSafe ? wrapText(subSafe, isBadge ? Math.round(maxSubChars * 0.75) : maxSubChars).slice(0, 2) : [];

    const textAnchor = isBadge ? 'start' : 'middle';
    const textX = isBadge ? Math.round(width * 0.1) : Math.round(width / 2);
    const blockHeight = mainLines.length * mainFontSize * 1.2 + subLines.length * subFontSize * 1.4;
    const startY = isBadge ? Math.round(height * 0.58) : Math.round((height - blockHeight) / 2 + mainFontSize);

    const mainTspans = mainLines
        .map((line, idx) => `<tspan x="${textX}" y="${Math.round(startY + idx * mainFontSize * 1.2)}">${line}</tspan>`)
        .join('');

    const subStartY = startY + mainLines.length * mainFontSize * 1.2 + subFontSize * 0.9;
    const subTspans = subLines
        .map((line, idx) => `<tspan x="${textX}" y="${Math.round(subStartY + idx * subFontSize * 1.4)}">${line}</tspan>`)
        .join('');

    const badgeMarkup = isBadge
        ? `<rect x="${Math.round(width * 0.1)}" y="${Math.round(height * 0.58 - mainFontSize - 46)}" width="${Math.round(Math.min(width * 0.34, 240))}" height="40" rx="20" fill="rgba(255,255,255,0.94)" />
           <text x="${Math.round(width * 0.1 + 20)}" y="${Math.round(height * 0.58 - mainFontSize - 20)}" font-family="${BANNER_FONT_FAMILY}" font-size="${Math.round(baseUnit * 0.026)}" font-weight="700" fill="${c1}">HONJALMA AD</text>`
        : '';

    const decorations = isBadge
        ? `<circle cx="${Math.round(width * 0.92)}" cy="${Math.round(height * 0.14)}" r="${Math.round(baseUnit * 0.22)}" fill="rgba(255,255,255,0.12)" />
           <circle cx="${Math.round(width * 0.85)}" cy="${Math.round(height * 0.88)}" r="${Math.round(baseUnit * 0.14)}" fill="rgba(255,255,255,0.08)" />`
        : `<circle cx="${Math.round(width * 0.14)}" cy="${Math.round(height * 0.86)}" r="${Math.round(baseUnit * 0.2)}" fill="rgba(255,255,255,0.1)" />
           <circle cx="${Math.round(width * 0.88)}" cy="${Math.round(height * 0.16)}" r="${Math.round(baseUnit * 0.16)}" fill="rgba(255,255,255,0.08)" />`;

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
<stop offset="0%" stop-color="${c1}" />
<stop offset="100%" stop-color="${c2}" />
</linearGradient>
</defs>
<rect width="${width}" height="${height}" fill="url(#bg)" />
${decorations}
<rect x="0" y="0" width="${width}" height="${height}" fill="rgba(15,23,42,0.12)" />
${badgeMarkup}
<text text-anchor="${textAnchor}" font-family="${BANNER_FONT_FAMILY}" font-weight="800" font-size="${mainFontSize}" fill="#FFFFFF">${mainTspans}</text>
<text text-anchor="${textAnchor}" font-family="${BANNER_FONT_FAMILY}" font-weight="500" font-size="${subFontSize}" fill="rgba(255,255,255,0.88)">${subTspans}</text>
</svg>`;
}

async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        toast.success('복사되었습니다.');
    } catch {
        toast.error('복사에 실패했습니다.');
    }
}

export default function AiPage() {
    const [activeTab, setActiveTab] = useState('copy');

    // Tab 1: AI 마케팅 문구
    const [industry, setIndustry] = useState(INDUSTRY_OPTIONS[0].value);
    const [name, setName] = useState('');
    const [tone, setTone] = useState(TONE_OPTIONS[0].value);
    const [keywords, setKeywords] = useState([]);
    const [keywordDraft, setKeywordDraft] = useState('');
    const [seed, setSeed] = useState(0);
    const [result, setResult] = useState(null);

    // Tab 2: AI 홍보 배너
    const [mainText, setMainText] = useState('여름맞이 특별 프로모션');
    const [subText, setSubText] = useState('지금 확인하고 혜택 받기');
    const [theme, setTheme] = useState(COLOR_THEMES[0].id);
    const [size, setSize] = useState(SIZES[0].id);
    const [layout, setLayout] = useState(LAYOUTS[0].id);

    const themeObj = COLOR_THEMES.find(t => t.id === theme) || COLOR_THEMES[0];
    const sizeObj = SIZES.find(s => s.id === size) || SIZES[0];

    const svgMarkup = useMemo(
        () => buildBannerSvg({ mainText, subText, theme: themeObj, size: sizeObj, layout }),
        [mainText, subText, themeObj, sizeObj, layout]
    );

    const handleAddKeyword = () => {
        const value = keywordDraft.trim();
        if (!value || keywords.length >= 3) return;
        if (keywords.includes(value)) {
            setKeywordDraft('');
            return;
        }
        setKeywords(prev => [...prev, value]);
        setKeywordDraft('');
    };

    const handleKeywordKeyDown = (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            handleAddKeyword();
        }
    };

    const handleRemoveKeyword = (idx) => {
        setKeywords(prev => prev.filter((_, i) => i !== idx));
    };

    const runGenerate = (nextSeed) => {
        if (!name.trim()) {
            toast.error('상품·업체명을 입력해주세요.');
            return;
        }
        if (keywords.length === 0) {
            toast.error('강점 키워드를 1개 이상 입력해주세요.');
            return;
        }
        setSeed(nextSeed);
        setResult(generateCopy({ industry, name, keywords, tone, seed: nextSeed }));
    };

    const handleGenerate = () => runGenerate(0);
    const handleRegenerate = () => runGenerate(seed + 1);

    const handleDownloadPng = () => {
        const fullSvg = buildBannerSvg({ mainText, subText, theme: themeObj, size: sizeObj, layout });
        const svgBlob = new Blob([fullSvg], { type: 'image/svg+xml;charset=utf-8' });
        const blobUrl = URL.createObjectURL(svgBlob);
        const img = new window.Image();

        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = sizeObj.width;
            canvas.height = sizeObj.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, sizeObj.width, sizeObj.height);
            URL.revokeObjectURL(blobUrl);

            canvas.toBlob((blob) => {
                if (!blob) {
                    toast.error('이미지 생성에 실패했습니다.');
                    return;
                }
                const downloadUrl = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = downloadUrl;
                link.download = `honjalma-banner-${Date.now()}.png`;
                document.body.appendChild(link);
                link.click();
                link.remove();
                URL.revokeObjectURL(downloadUrl);
                toast.success('배너 이미지가 다운로드되었습니다.');
            }, 'image/png');
        };
        img.onerror = () => {
            URL.revokeObjectURL(blobUrl);
            toast.error('이미지 생성에 실패했습니다.');
        };
        img.src = blobUrl;
    };

    return (
        <DashboardLayout>
            <div className={styles.container}>
                <div className={styles.header}>
                    <div>
                        <h1 className={styles.title}>AI 콘텐츠 스튜디오</h1>
                        <p className={styles.subtitle}>마케팅 문구와 홍보 배너를 즉시 만들어보세요</p>
                    </div>
                    <span className={styles.freeBadge}>
                        <Sparkles size={14} />
                        외부 AI 연동 없이 즉시 생성됩니다 — 무제한 무료
                    </span>
                </div>

                <div className={styles.tabs}>
                    {TABS.map((tab) => (
                        <button
                            key={tab.id}
                            className={`${styles.tab} ${activeTab === tab.id ? styles.tabActive : ''}`}
                            onClick={() => setActiveTab(tab.id)}
                        >
                            {tab.id === 'copy' ? <PenLine size={16} /> : <ImageIcon size={16} />}
                            {tab.label}
                        </button>
                    ))}
                </div>

                {activeTab === 'copy' ? (
                    <div>
                        <div className={styles.formCard}>
                            <div className={styles.formGrid}>
                                <div className={styles.formField}>
                                    <label htmlFor="industry">업종</label>
                                    <select id="industry" value={industry} onChange={(e) => setIndustry(e.target.value)}>
                                        {INDUSTRY_OPTIONS.map((opt) => (
                                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className={styles.formField}>
                                    <label htmlFor="name">상품·업체명</label>
                                    <input
                                        id="name"
                                        type="text"
                                        placeholder="예: 혼잘마 카페"
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                    />
                                </div>
                                <div className={styles.formField}>
                                    <label htmlFor="tone">톤</label>
                                    <select id="tone" value={tone} onChange={(e) => setTone(e.target.value)}>
                                        {TONE_OPTIONS.map((opt) => (
                                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div className={styles.formField}>
                                <label htmlFor="keyword">강점 키워드 (최대 3개)</label>
                                <div className={styles.keywordInputRow}>
                                    <input
                                        id="keyword"
                                        type="text"
                                        placeholder="키워드 입력 후 Enter (예: 수제버거, 24시간 영업)"
                                        value={keywordDraft}
                                        onChange={(e) => setKeywordDraft(e.target.value)}
                                        onKeyDown={handleKeywordKeyDown}
                                        disabled={keywords.length >= 3}
                                    />
                                    <button
                                        type="button"
                                        onClick={handleAddKeyword}
                                        disabled={keywords.length >= 3 || !keywordDraft.trim()}
                                    >
                                        추가
                                    </button>
                                </div>
                                {keywords.length > 0 && (
                                    <div className={styles.keywordChips}>
                                        {keywords.map((kw, idx) => (
                                            <span key={kw} className={styles.keywordChip}>
                                                {kw}
                                                <button type="button" onClick={() => handleRemoveKeyword(idx)}>
                                                    <X size={12} />
                                                </button>
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className={styles.generateRow}>
                                <button type="button" className={styles.generateBtn} onClick={handleGenerate}>
                                    <Wand2 size={16} />
                                    문구 생성
                                </button>
                                {result && (
                                    <button type="button" className={styles.regenerateBtn} onClick={handleRegenerate}>
                                        <RefreshCw size={14} />
                                        다시 생성
                                    </button>
                                )}
                            </div>
                        </div>

                        {!result ? (
                            <div className={styles.emptyState}>
                                <MessageSquareText size={48} className={styles.emptyIcon} />
                                <h4>아직 생성된 문구가 없습니다.</h4>
                                <p>업종, 상품·업체명, 키워드를 입력하고 문구 생성 버튼을 눌러보세요.</p>
                            </div>
                        ) : (
                            <div className={styles.resultsWrap}>
                                <div className={styles.resultBlock}>
                                    <h3>SNS 홍보문구</h3>
                                    <div className={styles.itemList}>
                                        {result.snsPhrases.map((phrase, idx) => (
                                            <div key={idx} className={styles.itemRow}>
                                                <p>{phrase}</p>
                                                <button type="button" onClick={() => copyToClipboard(phrase)}>
                                                    <Copy size={13} />복사
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className={styles.resultBlock}>
                                    <h3>인스타 캡션</h3>
                                    <div className={styles.captionBox}>
                                        <p>{result.instagram.caption}</p>
                                        <button type="button" onClick={() => copyToClipboard(result.instagram.caption)}>
                                            <Copy size={13} />캡션 복사
                                        </button>
                                    </div>
                                    <div className={styles.hashtagBox}>
                                        <div className={styles.hashtagList}>
                                            {result.instagram.hashtags.map((tag) => (
                                                <span key={tag}>{tag}</span>
                                            ))}
                                        </div>
                                        <button type="button" onClick={() => copyToClipboard(result.instagram.hashtags.join(' '))}>
                                            <Copy size={13} />해시태그 복사
                                        </button>
                                    </div>
                                </div>

                                <div className={styles.resultBlock}>
                                    <h3>블로그 제목</h3>
                                    <div className={styles.itemList}>
                                        {result.blogTitles.map((titleText, idx) => (
                                            <div key={idx} className={styles.itemRow}>
                                                <p>{titleText}</p>
                                                <button type="button" onClick={() => copyToClipboard(titleText)}>
                                                    <Copy size={13} />복사
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className={styles.bannerLayout}>
                        <div className={styles.bannerForm}>
                            <div className={styles.formField}>
                                <label htmlFor="mainText">메인 문구</label>
                                <input
                                    id="mainText"
                                    type="text"
                                    placeholder="예: 여름맞이 특별 프로모션"
                                    value={mainText}
                                    onChange={(e) => setMainText(e.target.value)}
                                />
                            </div>
                            <div className={styles.formField}>
                                <label htmlFor="subText">서브 문구</label>
                                <input
                                    id="subText"
                                    type="text"
                                    placeholder="예: 지금 확인하고 혜택 받기"
                                    value={subText}
                                    onChange={(e) => setSubText(e.target.value)}
                                />
                            </div>

                            <label className={styles.groupLabel}>색상 테마</label>
                            <div className={styles.themeRow}>
                                {COLOR_THEMES.map((t) => (
                                    <button
                                        key={t.id}
                                        type="button"
                                        title={t.label}
                                        className={`${styles.themeSwatch} ${theme === t.id ? styles.themeSelected : ''}`}
                                        style={{ background: `linear-gradient(135deg, ${t.colors[0]}, ${t.colors[1]})` }}
                                        onClick={() => setTheme(t.id)}
                                    >
                                        {theme === t.id && <Check size={14} />}
                                    </button>
                                ))}
                            </div>

                            <label className={styles.groupLabel}>사이즈</label>
                            <div className={styles.optionRow}>
                                {SIZES.map((s) => (
                                    <button
                                        key={s.id}
                                        type="button"
                                        className={`${styles.optionBtn} ${size === s.id ? styles.optionSelected : ''}`}
                                        onClick={() => setSize(s.id)}
                                    >
                                        {s.label}
                                    </button>
                                ))}
                            </div>

                            <label className={styles.groupLabel}>템플릿 레이아웃</label>
                            <div className={styles.optionRow}>
                                {LAYOUTS.map((l) => (
                                    <button
                                        key={l.id}
                                        type="button"
                                        className={`${styles.optionBtn} ${layout === l.id ? styles.optionSelected : ''}`}
                                        onClick={() => setLayout(l.id)}
                                    >
                                        {l.label}
                                    </button>
                                ))}
                            </div>

                            <button type="button" className={styles.downloadBtn} onClick={handleDownloadPng}>
                                <Download size={16} />
                                PNG 다운로드
                            </button>
                        </div>

                        <div className={styles.bannerPreviewWrap}>
                            <div
                                className={styles.bannerPreview}
                                style={{ aspectRatio: `${sizeObj.width} / ${sizeObj.height}` }}
                                dangerouslySetInnerHTML={{ __html: svgMarkup }}
                            />
                            <p className={styles.previewHint}>{sizeObj.label}</p>
                        </div>
                    </div>
                )}
            </div>
        </DashboardLayout>
    );
}
