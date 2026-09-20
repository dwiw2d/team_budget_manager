import { describe, expect, it } from "vitest";
import { JUST_UPDATED_WINDOW_MS, shouldSkipGate } from "./startup";

const NOW = 1_700_000_000_000;
const base = { online: true, pathname: "/", pickingPhoto: false, justUpdatedAt: 0, now: NOW };

describe("shouldSkipGate", () => {
  it("평소에는 관문을 돈다", () => {
    expect(shouldSkipGate(base)).toBe(false);
    expect(shouldSkipGate({ ...base, pathname: "/payments" })).toBe(false);
    // 경로 끝만 보므로 다른 화면 이름에 add 가 들어가도 걸리지 않는다
    expect(shouldSkipGate({ ...base, pathname: "/added" })).toBe(false);
  });

  it("오프라인이면 건너뛴다", () => {
    expect(shouldSkipGate({ ...base, online: false })).toBe(true);
  });

  it("결제 추가 화면이면 건너뛴다(배포 하위 경로와 끝 슬래시 포함)", () => {
    expect(shouldSkipGate({ ...base, pathname: "/add" })).toBe(true);
    expect(shouldSkipGate({ ...base, pathname: "/team_budget_manager/add" })).toBe(true);
    expect(shouldSkipGate({ ...base, pathname: "/add/" })).toBe(true);
  });

  it("사진 선택기 표시가 있으면 건너뛴다", () => {
    expect(shouldSkipGate({ ...base, pickingPhoto: true })).toBe(true);
  });

  it("업데이트 적용 직후 잠깐만 건너뛰고, 창이 지나면 다시 검사한다", () => {
    expect(shouldSkipGate({ ...base, justUpdatedAt: NOW })).toBe(true);
    expect(shouldSkipGate({ ...base, justUpdatedAt: NOW - JUST_UPDATED_WINDOW_MS + 500 })).toBe(true);
    expect(shouldSkipGate({ ...base, justUpdatedAt: NOW - JUST_UPDATED_WINDOW_MS })).toBe(false);
    // 표시가 아예 없으면(0) 아주 옛날로 보여 건너뛰지 않는다
    expect(shouldSkipGate({ ...base, justUpdatedAt: 0 })).toBe(false);
  });
});
