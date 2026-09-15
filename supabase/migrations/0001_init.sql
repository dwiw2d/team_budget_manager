-- SW2HW 장부 초기 스키마. 설계 스펙 §4 (docs/superpowers/specs/2026-09-16-sw2hw-ledger-design.md) 를 그대로 구현한다.
-- 클라우드에 적용된 뒤에는 이 파일을 수정하지 않는다. 변경이 필요하면 0002 파일을 만든다.

-- 1. 테이블 ---------------------------------------------------------------

create table public.cards (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id),
  name text not null check (length(trim(name)) between 1 and 40),
  initial_balance bigint not null check (initial_balance >= 0),
  last4 text check (last4 ~ '^[0-9]{4}$'),
  reset_date date,
  created_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id),
  card_id uuid not null references public.cards(id) on delete restrict,
  merchant text not null check (length(trim(merchant)) between 1 and 100),
  amount bigint not null check (amount > 0),
  paid_at timestamptz not null,
  memo text check (length(memo) <= 200),
  ocr_card_number text check (length(ocr_card_number) <= 32),
  source text not null check (source in ('receipt', 'manual')),
  canceled_at timestamptz,
  created_at timestamptz not null default now()
);
create index payments_card_paid_idx on public.payments (card_id, paid_at desc);
create index payments_owner_paid_idx on public.payments (owner_id, paid_at desc);

-- 2. 행 단위 접근 제어 (RLS) ----------------------------------------------
-- authenticated 만 owner_id = auth.uid() 조건으로 접근. anon 정책 없음.
-- payments 에는 delete 정책이 없다(삭제 불가, 잘못된 결제는 취소한다).

alter table public.cards enable row level security;
alter table public.payments enable row level security;

create policy cards_select on public.cards
  for select to authenticated using (owner_id = auth.uid());
create policy cards_insert on public.cards
  for insert to authenticated with check (owner_id = auth.uid());
create policy cards_update on public.cards
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy cards_delete on public.cards
  for delete to authenticated using (owner_id = auth.uid());

create policy payments_select on public.payments
  for select to authenticated using (owner_id = auth.uid());
create policy payments_insert on public.payments
  for insert to authenticated with check (owner_id = auth.uid());
create policy payments_update on public.payments
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- 3. payments 갱신 트리거 ---------------------------------------------------
-- memo 변경과 canceled_at 의 null → 값 전이만 허용. 새로 취소되면 서버 시각 now() 로 덮어쓴다.

create function public.payments_before_update() returns trigger
language plpgsql as $$
begin
  if new.id is distinct from old.id
     or new.owner_id is distinct from old.owner_id
     or new.card_id is distinct from old.card_id
     or new.merchant is distinct from old.merchant
     or new.amount is distinct from old.amount
     or new.paid_at is distinct from old.paid_at
     or new.ocr_card_number is distinct from old.ocr_card_number
     or new.source is distinct from old.source
     or new.created_at is distinct from old.created_at then
    raise exception 'payments: memo 와 취소 외에는 수정할 수 없습니다';
  end if;

  if new.canceled_at is distinct from old.canceled_at then
    if old.canceled_at is not null then
      raise exception 'payments: 취소는 되돌릴 수 없습니다';
    end if;
    new.canceled_at := now();
  end if;

  return new;
end
$$;

create trigger payments_before_update
  before update on public.payments
  for each row execute function public.payments_before_update();

-- 4. 뷰 card_balances ------------------------------------------------------
-- cards 의 모든 컬럼 + balance. security_invoker 로 호출자의 RLS 가 적용된다.
-- balance = 초기 잔액 − (마지막 초기화 기준일 이후, 취소되지 않은 결제 합). 날짜 비교는 Asia/Seoul 기준.

create view public.card_balances with (security_invoker = true) as
select
  c.*,
  (c.initial_balance - coalesce((
    select sum(p.amount)
    from public.payments p
    where p.card_id = c.id
      and p.canceled_at is null
      and (c.reset_date is null or (p.paid_at at time zone 'Asia/Seoul')::date >= c.reset_date)
  ), 0))::bigint as balance
from public.cards c;

-- 5. 함수 purge_old_payments ------------------------------------------------
-- 이번 달 포함 최근 3개월보다 오래되고, 카드의 초기화 기준일보다 앞선 결제만 삭제한다.
-- auth.uid() 가 null 이면 아무것도 지우지 않고 0 을 반환한다.

create function public.purge_old_payments() returns integer
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
     and c.reset_date is not null
     and (p.paid_at at time zone 'Asia/Seoul')::date < cutoff
     and (p.paid_at at time zone 'Asia/Seoul')::date < c.reset_date;

  get diagnostics deleted = row_count;
  return deleted;
end
$$;

revoke execute on function public.purge_old_payments() from public, anon;
grant execute on function public.purge_old_payments() to authenticated;
