import Link from 'next/link';
import { Home, Target, LifeBuoy } from 'lucide-react';
import styles from './not-found.module.css';

export const metadata = {
    title: '페이지를 찾을 수 없습니다',
};

export default function NotFound() {
    return (
        <div className={styles.container}>
            <div className={styles.panel}>
                <p className={styles.code}>404</p>
                <h1 className={styles.title}>페이지를 찾을 수 없습니다</h1>
                <p className={styles.desc}>
                    주소가 잘못 입력되었거나, 삭제·이동된 페이지일 수 있어요.
                    <br />
                    아래 바로가기에서 필요한 서비스를 찾아보세요.
                </p>
                <div className={styles.actions}>
                    <Link href="/" className={styles.primaryBtn}>
                        <Home size={16} />
                        홈으로 가기
                    </Link>
                    <Link href="/dashboard/keyword" className={styles.secondaryBtn}>
                        <Target size={16} />
                        키워드 분석
                    </Link>
                    <Link href="/dashboard/support" className={styles.secondaryBtn}>
                        <LifeBuoy size={16} />
                        고객센터
                    </Link>
                </div>
            </div>
        </div>
    );
}
