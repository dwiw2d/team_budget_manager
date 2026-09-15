import { expect, it } from "vitest";
import { formatWon } from "./money";

it("원 단위 정수를 천 단위 구분자와 원 접미사로 표기한다", () => {
  expect(formatWon(1234567)).toBe("1,234,567원");
  expect(formatWon(0)).toBe("0원");
  expect(formatWon(999)).toBe("999원");
  expect(formatWon(-1234)).toBe("-1,234원");
});
