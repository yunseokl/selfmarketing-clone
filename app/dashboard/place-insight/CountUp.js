'use client';

// GEO·AEO 점수와 AI 답변 점유율 숫자를 화면에 보일 때 0에서 세어 올립니다.
// 값이 바뀌면 처음부터가 아니라 지금 보이는 숫자에서 이어 가고, 모션 줄이기 설정에서는 바로 값을 보여 줍니다.

import { useEffect, useRef, useState } from 'react';

export default function CountUp({ value, duration = 900 }) {
    const ref = useRef(null);
    const last = useRef(0);
    const [seen, setSeen] = useState(false);
    const [shown, setShown] = useState(0);

    // 숨은 탭 안에 있을 때는 세지 않고, 탭이 열려 보이는 순간부터 셉니다.
    useEffect(() => {
        const el = ref.current;
        if (!el || seen) return undefined;
        if (typeof IntersectionObserver === 'undefined') {
            setSeen(true);
            return undefined;
        }
        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
                setSeen(true);
                observer.disconnect();
            }
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, [seen]);

    useEffect(() => {
        if (!seen) return undefined;
        if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
            last.current = value;
            setShown(value);
            return undefined;
        }
        let raf = 0;
        const origin = last.current;
        const start = performance.now();
        const tick = (now) => {
            const t = Math.min(1, (now - start) / duration);
            last.current = origin + (value - origin) * (1 - Math.pow(1 - t, 4));
            setShown(last.current);
            if (t < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [seen, value, duration]);

    return <span ref={ref}>{Math.round(shown)}</span>;
}
