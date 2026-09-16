-- 카드 자동 선택을 뒤 4자리가 아니라 앞자리로 맞춘다.
-- 한국 카드전표는 카드번호 뒤 4자리가 가려진다(실측 "4265-86**-****-****", "42658698********").
-- 뒤 4자리는 영수증에서 영영 읽을 수 없으므로 cards.last4 를 cards.card_prefix 로 바꾼다.
-- 0001_init.sql, 0002_reset_at.sql 은 이미 클라우드에 적용됐으므로 수정하지 않는다.

-- 1. 컬럼 교체 -------------------------------------------------------------
-- 뷰가 cards.* 를 참조하므로 컬럼을 지우려면 뷰를 먼저 떨어뜨려야 한다(0002 와 같은 방식).
-- 기존 값은 4자리라 새 제약(6~8자리)을 지킬 수 없다. 현재 데이터는 테스트용 2건뿐이라 비운다.

drop view public.card_balances;

alter table public.cards drop column last4;
alter table public.cards add column card_prefix text check (card_prefix ~ '^[0-9]{6,8}$');

-- 2. 뷰 card_balances 재생성 -------------------------------------------------
-- 0002 와 같은 정의. cards.* 가 바뀌었으므로 그대로 다시 만든다.

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
