-- 초기화를 날짜(reset_date)가 아니라 시각(reset_at)으로 기록한다.
-- 날짜 기준이면 초기화한 당일의 결제가 '>= 기준일' 에 걸려 잔액에서 계속 빠졌다.
-- 시각 기준으로 바꾸면 초기화를 누른 그 순간 잔액이 초기 잔액이 되고, 그 뒤 결제만 잔액을 줄인다.
-- 0001_init.sql 은 이미 클라우드에 적용됐으므로 수정하지 않는다.

-- 1. 컬럼 교체 -------------------------------------------------------------
-- 뷰가 cards.* 를 참조하므로 컬럼을 지우려면 뷰를 먼저 떨어뜨려야 한다.

drop view public.card_balances;

alter table public.cards add column reset_at timestamptz;

update public.cards
   set reset_at = (reset_date::timestamp at time zone 'Asia/Seoul')
 where reset_date is not null;

alter table public.cards drop column reset_date;

-- 2. 뷰 card_balances 재생성 -------------------------------------------------
-- balance = 초기 잔액 − (마지막 초기화 시각 이후, 취소되지 않은 결제 합).

create view public.card_balances with (security_invoker = true) as
select
  c.*,
  (c.initial_balance - coalesce((
    select sum(p.amount)
    from public.payments p
    where p.card_id = c.id
      and p.canceled_at is null
      and (c.reset_at is null or p.paid_at >= c.reset_at)
  ), 0))::bigint as balance
from public.cards c;

-- 3. 함수 purge_old_payments 재생성 ------------------------------------------
-- 이번 달 포함 최근 3개월보다 오래되고, 카드의 마지막 초기화보다 앞선 결제만 삭제한다.

create or replace function public.purge_old_payments() returns integer
language plpgsql security definer set search_path = public as $$
declare
  cutoff date;
  deleted integer;
begin
  if auth.uid() is null then
    return 0;
  end if;

  cutoff := (date_trunc('month', now() at time zone 'Asia/Seoul') - interval '2 months')::date;

  delete from payments p using cards c
   where p.card_id = c.id
     and p.owner_id = auth.uid()
     and c.reset_at is not null
     and (p.paid_at at time zone 'Asia/Seoul')::date < cutoff
     and p.paid_at < c.reset_at;

  get diagnostics deleted = row_count;
  return deleted;
end
$$;

revoke execute on function public.purge_old_payments() from public, anon;
grant execute on function public.purge_old_payments() to authenticated;
