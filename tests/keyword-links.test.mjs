// 검색어 트렌드 연동 키가 없을 때 보여 주는 외부 도구 주소 조립 검증 (네트워크 호출 없음)
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKeywordLinks, DATALAB_TREND_URL } from '../lib/keyword-links.js';

const NOW = new Date('2026-11-14T00:00:00Z');

test('키워드가 없으면 주소를 만들지 않는다', () => {
    assert.equal(buildKeywordLinks([], NOW), null);
    assert.equal(buildKeywordLinks(['  ', ''], NOW), null);
    assert.equal(buildKeywordLinks(undefined, NOW), null);
});

test('구글 트렌드 주소에 한국·최근 36개월·키워드가 미리 들어간다', () => {
    const links = buildKeywordLinks(['캠핑 의자', '캠핑테이블'], NOW);
    assert.deepEqual(links.keywords, ['캠핑 의자', '캠핑테이블']);
    assert.deepEqual(links.range, { startDate: '2023-11-01', endDate: '2026-10-31' });

    const url = new URL(links.googleTrends);
    assert.equal(url.origin + url.pathname, 'https://trends.google.com/trends/explore');
    assert.equal(url.searchParams.get('geo'), 'KR');
    assert.equal(url.searchParams.get('date'), '2023-11-01 2026-10-31');
    assert.equal(url.searchParams.get('q'), '캠핑 의자,캠핑테이블');
});

test('네이버 검색 주소는 키워드마다 하나씩, 특수문자는 인코딩된다', () => {
    const links = buildKeywordLinks(['A&B 텀블러'], NOW);
    assert.equal(links.datalab, DATALAB_TREND_URL);
    assert.equal(links.naverSearch.length, 1);
    const url = new URL(links.naverSearch[0].url);
    assert.equal(url.hostname, 'search.naver.com');
    assert.equal(url.searchParams.get('query'), 'A&B 텀블러');
    assert.ok(!links.naverSearch[0].url.includes('A&B'));
});

test('키워드는 앞뒤 공백을 지우고 최대 5개까지만 쓴다', () => {
    const links = buildKeywordLinks([' a1 ', 'b2', 'c3', 'd4', 'e5', 'f6'], NOW);
    assert.deepEqual(links.keywords, ['a1', 'b2', 'c3', 'd4', 'e5']);
    assert.equal(links.naverSearch.length, 5);
});
