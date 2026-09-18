import { supabase } from "./supabase";
import type { CardBalance, CardInput, NewPayment, OcrQuota, PaymentWithCard } from "./types";
import { AppError } from "./errors";

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

/** 새 결제의 id 를 돌려준다. 영수증 사진을 같은 id 로 이어 붙이려면 필요하다. */
export async function insertPayment(p: NewPayment): Promise<string> {
  const { data, error } = await supabase.from("payments").insert(p).select("id").single();
  if (error) throw error;
  return (data as { id: string }).id;
}

/** 영수증 사진의 저장소 경로. 규칙은 {owner_id}/{payment_id}.jpg 이고 정책이 첫 폴더로 소유자를 가린다. */
async function receiptPath(paymentId: string): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) throw new AppError("로그인이 필요합니다");
  return `${userId}/${paymentId}.jpg`;
}

/** 결제를 저장해 id 를 받은 뒤에 부른다. 경로가 새 결제 id 라 upsert 가 실제로 덮을 일은 없다. */
export async function uploadReceipt(paymentId: string, blob: Blob): Promise<void> {
  const { error } = await supabase.storage
    .from("receipts")
    .upload(await receiptPath(paymentId), blob, { contentType: "image/jpeg", upsert: true });
  if (error) throw error;
}

/** 상세 시트를 열 때만 부른다. 사진이 없는 결제(직접 입력 등)면 null 이고 오류도 null 로 삼킨다. */
export async function getReceiptUrl(paymentId: string): Promise<string | null> {
  try {
    const { data } = await supabase.storage
      .from("receipts")
      .createSignedUrl(await receiptPath(paymentId), 300);
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
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
    throw new AppError(`결제 ${count ?? 0}건이 있어 삭제할 수 없습니다`);
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
