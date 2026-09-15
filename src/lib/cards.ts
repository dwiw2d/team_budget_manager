import type { Card } from "./types";

/**
 * 카드 자동 선택(스펙 §6-3, PM 확정 규칙): 읽은 카드번호에서 공백·하이픈을 제거한 뒤 마지막 4문자가
 * 모두 숫자일 때만 last4 와 비교하고, 같은 카드가 정확히 하나면 그 id. 끝이 마스킹(`****`)돼 있으면
 * 가운데 숫자로 맞추지 않고 선택하지 않는다.
 */
export function autoCardId(cards: Pick<Card, "id" | "last4">[], cardNumber: string | null): string {
  const tail = (cardNumber ?? "").replace(/[\s-]/g, "").slice(-4);
  if (!/^\d{4}$/.test(tail)) return "";
  const matches = cards.filter((c) => c.last4 === tail);
  return matches.length === 1 ? matches[0].id : "";
}
