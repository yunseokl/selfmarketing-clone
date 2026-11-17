// 처방전 1쪽 넘침 시험용 견본(시험용으로 만든 값, 실제 매장 아님).
// 음식점 견본(RESTAURANT)을 바탕으로 매장 이름(30자)·주소·대표키워드(13~15자)·소식 제목을 길게 바꾸고,
// 경쟁 매장 이름도 길게 해 1쪽의 모든 칸이 가장 길어지게 합니다.
import { RESTAURANT } from './place-graph.fixtures.mjs';

const RENAME = {
    강남구청횟집: '강남구청역숙성회모둠정식코스',
    강남구청점심: '강남구청역직장인점심회정식집',
    강남구청회식: '강남구청역단체회식룸예약횟집',
    압구정횟집: '압구정로데오숙성회모둠정식집',
    압구정회식: '압구정로데오단체회식룸예약집',
};

const longName = (name) => (String(name).startsWith('시험') ? `${name} 프리미엄 숙성회 다이닝 본점` : name);

export const LONG = {
    ...RESTAURANT,
    place: {
        ...RESTAURANT.place,
        name: '대물섬 숙성회 강남구청역점 프리미엄 단체룸 다이닝',
        address: '서울특별시 강남구 언주로148길 14 대물빌딩 1층 103호~106호 (논현동 98-12)',
        keywords: RESTAURANT.place.keywords.map((keyword) => RENAME[keyword] || keyword),
    },
    activity: {
        ...RESTAURANT.activity,
        feeds: { ...RESTAURANT.activity.feeds, latestTitle: '11월 대방어 입고와 연말 단체 회식 예약 안내드립니다(룸 6곳)' },
    },
    ranks: RESTAURANT.ranks.map((row) => ({
        ...row,
        keyword: RENAME[row.keyword] || row.keyword,
        result: {
            ...row.result,
            keyword: RENAME[row.keyword] || row.keyword,
            top: row.result.top.map((top) => ({ ...top, name: longName(top.name) })),
        },
    })),
};
