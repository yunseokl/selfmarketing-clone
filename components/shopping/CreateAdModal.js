'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X, Check, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import styles from './CreateAdModal.module.css';

const serviceTypes = [
    { id: 'selma30', name: '베이직 쇼핑 유입 30원', price: 30 },
    { id: 'selma50', name: '스탠다드 쇼핑 유입 50원', price: 50 },
    { id: 'premium', name: '프리미엄 쇼핑 유입 100원', price: 100 },
];

const durationOptions = [10, 20, 30];

export default function CreateAdModal({ isOpen, onClose, onSuccess }) {
    const router = useRouter();
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);
    const [checking, setChecking] = useState(false);
    const [error, setError] = useState('');
    const [balance, setBalance] = useState(null);
    const [balanceLoading, setBalanceLoading] = useState(false);
    const [formData, setFormData] = useState({
        productUrl: '',
        productName: '',
        productImage: '',
        serviceType: 'selma30',
        keyword: '',
        dailyGoal: 100,
        duration: 10,
    });

    // 모달이 열릴 때 현재 캐시 잔액을 불러와 결제 미리보기에 사용합니다.
    useEffect(() => {
        if (!isOpen) return;
        let active = true;
        setBalanceLoading(true);
        fetch('/api/user')
            .then(res => (res.ok ? res.json() : null))
            .then(data => {
                if (active && data?.user) setBalance(data.user.balance ?? 0);
            })
            .catch(() => {})
            .finally(() => {
                if (active) setBalanceLoading(false);
            });
        return () => {
            active = false;
        };
    }, [isOpen]);

    const handleUrlCheck = async () => {
        const url = formData.productUrl.trim();
        if (!url) return;

        if (!/naver\.com/i.test(url)) {
            setError('올바른 네이버 쇼핑 URL을 입력해주세요.');
            return;
        }

        setChecking(true);
        setError('');
        let resolvedName = formData.productName.trim();
        try {
            // 서버에서 og:title/og:image를 조회해 상품명·이미지를 프리필합니다.
            const res = await fetch('/api/url-preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url }),
            });
            const data = res.ok ? await res.json() : null;
            resolvedName = resolvedName || (data?.title || '').trim();
            setFormData(prev => ({
                ...prev,
                productName: prev.productName || data?.title || '',
                productImage: data?.image || prev.productImage || '',
            }));
        } catch {
            // 조회 실패는 정상 흐름 — 사용자가 상품명을 직접 입력합니다.
        } finally {
            setChecking(false);
        }
        // 상품명이 확보된 경우에만 자동 진행 — 없으면 1단계에 머물며 직접 입력을 안내
        if (resolvedName) {
            setStep(2);
        } else {
            setError('상품 정보를 가져오지 못했습니다. 상품명을 직접 입력한 뒤 다음을 눌러주세요.');
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
                const message = data.error || '광고 생성 중 오류가 발생했습니다.';
                setError(message);
                toast.error(message);
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
                toast.success('광고가 생성되었습니다.');
                window.dispatchEvent(new Event('balance-refresh'));
                if (onSuccess) onSuccess();
            }
        } catch (err) {
            setError('광고 생성 중 오류가 발생했습니다.');
            toast.error('광고 생성 중 오류가 발생했습니다.');
        } finally {
            setLoading(false);
        }
    };

    const goToCharge = () => {
        onClose();
        router.push('/dashboard/charge');
    };

    const selectedService = serviceTypes.find(s => s.id === formData.serviceType);
    const totalCost = selectedService ? selectedService.price * formData.dailyGoal * formData.duration : 0;
    const afterBalance = balance != null ? balance - totalCost : null;
    const insufficient = balance != null && afterBalance < 0;
    const shortfall = insufficient ? totalCost - balance : 0;

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
                                    disabled={!formData.productUrl || checking}
                                >
                                    {checking ? '조회 중...' : '조회'}
                                </button>
                            </div>

                            <label className={styles.label}>상품명</label>
                            <input
                                type="text"
                                className={styles.input}
                                placeholder="조회 후 자동 입력되며, 직접 수정할 수 있습니다"
                                value={formData.productName}
                                onChange={e => setFormData(prev => ({ ...prev, productName: e.target.value }))}
                            />
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
                                    <span>총 광고비</span>
                                    <span className={styles.totalAmount}>{totalCost.toLocaleString()}원</span>
                                </div>
                            </div>

                            <div className={styles.balanceCard}>
                                <div className={styles.balanceHead}>
                                    <Wallet size={16} />
                                    <span>캐시 결제</span>
                                </div>
                                <div className={styles.balanceRow}>
                                    <span>현재 잔액</span>
                                    <span>{balanceLoading || balance == null ? '조회 중...' : `${balance.toLocaleString()}원`}</span>
                                </div>
                                <div className={styles.balanceRow}>
                                    <span>결제 후 잔액</span>
                                    <span className={insufficient ? styles.negative : styles.positive}>
                                        {afterBalance == null ? '-' : `${afterBalance.toLocaleString()}원`}
                                    </span>
                                </div>
                                {insufficient && (
                                    <div className={styles.insufficientNote}>
                                        캐시가 <strong>{shortfall.toLocaleString()}원</strong> 부족합니다. 충전 후 다시 시도해주세요.
                                    </div>
                                )}
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
                    ) : insufficient ? (
                        <button className={styles.chargeBtn} onClick={goToCharge}>
                            <Wallet size={16} />
                            캐시 충전하러 가기
                        </button>
                    ) : (
                        <button
                            className={styles.submitBtn}
                            onClick={handleSubmit}
                            disabled={loading || balanceLoading}
                        >
                            {loading ? '생성 중...' : `${totalCost.toLocaleString()}원 결제하고 광고 생성`}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
