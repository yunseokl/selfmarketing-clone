// 사업자 정보 등록 요청 — 번호 검증과 문의 글 조립 검증
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    BUSINESS_REQUEST_PREFIX, normalizeBusinessNumber, formatBusinessNumber, isValidBusinessNumber,
    buildBusinessRequest, isBusinessRequest,
} from '../lib/business.js';
import { createInquirySchema } from '../lib/validations/support.js';

// 검증식을 통과하도록 만든 시험용 번호(실제 사업자와 무관)
const VALID_NUMBER = '1234567891';

test('사업자등록번호는 숫자만 남기고 3-2-5로 나눠 보여 준다', () => {
    assert.equal(normalizeBusinessNumber(' 123-45 67891 '), '1234567891');
    assert.equal(formatBusinessNumber('12'), '12');
    assert.equal(formatBusinessNumber('1234'), '123-4');
    assert.equal(formatBusinessNumber('1234567891'), '123-45-67891');
    assert.equal(formatBusinessNumber('12345678919999'), '123-45-67891');
});

test('검증 숫자가 맞는 10자리만 통과한다', () => {
    assert.equal(isValidBusinessNumber(VALID_NUMBER), true);
    assert.equal(isValidBusinessNumber('123-45-67891'), true);
    assert.equal(isValidBusinessNumber('1234567890'), false); // 마지막 자리만 다름
    assert.equal(isValidBusinessNumber('123456789'), false);
    assert.equal(isValidBusinessNumber('12345678912'), false);
    assert.equal(isValidBusinessNumber(''), false);
    assert.equal(isValidBusinessNumber(null), false);
});

test('빠진 항목은 항목별 안내로 돌려준다', () => {
    const result = buildBusinessRequest({ company: '', number: '111', owner: '', email: 'not-mail' });
    assert.equal(result.ok, false);
    assert.deepEqual(Object.keys(result.errors).sort(), ['company', 'email', 'number', 'owner']);
});

test('정상 입력은 문의 검증을 통과하는 제목·내용이 된다', () => {
    const result = buildBusinessRequest({
        company: ' 다온상회 ', number: VALID_NUMBER, owner: '홍길동', email: 'tax@example.com',
        businessType: '도소매 / 전자상거래', address: '',
    });
    assert.equal(result.ok, true);
    assert.equal(result.title, `${BUSINESS_REQUEST_PREFIX} - 다온상회`);
    assert.match(result.content, /사업자등록번호: 123-45-67891/);
    assert.match(result.content, /사업장 주소: \(입력 안 함\)/);
    assert.equal(createInquirySchema.safeParse({ category: 'payment', title: result.title, content: result.content }).success, true);
});

test('입력 한도까지 채워도 문의 길이 제한을 넘지 않는다', () => {
    const result = buildBusinessRequest({
        company: '가'.repeat(60), number: VALID_NUMBER, owner: '나'.repeat(30), email: `${'a'.repeat(88)}@example.com`,
        businessType: '다'.repeat(60), address: '라'.repeat(150),
    });
    assert.equal(result.ok, true);
    assert.equal(createInquirySchema.safeParse({ category: 'payment', title: result.title, content: result.content }).success, true);
    assert.equal(buildBusinessRequest({ company: '가'.repeat(61), number: VALID_NUMBER, owner: '홍길동', email: 'a@b.co' }).ok, false);
});

test('사업자 등록 요청 문의만 골라낸다', () => {
    assert.equal(isBusinessRequest({ title: `${BUSINESS_REQUEST_PREFIX} - 다온상회` }), true);
    assert.equal(isBusinessRequest({ title: '세금계산서 문의' }), false);
    assert.equal(isBusinessRequest(null), false);
});
