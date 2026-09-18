import { describe, expect, it, vi } from "vitest";
import { extract, linesFromFields } from "./clova-general.ts";
import { resolve } from "./merge.ts";
import { receipt1Fields, receipt2Fields, receipt3Fields } from "./clova-general.fixtures.ts";

describe("extract", () => {
  it("receipt-1: KIS VAN 승인전표에서 네 필드를 뽑는다", () => {
    expect(extract(receipt1Fields)).toEqual({
      merchant: "동남집",
      paidAt: "2026-09-04T12:06:09+09:00",
      amount: 59000,
      cardNumber: "4265-86**-****-****",
      weak: [],
    });
  });

  it("receipt-2: POS 카드판매 영수증에서 네 필드를 뽑는다 ('사업자번호' 라벨 줄 위라 확신한다)", () => {
    expect(extract(receipt2Fields)).toEqual({
      merchant: "세상끝의라멘",
      paidAt: "2026-09-15T12:38:27+09:00",
      amount: 36000,
      cardNumber: "42658698********",
      weak: [],
    });
  });

  it("receipt-3: 라벨 없는 번호 줄 위에서 상호를 뽑되, 확신하지 않고 weak 를 단다", () => {
    expect(extract(receipt3Fields)).toEqual({
      merchant: "맷돌로만(가산디지털점)",
      paidAt: "2026-09-18T11:57:00+09:00",
      amount: 21000,
      cardNumber: "4265-8699-****-****",
      weak: ["merchant"],
    });
  });

  it("가맹점 함정: 사업자번호 줄 오른쪽 끝의 대표자 이름을 상호로 고르지 않는다", () => {
    // "321-98-76543 TEL)021112222 박민수" 줄이다. 규칙 (b) 를 (c) 보다 먼저 보면 여기서 이름을 집는다.
    expect(extract(receipt3Fields).merchant).not.toBe("박민수");
  });

  it("금액 함정: 공급가/부가세/단가/품목합계를 총액으로 고르지 않는다", () => {
    for (const trap of [53636, 5364]) expect(extract(receipt1Fields).amount).not.toBe(trap);
    for (const trap of [32727, 3273, 11000, 33000]) expect(extract(receipt2Fields).amount).not.toBe(trap);
  });

  it("가맹점 함정: 안내 문구·표 머리글·VAN사·카드사 이름을 상호로 고르지 않는다", () => {
    const picked = [extract(receipt1Fields).merchant, extract(receipt2Fields).merchant];
    for (const trap of ["주소가 실제와 다른경우", "테이블명: 1T", "KIS정보통신", "KB국민카드"]) {
      expect(picked).not.toContain(trap);
    }
  });

  it("시각 함정: 조각으로 쪼개진 판매시간을 자정으로 뭉개지 않는다", () => {
    // "판매시간:" "20260915" "12:38:" "27" 이 네 조각이다. 날짜만 읽고 끝내면 00:00:00 이 된다.
    expect(extract(receipt2Fields).paidAt?.endsWith("T00:00:00+09:00")).toBe(false);
  });

  it("카드번호 함정: 사업자번호·VANKEY·전표일련번호를 카드번호로 고르지 않는다", () => {
    expect(extract(receipt1Fields).cardNumber).not.toBe("1122334455667788");
    expect(extract(receipt2Fields).cardNumber).not.toBe("123-45-67890");
    expect(extract(receipt2Fields).cardNumber).not.toBe("2026091599999999");
  });

  it("두 영수증 모두 카드번호 뒤 4자리가 마스킹돼 있다", () => {
    // 카드 자동 선택이 뒤 4자리를 쓸 수 없는 이유다(스펙 §6-3: 앞자리로 맞춘다).
    for (const fields of [receipt1Fields, receipt2Fields]) {
      expect(extract(fields).cardNumber?.endsWith("****")).toBe(true);
    }
  });

  it("읽을 수 없으면 그 항목만 null 이고 weak 에 이름이 남는다", () => {
    expect(extract([])).toEqual({
      merchant: null,
      paidAt: null,
      amount: null,
      cardNumber: null,
      weak: ["merchant", "amount", "paidAt"],
    });
  });

  it("상호를 못 찾으면 억지로 고르지 않고 null 과 weak 를 준다", () => {
    const noMerchant = receipt2Fields.filter((f) => f.inferText !== "세상끝의라멘");
    expect(extract(noMerchant).merchant).toBeNull();
    expect(extract(noMerchant).weak).toEqual(["merchant"]);
    expect(extract(noMerchant).amount).toBe(36000); // 나머지 필드는 그대로 나온다
  });
});

describe("상호 규칙 (c) 의 weak 가 화면의 '확인해 주세요' 까지 이어진다", () => {
  // resolve 가 weak 를 uncertain 으로 옮기고, 결제 추가 화면이 uncertain 칸을 표시한다.

  it("receipt-3: Gemini 가 없거나 실패해도 CLOVA 상호는 남고 uncertain 에 merchant 가 담긴다", async () => {
    const { weak, ...values } = extract(receipt3Fields);
    const result = await resolve({ ok: true, values, weak }, async () => null);
    expect(result?.merchant).toBe("맷돌로만(가산디지털점)");
    expect(result?.uncertain).toContain("merchant");
  });

  it("receipt-2: 라벨로 찾은 상호는 확신하므로 Gemini 를 아예 부르지 않는다", async () => {
    const askGemini = vi.fn().mockResolvedValue(null);
    const { weak, ...values } = extract(receipt2Fields);
    const result = await resolve({ ok: true, values, weak }, askGemini);
    expect(askGemini).not.toHaveBeenCalled();
    expect(result?.uncertain).toEqual([]);
  });
});

describe("상호 규칙 (c): 자리만 보고 고른 값", () => {
  // 사업자번호 줄 '바로 윗줄'이 늘 상호인 것은 아니다. 아래 셋은 실제로 파서를 속였다.
  // 틀린 값을 확신해서 내보내면 2단계 Gemini 보완도, 화면의 "확인해 주세요" 표시도 함께 닫힌다.

  it("윗줄이 '대표 <이름>' 이면 상호로 고르지 않는다", () => {
    const fields = [line("행복식당", 0), line("대표 홍길동", 40), line("123-45-67890", 80)];
    expect(extract(fields).merchant).toBeNull();
    expect(extract(fields).weak).toContain("merchant");
  });

  it("윗줄이 시/도 이름 없이 시작하는 주소면 상호로 고르지 않는다", () => {
    const fields = [line("스타벅스 서현점", 0), line("성남시 분당구 황새울로", 40), line("123-45-67890", 80)];
    expect(extract(fields).merchant).toBeNull();
    expect(extract(fields).weak).toContain("merchant");
  });

  it("3-2-5 모양의 영수번호를 사업자번호로 착각해 그 윗줄을 상호로 고르지 않는다", () => {
    const fields = [
      line("담당 이영희", 0),
      line("No 001-22-33444", 40),
      line("행복식당", 80),
      line("123-45-67890", 120),
    ];
    expect(extract(fields).merchant).toBeNull();
    expect(extract(fields).weak).toContain("merchant");
  });
});

describe("weak", () => {
  it("합계·총액 같은 낱말 없이 가장 큰 숫자로 고른 금액은 확신하지 않는다", () => {
    const noKeyword = [line("아메리카노 4,500", 0), line("케이크 7,000", 40)];
    expect(extract(noKeyword).amount).toBe(7000); // 최댓값 규칙으로 떨어진다
    expect(extract(noKeyword).weak).toContain("amount");
  });

  it("합계 줄에서 고른 금액은 확신한다", () => {
    const keyed = [line("아메리카노 4,500", 0), line("합계: 4,500원", 40)];
    expect(extract(keyed).amount).toBe(4500);
    expect(extract(keyed).weak).not.toContain("amount");
  });

  it("시각을 못 찾아 자정으로 채우면 확신하지 않는다", () => {
    const dateOnly = [line("거래일시: 2026-09-04", 0)];
    expect(extract(dateOnly).paidAt).toBe("2026-09-04T00:00:00+09:00");
    expect(extract(dateOnly).weak).toContain("paidAt");
  });

  it("카드번호가 없어도 weak 에 넣지 않는다", () => {
    expect(extract(receipt1Fields).weak).not.toContain("cardNumber");
    expect(extract([]).weak).not.toContain("cardNumber");
  });
});

describe("linesFromFields", () => {
  it("좌우로 갈라진 라벨과 값을 한 줄로 합친다", () => {
    // 실제 응답은 "합계:" 와 "59,000원" 이 서로 다른 lineBreak 묶음으로 떨어져 나온다.
    const texts = linesFromFields(receipt1Fields).map((l) => l.text);
    expect(texts).toContain("합계: 59,000원");
    expect(texts).toContain("홍길동 (TEL: 0212341234) 동남집");
    expect(texts).toHaveLength(20);
  });

  it("나오는 순서가 뒤엉켜도 세로 중심으로 줄을 맞춘다", () => {
    // receipt-2 는 "공급가"(56번째 조각)와 그 값 "32,727"(76번째)이 멀찍이 떨어져 나온다.
    const texts = linesFromFields(receipt2Fields).map((l) => l.text);
    expect(texts).toContain("공급가 32,727");
    expect(texts).toContain("판매시간: 20260915 12:38: 27 (POS100)");
    expect(texts).toHaveLength(25);
  });
});

/** 한 줄짜리 가짜 조각. weak 규칙만 보려고 최소한으로 만든다. */
function line(text: string, top: number) {
  return {
    inferText: text,
    lineBreak: true,
    boundingPoly: {
      vertices: [
        { x: 0, y: top },
        { x: 400, y: top },
        { x: 400, y: top + 30 },
        { x: 0, y: top + 30 },
      ],
    },
  };
}
