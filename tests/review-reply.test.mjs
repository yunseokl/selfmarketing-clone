// 리뷰 답글 도우미 로직 검증 — 외부 호출 없이 규칙과 문장 조합만 확인합니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    INDUSTRIES,
    SENTIMENTS,
    COMPLAINT_TYPES,
    TONES,
    MAX_REVIEW_LENGTH,
    POLICY_SOURCES,
    hashString,
    josa,
    validateReview,
    detectSentiment,
    detectComplaintType,
    parseMentions,
    extractMentionCandidates,
    defaultIncludes,
    generateReplies,
    checkPolicy,
} from '../lib/review-reply.js';

const REVIEW = '파스타가 정말 맛있었고 직원분들도 친절해서 만족했어요. 분위기도 좋았습니다.';

const base = (extra = {}) => ({
    industry: 'restaurant',
    storeName: '다온식당',
    review: REVIEW,
    sentiment: 'praise',
    complaintType: 'etc',
    tone: 'polite',
    mentions: [],
    ...extra,
});

const ids = (findings) => findings.map((f) => f.id);

test('같은 입력이면 항상 같은 초안이 나온다', () => {
    const a = generateReplies(base());
    const b = generateReplies(base());
    assert.equal(a.length, 3);
    assert.deepEqual(a, b);
    assert.equal(hashString('abc'), hashString('abc'));
    assert.notEqual(hashString('abc'), hashString('abd'));
});

test('초안 3개는 서로 다르고, 입력이 바뀌면 문장 선택도 달라질 수 있다', () => {
    for (const industry of INDUSTRIES) {
        for (const tone of TONES) {
            const drafts = generateReplies(base({ industry: industry.id, tone: tone.id }));
            assert.equal(new Set(drafts.map((d) => d.text)).size, 3, `${industry.id}/${tone.id}`);
        }
    }
    const noStore = generateReplies(base({ storeName: '' }));
    assert.equal(new Set(noStore.map((d) => d.text)).size, 3);
    assert.ok(!noStore[0].text.includes('undefined') && !noStore[0].text.includes('{'));
});

test('불만 리뷰 초안에는 사과가 들어가고, 사과를 끄면 빠진다', () => {
    for (const type of COMPLAINT_TYPES) {
        for (const tone of TONES) {
            const input = base({ sentiment: 'complaint', complaintType: type.id, tone: tone.id, review: '많이 기다렸고 응대도 아쉬웠어요.' });
            const withApology = generateReplies({ ...input, include: defaultIncludes('complaint') });
            withApology.forEach((d) => assert.match(d.text, /죄송|사과/, `${type.id}/${tone.id}`));
            const without = generateReplies({ ...input, include: { ...defaultIncludes('complaint'), apology: false } });
            without.forEach((d) => assert.doesNotMatch(d.text, /죄송|사과/, `${type.id}/${tone.id}`));
        }
    }
});

test('모든 업종·성격·유형·말투·포함 항목 조합의 초안이 정책 점검에 걸리지 않는다', () => {
    const includeSets = [
        { thanks: true, apology: true, promise: true, revisit: true },
        { thanks: false, apology: false, promise: false, revisit: false },
        null, // 성격별 기본값
    ];
    const mentionSets = [[], ['파스타', '분위기'], ['커트 디자인']];
    let checked = 0;
    for (const industry of INDUSTRIES) {
        for (const sentiment of SENTIMENTS) {
            const types = sentiment.id === 'complaint' ? COMPLAINT_TYPES : [{ id: 'etc' }];
            for (const type of types) {
                for (const tone of TONES) {
                    for (const include of includeSets) {
                        for (const mentions of mentionSets) {
                            const drafts = generateReplies({
                                industry: industry.id, storeName: '다온식당', review: '리뷰 본문 예시입니다.',
                                sentiment: sentiment.id, complaintType: type.id, tone: tone.id, mentions, ...(include ? { include } : {}),
                            });
                            assert.equal(drafts.length, 3);
                            drafts.forEach((d) => {
                                const hits = checkPolicy(d.text, { industry: industry.id }).filter((f) => f.severity !== 'info');
                                assert.deepEqual(hits, [], `${industry.id}/${sentiment.id}/${type.id}/${tone.id}\n${d.text}`);
                                assert.ok(!d.text.includes('{') && !d.text.includes('undefined'));
                                assert.ok(!/\bAI\b/i.test(d.text));
                                checked += 1;
                            });
                        }
                    }
                }
            }
        }
    }
    assert.ok(checked > 1000, `조합 ${checked}개`);
});

test('언급할 내용은 사용자가 고른 단어만 초안에 들어간다', () => {
    const none = generateReplies(base());
    none.forEach((d) => assert.ok(!d.text.includes('파스타') && !d.text.includes('분위기')));

    const picked = generateReplies(base({ mentions: ['분위기'] }));
    picked.forEach((d) => {
        assert.ok(d.text.includes('분위기'));
        assert.ok(!d.text.includes('파스타'));
    });

    const complaint = generateReplies(base({ sentiment: 'complaint', complaintType: 'wait', mentions: ['웨이팅'] }));
    complaint.forEach((d) => assert.ok(d.text.includes('웨이팅')));

    assert.deepEqual(parseMentions(' 파스타, 파스타 ,분위기,,커피,라떼 '), ['파스타', '분위기', '커피']);
    assert.equal(josa('파스타', '을/를'), '를');
    assert.equal(josa('라면', '을/를'), '을');
    assert.equal(josa('서울', '으로/로'), '로');
    assert.equal(josa('분위기', '이/가'), '가');
});

test('병원·의원 초안은 방문 사실을 확인하지 않고 직접 문의를 안내한다', () => {
    for (const sentiment of SENTIMENTS) {
        const drafts = generateReplies(base({ industry: 'clinic', sentiment: sentiment.id, complaintType: 'service' }));
        drafts.forEach((d) => {
            assert.ok(!d.text.includes('방문'), d.text);
            assert.match(d.text, /직접 문의/);
        });
    }
});

test('개인정보: 전화번호·계좌번호·이메일·실명 호칭을 찾는다', () => {
    assert.ok(ids(checkPolicy('전화는 010-1234-5678로 주세요')).includes('phone'));
    assert.ok(ids(checkPolicy('문의는 02-123-4567 입니다')).includes('phone'));
    assert.ok(ids(checkPolicy('01012345678')).includes('phone'));
    assert.ok(ids(checkPolicy('대표번호 1588-1234')).includes('phone'));
    const account = checkPolicy('환불은 국민 12345678901 계좌로, 또는 110-123-456789');
    assert.ok(ids(account).includes('account'));
    assert.ok(!ids(checkPolicy('연락처 010-1234-5678')).includes('account'), '전화번호는 계좌로 중복 표시하지 않는다');
    assert.ok(ids(checkPolicy('메일은 shop@example.com 으로')).includes('email'));
    assert.ok(ids(checkPolicy('김민수님 감사합니다')).includes('name'));
    assert.ok(ids(checkPolicy('박서준 고객님 방문 감사합니다')).includes('name'));
    assert.ok(ids(checkPolicy('○○님 감사합니다')).includes('name-placeholder'));
});

test('작성자 특정: 방문 일시·좌석 번호·주문 내역 표현을 찾는다', () => {
    assert.ok(ids(checkPolicy('어제 7시에 오신 분이시죠')).includes('visit-time'));
    assert.ok(ids(checkPolicy('지난주 토요일 저녁에 방문하신 손님')).includes('visit-time'));
    assert.ok(ids(checkPolicy('3번 테이블 손님께서')).includes('seat'));
    assert.ok(ids(checkPolicy('주문하신 크림파스타가 늦어져서')).includes('order-detail'));
    assert.ok(ids(checkPolicy('예약 내역을 확인해 보니')).includes('record'));
    assert.ok(ids(checkPolicy('CCTV를 확인했습니다')).includes('record'));
});

test('비방·탓하기·위협 표현을 찾는다', () => {
    assert.ok(ids(checkPolicy('거짓말을 하시면 안 됩니다')).includes('abuse'));
    assert.ok(ids(checkPolicy('이런 진상 손님은 처음입니다')).includes('abuse'));
    assert.ok(ids(checkPolicy('허위 리뷰입니다')).includes('abuse'));
    assert.ok(ids(checkPolicy('고객님께서 오해하신 것 같습니다')).includes('blame'));
    assert.ok(ids(checkPolicy('고객님 탓이 큽니다')).includes('blame'));
    assert.ok(ids(checkPolicy('법적 조치를 하겠습니다')).includes('threat'));
});

test('리뷰·별점 수정 요구와 대가 약속을 찾는다', () => {
    const edit = checkPolicy('리뷰 수정해 주시면 감사하겠습니다');
    assert.ok(ids(edit).includes('edit-request'));
    assert.equal(edit.find((f) => f.id === 'edit-request').severity, 'danger');

    const reward = checkPolicy('삭제해 주시면 환불해 드리겠습니다');
    assert.ok(ids(reward).includes('reward-for-edit'));
    assert.ok(!ids(reward).includes('edit-request'), '같은 자리는 더 구체적인 규칙 하나로만 표시한다');

    assert.ok(ids(checkPolicy('별점 5점 부탁드립니다')).includes('score-request'));
    assert.ok(ids(checkPolicy('별점을 올려 주세요')).includes('score-request'));
});

test('환불·보상 약속은 주의, 병원 효과 단정은 병원일 때만 주의로 표시한다', () => {
    const refund = checkPolicy('전액 환불해 드리겠습니다');
    assert.ok(ids(refund).includes('refund-promise'));
    assert.equal(refund.find((f) => f.id === 'refund-promise').severity, 'warn');

    const effect = '100% 완치됩니다. 부작용이 전혀 없습니다.';
    assert.ok(ids(checkPolicy(effect, { industry: 'clinic' })).includes('medical-effect'));
    assert.ok(!ids(checkPolicy(effect, { industry: 'restaurant' })).includes('medical-effect'));

    const clinic = checkPolicy('안녕하세요.', { industry: 'clinic' });
    assert.deepEqual(ids(clinic), ['medical-notice']);
    assert.equal(clinic[0].severity, 'info');
    assert.match(clinic[0].reason, /직접 검토/);
    assert.deepEqual(checkPolicy('안녕하세요.', { industry: 'cafe' }), []);
});

test('정상적인 답글 문장은 걸리지 않는다', () => {
    const normal = [
        '안녕하세요, 다온식당입니다. 소중한 리뷰를 남겨 주셔서 진심으로 감사드립니다.',
        '고객님의 말씀을 가볍게 넘기지 않고 직원들과 함께 돌아보겠습니다.',
        '사장님과 직원 모두 기쁜 마음입니다. 다음에 또 찾아 주세요.',
        '원장님께도 전해 드리겠습니다. 감사합니다.',
        '기다리시는 시간이 길게 느껴지셨다니 마음이 무겁습니다. 대기 안내를 점검하겠습니다.',
        '저희 매장은 매일 오전 11시에 문을 엽니다. 편하게 들러 주세요.',
        '리뷰를 남겨 주셔서 감사합니다. 다음에는 더 좋은 모습으로 맞이하겠습니다.',
        '메뉴 구성은 계절마다 조금씩 바뀝니다. 좋은 하루 보내세요.',
        '정말 감사합니다 고객님. 항상 노력하겠습니다.',
        '기대에 못 미친 부분은 바로 살펴보겠습니다.',
        '고소한 맛을 좋게 봐 주셔서 기쁩니다. 매너 만점 직원이 되도록 노력하겠습니다.',
        '고객님께 불편을 드려 죄송합니다.',
    ];
    normal.forEach((text) => assert.deepEqual(checkPolicy(text), [], text));
});

test('입력 점검: 빈 입력, 5자 미만, 1000자 초과', () => {
    assert.equal(validateReview('').code, 'empty');
    assert.equal(validateReview('   \n  ').code, 'empty');
    assert.equal(validateReview('맛있어').code, 'short');
    assert.equal(validateReview('맛있어요!').ok, true);
    assert.equal(validateReview('가'.repeat(MAX_REVIEW_LENGTH)).ok, true);
    const tooLong = validateReview('가'.repeat(MAX_REVIEW_LENGTH + 1));
    assert.equal(tooLong.code, 'long');
    assert.match(tooLong.message, /1,000자/);
    assert.deepEqual(generateReplies(base({ review: '' })), []);
    assert.deepEqual(generateReplies(base({ review: '네' })), []);
});

test('성격·불만 유형 자동 추정', () => {
    assert.equal(detectSentiment(REVIEW), 'praise');
    assert.equal(detectSentiment('1시간을 기다렸는데 직원은 불친절하고 음식은 식어서 실망했어요'), 'complaint');
    assert.equal(detectSentiment('친절하지 않았어요'), 'complaint');
    assert.equal(detectSentiment('맛있지만 대기가 길어서 아쉬웠어요'), 'neutral');
    assert.equal(detectSentiment('그냥 평범해요 무난합니다'), 'neutral');

    assert.equal(detectComplaintType('머리카락이 나왔어요'), 'hygiene');
    assert.equal(detectComplaintType('한 시간 넘게 기다렸어요'), 'wait');
    assert.equal(detectComplaintType('너무 비싸요'), 'price');
    assert.equal(detectComplaintType('직원 태도가 별로였어요'), 'service');
    assert.equal(detectComplaintType('음식이 식어서 나왔어요'), 'taste');
    assert.equal(detectComplaintType('주차가 불편했어요'), 'etc');
});

test('언급 후보 단어는 리뷰 본문에서 조사·서술어를 뺀 명사 위주로 뽑는다', () => {
    const candidates = extractMentionCandidates('파스타가 정말 맛있었고 분위기도 좋았어요. 화장실이 깨끗했습니다.');
    assert.ok(candidates.includes('파스타'));
    assert.ok(candidates.includes('분위기'));
    assert.ok(candidates.includes('화장실'));
    assert.ok(!candidates.includes('맛있었고'));
    assert.ok(!candidates.includes('정말'));
    assert.ok(candidates.length <= 8);
});

test('근거 출처와 화면용 문구에 AI 표현이 없다', () => {
    assert.equal(POLICY_SOURCES.length, 2);
    POLICY_SOURCES.forEach((s) => {
        assert.match(s.url, /^https:\/\//);
        assert.ok(!/\bAI\b/i.test(`${s.title}${s.summary}`));
    });
    const reasons = checkPolicy('010-1234-5678 거짓말 리뷰 수정 환불 100% 완치', { industry: 'clinic' }).map((f) => f.reason).join('');
    assert.ok(!/\bAI\b/i.test(reasons));
});
