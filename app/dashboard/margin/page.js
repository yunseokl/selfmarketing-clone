'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
    Calculator, ChevronDown, Info, Megaphone, Package, RotateCcw, Save, ShoppingBag, Sparkles, Tag, Trash2, Truck,
} from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import {
    calcSmartstore,
    calcCoupang,
    solvePriceForMargin,
    rocketLogisticsDefault,
    SMARTSTORE_GRADES,
    SMARTSTORE_SALES_FEES,
    COUPANG_CATEGORIES,
    ROCKET_SIZES,
    FEE_BASIS,
} from '@/lib/margin';
import styles from './page.module.css';

const TABS = [
    { id: 'smartstore', label: '스마트스토어', icon: ShoppingBag, channel: 'smartstore' },
    { id: 'coupang-mp', label: '쿠팡 판매자배송', icon: Truck, channel: 'coupang' },
    { id: 'coupang-rocket', label: '쿠팡 로켓그로스', icon: Package, channel: 'coupang' },
];

const COMMON_DEFAULTS = {
    salePrice: '', sellerCoupon: '', cost: '', otherCost: '',
    returnRate: '', returnCost: '', vatMode: 'none', roas: '', targetMarginRate: '',
};

const DEFAULTS = {
    smartstore: {
        ...COMMON_DEFAULTS,
        shippingCharged: '3000', shippingCost: '3000',
        grade: 'general', storeType: 'smartstore', inflow: 'basic', npayRate: '', salesRate: '',
    },
    'coupang-mp': {
        ...COMMON_DEFAULTS, mode: 'marketplace',
        shippingCharged: '0', shippingCost: '3000', categoryId: 'fashion', feeRate: '', monthlyOrders: '',
    },
    'coupang-rocket': {
        ...COMMON_DEFAULTS, mode: 'rocket',
        categoryId: 'fashion', feeRate: '', monthlyOrders: '',
        sizeId: 'xs', shippingTable: 'A', logisticsFee: '', storageFee: '',
    },
};

const EXAMPLES = {
    smartstore: { salePrice: '29800', cost: '11000', otherCost: '500', returnRate: '3', returnCost: '6000', targetMarginRate: '20' },
    'coupang-mp': { salePrice: '19900', cost: '7500', otherCost: '300', monthlyOrders: '120', returnRate: '5', returnCost: '6000', targetMarginRate: '15' },
    'coupang-rocket': { salePrice: '14900', cost: '4800', otherCost: '200', sizeId: 's', monthlyOrders: '200', returnRate: '5', returnCost: '3000', targetMarginRate: '15' },
};

const CATEGORY_GROUPS = COUPANG_CATEGORIES.reduce((groups, category) => {
    const group = groups.find((g) => g.name === category.group);
    if (group) group.items.push(category);
    else groups.push({ name: category.group, items: [category] });
    return groups;
}, []);

const won = (value) => `${Math.round(value).toLocaleString('ko-KR')}원`;
const percent = (value) => `${value.toFixed(1)}%`;

function tabOfScenario(scenario) {
    if (scenario.channel === 'smartstore') return 'smartstore';
    return scenario.input?.mode === 'rocket' ? 'coupang-rocket' : 'coupang-mp';
}

function NumberField({ id, label, value, onChange, suffix = '원', placeholder = '0', hint, step }) {
    return (
        <div className={styles.field}>
            <label htmlFor={id}>{label}</label>
            <div className={styles.inputWrap}>
                <input
                    id={id}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step={step}
                    value={value}
                    placeholder={placeholder}
                    onChange={(e) => onChange(e.target.value)}
                />
                <span className={styles.suffix}>{suffix}</span>
            </div>
            {hint && <p className={styles.hint}>{hint}</p>}
        </div>
    );
}

function SelectField({ id, label, value, onChange, children, hint }) {
    return (
        <div className={styles.field}>
            <label htmlFor={id}>{label}</label>
            <div className={styles.selectWrap}>
                <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
                    {children}
                </select>
                <ChevronDown size={16} aria-hidden="true" />
            </div>
            {hint && <p className={styles.hint}>{hint}</p>}
        </div>
    );
}

export default function MarginPage() {
    const { status } = useSession();
    const router = useRouter();

    const [tab, setTab] = useState('smartstore');
    const [forms, setForms] = useState(DEFAULTS);
    const [showRates, setShowRates] = useState(false);
    const [scenarios, setScenarios] = useState([]);
    const [scenarioName, setScenarioName] = useState('');
    const [editingId, setEditingId] = useState(null);
    const [saving, setSaving] = useState(false);

    const input = forms[tab];
    const calc = tab === 'smartstore' ? calcSmartstore : calcCoupang;

    const setField = useCallback((key, value) => {
        setForms((prev) => ({ ...prev, [tab]: { ...prev[tab], [key]: value } }));
    }, [tab]);

    const fetchScenarios = useCallback(async () => {
        try {
            const res = await fetch('/api/margin-scenarios');
            if (!res.ok) return;
            const data = await res.json();
            setScenarios(data.scenarios || []);
        } catch (error) {
            console.error('Error fetching margin scenarios:', error);
        }
    }, []);

    useEffect(() => {
        if (status === 'unauthenticated') {
            router.push('/login');
        } else if (status === 'authenticated') {
            fetchScenarios();
        }
    }, [status, router, fetchScenarios]);

    // 다른 화면에서 /dashboard/margin?tab=coupang-mp 처럼 채널을 지정해 들어올 수 있습니다.
    useEffect(() => {
        const requested = new URLSearchParams(window.location.search).get('tab');
        if (TABS.some((t) => t.id === requested)) setTab(requested);
    }, []);

    const result = useMemo(() => calc(input), [calc, input]);
    const hasPrice = result.productPay > 0;

    const breakEvenPrice = useMemo(
        () => (hasPrice || Number(input.cost) > 0 ? solvePriceForMargin(calc, input, 0) : null),
        [calc, input, hasPrice]
    );
    const targetPrice = useMemo(
        () => (input.targetMarginRate !== '' ? solvePriceForMargin(calc, input, input.targetMarginRate) : null),
        [calc, input]
    );

    const rocketDefault = tab === 'coupang-rocket' ? rocketLogisticsDefault(input.sizeId, input.shippingTable) : 0;
    const selectedCategory = COUPANG_CATEGORIES.find((c) => c.id === input.categoryId);

    const fillExample = () => {
        setForms((prev) => ({ ...prev, [tab]: { ...DEFAULTS[tab], ...EXAMPLES[tab] } }));
        setEditingId(null);
    };

    const resetForm = () => {
        setForms((prev) => ({ ...prev, [tab]: DEFAULTS[tab] }));
        setEditingId(null);
        setScenarioName('');
    };

    const changeTab = (next) => {
        setTab(next);
        setEditingId(null);
        setScenarioName('');
    };

    const saveScenario = async () => {
        const name = scenarioName.trim();
        if (!name) {
            toast.error('저장할 상품 이름을 입력해주세요.');
            return;
        }
        if (!hasPrice) {
            toast.error('판매가를 먼저 입력해주세요.');
            return;
        }
        setSaving(true);
        try {
            const res = await fetch('/api/margin-scenarios', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: editingId || undefined,
                    channel: TABS.find((t) => t.id === tab).channel,
                    name,
                    input,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                toast.error(data.error || '저장하지 못했습니다.');
                return;
            }
            toast.success(editingId ? '저장한 계산을 고쳤습니다.' : '계산을 저장했습니다.');
            setEditingId(data.scenario.id);
            fetchScenarios();
        } catch {
            toast.error('저장 중 오류가 발생했습니다.');
        } finally {
            setSaving(false);
        }
    };

    const loadScenario = (scenario) => {
        const nextTab = tabOfScenario(scenario);
        setTab(nextTab);
        setForms((prev) => ({ ...prev, [nextTab]: { ...DEFAULTS[nextTab], ...scenario.input } }));
        setScenarioName(scenario.name);
        setEditingId(scenario.id);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const deleteScenario = async (scenario) => {
        if (!window.confirm(`'${scenario.name}' 계산을 삭제할까요?`)) return;
        try {
            const res = await fetch(`/api/margin-scenarios?id=${encodeURIComponent(scenario.id)}`, { method: 'DELETE' });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                toast.error(data.error || '삭제하지 못했습니다.');
                return;
            }
            toast.success('삭제했습니다.');
            if (editingId === scenario.id) {
                setEditingId(null);
                setScenarioName('');
            }
            fetchScenarios();
        } catch {
            toast.error('삭제 중 오류가 발생했습니다.');
        }
    };

    const scenarioRows = useMemo(() => scenarios.map((scenario) => {
        const scenarioTab = tabOfScenario(scenario);
        const fn = scenarioTab === 'smartstore' ? calcSmartstore : calcCoupang;
        const r = fn({ ...DEFAULTS[scenarioTab], ...scenario.input });
        return { scenario, tabLabel: TABS.find((t) => t.id === scenarioTab).label, result: r };
    }), [scenarios]);

    const profitClass = result.profit < 0 ? styles.negative : styles.positive;

    return (
        <DashboardLayout>
            <div className={styles.container}>
                <header className={styles.header}>
                    <div>
                        <h1>마진·ROAS 계산기</h1>
                        <p>수수료, 배송비, 부가세, 광고비까지 넣고 한 건 팔 때 실제로 남는 돈을 확인하세요.</p>
                    </div>
                    <span className={styles.freeBadge}>무료 · 횟수 제한 없음</span>
                </header>

                <div className={styles.tabs} role="tablist" aria-label="판매 채널">
                    {TABS.map(({ id, label, icon: Icon }) => (
                        <button
                            key={id}
                            type="button"
                            role="tab"
                            aria-selected={tab === id}
                            className={`${styles.tab} ${tab === id ? styles.tabActive : ''}`}
                            onClick={() => changeTab(id)}
                        >
                            <Icon size={16} />
                            {label}
                        </button>
                    ))}
                </div>

                <div className={styles.layout}>
                    {/* ===== 입력 ===== */}
                    <section className={styles.formCard} aria-label="계산 입력">
                        <div className={styles.cardHead}>
                            <h2><Tag size={16} /> 상품 정보</h2>
                            <div className={styles.headActions}>
                                <button type="button" className={styles.ghostBtn} onClick={fillExample}>
                                    <Sparkles size={14} /> 예시 넣기
                                </button>
                                <button type="button" className={styles.ghostBtn} onClick={resetForm}>
                                    <RotateCcw size={14} /> 초기화
                                </button>
                            </div>
                        </div>

                        <div className={styles.grid2}>
                            <NumberField id="salePrice" label="판매가" value={input.salePrice} onChange={(v) => setField('salePrice', v)} placeholder="예: 29800" />
                            <NumberField id="cost" label="상품 원가 (부가세 포함)" value={input.cost} onChange={(v) => setField('cost', v)} placeholder="예: 11000" />
                            <NumberField id="sellerCoupon" label="판매자 부담 할인·쿠폰" value={input.sellerCoupon} onChange={(v) => setField('sellerCoupon', v)} hint="즉시할인, 다운로드 쿠폰 등 내가 부담하는 금액" />
                            <NumberField id="otherCost" label="포장·기타 비용" value={input.otherCost} onChange={(v) => setField('otherCost', v)} hint="박스, 완충재, 사은품 등 1건당" />
                        </div>

                        {tab === 'smartstore' && (
                            <>
                                <h3 className={styles.groupTitle}>스토어·수수료</h3>
                                <div className={styles.grid2}>
                                    <SelectField id="grade" label="매출 등급" value={input.grade} onChange={(v) => setField('grade', v)} hint="스마트스토어센터 > 판매자 정보에서 확인">
                                        {SMARTSTORE_GRADES.map((g) => (
                                            <option key={g.id} value={g.id}>{g.label} · {g.npayRate}%</option>
                                        ))}
                                    </SelectField>
                                    <SelectField id="storeType" label="스토어 유형" value={input.storeType} onChange={(v) => setField('storeType', v)}>
                                        {Object.entries(SMARTSTORE_SALES_FEES).map(([id, s]) => (
                                            <option key={id} value={id}>{s.label}</option>
                                        ))}
                                    </SelectField>
                                </div>
                                <div className={styles.field}>
                                    <span className={styles.fieldLabel}>주문이 들어온 경로</span>
                                    <div className={styles.segment}>
                                        <button type="button" className={input.inflow === 'basic' ? styles.segmentActive : ''} onClick={() => setField('inflow', 'basic')}>
                                            네이버 쇼핑 검색·추천
                                        </button>
                                        <button type="button" className={input.inflow === 'marketing' ? styles.segmentActive : ''} onClick={() => setField('inflow', 'marketing')}>
                                            마케팅 링크·검색광고
                                        </button>
                                    </div>
                                    <p className={styles.hint}>내가 만든 마케팅 링크(인스타, 블로그 등)나 검색광고로 들어온 주문은 판매수수료가 낮아요.</p>
                                </div>
                                <div className={styles.grid2}>
                                    <NumberField id="shippingCharged" label="고객이 내는 배송비" value={input.shippingCharged} onChange={(v) => setField('shippingCharged', v)} hint="무료배송이면 0" />
                                    <NumberField id="shippingCost" label="실제 택배비" value={input.shippingCost} onChange={(v) => setField('shippingCost', v)} />
                                </div>
                            </>
                        )}

                        {tab !== 'smartstore' && (
                            <>
                                <h3 className={styles.groupTitle}>카테고리·수수료</h3>
                                <SelectField
                                    id="categoryId"
                                    label="상품 카테고리"
                                    value={input.categoryId}
                                    onChange={(v) => setField('categoryId', v)}
                                    hint="목록에 없는 소분류는 같은 대분류의 '기본'을 고르거나 아래에서 요율을 직접 입력하세요."
                                >
                                    {CATEGORY_GROUPS.map((group) => (
                                        <optgroup key={group.name} label={group.name}>
                                            {group.items.map((c) => (
                                                <option key={c.id} value={c.id}>{c.label} · {c.rate}%</option>
                                            ))}
                                        </optgroup>
                                    ))}
                                </SelectField>

                                {tab === 'coupang-mp' ? (
                                    <div className={styles.grid2}>
                                        <NumberField id="shippingCharged" label="고객이 내는 배송비" value={input.shippingCharged} onChange={(v) => setField('shippingCharged', v)} hint="무료배송이면 0" />
                                        <NumberField id="shippingCost" label="실제 택배비" value={input.shippingCost} onChange={(v) => setField('shippingCost', v)} />
                                    </div>
                                ) : (
                                    <>
                                        <div className={styles.grid2}>
                                            <SelectField id="sizeId" label="상품 크기" value={input.sizeId} onChange={(v) => setField('sizeId', v)}>
                                                {ROCKET_SIZES.map((s) => (
                                                    <option key={s.id} value={s.id}>{s.label}</option>
                                                ))}
                                            </SelectField>
                                            <SelectField id="shippingTable" label="배송비 기준" value={input.shippingTable} onChange={(v) => setField('shippingTable', v)}>
                                                <option value="A">기본 요금</option>
                                                <option value="B">프로모션 요금</option>
                                            </SelectField>
                                        </div>
                                        <div className={styles.grid2}>
                                            <NumberField
                                                id="logisticsFee"
                                                label="입출고·배송비 (개당, 부가세 별도)"
                                                value={input.logisticsFee}
                                                onChange={(v) => setField('logisticsFee', v)}
                                                placeholder={String(rocketDefault)}
                                                hint={`비워 두면 안내 시작가 ${rocketDefault.toLocaleString('ko-KR')}원으로 계산해요. Wing에서 본 실제 금액이 다르면 입력하세요.`}
                                            />
                                            <NumberField id="storageFee" label="보관비 (개당, 부가세 별도)" value={input.storageFee} onChange={(v) => setField('storageFee', v)} hint="무료 보관 기간 안에 팔리면 0" />
                                        </div>
                                    </>
                                )}

                                <NumberField
                                    id="monthlyOrders"
                                    label="이 스토어의 월 판매 건수"
                                    value={input.monthlyOrders}
                                    onChange={(v) => setField('monthlyOrders', v)}
                                    suffix="건"
                                    hint="월 매출이 기준(100만원, 가전·디지털은 500만원) 이상이면 판매자서비스이용료 55,000원을 건수로 나눠 반영해요."
                                />
                            </>
                        )}

                        <h3 className={styles.groupTitle}>반품·세금</h3>
                        <div className={styles.grid2}>
                            <NumberField id="returnRate" label="반품률" value={input.returnRate} onChange={(v) => setField('returnRate', v)} suffix="%" step="0.1" />
                            <NumberField id="returnCost" label="반품 1건당 손실" value={input.returnCost} onChange={(v) => setField('returnCost', v)} hint="왕복 배송비, 재판매 불가 손실 등" />
                        </div>
                        <div className={styles.field}>
                            <span className={styles.fieldLabel}>부가세</span>
                            <div className={styles.segment}>
                                <button type="button" className={input.vatMode !== 'general' ? styles.segmentActive : ''} onClick={() => setField('vatMode', 'none')}>
                                    반영 안 함
                                </button>
                                <button type="button" className={input.vatMode === 'general' ? styles.segmentActive : ''} onClick={() => setField('vatMode', 'general')}>
                                    일반과세자 (납부세액 반영)
                                </button>
                            </div>
                            <p className={styles.hint}>일반과세자는 (매출 − 매입·비용) ÷ 11 을 납부 부가세로 어림해 뺍니다. 간이과세자는 &lsquo;반영 안 함&rsquo;으로 두세요.</p>
                        </div>

                        <h3 className={styles.groupTitle}><Megaphone size={15} /> 광고</h3>
                        <div className={styles.grid2}>
                            <NumberField id="roas" label="현재 광고 ROAS (선택)" value={input.roas} onChange={(v) => setField('roas', v)} suffix="%" placeholder="예: 400" hint={tab === 'smartstore' ? '광고 관리 화면의 ROAS 그대로' : '쿠팡 광고센터의 광고수익률 그대로'} />
                            <NumberField id="targetMarginRate" label="남기고 싶은 마진율 (선택)" value={input.targetMarginRate} onChange={(v) => setField('targetMarginRate', v)} suffix="%" placeholder="예: 20" step="0.1" />
                        </div>

                        <button type="button" className={styles.ratesToggle} onClick={() => setShowRates((v) => !v)} aria-expanded={showRates}>
                            <ChevronDown size={15} className={showRates ? styles.rotated : ''} />
                            수수료율 직접 수정
                        </button>
                        {showRates && (
                            <div className={styles.ratesBox}>
                                {tab === 'smartstore' ? (
                                    <div className={styles.grid2}>
                                        <NumberField id="npayRate" label="Npay 주문관리 수수료율 (부가세 별도)" value={input.npayRate} onChange={(v) => setField('npayRate', v)} suffix="%" step="0.01" placeholder={String(SMARTSTORE_GRADES.find((g) => g.id === input.grade)?.npayRate ?? '')} />
                                        <NumberField id="salesRate" label="판매수수료율 (부가세 별도)" value={input.salesRate} onChange={(v) => setField('salesRate', v)} suffix="%" step="0.01" placeholder={String(SMARTSTORE_SALES_FEES[input.storeType]?.[input.inflow] ?? '')} />
                                    </div>
                                ) : (
                                    <NumberField id="feeRate" label="판매수수료율 (부가세 별도)" value={input.feeRate} onChange={(v) => setField('feeRate', v)} suffix="%" step="0.1" placeholder={String(selectedCategory?.rate ?? '')} />
                                )}
                                <p className={styles.hint}>비워 두면 위에서 고른 등급·카테고리의 기본 요율을 씁니다.</p>
                            </div>
                        )}
                    </section>

                    {/* ===== 결과 ===== */}
                    <aside className={styles.resultCol} aria-label="계산 결과" aria-live="polite">
                        {!hasPrice ? (
                            <div className={`${styles.resultCard} ${styles.emptyResult}`}>
                                <Calculator size={36} />
                                <strong>판매가와 원가를 입력해 보세요</strong>
                                <p>입력하는 즉시 1건당 순이익과 손익분기 ROAS가 계산됩니다.</p>
                                <button type="button" className={styles.primaryBtn} onClick={fillExample}>
                                    <Sparkles size={15} /> 예시로 먼저 보기
                                </button>
                            </div>
                        ) : (
                            <>
                                <div className={styles.resultCard}>
                                    <span className={styles.resultLabel}>1건 팔면 남는 돈 (광고비 제외)</span>
                                    <div className={`${styles.profit} ${profitClass}`}>{won(result.profit)}</div>
                                    <div className={styles.resultMeta}>
                                        <span>마진율 <strong className={profitClass}>{percent(result.marginRate)}</strong></span>
                                        <span>정산 예상액 <strong>{won(result.settlement)}</strong></span>
                                    </div>
                                    {result.profit < 0 && (
                                        <p className={styles.warn}>이 가격에서는 팔수록 손해예요. 아래 손익분기 판매가를 확인하세요.</p>
                                    )}

                                    <ul className={styles.breakdown}>
                                        <li className={styles.plus}>
                                            <span>고객 결제액{result.revenue !== result.productPay ? ' (상품 + 배송비)' : ''}</span>
                                            <b>{won(result.revenue)}</b>
                                        </li>
                                        {result.fees.map((fee) => (
                                            <li key={fee.key}><span>{fee.label}</span><b>−{won(fee.amount)}</b></li>
                                        ))}
                                        {result.costs.filter((c) => c.amount > 0).map((cost) => (
                                            <li key={cost.key}><span>{cost.label}</span><b>−{won(cost.amount)}</b></li>
                                        ))}
                                        {result.vat > 0 && (
                                            <li><span>납부 부가세 (어림값)</span><b>−{won(result.vat)}</b></li>
                                        )}
                                        <li className={styles.total}>
                                            <span>순이익</span>
                                            <b className={profitClass}>{won(result.profit)}</b>
                                        </li>
                                    </ul>
                                </div>

                                <div className={styles.resultCard}>
                                    <h3 className={styles.cardTitle}><Megaphone size={16} /> 광고는 어디까지 써도 될까</h3>
                                    {result.bepRoas == null ? (
                                        <p className={styles.muted}>광고를 하기 전부터 적자라 손익분기 ROAS를 계산할 수 없어요.</p>
                                    ) : (
                                        <>
                                            <div className={styles.statRow}>
                                                <div>
                                                    <span>손익분기 ROAS</span>
                                                    <strong>{Math.ceil(result.bepRoas).toLocaleString('ko-KR')}%</strong>
                                                </div>
                                                <div>
                                                    <span>1건당 쓸 수 있는 최대 광고비</span>
                                                    <strong>{won(result.maxAdPerOrder)}</strong>
                                                </div>
                                            </div>
                                            <p className={styles.muted}>
                                                광고 화면의 ROAS가 {Math.ceil(result.bepRoas).toLocaleString('ko-KR')}%보다 낮으면 팔수록 손해입니다.
                                                {tab !== 'smartstore' && ' (쿠팡 광고비의 부가세 10%까지 반영한 값)'}
                                            </p>
                                            {input.targetMarginRate !== '' && (
                                                <p className={styles.callout}>
                                                    마진 {input.targetMarginRate}%를 남기려면{' '}
                                                    {result.targetRoas == null
                                                        ? '광고 없이도 부족해요. 판매가나 원가를 조정해야 합니다.'
                                                        : <>ROAS <b>{Math.ceil(result.targetRoas).toLocaleString('ko-KR')}%</b> 이상이 필요해요.</>}
                                                </p>
                                            )}
                                        </>
                                    )}
                                    {result.ad && (
                                        <div className={`${styles.adResult} ${result.ad.profitAfterAd < 0 ? styles.adLoss : ''}`}>
                                            <span>지금 ROAS {result.ad.roas.toLocaleString('ko-KR')}%면 광고비 {won(result.ad.cashPerOrder)}를 쓰고</span>
                                            <strong className={result.ad.profitAfterAd < 0 ? styles.negative : styles.positive}>
                                                1건당 {won(result.ad.profitAfterAd)} {result.ad.profitAfterAd < 0 ? '손해' : '남아요'}
                                            </strong>
                                        </div>
                                    )}
                                </div>

                                <div className={styles.resultCard}>
                                    <h3 className={styles.cardTitle}><Tag size={16} /> 얼마에 팔아야 할까</h3>
                                    <div className={styles.statRow}>
                                        <div>
                                            <span>손익분기 판매가</span>
                                            <strong>{breakEvenPrice != null ? won(breakEvenPrice) : '-'}</strong>
                                        </div>
                                        <div>
                                            <span>{input.targetMarginRate !== '' ? `마진 ${input.targetMarginRate}% 판매가` : '목표 마진 판매가'}</span>
                                            <strong>
                                                {input.targetMarginRate === ''
                                                    ? '목표 입력 필요'
                                                    : targetPrice != null ? won(targetPrice) : '불가능'}
                                            </strong>
                                        </div>
                                    </div>
                                    <p className={styles.muted}>
                                        {tab === 'smartstore'
                                            ? '할인 행사나 쿠폰을 걸 때 손익분기 판매가 아래로 내려가지 않게 하세요.'
                                            : '아이템위너 경쟁이나 자동가격조정의 최저가를 손익분기 판매가보다 높게 잡으세요.'}
                                    </p>
                                    {tab === 'smartstore' && result.marketingLinkSaving > 0 && input.inflow === 'basic' && (
                                        <p className={styles.callout}>
                                            같은 주문이 마케팅 링크로 들어오면 판매수수료가 <b>{won(result.marketingLinkSaving)}</b> 줄어요.
                                        </p>
                                    )}
                                </div>
                            </>
                        )}

                        <div className={styles.basis}>
                            <Info size={14} />
                            <p>
                                계산 기준: {tab === 'smartstore' ? FEE_BASIS.smartstore : FEE_BASIS.coupang}.
                                요율은 바뀔 수 있으니 판매자센터에서 확인한 값과 다르면 &lsquo;수수료율 직접 수정&rsquo;으로 맞춰 주세요.
                                {tab === 'coupang-rocket' && ' 로켓그로스 요금은 안내 페이지의 시작가라 카테고리·판매가에 따라 더 높을 수 있습니다.'}
                            </p>
                        </div>
                    </aside>
                </div>

                {/* ===== 저장 ===== */}
                <section className={styles.savedCard} aria-label="저장한 계산">
                    <div className={styles.cardHead}>
                        <h2><Save size={16} /> 내 상품 계산 저장</h2>
                        <span className={styles.counter}>{scenarios.length}/50</span>
                    </div>
                    <div className={styles.saveRow}>
                        <label htmlFor="scenarioName" className={styles.srOnly}>상품 이름</label>
                        <input
                            id="scenarioName"
                            type="text"
                            maxLength={40}
                            value={scenarioName}
                            placeholder="상품 이름 (예: 캠핑의자 블랙)"
                            onChange={(e) => setScenarioName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && saveScenario()}
                        />
                        <button type="button" className={styles.primaryBtn} onClick={saveScenario} disabled={saving}>
                            <Save size={15} /> {saving ? '저장 중...' : editingId ? '수정 저장' : '저장'}
                        </button>
                        {editingId && (
                            <button type="button" className={styles.ghostBtn} onClick={() => { setEditingId(null); setScenarioName(''); }}>
                                새 항목으로
                            </button>
                        )}
                    </div>

                    {scenarioRows.length === 0 ? (
                        <p className={styles.muted}>저장한 계산이 없습니다. 상품별로 저장해 두면 가격이나 수수료가 바뀔 때 바로 다시 볼 수 있어요.</p>
                    ) : (
                        <div className={styles.tableWrap}>
                            <table className={styles.table}>
                                <thead>
                                    <tr>
                                        <th>상품</th>
                                        <th>채널</th>
                                        <th>판매가</th>
                                        <th>순이익</th>
                                        <th>마진율</th>
                                        <th>손익분기 ROAS</th>
                                        <th><span className={styles.srOnly}>작업</span></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {scenarioRows.map(({ scenario, tabLabel, result: r }) => (
                                        <tr key={scenario.id} className={editingId === scenario.id ? styles.rowActive : ''}>
                                            <td>
                                                <button type="button" className={styles.linkBtn} onClick={() => loadScenario(scenario)}>
                                                    {scenario.name}
                                                </button>
                                            </td>
                                            <td>{tabLabel}</td>
                                            <td>{won(r.productPay)}</td>
                                            <td className={r.profit < 0 ? styles.negative : styles.positive}>{won(r.profit)}</td>
                                            <td>{percent(r.marginRate)}</td>
                                            <td>{r.bepRoas == null ? '-' : `${Math.ceil(r.bepRoas).toLocaleString('ko-KR')}%`}</td>
                                            <td>
                                                <button type="button" className={styles.iconBtn} onClick={() => deleteScenario(scenario)} aria-label={`${scenario.name} 삭제`}>
                                                    <Trash2 size={15} />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </section>
            </div>
        </DashboardLayout>
    );
}
