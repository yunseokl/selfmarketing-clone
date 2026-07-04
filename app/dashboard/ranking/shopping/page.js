'use client';

import RankTrackingPage from '@/components/ranking/RankTrackingPage';
import { ShoppingCart } from 'lucide-react';

export default function ShoppingRankingPage() {
    return (
        <RankTrackingPage
            type="shopping"
            title="쇼핑 순위추적"
            subtitle="상품 URL과 키워드를 등록하면 매일 순위를 자동 기록해 상승·하락 추이를 보여드립니다"
            addLabel="상품 추가"
            emptyTitle="추적 중인 상품이 없습니다."
            emptyDescription="상품 URL과 키워드를 등록하면 현재 순위와 일별 변동 추이를 자동으로 기록합니다."
            urlLabel="상품 URL"
            urlPlaceholder="네이버 쇼핑 또는 스마트스토어 상품 URL 입력"
            nameLabel="상품명"
            namePlaceholder="비워두면 URL로 표시됩니다"
            keywordPlaceholder="예: 남자 운동화"
            Icon={ShoppingCart}
        />
    );
}
