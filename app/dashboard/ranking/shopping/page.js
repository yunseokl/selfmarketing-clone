'use client';

import RankTrackingPage from '@/components/ranking/RankTrackingPage';
import { ShoppingCart } from 'lucide-react';

export default function ShoppingRankingPage() {
    return (
        <RankTrackingPage
            type="shopping"
            title="쇼핑 순위 기록장"
            subtitle="검색해서 확인한 내 상품 순위를 날짜별로 기록하고 상승·하락 추이를 그래프로 확인하세요"
            addLabel="상품 추가"
            emptyTitle="기록 중인 상품이 없습니다."
            emptyDescription="상품과 키워드를 등록한 뒤, 직접 확인한 순위를 적으면 변동 추이를 보여 드립니다."
            urlLabel="상품 URL"
            urlPlaceholder="네이버 쇼핑 또는 스마트스토어 상품 URL 입력"
            nameLabel="상품명"
            namePlaceholder="비워두면 URL로 표시됩니다"
            keywordPlaceholder="예: 남자 운동화"
            Icon={ShoppingCart}
        />
    );
}
