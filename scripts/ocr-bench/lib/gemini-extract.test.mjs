import { test } from "node:test";
import assert from "node:assert/strict";

import { buildRequest, parseResponse, normalizePaidAt, RECEIPT_SCHEMA, PROMPT } from "./gemini-extract.mjs";
import {
  receipt1Clean,
  receipt1Expected,
  receipt2Messy,
  receipt2Expected,
  blocked,
} from "./gemini-fixtures.mjs";

test("깔끔한 응답을 그대로 네 필드로 읽는다", () => {
  assert.deepEqual(parseResponse(receipt1Clean), receipt1Expected);
});

test("코드 블록·쉼표 금액·시각 없는 날짜를 견딘다", () => {
  assert.deepEqual(parseResponse(receipt2Messy), receipt2Expected);
});

test("텍스트가 없는 응답은 사유와 함께 던진다", () => {
  assert.throws(() => parseResponse(blocked), /SAFETY/);
});

test("두 자리 연도는 2000년대로 편다", () => {
  assert.equal(normalizePaidAt("26/09/04 12:06:09"), "2026-09-04T12:06:09+09:00");
});

test("시간대가 이미 있으면 유지한다", () => {
  assert.equal(normalizePaidAt("2026-09-15T12:38:31+09:00"), "2026-09-15T12:38:31+09:00");
  assert.equal(normalizePaidAt("2026-09-15T03:38:31Z"), "2026-09-15T03:38:31+00:00");
});

test("읽지 못한 항목은 null 이 된다", () => {
  const response = {
    candidates: [{ content: { parts: [{ text: '{"merchant":"","paidAt":null,"amount":null,"cardNumber":null}' }] } }],
  };
  assert.deepEqual(parseResponse(response), {
    merchant: null,
    paidAt: null,
    amount: null,
    cardNumber: null,
  });
});

test("buildRequest 가 이미지와 프롬프트를 담는다", () => {
  const body = buildRequest("QUJD", "image/png");
  const [promptPart, imagePart] = body.contents[0].parts;

  assert.equal(promptPart.text, PROMPT);
  assert.deepEqual(imagePart.inline_data, { mime_type: "image/png", data: "QUJD" });
});

test("buildRequest 가 네 필드짜리 구조화 출력을 지정한다", () => {
  const { generationConfig } = buildRequest("QUJD", "image/jpeg");

  assert.equal(generationConfig.response_mime_type, "application/json");
  assert.equal(generationConfig.response_schema, RECEIPT_SCHEMA);
  assert.deepEqual(Object.keys(RECEIPT_SCHEMA.properties), ["merchant", "paidAt", "amount", "cardNumber"]);
  assert.ok(Object.values(RECEIPT_SCHEMA.properties).every((p) => p.nullable === true));
});

test("프롬프트가 가맹점·총액 함정을 짚는다", () => {
  assert.match(PROMPT, /VAN/);
  assert.match(PROMPT, /공급가/);
  assert.match(PROMPT, /2000년대/);
});
