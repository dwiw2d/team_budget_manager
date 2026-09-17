-- 영수증 인식(CLOVA General OCR, Gemini)의 무료 한도를 우리가 직접 센다 (설계 스펙 §5).
-- 두 서비스 모두 "남은 무료 한도" 를 물어볼 수 있는 API 가 없으므로 호출 직전에 세어 두는 수밖에 없다.
-- 한도는 프로젝트의 API 키에 붙는 것이라 사용자별이 아니다. 그래서 owner_id 를 두지 않는다.
-- 기간은 모두 한국 시간 기준이다: CLOVA 는 월 100건, Gemini 는 하루 20건.
-- 0001~0004 는 이미 클라우드에 적용됐으므로 수정하지 않는다.

-- 1. 테이블 ---------------------------------------------------------------
-- 한도 값은 대시보드에서 고칠 수 있도록 코드가 아니라 표에 둔다.

create table public.ocr_limits (
  provider text primary key,
  period_kind text not null check (period_kind in ('month', 'day')),
  limit_count integer not null check (limit_count > 0)
);

insert into public.ocr_limits (provider, period_kind, limit_count) values
  ('clova', 'month', 100),
  ('gemini', 'day', 20);

-- period 는 기간 문자열이다. month 면 'YYYY-MM', day 면 'YYYY-MM-DD'(KST).
-- 기간이 바뀌면 키가 달라져 새 행이 생기므로 따로 초기화할 것이 없다.
-- exhausted_at 은 제공자가 먼저 한도 초과를 알려 준 시각이다(우리 계수가 실제보다 적을 때).

create table public.ocr_usage (
  provider text not null references public.ocr_limits(provider),
  period text not null,
  used integer not null default 0,
  exhausted_at timestamptz,
  primary key (provider, period)
);

-- 2. 행 단위 접근 제어 (RLS) ----------------------------------------------
-- 읽기만 authenticated 에 연다. 쓰기는 아래 security definer 함수로만 한다.

alter table public.ocr_limits enable row level security;
alter table public.ocr_usage enable row level security;

create policy ocr_limits_select on public.ocr_limits
  for select to authenticated using (true);
create policy ocr_usage_select on public.ocr_usage
  for select to authenticated using (true);

revoke all on public.ocr_limits from anon, authenticated;
revoke all on public.ocr_usage from anon, authenticated;
grant select on public.ocr_limits to authenticated;
grant select on public.ocr_usage to authenticated;

-- 3. 헬퍼 ocr_period --------------------------------------------------------
-- 제공자의 period_kind 를 보고 지금 기간 문자열을 만든다. 모르는 제공자면 null.

create function public.ocr_period(p_provider text) returns text
language sql stable as $$
  select case l.period_kind
           when 'month' then to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM')
           else to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD')
         end
    from public.ocr_limits l
   where l.provider = p_provider
$$;

-- 4. 함수 ocr_quota ---------------------------------------------------------
-- 제공자별 상태 + 최상위 available(둘 중 하나라도 쓸 수 있으면 true).
-- 예: {"clova": {...}, "gemini": {...}, "available": true}

create function public.ocr_quota() returns jsonb
language sql stable security definer set search_path = public as $$
  with q as (
    select l.provider,
           public.ocr_period(l.provider) as period,
           coalesce(u.used, 0) as used,
           l.limit_count,
           (u.exhausted_at is null and coalesce(u.used, 0) < l.limit_count) as available
      from ocr_limits l
      left join ocr_usage u
        on u.provider = l.provider
       and u.period = public.ocr_period(l.provider)
  )
  select jsonb_build_object('available', coalesce(bool_or(q.available), false))
      || jsonb_object_agg(q.provider, jsonb_build_object(
           'provider', q.provider,
           'period', q.period,
           'used', q.used,
           'limit_count', q.limit_count,
           'remaining', greatest(q.limit_count - q.used, 0),
           'available', q.available))
    from q
$$;

-- 5. 함수 ocr_quota_consume -------------------------------------------------
-- 제공자를 부르기 직전에 1건을 미리 깎는다(응답이 유실돼도 과금분은 세어지도록).
-- 이미 쓸 수 없는 상태면 아무것도 하지 않고 false 를 돌려준다.

create function public.ocr_quota_consume(p_provider text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  p text := public.ocr_period(p_provider);
  lim integer;
begin
  select limit_count into lim from ocr_limits where provider = p_provider;
  if lim is null then
    return false;
  end if;

  insert into ocr_usage (provider, period) values (p_provider, p)
    on conflict (provider, period) do nothing;

  -- 조건을 update 의 where 에 두어 동시 호출에도 한도를 넘기지 않는다.
  update ocr_usage
     set used = used + 1
   where provider = p_provider
     and period = p
     and exhausted_at is null
     and used < lim;

  return found;
end
$$;

-- 6. 함수 ocr_quota_exhaust -------------------------------------------------
-- 제공자가 한도 초과(HTTP 429 등)를 알려 오면 우리 계수와 상관없이 이번 기간을 닫는다.

create function public.ocr_quota_exhaust(p_provider text) returns void
language plpgsql security definer set search_path = public as $$
declare
  p text := public.ocr_period(p_provider);
begin
  if p is null then
    return;
  end if;

  insert into ocr_usage (provider, period, exhausted_at) values (p_provider, p, now())
    on conflict (provider, period) do update set exhausted_at = now();
end
$$;

-- 7. 실행 권한 --------------------------------------------------------------

revoke execute on function
  public.ocr_period(text), public.ocr_quota(),
  public.ocr_quota_consume(text), public.ocr_quota_exhaust(text)
  from public, anon;
grant execute on function
  public.ocr_quota(), public.ocr_quota_consume(text), public.ocr_quota_exhaust(text)
  to authenticated;
