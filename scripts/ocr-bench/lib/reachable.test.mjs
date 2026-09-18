import test from 'node:test';
import assert from 'node:assert/strict';
import { isReachable } from './reachable.mjs';

test('merchant 는 공백을 무시하고 줄 안에 있으면 도달 가능', () => {
  assert.equal(isReachable('merchant', '동 남 집', ['상호: 동남집']), true);
  assert.equal(isReachable('merchant', '스타벅스', ['STARBUCKS', '합계 5,000']), false);
});

test('merchant 가 두 줄에 걸치면 도달 불가로 센다', () => {
  assert.equal(isReachable('merchant', '파리바게뜨 여의도KBS점', ['여의도KBS점', '파리바게뜨']), false);
});

test('amount 는 자릿수 구분 기호를 무시한다', () => {
  assert.equal(isReachable('amount', 21000, ['합계 21,000원']), true);
  assert.equal(isReachable('amount', 4400, ['4 4 0 0']), true);
  assert.equal(isReachable('amount', 59000, ['합계 21,000원']), false);
});

test('paidAt 은 0 없는 한글 날짜도 같은 날짜로 본다', () => {
  const want = '2021-04-19T00:00:00+09:00';
  assert.equal(isReachable('paidAt', want, ['2021년 4월 19일']), true);
  assert.equal(isReachable('paidAt', want, ['2021-04-19 14:30:01']), true);
  assert.equal(isReachable('paidAt', want, ['21.04.19']), true);
  assert.equal(isReachable('paidAt', want, ['20210419']), true);
  assert.equal(isReachable('paidAt', want, ['2021-07-22']), false);
});

test('paidAt 의 두 자리 연도가 다른 숫자 뒤에 붙으면 날짜로 세지 않는다', () => {
  assert.equal(isReachable('paidAt', '2021-04-19T00:00:00+09:00', ['승인번호 1234521-04-19']), false);
});

test('cardNumber 는 마스킹 문자를 * 로 통일해 본다', () => {
  assert.equal(isReachable('cardNumber', '413720****', ['[카드번호]   413720****....']), true);
  assert.equal(isReachable('cardNumber', '4137-20XX-XXXX-1234', ['4137 20** **** 1234']), true);
  assert.equal(isReachable('cardNumber', '413720****', ['[카드번호] 판독 불가']), false);
});
