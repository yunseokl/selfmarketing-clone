'use client';

import Sidebar from './Sidebar';
import MobileBottomBar from './MobileBottomBar';
import styles from './DashboardLayout.module.css';

import { AnimatePresence, motion } from 'framer-motion';
import { usePathname } from 'next/navigation';

import { Toaster } from 'sonner';

export default function DashboardLayout({ children }) {
    const pathname = usePathname();

    return (
        <div className={styles.layout}>
            <Sidebar />
            <main className={styles.main}>
                <AnimatePresence mode="wait">
                    <motion.div
                        key={pathname}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        transition={{ duration: 0.3 }}
                    >
                        {children}
                    </motion.div>
                </AnimatePresence>
            </main>
            <MobileBottomBar />
            <Toaster theme="dark" position="top-right" />
        </div>
    );
}
