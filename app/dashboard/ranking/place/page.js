'use client';

import RankTrackingPage from '@/components/ranking/RankTrackingPage';
import { MapPin } from 'lucide-react';

export default function PlaceRankingPage() {
    return (
        <RankTrackingPage
            type="place"
            title="플레이스 순위추적"
            subtitle="플레이스 URL과 키워드를 등록하면 매일 노출 순위를 자동 기록해 변동 추이를 보여드립니다"
            addLabel="플레이스 추가"
            emptyTitle="추적 중인 플레이스가 없습니다."
            emptyDescription="플레이스 URL과 키워드를 등록하면 현재 순위와 일별 변동 추이를 자동으로 기록합니다."
            urlLabel="플레이스 URL"
            urlPlaceholder="네이버 플레이스 또는 지도 URL 입력"
            nameLabel="플레이스명"
            namePlaceholder="비워두면 URL로 표시됩니다"
            keywordPlaceholder="예: 강남 미용실"
            Icon={MapPin}
        />
    );
}
