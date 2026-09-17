import { supabase } from "./supabase";

/** Edge Function `ocr` 응답(스펙 §5). 읽지 못한 항목은 null. */
export interface OcrResult {
  merchant: string | null;
  /** "YYYY-MM-DDTHH:mm:ss+09:00" */
  paidAt: string | null;
  amount: number | null;
  cardNumber: string | null;
  /** 확신하지 못한 필드 이름들("merchant" | "paidAt" | "amount" | "cardNumber"). 화면이 표시한다. */
  uncertain: string[];
}

/** 화면이 구분해야 하는 실패 갈래. quota_exceeded 만 한도 안내를 띄우고 나머지는 같은 문구다. */
export type OcrErrorCode = "quota_exceeded" | "not_configured" | "failed" | "network";

/** 401/429/502/503/네트워크 등 OCR 실패. 화면은 "직접 입력" 안내로 처리한다. */
export class OcrError extends Error {
  constructor(message: string, readonly code: OcrErrorCode = "failed") {
    super(message);
  }
}

/** Edge Function 호출 결과 → 오류 코드. 순수 함수.
 *  본문을 못 읽었으면(body 가 null) 상태 코드만으로 판정하고, 상태 코드도 없으면 failed 다. */
export function ocrErrorCode(
  status: number | undefined,
  body: unknown,
  errorName?: string,
): OcrErrorCode {
  if (errorName === "FunctionsFetchError") return "network";
  const code = (body as { error?: unknown } | null)?.error;
  if (status === 429 && (code === undefined || code === "ocr_quota_exceeded")) return "quota_exceeded";
  if (status === 503) return "not_configured";
  return "failed";
}

const MAX_EDGE = 1600;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new OcrError("이미지를 열 수 없습니다"));
    };
    img.src = url;
  });
}

/** canvas 로 긴 변 1600px, JPEG 0.85 로 줄여 base64(data: 접두어 없음)로 만든다. */
export async function compressImage(file: File): Promise<{ image: string; format: "jpg" }> {
  const img = await loadImage(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return { image: dataUrl.slice(dataUrl.indexOf(",") + 1), format: "jpg" };
}

/** 사진을 줄여 `ocr` 함수에 보내고 정규화된 결과를 받는다. 실패는 OcrError(code 로 갈래를 알린다). */
export async function recognizeReceipt(file: File): Promise<OcrResult> {
  const body = await compressImage(file);
  const { data, error, response } = await supabase.functions.invoke<OcrResult>("ocr", { body });
  if (!error && data) return data;
  const payload = response ? await response.json().catch(() => null) : null;
  throw new OcrError(
    error?.message ?? "empty response",
    ocrErrorCode(response?.status, payload, error?.name),
  );
}
