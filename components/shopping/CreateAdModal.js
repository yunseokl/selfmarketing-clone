'use client';

import { useState } from 'react';
import { X, Check } from 'lucide-react';
import styles from './CreateAdModal.module.css';

const serviceTypes = [
    { id: 'selma30', name: '셀마 쇼핑 유입 30원', price: 30 },
    { id: 'selma50', name: '셀마 쇼핑 유입 50원', price: 50 },
    { id: 'premium', name: '프리미엄 쇼핑 유입 100원', price: 100 },
];

const durationOptions = [10, 20, 30];

export default function CreateAdModal({ isOpen, onClose, onSuccess }) {
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [formData, setFormData] = useState({
        productUrl: '',
        productName: '',
        productImage: '',
        serviceType: 'selma30',
        keyword: '',
        dailyGoal: 100,
        duration: 10,
    });

    const handleUrlCheck = async () => {
        if (!formData.productUrl) return;

        // Simulate URL check - in production, you would call an API to fetch product info
        if (formData.productUrl.includes('smartstore.naver.com') ||
            formData.productUrl.includes('shopping.naver.com') ||
            formData.productUrl.includes('naver.com')) {
            setFormData(prev => ({
                ...prev,
                productName: '네이버 쇼핑 상품',
            }));
            setStep(2);
            setError('');
        } else {
            setError('올바른 네이버 쇼핑 URL을 입력해주세요.');
        }
    };

    const handleNext = () => {
        if (step === 2 && !formData.keyword) {
            setError('키워드를 입력해주세요.');
            return;
        }
        setError('');
        if (step < 4) setStep(step + 1);
    };

    const handlePrev = () => {
        setError('');
        if (step > 1) setStep(step - 1);
    };

    const handleSubmit = async () => {
        setLoading(true);
        setError('');

        try {
            const service = serviceTypes.find(s => s.id === formData.serviceType);

            const res = await fetch('/api/shopping-ads', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    productUrl: formData.productUrl,
                    productName: formData.productName,
                    productImage: formData.productImage,
                    keyword: formData.keyword,
                    serviceType: formData.serviceType,
                    pricePerClick: service?.price || 30,
                    dailyGoal: formData.dailyGoal,
                    duration: formData.duration,
                }),
            });

            const data = await res.json();

            if (!res.ok) {
                setError(data.error);
            } else {
                // Reset form and close
                setStep(1);
                setFormData({
                    productUrl: '',
                    productName: '',
                    productImage: '',
                    serviceType: 'selma30',
                    keyword: '',
                    dailyGoal: 100,
                    duration: 10,
                });
                if (onSuccess) onSuccess();
            }
        } catch (err) {
            setError('광고 생성 중 오류가 발생했습니다.');
        } finally {
            setLoading(false);
        }
    };

    const calculateTotal = () => {
        const service = serviceTypes.find(s => s.id === formData.serviceType);
        return service ? (service.price * formData.dailyGoal * formData.duration).toLocaleString() : 0;
    };

    const getEndDate = () => {
        const date = new Date();
        date.setDate(date.getDate() + formData.duration);
        return date.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
    };

    if (!isOpen) return null;

    return (
        <div className={styles.overlay} onClick={onClose}>
            <div className={styles.modal} onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className={styles.header}>
                    <h2>쇼핑 광고 생성하기</h2>
                    <span className={styles.headerSub}>네이버 쇼핑 광고를 생성합니다</span>
                    <button className={styles.closeBtn} onClick={onClose}>
                        <X size={20} />
                    </button>
                </div>

                {/* Progress Steps */}
                <div className={styles.steps}>
                    {[1, 2, 3, 4].map(s => (
                        <div key={s} className={`${styles.step} ${s <= step ? styles.active : ''} ${s < step ? styles.completed : ''}`}>
                            <div className={styles.stepNumber}>
                                {s < step ? <Check size={14} /> : s}
                            </div>
                            <span className={styles.stepLabel}>
                                {s === 1 && '상품 조회'}
                                {s === 2 && '서비스 설정'}
                                {s === 3 && '일정 설정'}
                                {s === 4 && '최종 확인'}
                            </span>
                        </div>
                    ))}
                </div>

                {/* Step Content */}
                <div className={styles.body}>
                    {/* Step 1: Product URL */}
                    {step === 1 && (
                        <div className={styles.stepContent}>
                            <label className={styles.label}>상품 URL</label>
                            <p className={styles.labelDesc}>네이버 쇼핑 상품 URL을 입력해주세요</p>
                            <div className={styles.urlInput}>
                                <input
                                    type="text"
                                    placeholder="https://smartstore.naver.com/..."
                                    value={formData.productUrl}
                                    onChange={e => setFormData(prev => ({ ...prev, productUrl: e.target.value }))}
                                />
                                <button
                                    className={styles.checkBtn}
                                    onClick={handleUrlCheck}
                                    disabled={!formData.productUrl}
                                >
                                    조회
                                </button>
                            </div>
                            {error && <p className={styles.error}>{error}</p>}
                        </div>
                    )}

                    {/* Step 2: Service Settings */}
                    {step === 2 && (
                        <div className={styles.stepContent}>
                            {/* Service Type */}
                            <label className={styles.label}>서비스 유형</label>
                            <div className={styles.serviceOptions}>
                                {serviceTypes.map(service => (
                                    <button
                                        key={service.id}
                                        className={`${styles.serviceOption} ${formData.serviceType === service.id ? styles.selected : ''}`}
                                        onClick={() => setFormData(prev => ({ ...prev, serviceType: service.id }))}
                                    >
                                        <span className={styles.serviceName}>{service.name}</span>
                                        <span className={styles.servicePrice}>{service.price}원/건</span>
                                    </button>
                                ))}
                            </div>

                            {/* Keyword */}
                            <label className={styles.label}>메인 키워드</label>
                            <input
                                type="text"
                                className={styles.input}
                                placeholder="예: 노트북"
                                value={formData.keyword}
                                onChange={e => setFormData(prev => ({ ...prev, keyword: e.target.value }))}
                            />

                            {/* Daily Goal */}
                            <label className={styles.label}>일일 목표수(목표/일)</label>
                            <div className={styles.numberInput}>
                                <button
                                    onClick={() => setFormData(prev => ({ ...prev, dailyGoal: Math.max(10, prev.dailyGoal - 10) }))}
                                >
                                    -
                                </button>
                                <input
                                    type="number"
                                    value={formData.dailyGoal}
                                    onChange={e => setFormData(prev => ({ ...prev, dailyGoal: parseInt(e.target.value) || 10 }))}
                                />
                                <button
                                    onClick={() => setFormData(prev => ({ ...prev, dailyGoal: prev.dailyGoal + 10 }))}
                                >
                                    +
                                </button>
                            </div>
                            <p className={styles.helperText}>
                                최소 10회/일부터 설정 가능 (주문별 이용가능)
                            </p>
                            {error && <p className={styles.error}>{error}</p>}
                        </div>
                    )}

                    {/* Step 3: Duration */}
                    {step === 3 && (
                        <div className={styles.stepContent}>
                            <label className={styles.label}>광고 기간</label>
                            <div className={styles.durationOptions}>
                                {durationOptions.map(days => (
                                    <button
                                        key={days}
                                        className={`${styles.durationOption} ${formData.duration === days ? styles.selected : ''}`}
                                        onClick={() => setFormData(prev => ({ ...prev, duration: days }))}
                                    >
                                        {days}일
                                    </button>
                                ))}
                            </div>
                            <p className={styles.dateInfo}>
                                📅 {new Date().toLocaleDateString('ko-KR')} ~ {getEndDate()} ({formData.duration}일간)
                            </p>
                            <p className={styles.helperText}>
                                광고 노출량 증대 시 미리출발봇 이용권을 이용하세요.
                            </p>
                        </div>
                    )}

                    {/* Step 4: Confirmation */}
                    {step === 4 && (
                        <div className={styles.stepContent}>
                            <label className={styles.label}>최종 확인</label>

                            <div className={styles.summary}>
                                <div className={styles.summaryRow}>
                                    <span>서비스</span>
                                    <span>{serviceTypes.find(s => s.id === formData.serviceType)?.name}</span>
                                </div>
                                <div className={styles.summaryRow}>
                                    <span>키워드</span>
                                    <span>{formData.keyword || '-'}</span>
                                </div>
                                <div className={styles.summaryRow}>
                                    <span>일일 목표</span>
                                    <span>{formData.dailyGoal}건</span>
                                </div>
                                <div className={styles.summaryRow}>
                                    <span>기간</span>
                                    <span>{formData.duration}일</span>
                                </div>
                                <div className={`${styles.summaryRow} ${styles.total}`}>
                                    <span>총 예상 금액</span>
                                    <span className={styles.totalAmount}>{calculateTotal()}원</span>
                                </div>
                            </div>

                            <div className={styles.infoBox}>
                                <h4>상품 정보</h4>
                                <div className={styles.productPreview}>
                                    <div className={styles.productImage}></div>
                                    <div className={styles.productInfo}>
                                        <p className={styles.productName}>{formData.productName || '상품명'}</p>
                                        <p className={styles.productUrl}>{formData.productUrl}</p>
                                    </div>
                                </div>
                            </div>

                            {error && <p className={styles.error}>{error}</p>}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className={styles.footer}>
                    {step > 1 && (
                        <button className={styles.prevBtn} onClick={handlePrev}>
                            이전
                        </button>
                    )}
                    {step < 4 ? (
                        <button
                            className={styles.nextBtn}
                            onClick={handleNext}
                            disabled={step === 1 && !formData.productName}
                        >
                            다음
                        </button>
                    ) : (
                        <button
                            className={styles.submitBtn}
                            onClick={handleSubmit}
                            disabled={loading}
                        >
                            {loading ? '생성 중...' : '광고 생성하기'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
