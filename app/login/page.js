'use client';

import { Suspense, useState } from 'react';
import { signIn } from 'next-auth/react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import styles from './page.module.css';
import { Mail, Lock, User, Eye, EyeOff, Gift, Sparkles, Check, Phone } from 'lucide-react';

function LoginForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [isLogin, setIsLogin] = useState(searchParams.get('mode') !== 'register');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    // 비밀번호 재설정 요청 화면 여부와 접수 안내 문구
    const [isReset, setIsReset] = useState(false);
    const [resetContact, setResetContact] = useState('');
    const [resetMessage, setResetMessage] = useState('');
    const [formData, setFormData] = useState({
        email: '',
        password: '',
        name: '',
    });

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            if (isReset) {
                const res = await fetch('/api/auth/password-reset-request', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: formData.email, contact: resetContact || undefined }),
                });
                const data = await res.json();
                if (!res.ok) {
                    setError(data.error || '요청을 처리하지 못했습니다.');
                } else {
                    setResetMessage(data.message);
                }
            } else if (isLogin) {
                // Login
                const result = await signIn('credentials', {
                    email: formData.email,
                    password: formData.password,
                    redirect: false,
                });

                if (result?.error) {
                    setError(result.error);
                } else {
                    router.push('/');
                    router.refresh();
                }
            } else {
                // Register
                const res = await fetch('/api/auth/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(formData),
                });

                const data = await res.json();

                if (!res.ok) {
                    setError(data.error);
                } else {
                    // Auto login after registration
                    await signIn('credentials', {
                        email: formData.email,
                        password: formData.password,
                        redirect: false,
                    });
                    router.push('/');
                    router.refresh();
                }
            }
        } catch (err) {
            setError('오류가 발생했습니다. 다시 시도해주세요.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className={styles.container}>
            {/* Left Side: Branding */}
            <div className={styles.brandingSection}>
                <div className={styles.brandingContent}>
                    <div className={styles.brandBadge}>
                        <Sparkles size={16} />
                        Premium Self Marketing
                    </div>
                    <h1 className={styles.brandTitle}>
                        대행사 없이<br />
                        <span>혼자서도 완벽하게</span>
                    </h1>
                    <p className={styles.brandDesc}>
                        수수료·광고비 계산부터 순위 기록까지,<br />
                        혼자 마케팅할 때 필요한 도구를 한곳에 모았습니다.
                    </p>

                    <div className={styles.testimonial}>
                        <p className={styles.testimonialQuote}>가입하면 바로 쓸 수 있는 무료 도구</p>
                        <ul className={styles.toolList}>
                            <li><Check size={16} /> 마진·ROAS 계산기 (스마트스토어·쿠팡)</li>
                            <li><Check size={16} /> 키워드 트렌드와 상품명 SEO 분석</li>
                            <li><Check size={16} /> 플레이스 진단과 리뷰 답글 도우미</li>
                            <li><Check size={16} /> 쇼핑·플레이스 순위 기록장</li>
                        </ul>
                    </div>
                </div>
            </div>

            {/* Right Side: Form */}
            <div className={styles.formSection}>
                <div className={styles.card}>
                    {/* Mobile Logo */}
                    <div className={styles.mobileLogo}>
                        <h1 style={{ fontSize: '24px', fontWeight: 800, color: 'white' }}>혼잘마</h1>
                    </div>

                    <div className={styles.formHeader}>
                        <h2 className={styles.headerTitle}>
                            {isReset ? '비밀번호 재설정' : isLogin ? '다시 오셨군요!' : '환영합니다!'}
                        </h2>
                        <p className={styles.headerDesc}>
                            {isReset
                                ? '가입한 이메일을 입력하면 관리자가 확인한 뒤 임시 비밀번호를 가입 이메일로 보내드립니다.'
                                : isLogin ? '계속하려면 로그인을 진행해주세요.' : '30초 만에 가입하고 무료로 시작하세요.'}
                        </p>
                    </div>

                    {/* Tabs */}
                    <div className={styles.tabs} style={{ display: 'none' }}> {/* Hidden for clean look, toggle via footer */}
                        <button onClick={() => setIsLogin(true)}>Login</button>
                        <button onClick={() => setIsLogin(false)}>Register</button>
                    </div>

                    {/* Form */}
                    <form onSubmit={handleSubmit} className={styles.form}>
                        {!isLogin && !isReset && (
                            <div className={styles.inputGroup}>
                                <User size={20} className={styles.inputIcon} />
                                <input
                                    type="text"
                                    placeholder="이름"
                                    autoComplete="name"
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                />
                            </div>
                        )}

                        <div className={styles.inputGroup}>
                            <Mail size={20} className={styles.inputIcon} />
                            <input
                                type="email"
                                placeholder="이메일 주소"
                                autoComplete="email"
                                value={formData.email}
                                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                required
                            />
                        </div>

                        {isReset ? (
                            <div className={styles.inputGroup}>
                                <Phone size={20} className={styles.inputIcon} />
                                <input
                                    type="text"
                                    placeholder="연락처 (선택)"
                                    autoComplete="tel"
                                    maxLength={50}
                                    value={resetContact}
                                    onChange={(e) => setResetContact(e.target.value)}
                                />
                            </div>
                        ) : (
                            <div className={styles.inputGroup}>
                                <Lock size={20} className={styles.inputIcon} />
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    placeholder="비밀번호"
                                    autoComplete={isLogin ? 'current-password' : 'new-password'}
                                    value={formData.password}
                                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                    required
                                />
                                <button
                                    type="button"
                                    className={styles.eyeBtn}
                                    onClick={() => setShowPassword(!showPassword)}
                                >
                                    {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                                </button>
                            </div>
                        )}

                        {isLogin && !isReset && (
                            <div className={styles.forgotRow}>
                                <button
                                    type="button"
                                    className={styles.forgotLink}
                                    onClick={() => { setIsReset(true); setError(''); setResetMessage(''); }}
                                >
                                    비밀번호를 잊으셨나요?
                                </button>
                            </div>
                        )}

                        {resetMessage && <p className={styles.success} role="status">{resetMessage}</p>}
                        {error && <p className={styles.error}>{error}</p>}

                        <button type="submit" className={styles.submitBtn} disabled={loading}>
                            {loading ? '처리 중...' : isReset ? '재설정 요청 보내기' : (isLogin ? '이메일로 로그인' : '무료로 시작하기')}
                        </button>

                        {!isLogin && !isReset && (
                            <p className={styles.consentText}>
                                가입 시 <a href="/terms" target="_blank" rel="noopener noreferrer" className={styles.consentLink}>이용약관</a> 및{' '}
                                <a href="/privacy" target="_blank" rel="noopener noreferrer" className={styles.consentLink}>개인정보처리방침</a>에 동의하는 것으로 간주됩니다.
                            </p>
                        )}
                    </form>

                    {!isLogin && !isReset && (
                        <div className={styles.bonusBadge}>
                            <Gift size={16} />
                            지금 가입하면 축하 캐시 10,000원 즉시 지급
                        </div>
                    )}

                    {/* Footer */}
                    <p className={styles.footer} style={{ marginTop: '24px' }}>
                        {isReset ? (
                            <button style={{ color: '#8B5CF6', fontWeight: 600 }} onClick={() => { setIsReset(false); setIsLogin(true); setError(''); setResetMessage(''); }}>로그인으로 돌아가기</button>
                        ) : isLogin ? (
                            <>계정이 없으신가요? <button style={{ color: '#8B5CF6', fontWeight: 600, marginLeft: 8 }} onClick={() => setIsLogin(false)}>회원가입</button></>
                        ) : (
                            <>이미 계정이 있으신가요? <button style={{ color: '#8B5CF6', fontWeight: 600, marginLeft: 8 }} onClick={() => setIsLogin(true)}>로그인</button></>
                        )}
                    </p>

                    {/* Legal Links */}
                    <div className={styles.legalFooter}>
                        <a href="/terms" target="_blank" rel="noopener noreferrer">이용약관</a>
                        <span className={styles.legalDivider}>·</span>
                        <a href="/privacy" target="_blank" rel="noopener noreferrer">개인정보처리방침</a>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function LoginPage() {
    return (
        <Suspense fallback={null}>
            <LoginForm />
        </Suspense>
    );
}
