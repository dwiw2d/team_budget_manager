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
  const traps1 = [53636, 5364];
  const traps2 = [32727, 3273, 11000, 33000, 3000, 1000];
  assert.ok(!traps1.includes(extract(receipt1Fields).amount));
  assert.ok(!traps2.includes(extract(receipt2Fields).amount));
});

test('가맹점 함정: VAN사·카드사 이름을 가맹점으로 고르지 않는다', () => {
  for (const fields of [receipt1Fields, receipt2Fields]) {
    const m = extract(fields).merchant;
    for (const bad of ['KIS', '국민카드', '영수증', '승인', '고객용', '회원용']) {
      assert.ok(!m.includes(bad), `${m} 에 ${bad} 가 들어있다`);
    }
  }
});

test('카드번호 함정: 사업자번호·VANKEY·전표일련번호를 카드번호로 고르지 않는다', () => {
  assert.notEqual(extract(receipt1Fields).cardNumber, '0247048435694933');
  assert.notEqual(extract(receipt2Fields).cardNumber, '741-11-00825');
  assert.notEqual(extract(receipt2Fields).cardNumber, '2026091510000016');
});

test('두 영수증 모두 카드번호 뒤 4자리가 마스킹돼 있다', () => {
  // 앱의 카드 자동 선택은 뒤 4자리를 쓰는데, 이 표본으로는 못 쓴다.
  for (const fields of [receipt1Fields, receipt2Fields]) {
    assert.ok(extract(fields).cardNumber.endsWith('****'));
  }
});

test('linesFromFields: lineBreak 로 줄을 끊고 줄마다 높이를 남긴다', () => {
  const lines = linesFromFields(receipt2Fields);
  assert.equal(lines.length, 24);
  assert.equal(lines[1].text, '세상끝의라멘');
  assert.equal(lines[1].height, 34); // 가맹점 추정에 쓰는 글자 높이
  assert.ok(lines[0].height < lines[1].height);
});

test('linesFromFields: lineBreak 가 빠져도 세로 좌표로 줄을 끊는다', () => {
  const broken = receipt2Fields.map((f) => ({ ...f, lineBreak: false }));
  assert.equal(linesFromFields(broken).length, linesFromFields(receipt2Fields).length);
});

test('읽을 수 없으면 그 항목만 null 이다', () => {
  assert.deepEqual(extract([]), { merchant: null, paidAt: null, amount: null, cardNumber: null });
});
