'use client';

import { useState } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import styles from './page.module.css';
import { Image, Sparkles, Download } from 'lucide-react';

export default function AiPage() {
    const [prompt, setPrompt] = useState('');
    const [generatedImages, setGeneratedImages] = useState([]);
    const [isGenerating, setIsGenerating] = useState(false);

    const handleGenerate = () => {
        if (!prompt.trim()) return;
        setIsGenerating(true);
        // Simulate generation
        setTimeout(() => {
            setIsGenerating(false);
        }, 2000);
    };

    return (
        <DashboardLayout>
            <div className={styles.container}>
                <div className={styles.header}>
                    <h1 className={styles.title}>AI 이미지 생성</h1>
                    <p className={styles.subtitle}>AI를 활용하여 마케팅에 필요한 이미지를 생성하세요</p>
                </div>

                {/* Input Section */}
                <div className={styles.inputSection}>
                    <div className={styles.inputWrapper}>
                        <Sparkles size={20} className={styles.inputIcon} />
                        <input
                            type="text"
                            placeholder="원하는 이미지를 설명해주세요... (예: 카페 인테리어 사진)"
                            value={prompt}
                            onChange={e => setPrompt(e.target.value)}
                            className={styles.promptInput}
                        />
                        <button
                            className={styles.generateBtn}
                            onClick={handleGenerate}
                            disabled={isGenerating || !prompt.trim()}
                        >
                            {isGenerating ? '생성 중...' : '생성하기'}
                        </button>
                    </div>
                    <p className={styles.helperText}>
                        구체적으로 설명할수록 더 좋은 결과를 얻을 수 있습니다.
                    </p>
                </div>

                {/* Generated Images */}
                {generatedImages.length === 0 ? (
                    <div className={styles.emptyState}>
                        <Image size={64} className={styles.emptyIcon} />
                        <h4>생성된 이미지가 없습니다.</h4>
                        <p>프롬프트를 입력하고 이미지를 생성해보세요.</p>
                    </div>
                ) : (
                    <div className={styles.imagesGrid}>
                        {generatedImages.map((img, idx) => (
                            <div key={idx} className={styles.imageCard}>
                                <img src={img.url} alt={img.prompt} />
                                <div className={styles.imageOverlay}>
                                    <button className={styles.downloadBtn}>
                                        <Download size={18} />
                                        다운로드
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </DashboardLayout>
    );
}
