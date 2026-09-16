// 두 테스트 영수증에 대해 Gemini 가 돌려줄 법한 generateContent 응답.
// 실제 호출 없이 parseResponse 를 검증하려고 손으로 만든 것이다.

/** receipt-1.png (KIS정보통신 VAN 전표) — 스키마대로 깔끔하게 온 경우. */
export const receipt1Clean = {
  candidates: [
    {
      content: {
        role: "model",
        parts: [
          {
            text: '{"merchant": "동남집", "paidAt": "2026-09-04T12:06:09+09:00", "amount": 59000, "cardNumber": "4265-86**-****-****"}',
          },
        ],
      },
      finishReason: "STOP",
    },
  ],
  usageMetadata: { promptTokenCount: 1587, candidatesTokenCount: 58, totalTokenCount: 1645 },
  modelVersion: "gemini-2.5-flash",
};

export const receipt1Expected = {
  merchant: "동남집",
  paidAt: "2026-09-04T12:06:09+09:00",
  amount: 59000,
  cardNumber: "4265-86**-****-****",
};

/** receipt-2.png (POS 카드판매 영수증) — 지저분하게 온 경우.
 *  코드 블록으로 감쌌고, 금액이 "36,000원" 문자열이고, 날짜에 시각이 없다. */
export const receipt2Messy = {
  candidates: [
    {
      content: {
        role: "model",
        parts: [
          {
            text:
              "```json\n" +
              "{\n" +
              '  "merchant": " 세상끝의라멘 ",\n' +
              '  "paidAt": "2026-09-15",\n' +
              '  "amount": "36,000원",\n' +
              '  "cardNumber": "42658698********"\n' +
              "}\n" +
              "```",
          },
        ],
      },
      finishReason: "STOP",
    },
  ],
  usageMetadata: { promptTokenCount: 1602, candidatesTokenCount: 71, totalTokenCount: 1673 },
  modelVersion: "gemini-2.5-flash",
};

export const receipt2Expected = {
  merchant: "세상끝의라멘",
  paidAt: "2026-09-15T00:00:00+09:00",
  amount: 36000,
  cardNumber: "42658698********",
};

/** 안전 필터 등으로 텍스트가 없는 응답. */
export const blocked = {
  candidates: [{ content: { role: "model", parts: [] }, finishReason: "SAFETY" }],
};
