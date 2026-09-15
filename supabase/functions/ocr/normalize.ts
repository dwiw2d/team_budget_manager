// 네이버 CLOVA OCR "Document OCR > 영수증" 응답을 앱이 쓰는 형태로 정규화한다.
// Deno/Node 의존성 없는 순수 TS. Vitest(normalize.test.ts)와 Edge Function(index.ts) 양쪽에서 쓴다.
//
// 확인한 공식 문서 (2026-09-16 확인):
//   https://api.ncloud-docs.com/docs/ai-application-service-ocr-ocrdocumentocr-receipt
//   (개요: https://api.ncloud-docs.com/docs/ai-application-service-ocr)
//
// 응답 필드 경로 (images[0].receipt.result 기준, 문서 예시 응답으로 확인):
//   images[0].inferResult                              "SUCCESS" | "ERROR" (ERROR 면 receipt 자체가 없음)
//   storeInfo.name.text                                → merchant      (예 "**마트")
//   paymentInfo.date.formatted.{year,month,day}        → paidAt 날짜   (문자열, 예 "2014","01","21")
//   paymentInfo.time.formatted.{hour,minute,second}    → paidAt 시각   (문자열, 예 "16","53","00")
//   paymentInfo.cardInfo.number.text                   → cardNumber    (예 "37L 80-****-")
//   totalPrice.price.formatted.value                   → amount        (문자열 "1600"; 없으면 .text "1,600" 에서 숫자만)
// 각 인식 필드는 text / formatted / keyText / confidenceScore / boundingPolys / maskingPolys 를 가진다.

export interface OcrResult {
  merchant: string | null;
  /** YYYY-MM-DDTHH:mm:ss+09:00. 날짜를 못 읽으면 null, 시각만 없으면 00:00:00. */
  paidAt: string | null;
  amount: number | null;
  cardNumber: string | null;
}

interface Field {
  text?: string;
  formatted?: Record<string, string | undefined>;
}

interface NaverReceiptResponse {
  images?: Array<{
    inferResult?: string;
    receipt?: {
      result?: {
        storeInfo?: { name?: Field };
        paymentInfo?: { date?: Field; time?: Field; cardInfo?: { number?: Field } };
        totalPrice?: { price?: Field };
      };
    };
  }>;
}

function text(field: Field | undefined): string | null {
  const value = field?.text?.trim();
  return value ? value : null;
}

function digits(value: string | undefined): number | null {
  const found = value?.replace(/[^0-9]/g, "");
  return found ? Number(found) : null;
}

function part(value: string | undefined, min: number, max: number): string | null {
  const n = digits(value);
  if (n === null || n < min || n > max) return null;
  return String(n).padStart(2, "0");
}

function paidAt(date: Field | undefined, time: Field | undefined): string | null {
  const year = digits(date?.formatted?.year);
  const month = part(date?.formatted?.month, 1, 12);
  const day = part(date?.formatted?.day, 1, 31);
  if (year === null || year < 1000 || month === null || day === null) return null;
  const hour = part(time?.formatted?.hour, 0, 23) ?? "00";
  const minute = part(time?.formatted?.minute, 0, 59) ?? "00";
  const second = part(time?.formatted?.second, 0, 59) ?? "00";
  return `${year}-${month}-${day}T${hour}:${minute}:${second}+09:00`;
}

export function normalizeNaverReceipt(body: unknown): OcrResult {
  const result = (body as NaverReceiptResponse)?.images?.[0]?.receipt?.result;
  const price = result?.totalPrice?.price;
  return {
    merchant: text(result?.storeInfo?.name),
    paidAt: paidAt(result?.paymentInfo?.date, result?.paymentInfo?.time),
    amount: digits(price?.formatted?.value) ?? digits(price?.text),
    cardNumber: text(result?.paymentInfo?.cardInfo?.number),
  };
}
