'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { RefreshCw, Home } from 'lucide-react';
import styles from './not-found.module.css';

export default function Error({ error, reset }) {
    useEffect(() => {
        console.error(error);
    }, [error]);

    return (
        <div className={styles.container}>
            <div className={styles.panel}>
                <p className={styles.code}>이런!</p>
                <h1 className={styles.title}>일시적인 오류가 발생했습니다</h1>
                <p className={styles.desc}>
                    잠시 후 다시 시도해주세요. 문제가 계속되면
                    <br />
                    고객센터로 알려주시면 빠르게 확인하겠습니다.
                </p>
                <div className={styles.actions}>
                    <button onClick={() => reset()} className={styles.primaryBtn}>
                        <RefreshCw size={16} />
                        다시 시도
                    </button>
                    <Link href="/" className={styles.secondaryBtn}>
                        <Home size={16} />
                        홈으로 가기
                    </Link>
                </div>
            </div>
        </div>
    );
}
