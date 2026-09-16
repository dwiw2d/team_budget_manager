import test from 'node:test';
import assert from 'node:assert/strict';
import { extract } from './azure-receipt-extract.mjs';
import { receipt1Response, receipt2Response } from './azure-receipt-fixtures.mjs';

test('receipt-1 (동남집) 네 필드', () => {
  assert.deepEqual(extract(receipt1Response), {
    merchant: '동남집',
    paidAt: '2026-09-04T12:06:09+09:00',
    amount: 59000,
    cardNumber: null,
  });
});

test('receipt-2 (세상끝의라멘) 네 필드', () => {
  assert.deepEqual(extract(receipt2Response), {
    merchant: '세상끝의라멘',
    paidAt: '2026-09-15T12:38:27+09:00',
    amount: 36000,
    cardNumber: null,
  });
});

test('Total 이 없으면 Subtotal 로 대체하지 않고 null', () => {
  const noTotal = structuredClone(receipt2Response);
  delete noTotal.analyzeResult.documents[0].fields.Total;

  const got = extract(noTotal);
  assert.equal(got.amount, null);
  assert.notEqual(got.amount, 32727); // Subtotal
  assert.notEqual(got.amount, 36000); // Payments[0].Amount
});

test('TransactionTime 이 없으면 00:00:00', () => {
  const noTime = structuredClone(receipt1Response);
  delete noTime.analyzeResult.documents[0].fields.TransactionTime;

  assert.equal(extract(noTime).paidAt, '2026-09-04T00:00:00+09:00');
});

test('문서를 하나도 못 찾으면 전부 null', () => {
  const empty = { status: 'succeeded', analyzeResult: { modelId: 'prebuilt-receipt', documents: [] } };

  assert.deepEqual(extract(empty), {
    merchant: null,
    paidAt: null,
    amount: null,
    cardNumber: null,
  });
});
