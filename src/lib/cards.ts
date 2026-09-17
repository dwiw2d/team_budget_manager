import type { Card } from "./types";

/** 자동 선택 결과. `ambiguous` 는 앞자리가 겹치는 카드가 두 장 이상이라 고르지 못했다는 뜻이다. */
export interface AutoCard {
  cardId: string;
  ambiguous: boolean;
  matchCount: number;
}

/**
 * 카드 자동 선택(스펙 §6-3). 한국 카드전표는 뒤 4자리가 가려지므로(실측 "4265-86**-****-****",
 * "42658698********") 앞자리로 맞춘다. 읽은 번호에서 공백·하이픈을 걷어낸 뒤 첫 마스킹 문자
 * 앞까지의 연속된 숫자를 뽑고, 카드의 card_prefix 와 앞에서부터 비교한다. 비교 길이는 둘 중
 * 짧은 쪽이며 6자리 미만이면 자동 선택하지 않는다. 정확히 한 장만 일치할 때만 그 id 를 주고,
 * 두 장 이상이면 고르지 않되 겹쳤다는 것(ambiguous)을 알린다.
 */
export function autoCardId(cards: Pick<Card, "id" | "card_prefix">[], cardNumber: string | null): AutoCard {
  const head = (cardNumber ?? "").replace(/[\s-]/g, "").match(/^\d+/)?.[0] ?? "";
  const matches = cards.filter((c) => {
    const prefix = c.card_prefix ?? "";
    const n = Math.min(head.length, prefix.length);
    return n >= 6 && head.slice(0, n) === prefix.slice(0, n);
  });
  return {
    cardId: matches.length === 1 ? matches[0].id : "",
    ambiguous: matches.length > 1,
    matchCount: matches.length,
  };
}
