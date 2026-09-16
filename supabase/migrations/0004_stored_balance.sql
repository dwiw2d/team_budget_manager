-- 잔액을 조회할 때 계산하지 않고 cards 에 저장한다.
-- 사용자가 누르는 초기화는 없앤다. 대신 매월 1일 0시(KST)에 잔액이 초기 잔액으로 다시 채워진다.
-- 스케줄러나 배치는 두지 않는다. 넘김은 (1) 결제 트리거가 손대기 직전에, (2) 앱 진입 시 roll_over_balances() 로,
-- (3) 아직 둘 다 안 돌았을 때를 위해 뷰 card_balances 가 조회 시 보정해서 일어난다.
-- 0001~0003 은 이미 클라우드에 적용됐으므로 수정하지 않는다.

-- 1. 헬퍼 함수 -------------------------------------------------------------
-- 지금의 잔액 기간이 시작한 날(= 이번 달 1일, KST). 아래 여러 곳에서 쓴다.

create function public.current_period_start() returns date
language sql stable as $$
  select (date_trunc('month', now() at time zone 'Asia/Seoul'))::date
$$;

-- 2. 컬럼 교체 -------------------------------------------------------------
-- 뷰가 cards.* 를 참조하므로 컬럼을 바꾸려면 뷰를 먼저 떨어뜨린다(0002·0003 과 같은 방식).

drop view public.card_balances;

alter table public.cards
  add column balance bigint not null default 0,
  add column balance_month date not null default (date_trunc('month', now() at time zone 'Asia/Seoul'))::date;

-- 기존 카드의 잔액을 새 규칙으로 채운다: 초기 잔액 − 이번 달 1일 0시(KST) 이후의 취소되지 않은 결제 합.
update public.cards c
   set balance_month = public.current_period_start(),
       balance = c.initial_balance - coalesce((
         select sum(p.amount)
           from public.payments p
          where p.card_id = c.id
            and p.canceled_at is null
            and p.paid_at >= (public.current_period_start()::timestamp at time zone 'Asia/Seoul')
       ), 0);

alter table public.cards drop column reset_at;

-- 3. 결제 트리거 -------------------------------------------------------------
-- insert 는 잔액에서 빼고, canceled_at 이 null → 값으로 바뀌는 취소는 다시 더한다.
-- 손대기 전에 잔액 기간이 지났으면 먼저 초기 잔액으로 넘긴다.
-- 결제 날짜가 그 잔액 기간(balance_month 의 0시 KST) 이후일 때만 잔액을 건드린다.
-- 지난달 영수증을 늦게 넣으면 내역에만 들어가고 이번 달 잔액은 그대로다. 취소도 같은 기준이다.

create function public.payments_adjust_balance() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  c cards%rowtype;
  period_start date := current_period_start();
begin
  -- update 는 '취소되지 않음 → 취소됨' 전이일 때만 잔액을 건드린다(메모 수정 등은 무시).
  if tg_op = 'UPDATE' and not (old.canceled_at is null and new.canceled_at is not null) then
    return null;
  end if;

  select * into c from cards where id = new.card_id for update;
  if not found then
    return null;
  end if;

  if c.balance_month < period_start then
    c.balance := c.initial_balance;
    c.balance_month := period_start;
  end if;

  if new.paid_at >= (c.balance_month::timestamp at time zone 'Asia/Seoul') then
    c.balance := c.balance + case when tg_op = 'INSERT' then -new.amount else new.amount end;
  end if;

  update cards set balance = c.balance, balance_month = c.balance_month where id = c.id;
  return null;
end
$$;

create trigger payments_adjust_balance
  after insert or update of canceled_at on public.payments
  for each row execute function public.payments_adjust_balance();

-- 4. 카드 생성 트리거 -------------------------------------------------------
-- 새 카드의 잔액은 초기 잔액에서 시작한다. 컬럼 default 는 다른 컬럼을 참조할 수 없으므로
-- (위 default 0 은 기존 행을 not null 로 채우려고 둔 것) 여기서 맞춘다.

create function public.cards_set_balance() returns trigger
language plpgsql as $$
begin
  new.balance := new.initial_balance;
  new.balance_month := public.current_period_start();
  return new;
end
$$;

create trigger cards_before_insert
  before insert on public.cards
  for each row execute function public.cards_set_balance();

-- 5. 함수 roll_over_balances -------------------------------------------------
-- 호출한 사용자의 카드 중 잔액 기간이 지난 것을 모두 초기 잔액으로 넘기고 넘긴 카드 수를 돌려준다.
-- auth.uid() 가 null 이면 아무것도 넘기지 않고 0 을 반환한다(purge_old_payments 와 같은 규칙·권한).

create function public.roll_over_balances() returns integer
language plpgsql security definer set search_path = public as $$
declare
  rolled integer;
begin
  if auth.uid() is null then
    return 0;
  end if;

  update cards
     set balance = initial_balance,
         balance_month = current_period_start()
   where owner_id = auth.uid()
     and balance_month < current_period_start();

  get diagnostics rolled = row_count;
  return rolled;
end
$$;

revoke execute on function public.roll_over_balances() from public, anon;
grant execute on function public.roll_over_balances() to authenticated;

-- 6. 뷰 card_balances 재생성 -------------------------------------------------
-- balance 는 이제 저장값이지만, 넘김이 아직 안 돈 카드도 화면에는 맞게 보여야 한다.
-- 그래서 잔액 기간이 지난 카드는 조회 시 초기 잔액으로 보정해서 낸다.
-- balance·balance_month 는 아래에서 다시 내므로 c.* 대신 나머지 컬럼을 그대로 나열한다(이름이 겹칠 수 없다).

create view public.card_balances with (security_invoker = true) as
select
  c.id,
  c.owner_id,
  c.name,
  c.initial_balance,
  c.card_prefix,
  c.created_at,
  (case when c.balance_month < public.current_period_start() then c.initial_balance else c.balance end)::bigint as balance,
  greatest(c.balance_month, public.current_period_start()) as balance_month
from public.cards c;

-- 7. 함수 purge_old_payments 재생성 ------------------------------------------
-- reset_at 이 없어졌으므로 그 조건을 뺀다. 이번 달 1일에서 2개월 전보다 오래된 결제만 지운다.

create or replace function public.purge_old_payments() returns integer
language plpgsql security definer set search_path = public as $$
declare
  cutoff date;
  deleted integer;
begin
  if auth.uid() is null then
    return 0;
  end if;

  cutoff := (current_period_start() - interval '2 months')::date;

  delete from payments
   where owner_id = auth.uid()
     and (paid_at at time zone 'Asia/Seoul')::date < cutoff;

  get diagnostics deleted = row_count;
  return deleted;
end
$$;

revoke execute on function public.purge_old_payments() from public, anon;
grant execute on function public.purge_old_payments() to authenticated;
