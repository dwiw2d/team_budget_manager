-- Supabase 무료 요금제는 7일간 데이터베이스 활동이 낮으면 프로젝트를 자동으로 일시정지한다
-- (https://supabase.com/docs/guides/platform/free-project-pausing). 기준은 "지난 한 주 동안 하루 몇 건의 요청" 이다.
-- 내장 pg_cron 으로는 못 푼다. 데이터베이스 안에서 도는 작업이라 바깥에서 들어온 요청으로 세어지지 않는다.
-- 그래서 요청은 GitHub Actions 가 매일 바깥에서 보내고(.github/workflows/keepalive.yml),
-- 여기서는 그 요청이 두드릴 표와 함수만 만든다. 배경과 운용은 docs/ops/keepalive.md 에 적었다.
-- 0001~0006 은 이미 적용됐거나 다른 작업자가 쓰는 중이므로 수정하지 않는다.

-- 1. 테이블 ---------------------------------------------------------------
-- 행은 영원히 하나(id=1)다. check 로 못을 박아 두 번째 행이 생길 여지를 없앤다.

create table public.keepalive (
  id smallint primary key default 1 check (id = 1),
  last_ping timestamptz not null default now()
);

insert into public.keepalive (id) values (1);

-- 2. 행 단위 접근 제어 (RLS) ----------------------------------------------
-- 정책은 만들지 않는다. 표에는 아무도 직접 손대지 않고 아래 ping() 으로만 들어온다.

alter table public.keepalive enable row level security;

revoke all on public.keepalive from anon, authenticated;

-- 3. 함수 ping --------------------------------------------------------------
-- 읽기가 아니라 쓰기여야 한다. select 만 하면 활동으로 안 잡힐 여지가 있다.

create function public.ping() returns timestamptz
language sql security definer set search_path = public as $$
  update keepalive set last_ping = now() where id = 1 returning last_ping
$$;

-- 4. 실행 권한 --------------------------------------------------------------
-- 하는 일이 시각 갱신뿐이라 로그인 없이(anon) 불러도 안전하다. 그 밖의 권한은 주지 않는다.

revoke execute on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated;
