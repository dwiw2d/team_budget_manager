-- Supabase 보안 린터와 감사에서 나온 권한 정리. 스키마도 함수 본문도 바꾸지 않는다.
--   1. SECURITY DEFINER 함수 payments_adjust_balance 의 EXECUTE 를 회수한다.
--      트리거 함수라 직접 호출은 Postgres 가 어차피 막지만, 같은 저장소의 delete_receipt_object(0008)
--      와 패턴을 맞추고 린터 경고를 없앤다.
--   2. search_path 가 고정되지 않은 함수 4개에 search_path = public 을 박는다.
--      고정하지 않으면 호출자가 심어 둔 스키마의 동명 객체를 먼저 집을 수 있다.
--   3. cards / payments / card_balances 에 anon 롤로 열려 있는 테이블 권한을 회수한다.
--      RLS 정책이 authenticated 전용이라 anon 은 이미 막혀 있지만 방어선이 그것 하나뿐이다.
--      authenticated 권한은 건드리지 않는다(앱이 죽는다). keepalive 의 ping() 도 그대로 둔다(anon 이 부른다).

-- 1. SECURITY DEFINER 트리거 함수 -------------------------------------------

revoke execute on function public.payments_adjust_balance() from public, anon, authenticated;

-- 2. search_path 고정 --------------------------------------------------------

alter function public.payments_before_update() set search_path = public;
alter function public.current_period_start() set search_path = public;
alter function public.cards_set_balance() set search_path = public;
alter function public.ocr_period(text) set search_path = public;

-- 3. anon 테이블 권한 회수 ---------------------------------------------------

revoke all on public.cards, public.payments, public.card_balances from anon;
