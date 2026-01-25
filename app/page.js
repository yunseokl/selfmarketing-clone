import DashboardLayout from '@/components/layout/DashboardLayout';
import styles from './page.module.css';
import { MapPin, ShoppingCart, FileText, DollarSign } from 'lucide-react';
import Link from 'next/link';

const services = [
    {
        title: '플레이스',
        subtitle: '광고',
        description: '지역 검색 시 상위 노출을 원하시나요? 지역 타겟팅을 통해 주변 고객들에게 더 많이 노출되세요.',
        icon: MapPin,
        color: '#10B981',
        href: '/dashboard/place',
        btnText: '광고 시작하기'
    },
    {
        title: '네이버 쇼핑',
        subtitle: '광고',
        description: '쇼핑 검색 결과 상위에 노출되세요. 실제 유저의 검색과 클릭으로 순위를 높여드립니다.',
        icon: ShoppingCart,
        color: '#2563EB',
        href: '/dashboard/shopping',
        btnText: '광고 시작하기'
    },
    {
        title: '네이버 블로그',
        subtitle: '광고',
        description: '블로그 검색 결과 상위 노출을 위한 블로그 포스팅 및 최적화 서비스를 제공합니다.',
        icon: FileText,
        color: '#8B5CF6',
        href: '/dashboard/blog',
        btnText: '광고 시작하기'
    },
    {
        title: '광고비',
        subtitle: '환급',
        description: '네이버/카카오 광고비를 절감하세요. 광고비 10% 환급 혜택을 누리세요.',
        icon: DollarSign,
        color: '#F59E0B',
        href: '/dashboard/refund',
        btnText: '환급 신청하기'
    },
];

const successStories = [
    {
        image: '/api/placeholder/300/300',
        name: '김OO 대표',
        business: '카페 운영',
        quote: '쇼핑 광고를 시작한 후 매출이 30% 증가했어요!'
    },
    {
        image: '/api/placeholder/300/300',
        name: '이OO 대표',
        business: '의류 쇼핑몰',
        quote: '플레이스 순위가 1페이지로 올라갔습니다.'
    },
    {
        image: '/api/placeholder/300/300',
        name: '박OO 대표',
        business: '화장품 판매',
        quote: '광고비 환급까지 받으니 일석이조네요!'
    },
];

export default function DashboardHome() {
    return (
        <DashboardLayout>
            <div className={styles.container}>
                {/* Hero Section */}
                <section className={styles.hero}>
                    <h1 className={styles.heroTitle}>
                        대행사 없이도 <span className={styles.highlight}>쉽게</span> 마케팅을 시작하세요! 🚀
                    </h1>
                    <p className={styles.heroSubtitle}>
                        마케팅 시작의 쉬움, 셀프마케팅
                    </p>
                </section>

                {/* Services Grid */}
                <section className={styles.services}>
                    {services.map((service, idx) => {
                        const Icon = service.icon;
                        return (
                            <div key={idx} className={styles.serviceCard}>
                                <div
                                    className={styles.serviceIcon}
                                    style={{ backgroundColor: `${service.color}20`, color: service.color }}
                                >
                                    <Icon size={32} />
                                </div>
                                <div className={styles.serviceContent}>
                                    <h3 className={styles.serviceTitle}>
                                        {service.title} <span style={{ color: service.color }}>{service.subtitle}</span>
                                    </h3>
                                    <p className={styles.serviceDesc}>{service.description}</p>
                                </div>
                                <Link href={service.href} className={styles.serviceBtn} style={{ backgroundColor: service.color }}>
                                    {service.btnText}
                                </Link>
                            </div>
                        );
                    })}
                </section>

                {/* Success Stories */}
                <section className={styles.stories}>
                    <div className={styles.storiesHeader}>
                        <span className={styles.storiesLabel}>실제 성공 사례 📈</span>
                        <h2 className={styles.storiesTitle}>
                            셀프마케팅으로 성장한 고객들의 진짜 이야기
                        </h2>
                    </div>

                    <div className={styles.storiesGrid}>
                        {successStories.map((story, idx) => (
                            <div key={idx} className={styles.storyCard}>
                                <div className={styles.storyImage}>
                                    <div className={styles.storyPlaceholder}>
                                        <span>{story.name.charAt(0)}</span>
                                    </div>
                                </div>
                                <div className={styles.storyContent}>
                                    <h4 className={styles.storyName}>{story.name}</h4>
                                    <p className={styles.storyBusiness}>{story.business}</p>
                                    <p className={styles.storyQuote}>"{story.quote}"</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                {/* Footer */}
                <footer className={styles.footer}>
                    <div className={styles.footerContent}>
                        <p>셀프마케팅 | 사업자등록번호: 123-45-67890</p>
                        <p>서울특별시 영등포구 여의대로 108</p>
                        <p>통신판매업신고: 제2024-서울영등포-0000호</p>
                    </div>
                </footer>
            </div>
        </DashboardLayout>
    );
}
