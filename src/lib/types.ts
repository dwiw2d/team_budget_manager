/** 스펙 §4 DDL 의 컬럼을 그대로 옮긴 타입. 컬럼 이름을 바꾸지 않는다. */

export interface Card {
  id: string;
  owner_id: string;
  name: string;
  initial_balance: number;
  last4: string | null;
  /** "YYYY-MM-DD" 또는 null(초기화 전) */
  reset_date: string | null;
  created_at: string;
}

/** 뷰 card_balances: cards 의 모든 컬럼 + balance */
export interface CardBalance extends Card {
  balance: number;
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
  last4: string | null;
}
