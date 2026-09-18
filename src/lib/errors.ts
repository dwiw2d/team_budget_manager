/** 우리가 직접 만들어 던지는, 사용자에게 그대로 보여도 되는 한국어 안내 오류. */
export class AppError extends Error {}

/** 서버 원본 오류를 화면에 그대로 내보내지 않는다. RLS 정책 이름·테이블명·제약조건 원문이 새기 때문이다.
 *  Supabase 오류든 fetch 가 실패할 때 브라우저가 던지는 TypeError 든 원문은 전부 fallback 으로 덮고,
 *  db.ts 가 AppError 로 직접 만든 문구만 통과시킨다. */
export function userMessage(e: unknown, fallback: string): string {
  if (navigator.onLine === false) return "네트워크에 연결할 수 없습니다";
  if (e instanceof AppError) return e.message;
  return fallback;
}
