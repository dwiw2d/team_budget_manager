/** 스펙 §4 DDL 의 컬럼을 그대로 옮긴 타입. 컬럼 이름을 바꾸지 않는다. */

export interface Card {
  id: string;
  owner_id: string;
  name: string;
  initial_balance: number;
  /** 카드번호 앞 6~8자리 또는 null. 영수증은 뒤 4자리를 가리므로 앞자리로 맞춘다 */
  card_prefix: string | null;
  created_at: string;
}

/** 뷰 card_balances: cards 의 컬럼 + 저장된 잔액. 잔액 기간이 지났으면 뷰가 조회 시 보정해 낸다. */
export interface CardBalance extends Card {
  balance: number;
  /** 잔액이 속한 달의 1일(YYYY-MM-DD, KST) */
  balance_month: string;
}

export type PaymentSource = "receipt" | "manual";

export interface Payment {
  id: string;
  owner_id: string;
  card_id: string;
  merchant: string;
  amount: number;
  paid_at: string;
  memo: string | null;
  ocr_card_number: string | null;
  source: PaymentSource;
  canceled_at: string | null;
  created_at: string;
}

/** payments join cards(name) */
export interface PaymentWithCard extends Payment {
  cards: { name: string } | null;
}

export interface NewPayment {
  card_id: string;
  merchant: string;
  amount: number;
  paid_at: string;
  memo: string | null;
  ocr_card_number: string | null;
  source: PaymentSource;
}

export interface CardInput {
  name: string;
  initial_balance: number;
  card_prefix: string | null;
}

/** RPC ocr_quota() 의 제공자별 상태. 한도는 프로젝트 API 키에 붙으므로 사용자별이 아니다. */
export interface ProviderQuota {
  provider: string;
  /** 'YYYY-MM'(월 한도) 또는 'YYYY-MM-DD'(일 한도), KST */
  period: string;
  used: number;
  limit_count: number;
  remaining: number;
  available: boolean;
}

/** RPC ocr_quota() 반환값. available 은 두 제공자 중 하나라도 쓸 수 있으면 true. */
export interface OcrQuota {
  available: boolean;
  clova: ProviderQuota;
  gemini: ProviderQuota;
}
