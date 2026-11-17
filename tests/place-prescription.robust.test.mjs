import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrescription } from '../lib/place-prescription.js';
import { analyzeGeoAeo } from '../lib/place-geo.js';
import { recommendKeywords } from '../lib/place-keywords.js';
import { buildActionItems } from '../lib/naver-place.js';
import { PHARMACY, RESTAURANT, SALON, NOW, graphInput } from './place-graph.fixtures.mjs';
import { LONG } from './place-prescription.fixtures.mjs';

// 처방전은 분석 결과가 있으면 그려지므로, 실제 네이버 응답이 견본과 모양이 달라도(빈 배열·null·필드 없음) 던지면 안 됩니다.
// 견본의 필드를 하나씩 지우거나 null·빈 값·엉뚱한 타입으로 바꾼 변형을 만들어 buildPrescription 이 던지지 않는지 봅니다.
// (AI 검색 진단·추천·할 일은 화면이 따로 계산합니다. 그쪽이 던지면 화면처럼 null·빈 배열로 대신합니다.)

const BAD_VALUES = [undefined, null, [], {}, '', 0];

function attempt(fn, fallback) {
    try {
        return fn();
    } catch {
        return fallback;
    }
}

// 화면(Prescription.js)과 같은 순서로 자료를 만들고 처방전을 만듭니다.
function build({ place, activity, ranks, recommendation, actions }) {
    const reco = recommendation === undefined ? attempt(() => recommendKeywords({ place, activity, ranks }), null) : recommendation;
    const todo = actions === undefined ? attempt(() => buildActionItems(place, activity, { recommendation: reco, nowMs: NOW }), []) : actions;
    const geo = attempt(() => analyzeGeoAeo({ place, activity, ranks, nowMs: NOW }), null);
    return buildPrescription({ place, activity, ranks, recommendation: reco, actions: todo, geo, fetchedAt: NOW, nowMs: NOW });
}

function variants(input) {
    const out = [];
    const { place, activity, ranks } = input;
    const add = (label, patch) => out.push({ label, data: { place, activity, ranks, recommendation: undefined, actions: undefined, ...patch } });
    for (const key of Object.keys(place)) {
        for (const value of BAD_VALUES) add(`place.${key}=${JSON.stringify(value)}`, { place: { ...place, [key]: value } });
    }
    for (const key of Object.keys(place.detail || {})) {
        for (const value of BAD_VALUES) add(`place.detail.${key}=${JSON.stringify(value)}`, { place: { ...place, detail: { ...place.detail, [key]: value } } });
    }
    for (const key of Object.keys(activity || {})) {
        for (const value of BAD_VALUES) add(`activity.${key}=${JSON.stringify(value)}`, { activity: { ...activity, [key]: value } });
        const inner = activity[key];
        if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
            for (const sub of Object.keys(inner)) add(`activity.${key}.${sub}=null`, { activity: { ...activity, [key]: { ...inner, [sub]: null } } });
        }
    }
    for (const value of BAD_VALUES) add(`activity=${JSON.stringify(value)}`, { activity: value });
    for (const value of [undefined, null, [], [null], [{}], [{ keyword: 'x', state: 'done', result: null }], [{ keyword: 'x', state: 'done', result: {} }]]) {
        add(`ranks=${JSON.stringify(value)}`, { ranks: value });
    }
    const row = (ranks || []).find((entry) => entry.result);
    if (row) {
        for (const key of Object.keys(row.result)) {
            for (const value of BAD_VALUES) add(`ranks[].result.${key}=${JSON.stringify(value)}`, { ranks: ranks.map((entry) => (entry === row ? { ...entry, result: { ...entry.result, [key]: value } } : entry)) });
        }
        add('ranks[].result.top=[null, {}]', { ranks: ranks.map((entry) => (entry === row ? { ...entry, result: { ...entry.result, top: [null, {}, { rank: 'x', name: null }] } } : entry)) });
    }
    const reco = input.recommendation;
    for (const key of Object.keys(reco || {})) {
        for (const value of BAD_VALUES) add(`recommendation.${key}=${JSON.stringify(value)}`, { recommendation: { ...reco, [key]: value } });
    }
    add('recommendation.registered=[{}]', { recommendation: { ...reco, registered: [{}, null] } });
    add('recommendation.items=[{}]', { recommendation: { ...reco, items: [{}, null, { keyword: 'x', reasons: null }] } });
    add('recommendation=null', { recommendation: null });
    add('actions=[{}]', { actions: [{}, null, { key: 'reply' }, { key: 'feed', level: 'high', detail: null }] });
    add('actions=null', { actions: null });
    return out;
}

for (const [name, sample] of [['음식점', RESTAURANT], ['약국', PHARMACY], ['미용실', SALON], ['긴 견본', LONG]]) {
    test(`자료 모양이 어긋나도 처방전이 던지지 않는다 — ${name}`, () => {
        const input = graphInput(sample);
        const list = variants(input);
        const failures = [];
        for (const { label, data } of list) {
            try {
                const doc = build(data);
                if (data.place) {
                    assert.ok(doc && Array.isArray(doc.sections) && doc.summary, label);
                    JSON.stringify(doc);
                }
            } catch (error) {
                failures.push(`${label}: ${String(error.message).split('\n')[0]}`);
            }
        }
        assert.ok(list.length > 200, `변형 ${list.length}개`);
        assert.deepEqual(failures, []);
    });
}

test('place 가 비었거나 엉뚱한 값이면 문서를 만들지 않고 던지지도 않는다', () => {
    for (const place of [undefined, null, '', 0]) {
        assert.equal(buildPrescription({ place }), null);
    }
    assert.doesNotThrow(() => buildPrescription({ place: {} }));
    assert.doesNotThrow(() => buildPrescription({ place: [] }));
});
