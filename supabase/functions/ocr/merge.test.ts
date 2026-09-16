import { describe, expect, it, vi } from "vitest";
import { merge, resolve } from "./merge.ts";

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

describe("resolve", () => {
  it("(a) CLOVA 성공·weak 없음이면 Gemini 를 부르지 않는다", async () => {
    const askGemini = vi.fn();
    expect(await resolve({ ok: true, values: clova, weak: [] }, askGemini)).toEqual({
      ...clova,
      uncertain: [],
    });
    expect(askGemini).not.toHaveBeenCalled();
  });

  it("(b) CLOVA 성공·weak 있으면 Gemini 와 병합하고 달라진 필드만 uncertain 이다", async () => {
    const mine = { ...clova, amount: 32727 };
    const gemini = { ...clova, merchant: "동남집앞" };
    const askGemini = vi.fn().mockResolvedValue(gemini);
    expect(await resolve({ ok: true, values: mine, weak: ["amount"] }, askGemini)).toEqual({
      ...clova,
      merchant: "동남집앞",
      uncertain: ["merchant"],
    });
    expect(askGemini).toHaveBeenCalledTimes(1);
  });

  it("(c) CLOVA 실패·Gemini 성공이면 Gemini 값을 쓰고 값이 있는 칸을 전부 uncertain 에 넣는다", async () => {
    const gemini = { ...clova, paidAt: null };
    expect(await resolve({ ok: false }, vi.fn().mockResolvedValue(gemini))).toEqual({
      ...gemini,
      uncertain: ["merchant", "amount", "cardNumber"],
    });
  });

  it("(d) CLOVA 실패·Gemini 실패면 null 로 실패를 알린다", async () => {
    expect(await resolve({ ok: false }, vi.fn().mockResolvedValue(null))).toBeNull();
  });

  it("(e) 네 필드가 모두 null 이면 어느 경로로 왔든 실패다", async () => {
    const empty = { merchant: null, paidAt: null, amount: null, cardNumber: null };
    // CLOVA 실패 후 Gemini 가 "읽을 게 없다"는 뜻으로 전부 null 을 준 경우(영수증이 아닌 사진)
    expect(await resolve({ ok: false }, vi.fn().mockResolvedValue(empty))).toBeNull();
    // CLOVA 는 성공했지만 파서도 Gemini 도 아무것도 못 뽑은 경우
    expect(
      await resolve({ ok: true, values: empty, weak: ["merchant"] }, vi.fn().mockResolvedValue(empty)),
    ).toBeNull();
  });

  it("(f) 한 칸이라도 값이 있으면 성공이고 uncertain 규칙은 그대로다", async () => {
    const only = { merchant: null, paidAt: null, amount: 59000, cardNumber: null };
    expect(await resolve({ ok: false }, vi.fn().mockResolvedValue(only))).toEqual({
      ...only,
      uncertain: ["amount"],
    });
  });
});
