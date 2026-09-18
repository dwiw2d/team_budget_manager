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
