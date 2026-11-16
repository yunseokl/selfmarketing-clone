// 검색어 트렌드 연동 키가 없을 때 쓰는 대체 경로.
// 그래프를 직접 그릴 수 없으므로, 입력한 키워드로 같은 자료를 볼 수 있는 외부 도구 주소를 만들어 줍니다.
// 수치를 만들어 내지 않고 주소만 조립합니다.

import { trendRange, TREND_MAX_KEYWORDS } from './naver-trend.js';

// 네이버 데이터랩은 주소로 키워드를 미리 넣을 수 없어, 화면에서 키워드를 복사한 뒤 열도록 안내합니다.
export const DATALAB_TREND_URL = 'https://datalab.naver.com/keyword/trendSearch.naver';
export const SEARCHAD_URL = 'https://searchad.naver.com';

export function buildKeywordLinks(keywords, now = new Date()) {
    const list = (Array.isArray(keywords) ? keywords : [])
        .map((keyword) => String(keyword ?? '').trim())
        .filter(Boolean)
        .slice(0, TREND_MAX_KEYWORDS);
    if (list.length === 0) return null;

    const range = trendRange(now);
    const trends = new URLSearchParams({
        date: `${range.startDate} ${range.endDate}`,
        geo: 'KR',
        q: list.join(','),
        hl: 'ko',
    });

    return {
        keywords: list,
        range,
        datalab: DATALAB_TREND_URL,
        googleTrends: `https://trends.google.com/trends/explore?${trends}`,
        naverSearch: list.map((keyword) => ({
            keyword,
            url: `https://search.naver.com/search.naver?${new URLSearchParams({ query: keyword })}`,
        })),
    };
}
