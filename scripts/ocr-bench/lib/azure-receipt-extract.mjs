// Azure AI Document Intelligence prebuilt-receipt (API 2024-11-30) 응답 -> 앱이 쓰는 네 필드.
// 필드 스키마: https://github.com/Azure-Samples/document-intelligence-code-samples/blob/main/schema/2024-11-30-ga/receipt.md
// 값 표현: https://learn.microsoft.com/en-us/rest/api/aiservices/document-models/get-analyze-result?view=rest-aiservices-v4.0%20(2024-11-30)

/**
 * @param {object} response GET analyzeResults 응답 전체 (status/analyzeResult 포함)
 * @returns {{merchant: string|null, paidAt: string|null, amount: number|null, cardNumber: string|null}}
 */
export function extract(response) {
  const fields = response?.analyzeResult?.documents?.[0]?.fields ?? {};

  return {
    merchant: fields.MerchantName?.valueString ?? null,
    paidAt: toPaidAt(fields.TransactionDate?.valueDate, fields.TransactionTime?.valueTime),
    // Total 만 본다. Subtotal 은 부가세가 빠진 금액이라 대체하면 안 된다.
    amount: fields.Total?.valueCurrency?.amount ?? null,
    // prebuilt-receipt 스키마에 카드번호 필드가 없다. Payments.*.Method / Payments.*.Amount 뿐이라 항상 null.
    cardNumber: null,
  };
}

// valueDate 는 "YYYY-MM-DD", valueTime 은 24시간제 "HH:mm:ss".
function toPaidAt(date, time) {
  if (!date) return null;
  const hhmmss = !time ? '00:00:00' : time.length === 5 ? `${time}:00` : time;
  return `${date}T${hhmmss}+09:00`;
}
