import { supabase } from "./supabase";
import type { CardBalance, CardInput, NewPayment, OcrQuota, PaymentWithCard } from "./types";

const PAYMENT_WITH_CARD = "*, cards(name)";

export async function listCardBalances(): Promise<CardBalance[]> {
  const { data, error } = await supabase.from("card_balances").select("*").order("created_at");
  if (error) throw error;
  return data as CardBalance[];
}

export async function listRecentPayments(limit = 5): Promise<PaymentWithCard[]> {
  const { data, error } = await supabase
    .from("payments")
    .select(PAYMENT_WITH_CARD)
    .order("paid_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data as PaymentWithCard[];
}

export async function listPaymentsByMonth(args: {
  startIso: string;
  endIso: string;
  cardId?: string;
}): Promise<PaymentWithCard[]> {
  let q = supabase
    .from("payments")
    .select(PAYMENT_WITH_CARD)
    .gte("paid_at", args.startIso)
    .lt("paid_at", args.endIso)
    .order("paid_at", { ascending: false });
  if (args.cardId) q = q.eq("card_id", args.cardId);
  const { data, error } = await q;
  if (error) throw error;
  return data as PaymentWithCard[];
}

export async function insertPayment(p: NewPayment): Promise<void> {
  const { error } = await supabase.from("payments").insert(p);
  if (error) throw error;
}

export async function updatePaymentMemo(id: string, memo: string | null): Promise<void> {
  const { error } = await supabase.from("payments").update({ memo }).eq("id", id);
  if (error) throw error;
}

/** 취소. 서버 트리거가 canceled_at 을 now() 로 덮어쓴다. */
export async function cancelPayment(id: string): Promise<void> {
  const { error } = await supabase
    .from("payments")
    .update({ canceled_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function insertCard(c: CardInput): Promise<void> {
  const { error } = await supabase.from("cards").insert(c);
  if (error) throw error;
}

export async function updateCard(id: string, c: CardInput): Promise<void> {
  const { error } = await supabase.from("cards").update(c).eq("id", id);
  if (error) throw error;
}

/** 결제가 있으면 FK restrict(23503) 로 실패한다. 건수를 세어 안내 문구로 바꾼다. */
export async function deleteCard(id: string): Promise<void> {
  const { error } = await supabase.from("cards").delete().eq("id", id);
  if (error?.code === "23503") {
    const { count } = await supabase
      .from("payments")
      .select("*", { count: "exact", head: true })
      .eq("card_id", id);
    throw new Error(`결제 ${count ?? 0}건이 있어 삭제할 수 없습니다`);
  }
  if (error) throw error;
}

/** 잔액 기간이 지난 카드를 예산만큼 채우는 RPC. 넘긴 카드 수를 돌려준다. */
export async function rollOverBalances(): Promise<number> {
  const { data, error } = await supabase.rpc("roll_over_balances");
  if (error) throw error;
  return (data as number) ?? 0;
}

/** 3개월 지난 결제 정리 RPC. 삭제 건수를 돌려준다. */
export async function purgeOldPayments(): Promise<number> {
  const { data, error } = await supabase.rpc("purge_old_payments");
  if (error) throw error;
  return (data as number) ?? 0;
}

/** 영수증 인식 무료 한도 상태 RPC. 둘 다 소진이면 available 이 false 다. */
export async function getOcrQuota(): Promise<OcrQuota> {
  const { data, error } = await supabase.rpc("ocr_quota");
  if (error) throw error;
  return data as OcrQuota;
}
