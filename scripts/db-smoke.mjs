// DB 스모크 테스트 (설계 스펙 §9). Management API POST /v1/projects/{ref}/database/query 를
// 개인 액세스 토큰(SUPABASE_ACCESS_TOKEN)으로 호출해 실행한다.
//
// - 이 엔드포인트는 다중문을 보내도 마지막 결과 집합만 돌려주고, begin/rollback 을 호출 사이에 걸쳐 둘 수 없다.
//   그래서 모든 검증을 DO $$ ... $$ 블록 하나에서 수행하고, 마지막에 raise exception 'ROLLBACK_OK <json>' 으로
//   강제 롤백한다. 예외 메시지에 실린 JSON 으로 항목별 PASS/FAIL 을 판정한다. 실 데이터에 흔적을 남기지 않는다.
// - 주의: 이 쿼리는 superuser(postgres) 로 실행되므로 RLS 를 우회한다. RLS 자체는 QA(브라우저)에서 확인한다.
//   같은 이유로 auth.uid() 가 null 이라 owner_id 는 auth.users 의 기존 사용자(sb:seed-owner 로 만든 계정) id 를 쓴다.
process.loadEnvFile(".env.local");

function need(key) {
  const value = process.env[key];
  if (!value) {
    console.error(`.env.local 에 ${key} 가 없습니다`);
    process.exit(1);
  }
  return value;
}

const accessToken = need("SUPABASE_ACCESS_TOKEN");
const projectRef = need("SUPABASE_PROJECT_REF");

const SQL = `
do $$
declare
  owner_uuid uuid;
  card_a uuid;
  card_b uuid;
  pay_30k uuid;
  bal bigint;
  n integer;
  ok boolean;
  detail text;
  cutoff date := (date_trunc('month', now() at time zone 'Asia/Seoul') - interval '2 months')::date;
  results jsonb := '[]'::jsonb;
begin
  select id into owner_uuid from auth.users order by created_at limit 1;
  if owner_uuid is null then
    raise exception 'ROLLBACK_OK %', '[{"item":"pre","ok":false,"detail":"auth.users 에 사용자가 없습니다 (npm run sb:seed-owner 먼저)"}]';
  end if;

  -- (a) 카드 1장(초기 잔액 100000, reset_at null) + 결제 3건(30000, 20000, 어제 10000) → balance 40000
  insert into public.cards (owner_id, name, initial_balance)
    values (owner_uuid, '스모크 카드 A', 100000) returning id into card_a;
  insert into public.payments (owner_id, card_id, merchant, amount, paid_at, source)
    values (owner_uuid, card_a, '스모크 가맹점 1', 30000, now(), 'manual') returning id into pay_30k;
  insert into public.payments (owner_id, card_id, merchant, amount, paid_at, source) values
    (owner_uuid, card_a, '스모크 가맹점 2', 20000, now(), 'manual'),
    (owner_uuid, card_a, '스모크 가맹점 3', 10000, now() - interval '1 day', 'manual');
  select balance into bal from public.card_balances where id = card_a;
  results := results || jsonb_build_object('item', 'a', 'ok', bal = 40000,
    'detail', format('balance=%s (기대 40000)', bal));

  -- (b) amount 수정 시도 → 예외
  begin
    update public.payments set amount = 1 where id = pay_30k;
    ok := false; detail := '예외가 발생하지 않음';
  exception when others then
    ok := true; detail := sqlerrm;
  end;
  results := results || jsonb_build_object('item', 'b', 'ok', ok, 'detail', detail);

  -- (c) 결제 1건 취소 → balance 상승 (30000 제외 → 70000)
  update public.payments set canceled_at = now() where id = pay_30k;
  select balance into bal from public.card_balances where id = card_a;
  results := results || jsonb_build_object('item', 'c', 'ok', bal = 70000,
    'detail', format('balance=%s (기대 70000)', bal));

  -- (d) 취소 되돌리기 시도 → 예외
  begin
    update public.payments set canceled_at = null where id = pay_30k;
    ok := false; detail := '예외가 발생하지 않음';
  exception when others then
    ok := true; detail := sqlerrm;
  end;
  results := results || jsonb_build_object('item', 'd', 'ok', ok, 'detail', detail);

  -- (e) 초기화 직후 잔액 = 초기 잔액 (그 시각 이전 결제는 전부 잔액에서 빠진다)
  update public.cards set reset_at = now() where id = card_a;
  select balance into bal from public.card_balances where id = card_a;
  results := results || jsonb_build_object('item', 'e', 'ok', bal = 100000,
    'detail', format('balance=%s (기대 100000 = 초기 잔액)', bal));

  -- (f) 초기화 이후 결제만 잔액을 줄인다 → 15000 결제 후 85000
  insert into public.payments (owner_id, card_id, merchant, amount, paid_at, source)
    values (owner_uuid, card_a, '초기화 이후 결제', 15000, now(), 'manual');
  select balance into bal from public.card_balances where id = card_a;
  results := results || jsonb_build_object('item', 'f', 'ok', bal = 85000,
    'detail', format('balance=%s (기대 85000)', bal));

  -- (g) purge 규칙: reset_at 이 있고 cutoff 이전이며 reset_at 이전인 결제만 삭제 대상
  insert into public.cards (owner_id, name, initial_balance)
    values (owner_uuid, '스모크 카드 B(초기화 없음)', 50000) returning id into card_b;
  insert into public.payments (owner_id, card_id, merchant, amount, paid_at, source) values
    (owner_uuid, card_a, '4개월 전 결제', 5000, now() - interval '4 months', 'manual'),
    (owner_uuid, card_a, '1개월 전 결제', 5000, now() - interval '1 month', 'manual'),
    (owner_uuid, card_b, '4개월 전 결제(초기화 없음)', 5000, now() - interval '4 months', 'manual');
  select public.purge_old_payments() into n;
  ok := (n = 0);
  detail := format('purge_old_payments()=%s (auth.uid() null → 기대 0)', n);
  with d as (
    delete from public.payments p using public.cards c
     where p.card_id = c.id
       and p.owner_id = owner_uuid
       and c.reset_at is not null
       and (p.paid_at at time zone 'Asia/Seoul')::date < cutoff
       and p.paid_at < c.reset_at
     returning p.id
  )
  select count(*) into n from d;
  ok := ok and (n = 1);
  detail := detail || format('; 동일 조건 delete returning 건수=%s (기대 1: 카드 A 의 4개월 전 결제만)', n);
  results := results || jsonb_build_object('item', 'g', 'ok', ok, 'detail', detail);

  raise exception 'ROLLBACK_OK %', results::text;
end
$$;
`;

// fetch 직후 process.exit() 를 부르면 Windows 에서 libuv 단언 오류가 나므로 exitCode 만 정한다.
async function main() {
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: SQL }),
  });
  const text = await res.text();

  if (res.ok) {
    console.error("FAIL: DO 블록이 예외 없이 끝났습니다(롤백되지 않았을 수 있음)");
    return 1;
  }

  // 응답: { "message": "Failed to run sql query: ERROR:  P0001: ROLLBACK_OK [ ...json... ]\nCONTEXT: ..." }
  let message = text;
  try {
    message = JSON.parse(text).message ?? text;
  } catch {
    /* JSON 이 아니면 원문 그대로 */
  }
  const match = message.match(/ROLLBACK_OK (\[.*\])/);
  if (!match) {
    console.error(`FAIL: 예상치 못한 응답 HTTP ${res.status}`);
    console.error(message.slice(0, 2000));
    return 1;
  }

  let failed = 0;
  for (const r of JSON.parse(match[1])) {
    if (!r.ok) failed += 1;
    console.log(`[${r.ok ? "PASS" : "FAIL"}] (${r.item}) ${r.detail}`);
  }
  console.log(failed === 0 ? "모든 항목 PASS (트랜잭션 롤백됨)" : `${failed}개 항목 FAIL`);
  return failed === 0 ? 0 : 1;
}

process.exitCode = await main();
