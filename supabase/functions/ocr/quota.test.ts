import { describe, expect, it } from "vitest";
import { decideProviders, isQuotaExceeded, type OcrQuota, type ProviderQuota } from "./quota.ts";

const provider = (available: boolean, over: Partial<ProviderQuota> = {}): ProviderQuota => ({
  provider: "clova",
  period: "2026-09",
  used: available ? 3 : 100,
  limit_count: 100,
  remaining: available ? 97 : 0,
  available,
  ...over,
});

const quota = (clova: boolean, gemini: boolean): OcrQuota => ({
  available: clova || gemini,
  clova: provider(clova),
  gemini: provider(gemini, { provider: "gemini", period: "2026-09-17", limit_count: 20 }),
});

describe("decideProviders", () => {
  it("둘 다 남았으면 둘 다 부를 수 있다", () => {
    expect(decideProviders(quota(true, true))).toEqual({ clova: true, gemini: true, blocked: false });
  });

  it("Gemini 만 소진이면 CLOVA 만 부른다", () => {
    expect(decideProviders(quota(true, false))).toEqual({ clova: true, gemini: false, blocked: false });
  });

  it("CLOVA 만 소진이면 Gemini 만 부른다(주 엔진이 된다)", () => {
    expect(decideProviders(quota(false, true))).toEqual({ clova: false, gemini: true, blocked: false });
  });

  it("둘 다 소진이면 아무것도 부르지 않는다", () => {
    expect(decideProviders(quota(false, false))).toEqual({ clova: false, gemini: false, blocked: true });
  });

  it("한도 상태를 못 읽었으면 선차감도 못 하므로 둘 다 막는다", () => {
    expect(decideProviders(null)).toEqual({ clova: false, gemini: false, blocked: true });
  });
});

describe("isQuotaExceeded", () => {
  it("HTTP 429 는 본문과 무관하게 한도 초과다", () => {
    expect(isQuotaExceeded(429, null)).toBe(true);
  });

  it("오류 응답의 코드·메시지에 한도를 뜻하는 낱말이 있으면 한도 초과다", () => {
    expect(isQuotaExceeded(403, { code: "QUOTA_EXCEEDED" })).toBe(true);
    expect(isQuotaExceeded(400, { message: "월 사용량을 초과했습니다" })).toBe(true);
    expect(isQuotaExceeded(400, { errorMessage: "rate limit reached" })).toBe(true);
  });

  it("그 밖의 실패는 한도 초과가 아니다(평소의 폴백 경로를 탄다)", () => {
    expect(isQuotaExceeded(500, { message: "internal error" })).toBe(false);
    expect(isQuotaExceeded(401, { code: "UNAUTHORIZED" })).toBe(false);
    expect(isQuotaExceeded(200, { message: "limit" })).toBe(false);
  });
});
