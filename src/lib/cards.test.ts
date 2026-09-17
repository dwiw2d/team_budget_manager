import { describe, expect, it } from "vitest";
import { autoCardId } from "./cards";

const cards = [
  { id: "a", card_prefix: "426586" },
  { id: "b", card_prefix: "53012345" },
  { id: "c", card_prefix: null },
];

/** 고른 카드 id 만 볼 때 쓰는 줄임. */
const pick = (cardNumber: string | null, list = cards) => autoCardId(list, cardNumber).cardId;

describe("autoCardId", () => {
  it("실측 마스킹 패턴 두 가지에서 앞자리로 카드를 고른다", () => {
    expect(pick("4265-86**-****-****")).toBe("a");
    expect(pick("42658698********")).toBe("a");
  });

  it("비교 길이는 둘 중 짧은 쪽이다", () => {
    // 카드 앞자리 8, 읽은 번호 6 -> 앞 6자리만 비교한다.
    expect(pick("5301-23**-****-****")).toBe("b");
    // 카드 앞자리 6, 읽은 번호 8 -> 앞 6자리만 비교한다.
    expect(pick("42658698********")).toBe("a");
  });

  it("두 카드가 같은 앞자리를 가지면 고르지 않고 겹침으로 알린다", () => {
    const twins = [...cards, { id: "d", card_prefix: "426586" }];
    expect(autoCardId(twins, "4265-86**-****-****")).toEqual({ cardId: "", ambiguous: true, matchCount: 2 });
    // 앞 6자리가 겹치면 읽은 번호가 8자리여도 갈라낼 수 없다.
    expect(autoCardId(twins, "42658698********")).toEqual({ cardId: "", ambiguous: true, matchCount: 2 });
  });

  it("한 장만 일치하면 겹침이 아니다", () => {
    expect(autoCardId(cards, "4265-86**-****-****")).toEqual({ cardId: "a", ambiguous: false, matchCount: 1 });
  });

  it("앞자리가 다르면 고르지 않고 겹침도 아니다", () => {
    expect(autoCardId(cards, "4265-87**-****-****")).toEqual({ cardId: "", ambiguous: false, matchCount: 0 });
    expect(pick("9999-99**-****-****")).toBe("");
  });

  it("비교할 숫자가 6자리 미만이면 고르지 않고 겹침도 아니다", () => {
    const twins = [...cards, { id: "d", card_prefix: "426586" }];
    // 앞 5자리뿐이면 두 장이 걸릴 법해도 겹침으로 보지 않는다.
    expect(autoCardId(twins, "4265-8***-****-****")).toEqual({ cardId: "", ambiguous: false, matchCount: 0 });
    expect(pick("426586")).toBe("a"); // 딱 6자리는 고른다
    expect(pick("42658698********", [{ id: "e", card_prefix: "4265" }])).toBe("");
  });

  it("번호가 없거나 앞이 가려져 있으면 고르지 않는다", () => {
    expect(pick(null)).toBe("");
    expect(pick("")).toBe("");
    expect(pick("****-****-****-1234")).toBe("");
  });
});
