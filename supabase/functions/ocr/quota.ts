// 무료 한도(CLOVA 월 100건, Gemini 하루 20건 — 구글 공식 값이 아니라 제3자 비공식 실측에 맞춘
// 우리 쪽 자체 상한이다. docs/ocr/gemini.md §3)를 보고 어느 제공자를 부를 수 있는지 정하는 순수 모듈
// (설계 스펙 §5). 네트워크·Deno 의존성 없음. index.ts 는 여기 판단만 따르고 조건문을 갖지 않는다.

/** ocr_quota() 가 제공자마다 돌려주는 상태. */
export interface ProviderQuota {
  provider: string;
  /** 'YYYY-MM'(월 한도) 또는 'YYYY-MM-DD'(일 한도), KST */
  period: string;
  used: number;
  limit_count: number;
  remaining: number;
  available: boolean;
}

/** ocr_quota() RPC 의 반환값. 최상위 available 은 둘 중 하나라도 쓸 수 있으면 true. */
export interface OcrQuota {
  available: boolean;
  clova: ProviderQuota;
  gemini: ProviderQuota;
}

export interface Providers {
  clova: boolean;
  gemini: boolean;
  /** 둘 다 못 부른다. 이때는 제공자를 전혀 부르지 않고 429 ocr_quota_exceeded 다. */
  blocked: boolean;
}

/** 한도 상태 → 부를 수 있는 제공자. 상태를 못 읽었으면(null) 선차감도 못 하므로 둘 다 막는다. */
export function decideProviders(quota: OcrQuota | null | undefined): Providers {
  const clova = quota?.clova?.available === true;
  const gemini = quota?.gemini?.available === true;
  return { clova, gemini, blocked: !clova && !gemini };
}

const QUOTA_WORDS = /quota|limit|exceed|초과/i;

/** 제공자 응답이 "한도 초과" 를 뜻하는가. HTTP 429 이거나, 오류 응답의 코드·메시지에 한도를 뜻하는 낱말이 있으면 그렇다.
 *  true 면 우리 계수와 상관없이 그 기간을 닫는다(ocr_quota_exhaust). */
export function isQuotaExceeded(status: number, body: unknown): boolean {
  if (status === 429) return true;
  if (status < 400 || typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  const text = [b.code, b.message, b.errorMessage]
    .filter((v) => typeof v === "string")
    .join(" ");
  return QUOTA_WORDS.test(text);
}
