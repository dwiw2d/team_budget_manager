import test from 'node:test';
import assert from 'node:assert/strict';
import { extract, linesFromFields } from './clova-general-extract.mjs';
import { receipt1Fields, receipt2Fields } from './clova-general-fixtures.mjs';

test('receipt-1: KIS VAN 승인전표에서 네 필드를 뽑는다', () => {
  assert.deepEqual(extract(receipt1Fields), {
    merchant: '동남집',
    paidAt: '2026-09-04T12:06:09+09:00',
    amount: 59000,
    cardNumber: '4265-86**-****-****',
  });
});

test('receipt-2: POS 카드판매 영수증에서 네 필드를 뽑는다', () => {
  assert.deepEqual(extract(receipt2Fields), {
    merchant: '세상끝의라멘',
    paidAt: '2026-09-15T12:38:27+09:00',
    amount: 36000,
    cardNumber: '42658698********',
  });
});

test('금액 함정: 공급가/부가세/단가/품목합계를 총액으로 고르지 않는다', () => {
  for (const trap of [53636, 5364]) assert.notEqual(extract(receipt1Fields).amount, trap);
  for (const trap of [32727, 3273, 11000, 33000]) assert.notEqual(extract(receipt2Fields).amount, trap);
});

test('가맹점 함정: 안내 문구·표 머리글·VAN사·카드사 이름을 상호로 고르지 않는다', () => {
  const picked = [extract(receipt1Fields).merchant, extract(receipt2Fields).merchant];
  for (const trap of ['주소가 실제와 다른경우', '테이블명: 1T', 'KIS정보통신', 'KB국민카드']) {
    assert.ok(!picked.includes(trap), `${trap} 를 상호로 골랐다`);
  }
});

test('시각 함정: 조각으로 쪼개진 판매시간을 자정으로 뭉개지 않는다', () => {
  // "판매시간:" "20260915" "12:38:" "27" 이 네 조각이다. 날짜만 읽고 끝내면 00:00:00 이 된다.
  assert.ok(!extract(receipt2Fields).paidAt.endsWith('T00:00:00+09:00'));
});

test('카드번호 함정: 사업자번호·VANKEY·전표일련번호를 카드번호로 고르지 않는다', () => {
  assert.notEqual(extract(receipt1Fields).cardNumber, '1122334455667788');
  assert.notEqual(extract(receipt2Fields).cardNumber, '123-45-67890');
  assert.notEqual(extract(receipt2Fields).cardNumber, '2026091599999999');
});

test('두 영수증 모두 카드번호 뒤 4자리가 마스킹돼 있다', () => {
  // 앱의 카드 자동 선택은 뒤 4자리를 쓰는데, 이 표본으로는 못 쓴다.
  for (const fields of [receipt1Fields, receipt2Fields]) {
    assert.ok(extract(fields).cardNumber.endsWith('****'));
  }
});

test('linesFromFields: 좌우로 갈라진 라벨과 값을 한 줄로 합친다', () => {
  // 실제 응답은 "합계:" 와 "59,000원" 이 서로 다른 lineBreak 묶음으로 떨어져 나온다.
  const texts = linesFromFields(receipt1Fields).map((l) => l.text);
  assert.ok(texts.includes('합계: 59,000원'), texts.join(' / '));
  assert.ok(texts.includes('홍길동 (TEL: 0212341234) 동남집'), texts.join(' / '));
  assert.equal(texts.length, 20);
});

test('linesFromFields: 나오는 순서가 뒤엉켜도 세로 중심으로 줄을 맞춘다', () => {
  // receipt-2 는 "공급가"(56번째 조각)와 그 값 "32,727"(76번째)이 멀찍이 떨어져 나온다.
  const texts = linesFromFields(receipt2Fields).map((l) => l.text);
  assert.ok(texts.includes('공급가 32,727'), texts.join(' / '));
  assert.ok(texts.includes('판매시간: 20260915 12:38: 27 (POS100)'), texts.join(' / '));
  assert.equal(texts.length, 25);
});

test('읽을 수 없으면 그 항목만 null 이다', () => {
  assert.deepEqual(extract([]), { merchant: null, paidAt: null, amount: null, cardNumber: null });
});

test('상호를 못 찾으면 억지로 고르지 않고 null 을 준다', () => {
  const noMerchant = receipt2Fields.filter((f) => f.inferText !== '세상끝의라멘');
  assert.equal(extract(noMerchant).merchant, null);
  assert.equal(extract(noMerchant).amount, 36000); // 나머지 필드는 그대로 나온다
});
