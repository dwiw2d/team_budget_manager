// CLOVA 파서 결과와 Gemini 보완 결과를 합치는 규칙 (설계 스펙 §5). 순수 모듈.
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
