// 실행: node --no-warnings --test "tests/*.test.mjs"
// 회귀 방지: 관리자 주문 CSV 수식 주입, 서버 시간대에 따라 날짜가 하루 어긋나던 문제 — 2026-11-14 감사에서 발견
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    neutralizeFormula,
    csvCell,
    buildCsv,
    formatDateKST,
    formatDateTimeKST,
    kstDateStamp,
} from '../lib/csv.js';

test('= + - @ 탭 CR 로 시작하는 셀은 앞에 작은따옴표를 붙인다', () => {
    for (const text of ['=1+1', '+1', '-1', '@SUM(A1)', '\tcmd', '\rcmd', '=HYPERLINK("http://x","y")']) {
        assert.equal(neutralizeFormula(text), `'${text}`, JSON.stringify(text));
    }
});

test('일반 문자열과 중간에 기호가 있는 문자열은 그대로 둔다', () => {
    for (const text of ['카페 모카', 'a=b', '010-1234-5678', 'hello@example.com', '', ' =leading-space']) {
        assert.equal(neutralizeFormula(text), text, JSON.stringify(text));
    }
    assert.equal(neutralizeFormula(null), '');
    assert.equal(neutralizeFormula(undefined), '');
});

test('csvCell: 큰따옴표를 이스케이프하고 항상 따옴표로 감싼다', () => {
    assert.equal(csvCell('a"b'), '"a""b"');
    assert.equal(csvCell('a,b\nc'), '"a,b\nc"');
    assert.equal(csvCell('=1+1'), `"'=1+1"`);
    assert.equal(csvCell('="x"'), `"'=""x"""`);
});

test('csvCell: 숫자는 수식 방어 대상이 아니다 (음수 금액 보존)', () => {
    assert.equal(csvCell(30), '"30"');
    assert.equal(csvCell(-1500), '"-1500"');
    assert.equal(csvCell(0), '"0"');
});

test('buildCsv: BOM + 헤더 + 행, 사용자 입력 수식은 무력화', () => {
    const csv = buildCsv(['업체명', '키워드'], [['=cmd|"/c calc"!A1', '정상'], ['a"b', '+SUM(1)']]);
    assert.equal(csv.charCodeAt(0), 0xfeff);
    const lines = csv.slice(1).split('\n');
    assert.equal(lines[0], '"업체명","키워드"');
    assert.equal(lines[1], `"'=cmd|""/c calc""!A1","정상"`);
    assert.equal(lines[2], `"a""b","'+SUM(1)"`);
});

test('날짜는 서버 시간대와 무관하게 KST 로 표기한다', () => {
    // 2026-11-13T23:30:00Z = KST 11월 14일 08:30
    const d = '2026-11-13T23:30:00.000Z';
    assert.match(formatDateKST(d), /2026\D+11\D+14/);
    assert.doesNotMatch(formatDateKST(d), /13/);
    assert.match(formatDateTimeKST(d), /2026\D+11\D+14/);
    assert.match(formatDateTimeKST(d), /8:30|08:30/);
});

test('kstDateStamp: 파일명 날짜는 KST 기준 YYYY-MM-DD', () => {
    assert.equal(kstDateStamp(new Date('2026-11-13T23:30:00Z')), '2026-11-14');
    assert.equal(kstDateStamp(new Date('2026-11-14T14:59:59Z')), '2026-11-14');
    assert.equal(kstDateStamp(new Date('2026-11-14T15:00:00Z')), '2026-11-15');
});
