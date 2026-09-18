/** 서버 원본 오류를 화면에 그대로 내보내지 않는다. RLS 정책 이름·테이블명·제약조건 원문이 새기 때문이다.
 *  Supabase 오류(Postgrest·Auth·Storage)는 code 나 status 를 달고 오므로 그것만 걸러내고,
 *  db.ts 가 직접 만든 안내 문구(둘 다 없는 Error)는 그대로 보여준다. */
export function userMessage(e: unknown, fallback: string): string {
  if (navigator.onLine === false) return "네트워크에 연결할 수 없습니다";
  if (e instanceof Error && !("code" in e) && !("status" in e)) return e.message;
  return fallback;
}
