/** 단일 계정. 로그인 화면은 PIN 6자리만 받는다(스펙 §6-1). */
export const OWNER_EMAIL = "owner@sw2hw.local";

export const PIN_LENGTH = 6;

export const isPin = (v: string) => new RegExp(`^\\d{${PIN_LENGTH}}$`).test(v);

/** 입력 정제: 숫자만 남기고 PIN 길이까지 자른다. */
export const onlyDigits = (v: string) => v.replace(/\D/g, "").slice(0, PIN_LENGTH);
