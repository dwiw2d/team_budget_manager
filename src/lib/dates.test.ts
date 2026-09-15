import { describe, expect, it } from "vitest";
import {
  addMonths,
  formatKst,
  fromDatetimeLocal,
  monthLabel,
  monthRange,
  toDatetimeLocal,
  todayKst,
} from "./dates";

describe("monthRange", () => {
  it("그 달 1일 00:00+09:00 부터 다음 달 1일 00:00+09:00 까지", () => {
    expect(monthRange(2026, 9)).toEqual({
      startIso: "2026-09-01T00:00:00+09:00",
      endIso: "2026-10-01T00:00:00+09:00",
    });
  });
  it("12월은 다음 해 1월로 넘어간다", () => {
    expect(monthRange(2026, 12)).toEqual({
      startIso: "2026-12-01T00:00:00+09:00",
      endIso: "2027-01-01T00:00:00+09:00",
    });
  });
});

describe("addMonths", () => {
  it("연도 경계를 넘는다", () => {
    expect(addMonths(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(addMonths(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(addMonths(2026, 9, 0)).toEqual({ year: 2026, month: 9 });
  });
});

describe("todayKst", () => {
  it("UTC 자정 직전은 KST 로는 다음 날이다", () => {
    expect(todayKst(new Date("2026-09-30T15:00:00Z"))).toBe("2026-10-01");
    expect(todayKst(new Date("2026-09-30T14:59:59Z"))).toBe("2026-09-30");
    expect(todayKst(new Date("2026-12-31T15:00:00Z"))).toBe("2027-01-01");
  });
});

describe("datetime-local 변환", () => {
  it("ISO(+09:00) → datetime-local", () => {
    expect(toDatetimeLocal("2026-09-16T14:05:00+09:00")).toBe("2026-09-16T14:05");
    expect(toDatetimeLocal("2026-12-31T15:00:00Z")).toBe("2027-01-01T00:00");
    expect(toDatetimeLocal("2026-12-31T14:59:00Z")).toBe("2026-12-31T23:59");
  });
  it("datetime-local → ISO(+09:00)", () => {
    expect(fromDatetimeLocal("2026-09-16T14:05")).toBe("2026-09-16T14:05:00+09:00");
    expect(fromDatetimeLocal("2026-09-16T14:05:30")).toBe("2026-09-16T14:05:30+09:00");
  });
  it("왕복하면 같은 시각이다", () => {
    const iso = fromDatetimeLocal("2026-12-31T23:59");
    expect(new Date(iso).toISOString()).toBe("2026-12-31T14:59:00.000Z");
    expect(toDatetimeLocal(iso)).toBe("2026-12-31T23:59");
  });
});

describe("표시", () => {
  it("formatKst", () => {
    expect(formatKst("2026-09-16T14:05:00+09:00")).toBe("9월 16일 14:05");
    expect(formatKst("2026-09-16T05:05:00Z")).toBe("9월 16일 14:05");
    expect(formatKst("2026-12-31T15:00:00Z")).toBe("1월 1일 00:00");
  });
  it("monthLabel", () => {
    expect(monthLabel(2026, 9)).toBe("2026년 9월");
  });
});
