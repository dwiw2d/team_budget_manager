import { describe, expect, it } from "vitest";
import { autoCardId } from "./cards";

const cards = [
  { id: "a", card_prefix: "426586" },
  { id: "b", card_prefix: "53012345" },
  { id: "c", card_prefix: null },
];

describe("autoCardId", () => {
  it("실측 마스킹 패턴 두 가지에서 앞자리로 카드를 고른다", () => {
    expect(autoCardId(cards, "4265-86**-****-****")).toBe("a");
    expect(autoCardId(cards, "42658698********")).toBe("a");
  });

  it("비교 길이는 둘 중 짧은 쪽이다", () => {
    // 카드 앞자리 8, 읽은 번호 6 -> 앞 6자리만 비교한다.
    expect(autoCardId(cards, "5301-23**-****-****")).toBe("b");
    // 카드 앞자리 6, 읽은 번호 8 -> 앞 6자리만 비교한다.
    expect(autoCardId(cards, "42658698********")).toBe("a");
  });

  it("두 카드가 같은 앞자리를 가지면 고르지 않는다", () => {
    const twins = [...cards, { id: "d", card_prefix: "426586" }];
    expect(autoCardId(twins, "4265-86**-****-****")).toBe("");
    // 앞 6자리가 겹치면 읽은 번호가 8자리여도 갈라낼 수 없다.
    expect(autoCardId(twins, "42658698********")).toBe("");
  });

  it("앞자리가 다르면 고르지 않는다", () => {
    expect(autoCardId(cards, "4265-87**-****-****")).toBe("");
    expect(autoCardId(cards, "9999-99**-****-****")).toBe("");
  });

  it("비교할 숫자가 6자리 미만이면 고르지 않는다", () => {
    expect(autoCardId(cards, "4265-8***-****-****")).toBe(""); // 앞 5자리뿐
    expect(autoCardId(cards, "426586")).toBe("a"); // 딱 6자리는 고른다
    expect(autoCardId([{ id: "e", card_prefix: "4265" }], "42658698********")).toBe("");
  });

  it("번호가 없거나 앞이 가려져 있으면 고르지 않는다", () => {
    expect(autoCardId(cards, null)).toBe("");
    expect(autoCardId(cards, "")).toBe("");
    expect(autoCardId(cards, "****-****-****-1234")).toBe("");
  });
});
