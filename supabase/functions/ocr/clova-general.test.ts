import { describe, expect, it, vi } from "vitest";
import { extract, linesFromFields, merchantFromLine, merchantOk } from "./clova-general.ts";
// 벤치 채점기와 같은 합성 좌표 생성기. 넓은 공백(2칸 이상)을 좌우 단으로 벌려 준다.
// tsconfig 가 allowJs 를 끄고 있어 .mjs 에는 타입이 없다. 벤치 쪽 파일이라 손대지 않는다.
// @ts-expect-error -- 타입 선언 없는 .mjs
import { linesToFields } from "../../../scripts/ocr-bench/lib/synth-fields.mjs";
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
  // 윗줄이 역할어·주소면 버리고 위로 더 올라가거나 맨 위 줄에서 찾는다. 다만 자리만 보고
  // 고른 값이므로 확신하지 않는다 — weak 에 merchant 가 남아야 2단계 Gemini 보완도,
  // 화면의 "확인해 주세요" 표시도 열린다. 절대 하면 안 되는 것은 '확신하면서 틀리는' 것이다.

  it("윗줄이 '대표 <이름>' 이면 그 이름 대신 그 위의 상호를 고른다", () => {
    const fields = linesToFields(["행복식당", "대표 홍길동", "123-45-67890"]);
    expect(extract(fields).merchant).toBe("행복식당");
    expect(extract(fields).weak).toContain("merchant");
  });

  it("윗줄이 시/도 이름 없이 시작하는 주소면 그 주소 대신 그 위의 상호를 고른다", () => {
    const fields = linesToFields(["스타벅스 서현점", "성남시 분당구 황새울로", "123-45-67890"]);
    expect(extract(fields).merchant).toBe("스타벅스 서현점");
    expect(extract(fields).weak).toContain("merchant");
  });

  it("3-2-5 모양의 영수번호를 사업자번호로 착각해 그 윗줄을 상호로 고르지 않는다", () => {
    const fields = linesToFields(["담당 이영희", "No 001-22-33444", "행복식당", "123-45-67890"]);
    expect(extract(fields).merchant).toBe("행복식당"); // 'No 001-22-33444' 도 '담당 이영희' 도 아니다
    expect(extract(fields).weak).toContain("merchant");
  });

  it("영수번호 줄의 두 글자짜리 영문 말머리를 상호로 돌려주지 않는다", () => {
    // "No 001-22-33444" 에서 번호를 지우면 'No' 만 남는다. 상호가 아니라 말머리다.
    expect(merchantFromLine(asLine("No 001-22-33444"))).toBeNull();
    expect(merchantOk("No")).toBe(false);
  });
});

describe("상호 규칙 (c) 의 확신: 앵커 줄에 다른 것이 섞였는지로 가른다", () => {
  // 라벨이 있다는 사실은 그 줄이 사업자번호 줄임을 말할 뿐, 윗줄이 상호임을 보장하지 않는다.
  // 실제로 표 머리글·상호 칸이 더 붙은 줄 위에서 안내문·표어를 확신하며 집어 갔다.

  it("라벨과 번호뿐인 깨끗한 줄이면 그 윗줄을 확신한다", () => {
    const fields = linesToFields(["행복식당", "사업자등록번호 123-45-67890"]);
    expect(extract(fields).merchant).toBe("행복식당");
    expect(extract(fields).weak).not.toContain("merchant");
  });

  it("같은 줄에 상호 칸이 더 붙어 있으면 확신하지 않는다", () => {
    const fields = linesToFields(["행복식당", "사업자등록번호 123-45-67890 상 호"]);
    expect(extract(fields).merchant).toBe("행복식당");
    expect(extract(fields).weak).toContain("merchant");
  });

  it("앵커 줄이 표 머리글이면 확신하지 않는다", () => {
    // 배달앱 영수증에 실제로 있는 줄이다. 윗줄은 상호가 아니라 배달 플랫폼 법인명이었다.
    const fields = linesToFields(["(주)우아한형제들 김범준", "사업자등록번호 가맹점 전화번호"]);
    expect(extract(fields).weak).toContain("merchant");
  });
});

describe("merchantOk: 거름망이 멀쩡한 상호를 버리지 않는다", () => {
  // 역할어와 주소 꼬리를 부분 문자열로 걸렀더니 아래 상호들이 통째로 날아갔다.
  const keep = [
    // 역할 낱말이 상호 안에 박힌 경우
    "대표과일", "대표김밥", "대표약국", "대표떡볶이", "사장님갈비", "사장님이미쳤어요",
    "김사장네 곱창", "점장수제버거", "담당김밥천국", "계산원조갈비",
    // 주소 접미사가 상호 안에 박힌 경우
    "정성스시 방배동", "하루스시 논현로", "미소야 스시 역삼동", "쿠우쿠우 스시 명동",
    "무교동 낙지 을지로", "샤로수길 커피 봉천동",
    // 원래도 살아 있던 것들
    "맷돌로", "해오름길", "종로설렁탕", "구로반점", "동대문엽기떡볶이", "이로운약국",
    "강남면옥", "일로와호프", "길동이네", "시장통닭", "로데오피자", "분당돈까스",
    "상동칼국수", "서현역국밥",
  ];
  const drop = [
    "대표 홍길동",          // 역할어 + 사람 이름
    "담당 이영희",
    "계산원 : 초기사용자",  // 맷돌로만 영수증에 실제로 있는 줄
    "대표자 손석원",
    "성남시 분당구 황새울로", // 시/도 없이 시작하는 전체 주소
  ];

  it.each(keep)("상호로 받는다: %s", (v) => expect(merchantOk(v)).toBe(true));
  it.each(drop)("상호로 받지 않는다: %s", (v) => expect(merchantOk(v)).toBe(false));
});

describe("금액 라벨 등급: 동점일 때 사용자가 낸 값을 고른다", () => {
  it("진료비 서식에서 '총액' 대신 본인부담 '합계' 를 고른다", () => {
    // 이 표는 총액·보험자부담·본인부담이 나란히 있다. 큰 값을 고르면 총액이 저장돼
    // 카드 잔액이 틀어진다. 실제로 저장되는 값이라 인식률보다 이쪽이 더 중요하다.
    const fields = linesToFields([
      "약제비총액(1+2+3)   26,990 원",
      "본인부담금(1)        8,000 원",
      "보험자부담금(2)     18,990 원",
      "합  계               8,000 원",
    ]);
    expect(extract(fields).amount).toBe(8000);
  });

  it("할인·쿠폰을 빼기 전 '합계' 대신 '결제금액' 을 고른다", () => {
    const fields = linesToFields(["합계      13,400", "쿠폰      6,900", "할인      2,000", "결제금액   4,500"]);
    expect(extract(fields).amount).toBe(4500);
  });

  it("공급가인 '판매금액' 이 두 번 나와도 '합계금액' 에 진다", () => {
    const fields = linesToFields([
      "[판 매 금 액] 90,909",
      "[승 인 금 액] 100,000",
      "판 매 금 액: 90,909",
      "합 계 금 액: 100,000",
    ]);
    expect(extract(fields).amount).toBe(100000);
  });

  it("'판매금액' 밖에 없으면 그대로 쓴다", () => {
    expect(extract(linesToFields(["판매금액   21,000"])).amount).toBe(21000);
  });

  it("라벨이 없으면 등급 차이가 없으므로 예전처럼 큰 값을 고른다", () => {
    expect(extract(linesToFields(["아메리카노 4,500", "케이크 7,000"])).amount).toBe(7000);
  });
});

describe("금액 라벨 사전: 자간 공백·영문·주문/티켓 서식", () => {
  it.each([
    ["총 주문금액   26,700원", 26700],
    ["결제 요금 :  6,800원", 6800],
    ["티켓정보: 조조성인8,000원", 8000],
    ["TOTAL   8,000", 8000],
    ["받은금액   21,000", 21000],
    ["결 제 액   12,000", 12000],
  ])("%s 를 금액 줄로 읽는다", (line, want) => {
    expect(extract(linesToFields([line])).amount).toBe(want);
  });
});

describe("금액 좌우 2단: 라벨 칸과 그 오른쪽 칸까지만 본다", () => {
  it("오른쪽 끝의 '할 인 0' 을 합계 값으로 집지 않는다", () => {
    const fields = linesToFields(["총 합 계        5,600     할 인        0"]);
    expect(extract(fields).amount).toBe(5600);
  });

  it("라벨 칸에 숫자가 없으면 오른쪽 칸에서 값을 가져온다", () => {
    const fields = linesToFields(["총수납금액   현  금        8,000 원"]);
    expect(extract(fields).amount).toBe(8000);
  });

  it("라벨이 토막 경계에 걸려 쪼개지면 줄 통째로 다시 본다", () => {
    // '-  합  계   11,400' 은 토막이 '-' / '합' / '계' / '11,400' 로 갈린다.
    expect(extract(linesToFields(["-  합  계        11,400"])).amount).toBe(11400);
  });

  it("항목 번호 '(1+2+3)' 을 금액으로 집지 않는다", () => {
    const fields = linesToFields(["약제비총액(1+2+3)        26,990 원", "합  계        8,000 원"]);
    expect(extract(fields).amount).toBe(8000);
  });

  it("자릿수 칸에 한 자씩 찍힌 금액을 붙여 읽는다", () => {
    expect(extract(linesToFields(["합계        4 4 0 0"])).amount).toBe(4400);
  });

  it("금액 라벨이 없는 줄의 한 자리 숫자 나열은 건드리지 않는다", () => {
    expect(extract(linesToFields(["주문수량        4 4 0 0", "아메리카노 4,500"])).amount).toBe(4500);
  });
});

describe("금액 fallback: 라벨이 하나도 없을 때", () => {
  it("쉼표가 찍힌 숫자가 있으면 사업자번호·요금표 토막은 보지 않는다", () => {
    const fields = linesToFields(["106-81-23498 (주)롯데리아 월드몰 3층점", "T-REX세트   5,600"]);
    expect(extract(fields).amount).toBe(5600);
  });

  it("쉼표가 하나도 없으면 예전처럼 맨숫자 중 큰 값을 고른다", () => {
    expect(extract(linesToFields(["아메리카노 4500", "케이크 7000"])).amount).toBe(7000);
  });
});

describe("결제 일시: 날짜 표기·12시간제·여러 날짜", () => {
  it.each([
    ["2021년 4월 19일", "2021-04-19"],
    ["2022년 07월 20일", "2022-07-20"],
    ["거래일시 2022 12 30", "2022-12-30"],
  ])("%s 를 날짜로 읽는다", (line, want) => {
    expect(extract(linesToFields([line])).paidAt).toBe(`${want}T00:00:00+09:00`);
  });

  it("수량 표 칸을 공백 구분 날짜로 오인하지 않는다", () => {
    expect(extract(linesToFields(["티셔츠 3 2 1"])).paidAt).toBe(null);
  });

  it.each([
    ["시간: 오후 3:47", "15:47:00"],
    ["시간: 오후 12:10", "12:10:00"],
    ["시간: 오전 12:30", "00:30:00"],
    ["시간: 오전 9:05", "09:05:00"],
  ])("%s 를 24시간제로 바꾼다", (time, want) => {
    expect(extract(linesToFields([`2025-09-21 ${time}`])).paidAt).toBe(`2025-09-21T${want}+09:00`);
  });

  it("날짜가 여럿이면 시각이 함께 찍힌 줄을 고른다", () => {
    // 수납일·발행일·전표일시가 흩어진 진료비 영수증 판형이다.
    const fields = linesToFields(["수납일 2022.06.23", "항목   급여", "2022년 07월 18일 17:18"]);
    expect(extract(fields).paidAt).toBe("2022-07-18T17:18:00+09:00");
  });

  it("시각이 영수증에 딱 하나면 날짜와 멀어도 쓴다", () => {
    const fields = linesToFields(["50912   2026-04-02(목)   POS-01", "칸쵸  1,500", "합계  1,500", "NO:1777  14:27"]);
    expect(extract(fields).paidAt).toBe("2026-04-02T14:27:00+09:00");
  });

  it("멀리 있는 시각이 둘 이상이면 고르지 않고 자정으로 둔다", () => {
    const fields = linesToFields(["2026-04-02(목)", "합계  1,500", "영업시간 09:00", "NO:1777  14:27"]);
    expect(extract(fields).paidAt).toBe("2026-04-02T00:00:00+09:00");
    expect(extract(fields).weak).toContain("paidAt");
  });
});

describe("weak", () => {
  it("합계·총액 같은 낱말 없이 가장 큰 숫자로 고른 금액은 확신하지 않는다", () => {
    const noKeyword = linesToFields(["아메리카노 4,500", "케이크 7,000"]);
    expect(extract(noKeyword).amount).toBe(7000); // 최댓값 규칙으로 떨어진다
    expect(extract(noKeyword).weak).toContain("amount");
  });

  it("합계 줄에서 고른 금액은 확신한다", () => {
    const keyed = linesToFields(["아메리카노 4,500", "합계: 4,500원"]);
    expect(extract(keyed).amount).toBe(4500);
    expect(extract(keyed).weak).not.toContain("amount");
  });

  it("시각을 못 찾아 자정으로 채우면 확신하지 않는다", () => {
    const dateOnly = linesToFields(["거래일시: 2026-09-04"]);
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

describe("merchantOk: '…스시'·'…장군' 상호를 주소로 오인하지 않는다", () => {
  // ADDRESS_FULL 의 첫 토막이 '한글 2자 이상 + 시/군' 이라 '회전스시'·'이순신장군' 이 지명으로 읽혔다.
  const keep = [
    "회전스시 서면", "미소스시 서면", "정성스시 서면", "오마카세스시 서면", "일품스시 서면",
    "대게스시 서면", "정성스시 서면 본점", "하루스시 서면 2호점", "하루스시 냉면", "정성스시 냉면",
    "정성스시 물냉면", "회전스시 메밀면", "초밥스시 우동면", "미소스시 우동면", "회전스시 라면",
    "이순신장군 냉면", "해물장군 라면", "회전스시 조치원읍", "미소스시 화도읍",
  ];
  // 시/군 다음에 구/군/읍/면 이 오는 진짜 주소는 그대로 걸려야 한다.
  const drop = [
    "성남시 분당구 황새울로", "화성시 동탄면 어울림로", "안동시 풍천면", "김포시 통진읍",
  ];

  it.each(keep)("상호로 받는다: %s", (v) => expect(merchantOk(v)).toBe(true));
  it.each(drop)("상호로 받지 않는다: %s", (v) => expect(merchantOk(v)).toBe(false));

  // 둘째 토막이 구/군/읍/면 으로 안 끝나면 주소로 보지 않는다. '양평군 한우마을' 은 상호로 살아남는다.
  it("'군 + 일반 낱말' 은 주소로 보지 않는다", () => {
    expect(merchantOk("양평군 한우마을")).toBe(true);
  });
});

/** 글자 줄 하나를 합성 좌표에 얹어 Line 으로. 벤치 채점기가 쓰는 것과 같은 생성기다. */
function asLine(text: string) {
  return linesFromFields(linesToFields([text]))[0];
}

describe("상호 토막 떼어내기: 줄에 로고·전화·번호가 붙어 있어도 상호만 뽑는다", () => {
  // 전부 실제 영수증에서 가져온 줄이다. 번호는 같은 자릿수 가짜로 바꿨다.
  // 줄을 통째로 상호 후보로 쓰던 시절에는 셋 다 길이·숫자 조건에 걸려 버려졌다.
  const cases: Array<[string, string]> = [
    ["emart   이마트 신촌점 (02)-116-1219", "이마트 신촌점"],
    ["emart   이마트 충주점 (043)841-1234", "이마트 충주점"],
    ["[V]외래 [ ]입원(( )퇴원( )중간) 진료비 계산서·영수증   중앙대학교병원", "중앙대학교병원"],
    ["GS25성내동원점              024749333", "GS25성내동원점"],
    ["emart everyday   이마트에브리데이 서초내곡점", "이마트에브리데이 서초내곡점"],
    ["첫걸음산부인과의원              TID:***2506093", "첫걸음산부인과의원"],
  ];
  it.each(cases)("%s -> %s", (text, want) => expect(merchantFromLine(asLine(text))).toBe(want));

  it("넓게 띄어 쓴 상호는 앞 토막만 집지 않고 줄 통째로 쓴다", () => {
    expect(merchantFromLine(asLine("롯데쇼핑(주)                    잠실 점"))).toBe("롯데쇼핑(주) 잠실 점");
  });

  it("상호가 없는 줄에서는 억지로 토막을 고르지 않는다", () => {
    expect(merchantFromLine(asLine("215-67-00093 대표자"))).toBeNull();
    expect(merchantFromLine(asLine("[구매] 2025-12-25   18:42        POS:1509-0607"))).toBeNull();
  });

  it("사업자번호 줄 위가 로고+상호+전화번호 한 줄이어도 상호를 뽑는다", () => {
    const fields = linesToFields(["emart   이마트 신촌점 (02)-116-1219", "215-67-00093 대표자"]);
    expect(extract(fields).merchant).toBe("이마트 신촌점");
  });
});

describe("라벨로 상호 뽑기: 콜론이 없어도, 자간 공백이 있어도 찾는다", () => {
  // 전부 실제 영수증 줄이다. 번호는 같은 자릿수 가짜로 바꿨다.
  const cases: Array<[string, string[], string]> = [
    ["매장 라벨", ["매장: 유니클로", "TEL. 02-3453-5448"], "유니클로"],
    ["영화관 라벨", ["영화관:   메가박스중앙(주) 코엑스점", "사업자No: 120-85-14877"], "메가박스중앙(주) 코엑스점"],
    ["주문매장 라벨", ["주문매장: 호시타코야끼 대치점"], "호시타코야끼 대치점"],
    ["점 명 라벨(자간 공백)", ["점 명 : PID 인천 구월로데오광장점", "사업자 : 771-07-00251"], "PID 인천 구월로데오광장점"],
    ["가 맹 점 명(자간 공백)", ["가 맹 점 명: 보소다테점", "대 표 자 명: 멘마짱"], "보소다테점"],
    ["콜론 없는 표 칸", ["사업장소재지", "상    호   열매약국", "성    명   [마스킹/직인]"], "열매약국"],
    ["사업자번호와 같은 칸 줄", ["사업자등록번호   203-82-03581   상호   중앙대학교병원"], "중앙대학교병원"],
    ["라벨과 값이 모두 자간 공백", ["사업자등록번호   371-76-00154", "상  호   윤 중 약 국", "성  명"], "윤 중 약 국"],
    ["라벨과 값이 한 낱말로 붙음", ["상호:동대문마트", "121-19-53775"], "동대문마트"],
  ];
  it.each(cases)("%s", (_why, lines, want) => expect(extract(linesToFields(lines)).merchant).toBe(want));

  it("값을 줄 끝까지 잡지 않고 다음 토막 앞까지만 자른다", () => {
    const fields = linesToFields(["상호: 두리이비인후과                          대표자: 홍정주"]);
    expect(extract(fields).merchant).toBe("두리이비인후과");
  });

  it("콜론을 선택으로 바꿨어도 VAN 안내 문구는 라벨로 읽지 않는다", () => {
    // 이 줄 하나 때문에 예전에는 콜론을 필수로 두었다. 라벨은 낱말 통째로 같을 때만 인정한다.
    const fields = linesToFields([
      "가맹점명/주소가 실제와 다른경우 신고안내(포상금 10만원 지급)",
      "여신금융협회",
    ]);
    expect(extract(fields).merchant).toBeNull();
  });
});

describe("merchantOk: 인사말·안내 문구를 상호로 받지 않는다", () => {
  // 앵커가 없어 맨 위 줄에서 찾는 (d) 경로가 이것들을 상호로 집어 갔다. 전부 weak 라 조용히
  // 틀리지는 않지만, 그럴듯하게 틀린 값은 사용자가 그대로 저장한다.
  const drop = [
    "감사합니다", "또 오세요", "안녕히 가세요", "이용해 주셔서 감사합니다",
    "고객님", "교환·환불 안내", "반품 및 교환 안내", "포인트 적립", "적립되었습니다",
    "고객", "안내",
  ];
  // '감사'·'고객' 은 상호에도 쓰인다. 그 말뿐인 단독 문장일 때만 걸러야 한다.
  const keep = ["감사식당", "감사떡볶이", "고객만족센터", "고객사랑치과", "또오시오분식"];

  it.each(drop)("상호로 받지 않는다: %s", (v) => expect(merchantOk(v)).toBe(false));
  it.each(keep)("상호로 받는다: %s", (v) => expect(merchantOk(v)).toBe(true));

  it("맨 위 줄이 인사말이면 건너뛰고 그 아래 상호를 쓴다", () => {
    const fields = linesToFields(["감사합니다", "또 오세요", "행복분식", "아메리카노 4,500"]);
    expect(extract(fields).merchant).toBe("행복분식");
  });
});

describe("merchantOk: 자간 공백을 붙여 보고 한 번 더 거른다", () => {
  it("벌려 찍은 역할어·표 머리글을 상호로 받지 않는다", () => {
    expect(merchantOk("대 표 자 명: 멘마짱")).toBe(false);
    expect(merchantOk("상 품 명   단 가")).toBe(false);
  });

  it("벌려 찍은 진짜 상호는 그대로 받는다", () => {
    expect(merchantOk("윤 중 약 국")).toBe(true);
    expect(merchantOk("현 대 백 화 점")).toBe(true);
  });
});

describe("상호 앵커 넓히기: 사업자번호가 같은 줄·먼 줄이거나 아예 없을 때", () => {
  it("사업자번호가 상호와 같은 줄이면 그 번호가 든 칸의 왼쪽을 상호로 본다", () => {
    const fields = linesToFields([
      "대한민국 1등인 이마트",
      "이마트 탄현점 128-85-48537 대표: 최병훈",
      "고양시 일산구 덕이동 203-1 (031)927-1234",
    ]);
    expect(extract(fields).merchant).toBe("이마트 탄현점");
  });

  it("번호가 제 칸의 맨 앞이면 왼쪽이 비었으므로 상호로 삼지 않는다", () => {
    // "손은주   669-56-00790  Tel:…" 의 대표자 이름을 상호로 집던 자리다.
    const fields = linesToFields([
      "첫걸음산부인과의원              TID:***2506093",
      "손은주   669-56-00790  Tel:0220387375",
    ]);
    expect(extract(fields).merchant).toBe("첫걸음산부인과의원");
  });

  it("사업자번호 줄과 상호 사이에 로고·주소가 끼어 있으면 위로 더 올라간다", () => {
    const fields = linesToFields([
      "THE HYUNDAI",
      "(주)현대백화점 압구정본점",
      "강남구 압구정로 165",
      "211-85-37633   대표이사: 정지영 외 1인",
    ]);
    expect(extract(fields).merchant).toBe("(주)현대백화점 압구정본점");
    expect(extract(fields).weak).toContain("merchant"); // 자리만 보고 골랐다
  });

  it("세 줄보다 더 올라가지는 않는다", () => {
    const fields = linesToFields([
      "행복식당",
      "안내문 한 줄",
      "안내문 두 줄",
      "안내문 세 줄",
      "123-45-67890",
    ]);
    expect(extract(fields).merchant).not.toBe("행복식당");
  });

  it("번호 모양이 아니어도 '사업자등록번호' 라벨만으로 자리를 안다", () => {
    const fields = linesToFields([
      "CU (Again)",
      "******* 최근영수증발행인쇄 *******",
      "CU 개포스카이점",
      "사업자등록번호:7436000775",
    ]);
    expect(extract(fields).merchant).toBe("CU 개포스카이점");
  });

  it("라벨도 사업자번호도 없으면 맨 위 몇 줄에서 찾되 확신하지 않는다", () => {
    const fields = linesToFields([
      "모바일 영수증",
      "GS25성내동원점              024749333",
      "이경희                      2752301295",
    ]);
    expect(extract(fields).merchant).toBe("GS25성내동원점");
    expect(extract(fields).weak).toContain("merchant");
  });
});

describe("merchantOk 문턱: 앞 단계를 다 고친 뒤에 푼 것들", () => {
  it("라벨이 직접 가리킨 값은 숫자 세 자리 규칙을 면제한다", () => {
    expect(merchantOk("서울법인115")).toBe(false); // 자리만 보고 고른 값이면 여전히 버린다
    expect(merchantOk("서울법인115", true)).toBe(true);
    expect(extract(linesToFields(["상  호 : 서울법인115"])).merchant).toBe("서울법인115");
    expect(extract(linesToFields(["상호:153구포국수(선릉역점)"])).merchant).toBe("153구포국수(선릉역점)");
  });

  it("라벨이 가리켜도 글자가 두 자 미만이면 상호로 받지 않는다", () => {
    expect(merchantOk("1234567", true)).toBe(false);
    expect(merchantOk("101-86-76277", true)).toBe(false);
  });

  it("20자가 넘는 긴 상호를 버리지 않는다", () => {
    expect(merchantOk("(유)아웃백스테이크하우스코리아 신대방점")).toBe(true);
  });

  it("배달앱 화면의 UI 버튼을 상호로 고르지 않는다", () => {
    expect(merchantOk("가게보기")).toBe(false);
    expect(merchantOk("지도보기")).toBe(false);
    const fields = linesToFields([
      "픽업을 완료했어요",
      "이삭토스트                지도보기",
      "영수증 받기   전화   가게보기",
    ]);
    expect(extract(fields).merchant).toBe("이삭토스트");
  });

  it("시/도 이름으로 시작해도 뒤에 행정 접미사나 공백이 없으면 주소가 아니다", () => {
    expect(merchantOk("강원대학교병원")).toBe(true);
    expect(merchantOk("제주도횟집")).toBe(true);
    expect(merchantOk("경기김밥")).toBe(true);
    // 진짜 주소는 그대로 걸린다
    expect(merchantOk("서울 강동구 선호대로")).toBe(false);
    expect(merchantOk("강원도 춘천시 백령로")).toBe(false);
    expect(merchantOk("서울특별시 송파구 올림픽로")).toBe(false);
  });

  it("역할어 칸의 오른쪽 칸은 사람 이름이므로 상호로 고르지 않는다", () => {
    const fields = linesToFields([
      "뉴매장",
      "57,000원",
      "대표                            김유나",
      "사업자등록번호   331-88-02462",
    ]);
    expect(extract(fields).merchant).toBe("뉴매장");
  });

  it("도장처럼 한 글자만 찍힌 칸은 상호에서 뺀다", () => {
    const fields = linesToFields([
      "현 대 백 화 점  무 역 센 터 점        송",
      "158-86-00318                           송",
    ]);
    expect(extract(fields).merchant).toBe("현 대 백 화 점 무 역 센 터 점");
  });

  it("맨 위 줄이 영문 로고면 그 아래 한글 상호를 먼저 쓴다", () => {
    const fields = linesToFields([
      "PARIS BAGUETTE",
      "주문(대기)번호 - 0127",
      "여의도KBS 파리바게트",
    ]);
    expect(extract(fields).merchant).toBe("여의도KBS 파리바게트");
  });
});

describe("merchantOk: 라벨이 가리킨 값은 인사말 거름망과 두 글자 규칙을 면제한다", () => {
  // 이 둘은 앵커가 없어 자리로 추측하는 (d) 경로에서 쓰라고 만든 것이다. 라벨은 사람이
  // "여기가 상호다" 라고 명시한 것이라 그 위에서 또 거르면 멀쩡한 상호를 버린다.
  const labelledOnly = [
    // '…세요'·'…니다' 가 든 상호
    "또오세요분식", "어서오세요마트", "드세요분식", "오세요네과일", "행복하세요약국",
    "맛있습니다식당", "감사합니다",
    // 안내 낱말이 앞글자로 들어간 상호
    "교환역국밥", "교환학생카페", "교환다리설렁탕", "환불없는집", "환불맛집",
    "적립왕고기", "적립왕치킨", "적립의민족", "반품천국",
    // 단독 문장으로는 안내문이지만 라벨이 가리키면 상호다
    "감사", "고객", "고객님", "안내",
    // 한글 없는 두 글자 브랜드
    "CU", "KT", "SK", "No",
  ];

  it.each(labelledOnly)("라벨 없으면 버리고, 라벨이 가리키면 받는다: %s", (v) => {
    expect(merchantOk(v)).toBe(false);
    expect(merchantOk(v, true)).toBe(true);
  });

  it("두 글자 브랜드를 라벨과 함께 돌려준다 — 라벨 글자가 섞이지 않는다", () => {
    expect(extract(linesToFields(["상호: CU", "합계 10,000원"])).merchant).toBe("CU");
    expect(extract(linesToFields(["가맹점명: KT", "합계 10,000원"])).merchant).toBe("KT");
  });

  it("라벨이 가리킨 인사말꼴 상호를 돌려준다", () => {
    expect(extract(linesToFields(["상호: 또오세요분식", "합계 10,000원"])).merchant).toBe("또오세요분식");
    expect(extract(linesToFields(["상호: 적립왕치킨", "합계 10,000원"])).merchant).toBe("적립왕치킨");
  });

  it("라벨이 없으면 맨 위 줄의 안내문을 여전히 건너뛴다", () => {
    const fields = linesToFields(["또 오세요", "포인트 적립", "행복분식", "아메리카노 4,500"]);
    expect(extract(fields).merchant).toBe("행복분식");
  });
});
