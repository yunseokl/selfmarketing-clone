import { AlertCircle, RefreshCw } from 'lucide-react';
import styles from './LoadError.module.css';

// 목록을 불러오지 못했을 때 "내역이 없습니다" 대신 보여 주는 안내. 빈 목록과 실패를 구분합니다.
export default function LoadError({ message = '정보를 불러오지 못했습니다.', onRetry, compact = false }) {
    return (
        <div className={`${styles.box} ${compact ? styles.compact : ''}`} role="alert">
            <AlertCircle size={compact ? 18 : 30} className={styles.icon} aria-hidden="true" />
            <div className={styles.text}>
                <strong>{message}</strong>
                <span>잠시 후 다시 시도해주세요. 계속되면 고객센터로 알려 주세요.</span>
            </div>
            {onRetry && (
                <button type="button" className={styles.retry} onClick={onRetry}>
                    <RefreshCw size={14} aria-hidden="true" />
                    다시 시도
                </button>
            )}
        </div>
    );
}
