import { describe, expect, it, vi } from "vitest";

// ocr.ts 는 supabase.ts 를 거쳐 VITE_ 환경 변수를 요구한다. 순수 함수만 보려고 값만 채우고 불러온다.
vi.stubEnv("VITE_SUPABASE_URL", "http://localhost:54321");
vi.stubEnv("VITE_SUPABASE_ANON_KEY", "test-anon-key");
const { ocrErrorCode } = await import("./ocr");

describe("ocrErrorCode", () => {
  it("429 ocr_quota_exceeded 는 한도 소진이다", () => {
    expect(ocrErrorCode(429, { error: "ocr_quota_exceeded" })).toBe("quota_exceeded");
    // 본문을 못 읽어도 이 함수의 429 는 한도뿐이다
    expect(ocrErrorCode(429, null)).toBe("quota_exceeded");
  });

  it("503 은 시크릿 미설정이다", () => {
    expect(ocrErrorCode(503, { error: "ocr_not_configured" })).toBe("not_configured");
  });

  it("그 밖의 HTTP 오류와 상태 코드를 못 읽은 경우는 failed 다", () => {
    expect(ocrErrorCode(502, { error: "ocr_failed" })).toBe("failed");
    expect(ocrErrorCode(401, null)).toBe("failed");
    expect(ocrErrorCode(429, { error: "too_many_requests" })).toBe("failed");
    expect(ocrErrorCode(undefined, null)).toBe("failed");
  });

  it("네트워크 실패는 상태 코드와 무관하게 network 다", () => {
    expect(ocrErrorCode(undefined, null, "FunctionsFetchError")).toBe("network");
  });
});
