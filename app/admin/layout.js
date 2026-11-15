'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Toaster } from 'sonner';

// 관리자 화면 공통 레이아웃
// - sonner <Toaster/> 를 한 번만 렌더링해, 관리자 페이지의 toast 가 실제로 보이게 합니다.
//   (Toaster 는 DashboardLayout 에만 있고 관리자 페이지는 그 레이아웃을 쓰지 않습니다.)
// - /api/user 로 role 을 확인해 관리자가 아니면 '/' 로 보내고, 확인 전에는 하위 화면을 렌더링하지 않습니다.
//   (데이터 접근 자체는 각 관리자 API 의 requireAdmin 이 막으며, 이 레이아웃은 화면 노출을 막는 용도입니다.)
export default function AdminLayout({ children }) {
    const router = useRouter();
    const [allowed, setAllowed] = useState(false);

    useEffect(() => {
        let active = true;

        const check = async () => {
            try {
                const res = await fetch('/api/user');
                if (!active) return;

                if (res.status === 401) {
                    router.replace('/login');
                    return;
                }
                if (!res.ok) {
                    router.replace('/');
                    return;
                }

                const data = await res.json();
                if (!active) return;

                if (data.user?.role === 'admin') {
                    setAllowed(true);
                } else {
                    router.replace('/');
                }
            } catch {
                if (active) router.replace('/');
            }
        };

        check();
        return () => {
            active = false;
        };
    }, [router]);

    return (
        <>
            <Toaster theme="dark" position="top-right" />
            {allowed ? (
                children
            ) : (
                <div role="status" style={{ padding: '48px 16px', textAlign: 'center' }}>
                    권한 확인 중...
                </div>
            )}
        </>
    );
}
