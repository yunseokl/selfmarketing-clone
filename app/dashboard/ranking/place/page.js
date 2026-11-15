'use client';

import RankTrackingPage from '@/components/ranking/RankTrackingPage';
import { MapPin } from 'lucide-react';

export default function PlaceRankingPage() {
    return (
        <RankTrackingPage
            type="place"
            title="플레이스 순위 기록장"
            subtitle="내 가게의 실제 검색 순위를 조회해 날짜별로 기록하고 변동 추이를 그래프로 확인하세요"
            addLabel="플레이스 추가"
            emptyTitle="기록 중인 플레이스가 없습니다."
            emptyDescription="가게와 키워드를 등록한 뒤 '지금 조회'를 누르면 실제 순위를 찾아 기록합니다. 직접 확인한 순위를 적어도 됩니다."
            urlLabel="플레이스 URL"
            urlPlaceholder="네이버 플레이스·지도 URL 또는 공유 링크(naver.me) 입력"
            nameLabel="플레이스명"
            namePlaceholder="비워두면 URL로 표시됩니다"
            keywordPlaceholder="예: 강남 미용실"
            Icon={MapPin}
        />
    );
}
