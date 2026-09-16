// Gemini 비전 모델로 영수증에서 네 필드를 뽑는 순수 모듈 (네트워크 없음).
// 요청 본문 만들기와 응답 정규화만 담당한다.

export const DEFAULT_MODEL = "gemini-2.5-flash";

/** 구조화 출력 스키마. 앱이 쓰는 네 필드만 받는다. */
export const RECEIPT_SCHEMA = {
  type: "object",
  properties: {
    merchant: { type: "string", nullable: true },
    paidAt: { type: "string", nullable: true },
    amount: { type: "integer", nullable: true },
    cardNumber: { type: "string", nullable: true },
  },
  required: ["merchant", "paidAt", "amount", "cardNumber"],
  propertyOrdering: ["merchant", "paidAt", "amount", "cardNumber"],
};

export const PROMPT = `너는 한국 영수증·카드전표를 읽는 도구다. 이미지에서 아래 네 가지만 뽑아 JSON 으로 답한다.

merchant: 실제로 결제한 가게의 상호명.
  - 카드사(KB국민카드, 신한카드 등)나 VAN 사(KIS정보통신, 나이스정보통신, KOVAN 등) 이름은 상호가 아니다. 고르지 마라.
  - 여신금융협회 같은 안내 문구에 나오는 기관명도 상호가 아니다.
  - 상호는 대표자 이름이나 전화번호가 적힌 줄의 오른쪽 끝, 또는 영수증 맨 위 큰 글씨에 있는 경우가 많다.

amount: 실제로 결제한 최종 총액. 부가세를 포함한 금액이다.
  - "합계", "합 계", "총액", "카드매출", "카드" 로 적힌 값을 쓴다.
  - "공급가", "공급가액", "금액"(부가세 별도 표기), "부가세", "세액", 품목 단가, 품목별 소계는 절대 고르지 마라.
  - 공급가와 부가세가 따로 적혀 있으면 두 값을 더한 값이 총액이다.
  - 숫자만 정수로 적는다. 쉼표와 "원" 은 빼라.

paidAt: 거래일시 / 승인일시 / 판매시간. 한국 시간(KST, +09:00)이다.
  - "YYYY-MM-DDTHH:mm:ss+09:00" 형식으로 적어라.
  - 연도가 두 자리면 2000년대로 해석한다. 예: 26/09/04 -> 2026-09-04.
  - "20260915 12:38:27" 처럼 구분자가 없어도 연-월-일 시:분:초로 풀어라.

cardNumber: 영수증에 찍힌 카드번호를 마스킹된 모양 그대로 옮긴다.
  - 별표(*)를 지우거나 채워 넣지 마라. 하이픈도 있으면 있는 그대로 둔다.
  - 예: "4265-86**-****-****", "42658698********".

읽을 수 없거나 영수증에 없는 항목은 추측하지 말고 null 로 둔다.`;

/** 모델에 보낼 generateContent 요청 본문. */
export function buildRequest(base64, mimeType) {
  return {
    contents: [
      {
        role: "user",
        parts: [
          { text: PROMPT },
          { inline_data: { mime_type: mimeType, data: base64 } },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
      response_mime_type: "application/json",
      response_schema: RECEIPT_SCHEMA,
    },
  };
}

function stripFence(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return (fenced ? fenced[1] : text).trim();
}

function toAmount(value) {
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value) : null;
  if (typeof value !== "string") return null;
  const digits = value.replace(/[^\d]/g, "");
  return digits ? Number.parseInt(digits, 10) : null;
}

/** "2026-09-15", "2026-09-15 12:38", "26/09/04 12:06:09" 등을 KST ISO 문자열로. */
export function normalizePaidAt(value) {
  if (typeof value !== "string") return null;
  const m = value
    .trim()
    .match(
      /^(\d{4}|\d{2})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*(Z|[+-]\d{2}:?\d{2})?$/,
    );
  if (!m) return null;
  const [, yRaw, mo, d, hh = "0", mi = "00", ss = "00", zoneRaw] = m;
  const year = yRaw.length === 2 ? `20${yRaw}` : yRaw;
  const zone = !zoneRaw
    ? "+09:00"
    : zoneRaw === "Z"
      ? "+00:00"
      : zoneRaw.includes(":")
        ? zoneRaw
        : `${zoneRaw.slice(0, 3)}:${zoneRaw.slice(3)}`;
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${year}-${p(mo)}-${p(d)}T${p(hh)}:${p(mi)}:${p(ss)}${zone}`;
}

function toText(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** generateContent 응답에서 모델이 낸 JSON 을 꺼내 네 필드로 정규화한다. */
export function parseResponse(json) {
  const parts = json?.candidates?.[0]?.content?.parts;
  const text = Array.isArray(parts)
    ? parts
        .map((p) => p?.text ?? "")
        .join("")
        .trim()
    : "";
  if (!text) {
    const reason = json?.candidates?.[0]?.finishReason ?? json?.promptFeedback?.blockReason ?? "unknown";
    throw new Error(`모델 응답에 텍스트가 없다 (finishReason: ${reason})`);
  }

  const data = JSON.parse(stripFence(text));
  return {
    merchant: toText(data.merchant),
    paidAt: normalizePaidAt(data.paidAt),
    amount: toAmount(data.amount),
    cardNumber: toText(data.cardNumber),
  };
}
