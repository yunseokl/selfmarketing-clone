'use client';

// 루트 레이아웃 자체가 깨졌을 때의 최후 방어선 — html/body를 직접 렌더해야 합니다.
export default function GlobalError({ error, reset }) {
    return (
        <html lang="ko">
            <body style={{
                margin: 0,
                minHeight: '100vh',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: '#0F172A',
                color: '#fff',
                fontFamily: 'Pretendard, -apple-system, sans-serif',
                textAlign: 'center',
            }}>
                <div>
                    <h1 style={{ fontSize: 24, marginBottom: 12 }}>서비스에 일시적인 문제가 발생했습니다</h1>
                    <p style={{ color: '#94A3B8', marginBottom: 24 }}>잠시 후 다시 시도해주세요.</p>
                    <button
                        onClick={() => reset()}
                        style={{
                            padding: '10px 20px',
                            borderRadius: 10,
                            border: 'none',
                            cursor: 'pointer',
                            fontWeight: 600,
                            color: '#fff',
                            background: 'linear-gradient(135deg, #6D28D9, #7C3AED)',
                        }}
                    >
                        다시 시도
                    </button>
                </div>
            </body>
        </html>
    );
}
