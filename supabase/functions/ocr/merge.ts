// CLOVA 파서 결과와 Gemini 보완 결과를 합치는 규칙, 그리고 2단계를 부를지 정하는 규칙 (설계 스펙 §5). 순수 모듈.
import type { GeminiResult } from "./gemini.ts";

export const FIELDS = ["merchant", "paidAt", "amount", "cardNumber"] as const;

export interface Merged extends GeminiResult {
  /** 사용자가 확인해야 하는 필드 이름들. 결제 추가 화면이 이 칸을 표시한다. */
  uncertain: string[];
}

/** CLOVA 값을 기준으로 두고 확신 없는 칸만 Gemini 로 메운다.
 *  - CLOVA 가 null 이거나 weak 면 Gemini 값을 쓴다. Gemini 도 못 읽었으면 uncertain 에 남긴다.
 *  - 둘 다 값이 있고 서로 다르면 Gemini 값을 쓰되 그 필드를 uncertain 에 넣는다.
 *  - Gemini 를 안 불렀거나 실패했으면(gemini === null) CLOVA 값을 그대로 쓰고 weak 를 uncertain 으로 옮긴다. */
export function merge(clova: GeminiResult, weak: string[], gemini: GeminiResult | null): Merged {
  if (!gemini) return { ...clova, uncertain: [...weak] };

  const merged = { ...clova } as Record<string, string | number | null>;
  const uncertain: string[] = [];
  for (const f of FIELDS) {
    const mine = clova[f];
    const theirs = gemini[f];
    if (mine === null || weak.includes(f)) {
      merged[f] = theirs ?? mine;
      if (theirs === null && weak.includes(f)) uncertain.push(f);
    } else if (theirs !== null && theirs !== mine) {
      merged[f] = theirs;
      uncertain.push(f);
    }
  }
  return { ...(merged as unknown as GeminiResult), uncertain };
}

/** 1단계(CLOVA) 결과. 실패는 ok:false 하나로 뭉뚱그린다(네트워크·HTTP 오류·inferResult·응답 파싱 모두). */
export type ClovaOutcome =
  | { ok: true; values: GeminiResult; weak: string[] }
  | { ok: false };

/** 네 필드를 하나도 못 읽었으면 성공이 아니다(영수증이 아닌 사진). null 로 바꿔 실패로 만든다. */
function orFail(result: Merged): Merged | null {
  return FIELDS.some((f) => result[f] !== null) ? result : null;
}

/** 2단계를 부를지와 최종 응답을 정한다. null 이면 502 `ocr_failed` 다.
 *  - 1단계 성공: weak 가 있을 때만 Gemini 를 부르고 merge 규칙을 따른다.
 *  - 1단계 실패: Gemini 만으로 답한다. 대조할 근거가 없으므로 값이 있는 칸은 전부 uncertain 이다.
 *  - 어느 경로로 왔든 네 필드가 모두 null 이면 실패다. */
export async function resolve(
  clova: ClovaOutcome,
  askGemini: () => Promise<GeminiResult | null>,
): Promise<Merged | null> {
  if (clova.ok) {
    return orFail(merge(clova.values, clova.weak, clova.weak.length ? await askGemini() : null));
  }
  const gemini = await askGemini();
  if (!gemini) return null;
  return orFail({ ...gemini, uncertain: FIELDS.filter((f) => gemini[f] !== null) });
}
