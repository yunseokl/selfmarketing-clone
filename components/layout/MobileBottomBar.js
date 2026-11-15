'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, ShoppingCart, MapPin, User, Calculator } from 'lucide-react';
import styles from './MobileBottomBar.module.css';

const mobileNavItems = [
    { name: '홈', href: '/', icon: Home },
    { name: '계산기', href: '/dashboard/margin', icon: Calculator },
    { name: '쇼핑', href: '/dashboard/shopping', icon: ShoppingCart },
    { name: '플레이스', href: '/dashboard/place', icon: MapPin },
    { name: '내 정보', href: '/dashboard/profile', icon: User },
];

export default function MobileBottomBar() {
    const pathname = usePathname();

    return (
        <nav className={styles.bottomBar}>
            {mobileNavItems.map((item, idx) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;
                return (
                    <Link
                        key={idx}
                        href={item.href}
                        className={`${styles.navItem} ${isActive ? styles.active : ''}`}
                    >
                        <div className={styles.iconContainer}>
                            <Icon size={22} strokeWidth={isActive ? 2.5 : 2} />
                        </div>
                        <span className={styles.label}>{item.name}</span>
                        {isActive && <div className={styles.activeIndicator} />}
                    </Link>
                );
            })}
        </nav>
    );
}
