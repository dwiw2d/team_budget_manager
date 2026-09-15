import { describe, expect, it } from "vitest";
import { normalizeNaverReceipt } from "./normalize";
import fixture from "./fixtures/naver-receipt.json";

describe("normalizeNaverReceipt", () => {
  it("fixture 응답을 정상 매핑한다", () => {
    expect(normalizeNaverReceipt(fixture)).toEqual({
      merchant: "GS25 역삼점",
      paidAt: "2026-09-15T12:34:56+09:00",
      amount: 12300,
      cardNumber: "1234-56**-****-5678",
    });
  });

  it("필드가 없으면 null 을 돌려준다", () => {
    expect(normalizeNaverReceipt({ images: [{ inferResult: "SUCCESS", receipt: { result: {} } }] })).toEqual({
      merchant: null,
      paidAt: null,
      amount: null,
      cardNumber: null,
    });
    expect(normalizeNaverReceipt({ images: [{ inferResult: "ERROR" }] }).merchant).toBeNull();
    expect(normalizeNaverReceipt(null).amount).toBeNull();
  });

  it("formatted.value 가 없으면 text 의 쉼표·원을 걷어내고 숫자만 뽑는다", () => {
    const body = {
      images: [{ receipt: { result: { totalPrice: { price: { text: "12,300원" } } } } }],
    };
    expect(normalizeNaverReceipt(body).amount).toBe(12300);
  });

  it("시각이 없으면 날짜만으로 00:00:00 을 만들고, 날짜가 없으면 paidAt 은 null", () => {
    const dateOnly = {
      images: [{ receipt: { result: { paymentInfo: { date: { formatted: { year: "2026", month: "1", day: "5" } } } } } }],
    };
    expect(normalizeNaverReceipt(dateOnly).paidAt).toBe("2026-01-05T00:00:00+09:00");

    const timeOnly = {
      images: [{ receipt: { result: { paymentInfo: { time: { formatted: { hour: "12", minute: "00", second: "00" } } } } } }],
    };
    expect(normalizeNaverReceipt(timeOnly).paidAt).toBeNull();
  });
});
