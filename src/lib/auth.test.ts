import { expect, it } from "vitest";
import { isPin, onlyDigits } from "./auth";

it("숫자 6자리만 PIN 으로 인정한다", () => {
  expect(isPin("123456")).toBe(true);
  expect(isPin("12345")).toBe(false);
  expect(isPin("1234567")).toBe(false);
  expect(isPin("12a456")).toBe(false);
  expect(isPin("")).toBe(false);
});

it("입력에서 숫자만 남기고 6자리까지 자른다", () => {
  expect(onlyDigits("12-34ab56789")).toBe("123456");
  expect(onlyDigits("abc")).toBe("");
});
