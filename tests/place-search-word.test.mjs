import test from 'node:test';
import assert from 'node:assert/strict';
import { searchCategoryWord, recommendKeywords } from '../lib/place-keywords.js';
import { analyzeGeoAeo, measurePrompts, searchCategory, targetQuestion } from '../lib/place-geo.js';
import { buildQuickStrategies } from '../lib/place-geo-quick.js';
import { PHARMACY, RESTAURANT, SALON, NOW } from './place-graph.fixtures.mjs';

// AI 질문·소식 제목·답글 안내처럼 손님이 검색하는 말을 적는 자리에는, 업종 이름이 "한식"·"해물,생선요리"처럼 뜻이 넓으면 그 말 대신
// 이 매장의 중심 낱말(키워드 추천의 topTerm: 횟집 등)을 씁니다(6차 후속). 키워드 추천이 넓다고 뺀 업종 이름과 같은 규칙입니다.
// 매장을 설명하는 사실 문구("한식 매장", 업종: 한식)는 업종 이름 그대로입니다.

const SHOP = { placeId: 't', name: '시험식당', address: '서울 강남구 테헤란로 1', jibunAddress: '서울 강남구 역삼동 1', keywords: [], conveniences: [], reviewVotes: [], reviewThemes: [], reviewMenus: [] };
const withCenter = (category) => ({ ...SHOP, category, keywords: ['역삼횟집', '역삼회식'], reviewMenus: [{ label: '광어', count: 30 }] });

test('업종 이름이 뜻이 넓으면 중심 낱말을, 쓸 만하면 업종 이름 그대로 쓴다', () => {
    const center = recommendKeywords({ place: withCenter('한식') }).topTerm;
    assert.equal(center, '횟집');
    // 넓은 업종 이름(한식·음식점)·재료 갈래(육류·고기요리·해물·생선요리·닭요리)는 중심 낱말로 바뀐다
    for (const category of ['한식', '음식점', '해물,생선요리', '육류,고기요리', '닭요리', '양식']) assert.equal(searchCategoryWord(withCenter(category)), '횟집', category);
    // 쓸 만한 업종 이름은 null(부른 쪽이 업종 이름을 그대로 씀): 미용실·약국·카페·횟집·남성전문미용실
    for (const category of ['미용실', '약국', '카페', '횟집', '남성전문미용실', '네일샵']) assert.equal(searchCategoryWord(withCenter(category)), null, category);
    // 일부만 넓으면 쓸 만한 업종 이름만 남긴다
    assert.equal(searchCategoryWord(withCenter('한식,횟집')), '횟집');
    assert.equal(searchCategoryWord(withCenter('한식,육류,고기요리,삼겹살')), '삼겹살');
    // 중심 낱말을 못 정하면(등록 키워드·리뷰·업종 연관어 어디에도 근거가 없음) 지금처럼 업종 이름 그대로
    assert.equal(searchCategoryWord({ ...SHOP, category: '한식' }), null);
    assert.equal(searchCategory({ ...SHOP, category: '한식' }), '한식');
    assert.equal(searchCategory({ ...SHOP, category: '해물,생선요리' }), '해물·생선요리');
    assert.equal(searchCategoryWord({ ...SHOP, category: '' }), null);
    assert.equal(searchCategoryWord(null), null);
});

test('견본 3종: 음식점의 질문·초안만 "한식"이 "횟집"으로 바뀌고, 약국·미용실 문구는 그대로다', () => {
    const analyze = (sample) => analyzeGeoAeo({ place: sample.place, activity: sample.activity, ranks: sample.ranks ?? null, nowMs: NOW });
    const food = analyze(RESTAURANT);
    assert.equal(targetQuestion(RESTAURANT.place), '강남구청역 횟집 추천');
    assert.equal(food.question, '강남구청역 횟집 추천');
    assert.equal(measurePrompts(RESTAURANT.place)[0].startsWith('강남구청역 횟집 추천해줘.'), true);
    assert.equal(food.fanout.find((item) => item.key === 'hours').question, '강남구청역 횟집 지금 영업 중인 곳·영업시간은?');
    assert.equal(food.fanout.find((item) => item.key === 'reputation').question, '강남구청역 횟집 중 평이 좋은 곳은?');
    assert.equal(food.templates.find((template) => template.key === 'feedPost').text.split('\n')[1], '강남구청역 횟집 대물섬 강남점 — 11월 영업시간·주차·예약 안내');
    // 매장을 설명하는 문장은 실제 업종 이름 그대로("한식 매장입니다")
    assert.match(food.atomic.text, /한식 매장입니다/);
    assert.equal(JSON.stringify(food).includes('강남구청역 한식'), false);
    // 새 소식 전략·질문형 초안도 같은 낱말을 쓴다
    const quick = buildQuickStrategies(RESTAURANT.place, RESTAURANT.activity, {});
    const feed = quick.find((strategy) => strategy.id === 'naver-feed');
    assert.equal(feed.title, "스마트플레이스 '새소식' 제목을 손님이 묻는 말로 올리기");
    assert.equal(JSON.stringify(quick).includes('강남구청역 한식'), false);
    assert.equal(JSON.stringify(quick).includes('타겟 질문'), false);
    // 업종 이름이 쓸 만한 약국·미용실은 그대로
    assert.equal(analyze(PHARMACY).question, '오창읍 약국 추천');
    assert.equal(analyze(SALON).question, '강남역 남성전문미용실 추천');
});

test('사장님에게 보이는 문구에 업계 말(타겟 질문·쿼리 팬아웃·엔티티·NAP)을 쓰지 않는다', () => {
    for (const sample of [PHARMACY, RESTAURANT, SALON]) {
        const text = JSON.stringify([
            analyzeGeoAeo({ place: sample.place, activity: sample.activity, ranks: sample.ranks ?? null, nowMs: NOW }),
            buildQuickStrategies(sample.place, sample.activity, {}),
        ]);
        assert.equal(/타겟 질문|쿼리 팬아웃|엔티티|\(NAP\)/.test(text), false);
    }
});
