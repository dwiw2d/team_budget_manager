import { describe, expect, it } from "vitest";
import { merge } from "./merge.ts";

const clova = {
  merchant: "동남집",
  paidAt: "2026-09-04T12:06:09+09:00",
  amount: 59000,
  cardNumber: "4265-86**-****-****",
};

describe("merge", () => {
  it("Gemini 를 안 불렀으면 CLOVA 값을 그대로 쓰고 weak 를 uncertain 으로 옮긴다", () => {
    expect(merge(clova, ["merchant"], null)).toEqual({ ...clova, uncertain: ["merchant"] });
  });

  it("weak 가 없으면 Gemini 가 달라도 CLOVA 값을 지킨다", () => {
    const gemini = { ...clova, merchant: "동남집앞", amount: 1000 };
    expect(merge(clova, [], gemini)).toEqual({
      ...clova,
      merchant: "동남집앞",
      amount: 1000,
      uncertain: ["merchant", "amount"],
    });
  });

  it("CLOVA 가 null 이면 Gemini 값으로 채우고 uncertain 에 넣지 않는다", () => {
    const mine = { ...clova, merchant: null };
    expect(merge(mine, ["merchant"], clova)).toEqual({ ...clova, uncertain: [] });
  });

  it("weak 인 칸은 값이 있어도 Gemini 값으로 덮고 uncertain 에 넣지 않는다", () => {
    const mine = { ...clova, amount: 32727 }; // 최댓값 규칙으로 잘못 고른 경우
    expect(merge(mine, ["amount"], clova)).toEqual({ ...clova, uncertain: [] });
  });

  it("weak 인데 Gemini 도 못 읽으면 CLOVA 값을 두고 uncertain 에 넣는다", () => {
    const gemini = { ...clova, amount: null };
    expect(merge(clova, ["amount"], gemini)).toEqual({ ...clova, uncertain: ["amount"] });
  });

  it("둘 다 못 읽으면 null 인 채로 uncertain 에 남는다", () => {
    const mine = { ...clova, merchant: null };
    const gemini = { ...clova, merchant: null };
    expect(merge(mine, ["merchant"], gemini)).toEqual({ ...mine, uncertain: ["merchant"] });
  });

  it("cardNumber 는 CLOVA 가 비었을 때만 Gemini 값을 받는다", () => {
    const mine = { ...clova, cardNumber: null };
    expect(merge(mine, [], clova).cardNumber).toBe("4265-86**-****-****");
    expect(merge(mine, [], clova).uncertain).toEqual([]);
  });
});
