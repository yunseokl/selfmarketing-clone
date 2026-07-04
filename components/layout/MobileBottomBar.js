'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, ShoppingCart, MapPin, User, Target } from 'lucide-react';
import styles from './MobileBottomBar.module.css';

const mobileNavItems = [
    { name: '홈', href: '/', icon: Home },
    { name: '쇼핑', href: '/dashboard/shopping', icon: ShoppingCart },
    { name: '플레이스', href: '/dashboard/place', icon: MapPin },
    { name: '키워드', href: '/dashboard/keyword', icon: Target },
    { name: '내 정보', href: '/dashboard/profile', icon: User },
    // Menu is handled by toggle in Sidebar, but here we might link to a full menu page or trigger
    // For simplicity, let's link to blog for now or remove 'Menu' if Sidebar toggle serves that.
    // Let's use 'menu' to trigger sidebar (requires state lift or context, let's stick to links for first version)
    // Or just link to AI for fun
    // { name: 'AI', href: '/dashboard/ai', icon: Menu }, 
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
