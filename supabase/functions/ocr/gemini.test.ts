import { describe, expect, it } from "vitest";
import {
  buildRequest,
  DEFAULT_MODEL,
  modelChain,
  normalizePaidAt,
  parseResponse,
  PROMPT,
  RECEIPT_SCHEMA,
  RETRY_DELAYS_MS,
  shouldRetry,
} from "./gemini.ts";
import {
  blocked,
  receipt1Clean,
  receipt1Expected,
  receipt2Expected,
  receipt2Messy,
} from "./gemini.fixtures.ts";

describe("parseResponse", () => {
  it("깔끔한 응답을 그대로 네 필드로 읽는다", () => {
    expect(parseResponse(receipt1Clean)).toEqual(receipt1Expected);
  });

  it("코드 블록·쉼표 금액·시각 없는 날짜를 견딘다", () => {
    expect(parseResponse(receipt2Messy)).toEqual(receipt2Expected);
  });

  it("텍스트가 없는 응답은 사유와 함께 던진다", () => {
    expect(() => parseResponse(blocked)).toThrow(/SAFETY/);
  });

  it("읽지 못한 항목은 null 이 된다", () => {
    const response = {
      candidates: [
        { content: { parts: [{ text: '{"merchant":"","paidAt":null,"amount":null,"cardNumber":null}' }] } },
      ],
    };
    expect(parseResponse(response)).toEqual({
      merchant: null,
      paidAt: null,
      amount: null,
      cardNumber: null,
    });
  });
});

describe("normalizePaidAt", () => {
  it("두 자리 연도는 2000년대로 편다", () => {
    expect(normalizePaidAt("26/09/04 12:06:09")).toBe("2026-09-04T12:06:09+09:00");
  });

  it("시간대가 이미 있으면 유지한다", () => {
    expect(normalizePaidAt("2026-09-15T12:38:31+09:00")).toBe("2026-09-15T12:38:31+09:00");
    expect(normalizePaidAt("2026-09-15T03:38:31Z")).toBe("2026-09-15T03:38:31+00:00");
  });
});

describe("buildRequest", () => {
  it("이미지와 프롬프트를 담는다", () => {
    const [promptPart, imagePart] = buildRequest("QUJD", "image/png").contents[0].parts;

    expect(promptPart.text).toBe(PROMPT);
    expect(imagePart.inline_data).toEqual({ mime_type: "image/png", data: "QUJD" });
  });

  it("네 필드짜리 구조화 출력을 지정한다", () => {
    const { generationConfig } = buildRequest("QUJD", "image/jpeg");

    expect(generationConfig.response_mime_type).toBe("application/json");
    expect(generationConfig.response_schema).toBe(RECEIPT_SCHEMA);
    expect(Object.keys(RECEIPT_SCHEMA.properties)).toEqual(["merchant", "paidAt", "amount", "cardNumber"]);
    expect(Object.values(RECEIPT_SCHEMA.properties).every((p) => p.nullable)).toBe(true);
  });
});

it("프롬프트가 가맹점·총액 함정을 짚는다", () => {
  expect(PROMPT).toMatch(/VAN/);
  expect(PROMPT).toMatch(/공급가/);
  expect(PROMPT).toMatch(/2000년대/);
});

describe("shouldRetry", () => {
  it("503·500 은 모델 과부하라 다시 부른다", () => {
    expect(shouldRetry(503)).toBe(true);
    expect(shouldRetry(500)).toBe(true);
  });

  it("429·400·401 은 다시 불러도 소용없다", () => {
    for (const status of [429, 400, 401, 403, 404]) expect(shouldRetry(status)).toBe(false);
  });

  it("재시도는 최대 2회 추가다(총 3회)", () => {
    expect(RETRY_DELAYS_MS).toHaveLength(2);
  });
});

describe("modelChain", () => {
  it("GEMINI_MODEL 을 첫째로 둔다", () => {
    expect(modelChain("gemini-2.5-flash")).toEqual([
      "gemini-2.5-flash",
      "gemini-3.5-flash",
      "gemini-flash-latest",
    ]);
  });

  it("GEMINI_MODEL 이 대체 목록과 겹치면 중복을 뺀다", () => {
    const chain = modelChain("gemini-3.5-flash");
    expect(chain[0]).toBe("gemini-3.5-flash");
    expect(new Set(chain).size).toBe(chain.length);
  });

  it("GEMINI_MODEL 이 비어 있어도 기본 모델로 목록을 만든다", () => {
    for (const env of [undefined, null, "", "   "]) {
      const chain = modelChain(env);
      expect(chain[0]).toBe(DEFAULT_MODEL);
      expect(new Set(chain).size).toBe(chain.length);
      expect(chain.length).toBeGreaterThan(1);
    }
  });
});
