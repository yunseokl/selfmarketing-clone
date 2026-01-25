'use client';

import Sidebar from './Sidebar';
import MobileBottomBar from './MobileBottomBar';
import styles from './DashboardLayout.module.css';

export default function DashboardLayout({ children }) {
    return (
        <div className={styles.layout}>
            <Sidebar />
            <main className={styles.main}>
                {children}
            </main>
            <MobileBottomBar />
        </div>
    );
}
