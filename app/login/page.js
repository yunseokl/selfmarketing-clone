'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import styles from './page.module.css';
import { Mail, Lock, User, Eye, EyeOff, MessageCircle, Sparkles } from 'lucide-react';

export default function LoginPage() {
    const router = useRouter();
    const [isLogin, setIsLogin] = useState(true);
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
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
            if (isLogin) {
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
                        복잡한 마케팅 데이터, 이제 한눈에 확인하세요.<br />
                        AI 기반 분석으로 당신의 비즈니스를 성장시킵니다.
                    </p>

                    <div className={styles.testimonial}>
                        <p className={styles.testimonialQuote}>
                            "혼잘마 도입 후 광고 효율이 200% 증가했습니다. <br />
                            직관적인 대시보드 덕분에 데이터 분석이 정말 쉬워졌어요."
                        </p>
                        <div className={styles.testimonialAuthor}>
                            <div className={styles.authorAvatar}>K</div>
                            <div className={styles.authorInfo}>
                                <h4>김민수 대표님</h4>
                                <p>스마트스토어 파워등급 운영자</p>
                            </div>
                        </div>
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
                            {isLogin ? '다시 오셨군요!' : '환영합니다!'}
                        </h2>
                        <p className={styles.headerDesc}>
                            {isLogin ? '계속하려면 로그인을 진행해주세요.' : '30초 만에 가입하고 무료로 시작하세요.'}
                        </p>
                    </div>

                    {/* Tabs */}
                    <div className={styles.tabs} style={{ display: 'none' }}> {/* Hidden for clean look, toggle via footer */}
                        <button onClick={() => setIsLogin(true)}>Login</button>
                        <button onClick={() => setIsLogin(false)}>Register</button>
                    </div>

                    {/* Form */}
                    <form onSubmit={handleSubmit} className={styles.form}>
                        {!isLogin && (
                            <div className={styles.inputGroup}>
                                <User size={20} className={styles.inputIcon} />
                                <input
                                    type="text"
                                    placeholder="이름"
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
                                value={formData.email}
                                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                required
                            />
                        </div>

                        <div className={styles.inputGroup}>
                            <Lock size={20} className={styles.inputIcon} />
                            <input
                                type={showPassword ? 'text' : 'password'}
                                placeholder="비밀번호"
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

                        {error && <p className={styles.error}>{error}</p>}

                        <button type="submit" className={styles.submitBtn} disabled={loading}>
                            {loading ? '처리 중...' : (isLogin ? '이메일로 로그인' : '무료로 시작하기')}
                        </button>
                    </form>

                    {/* Divider */}
                    <div className={styles.divider}>
                        <span>또는 소셜 계정으로 계속하기</span>
                    </div>

                    {/* Social Login */}
                    <div className={styles.socialButtons}>
                        <button className={styles.kakaoBtn}>
                            <MessageCircle size={20} />
                            카카오로 시작하기
                        </button>
                        <button className={styles.naverBtn}>
                            <span className={styles.naverIcon}>N</span>
                            네이버로 시작하기
                        </button>
                    </div>

                    {/* Footer */}
                    <p className={styles.footer} style={{ marginTop: '24px' }}>
                        {isLogin ? (
                            <>계정이 없으신가요? <button style={{ color: '#8B5CF6', fontWeight: 600, marginLeft: 8 }} onClick={() => setIsLogin(false)}>회원가입</button></>
                        ) : (
                            <>이미 계정이 있으신가요? <button style={{ color: '#8B5CF6', fontWeight: 600, marginLeft: 8 }} onClick={() => setIsLogin(true)}>로그인</button></>
                        )}
                    </p>
                </div>
            </div>
        </div>
    );
}
