// DB 스모크 테스트 (설계 스펙 §9). Management API POST /v1/projects/{ref}/database/query 를
// 개인 액세스 토큰(SUPABASE_ACCESS_TOKEN)으로 호출해 실행한다.
//
// - 이 엔드포인트는 다중문을 보내도 마지막 결과 집합만 돌려주고, begin/rollback 을 호출 사이에 걸쳐 둘 수 없다.
//   그래서 모든 검증을 DO $$ ... $$ 블록 하나에서 수행하고, 마지막에 raise exception 'ROLLBACK_OK <json>' 으로
//   강제 롤백한다. 예외 메시지에 실린 JSON 으로 항목별 PASS/FAIL 을 판정한다. 실 데이터에 흔적을 남기지 않는다.
// - 주의: 이 쿼리는 superuser(postgres) 로 실행되므로 RLS 를 우회한다. RLS 자체는 QA(브라우저)에서 확인한다.
//   같은 이유로 auth.uid() 가 기본적으로 null 이라 owner_id 는 auth.users 의 기존 사용자(sb:seed-owner 로 만든 계정) id 를 쓴다.
//   auth.uid() 를 요구하는 RPC(roll_over_balances, purge_old_payments)는 null 일 때 0 을 돌려주는지 먼저 본 다음,
//   set_config('request.jwt.claims', ...) 으로 sub 클레임을 트랜잭션 안에서만 심어 실제 동작을 확인한다.
// - (n)~(p) 는 영수증 사진 보관(receipt_images, 0006) 규칙이다.
// - (j)~(m) 은 OCR 무료 한도(ocr_limits/ocr_usage, 0005) 규칙이다. 한도는 사용자별이 아니라 프로젝트 전체이므로
//   시작 상태를 ocr_usage 를 비워 고정한 뒤 센다. 이 삭제도 같은 트랜잭션이라 롤백된다.
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
  pay_photo uuid;
  bal bigint;
  bmonth date;
  n integer;
  i integer;
  quota jsonb;
  ok boolean;
  detail text;
  period_start date := (date_trunc('month', now() at time zone 'Asia/Seoul'))::date;
  last_month date := (date_trunc('month', now() at time zone 'Asia/Seoul') - interval '1 month')::date;
  results jsonb := '[]'::jsonb;
begin
  select id into owner_uuid from auth.users order by created_at limit 1;
  if owner_uuid is null then
    raise exception 'ROLLBACK_OK %', '[{"item":"pre","ok":false,"detail":"auth.users 에 사용자가 없습니다 (npm run sb:seed-owner 먼저)"}]';
  end if;

  -- (a) 결제를 넣으면 잔액이 그만큼 줄어든다. 새 카드의 잔액은 초기 잔액에서 시작한다.
  --     초기 잔액 100000 − (30000 + 20000 + 10000) = 40000
  insert into public.cards (owner_id, name, initial_balance)
    values (owner_uuid, '스모크 카드 A', 100000) returning id into card_a;
  insert into public.payments (owner_id, card_id, merchant, amount, paid_at, source)
    values (owner_uuid, card_a, '스모크 가맹점 1', 30000, now(), 'manual') returning id into pay_30k;
  insert into public.payments (owner_id, card_id, merchant, amount, paid_at, source) values
    (owner_uuid, card_a, '스모크 가맹점 2', 20000, now(), 'manual'),
    (owner_uuid, card_a, '스모크 가맹점 3', 10000, now(), 'manual');
  select balance into bal from public.cards where id = card_a;
  results := results || jsonb_build_object('item', 'a', 'ok', bal = 40000,
    'detail', format('cards.balance=%s (기대 40000)', bal));

  -- (b) amount 수정 시도 → 예외
  begin
    update public.payments set amount = 1 where id = pay_30k;
    ok := false; detail := '예외가 발생하지 않음';
  exception when others then
    ok := true; detail := sqlerrm;
  end;
  results := results || jsonb_build_object('item', 'b', 'ok', ok, 'detail', detail);

  -- (c) 취소하면 잔액이 다시 늘어난다 (30000 복구 → 70000)
  update public.payments set canceled_at = now() where id = pay_30k;
  select balance into bal from public.cards where id = card_a;
  results := results || jsonb_build_object('item', 'c', 'ok', bal = 70000,
    'detail', format('cards.balance=%s (기대 70000)', bal));

  -- (d) 취소 되돌리기 시도 → 예외
  begin
    update public.payments set canceled_at = null where id = pay_30k;
    ok := false; detail := '예외가 발생하지 않음';
  exception when others then
    ok := true; detail := sqlerrm;
  end;
  results := results || jsonb_build_object('item', 'd', 'ok', ok, 'detail', detail);

  -- (e) 지난달 날짜의 결제는 내역에만 들어가고 이번 달 잔액은 그대로다
  insert into public.payments (owner_id, card_id, merchant, amount, paid_at, source)
    values (owner_uuid, card_a, '스모크 지난달 결제', 9000, now() - interval '1 month', 'manual');
  select balance into bal from public.cards where id = card_a;
  results := results || jsonb_build_object('item', 'e', 'ok', bal = 70000,
    'detail', format('cards.balance=%s (기대 70000, 지난달 결제는 잔액 불변)', bal));

  -- (f) 잔액 기간이 지난 카드에 결제를 넣으면 먼저 초기 잔액으로 넘어간 뒤 차감된다
  --     balance 를 엉뚱한 값으로 두고 balance_month 를 지난달로 만든 뒤 5000 결제 → 100000 − 5000
  update public.cards set balance = 12345, balance_month = last_month where id = card_a;
  insert into public.payments (owner_id, card_id, merchant, amount, paid_at, source)
    values (owner_uuid, card_a, '스모크 넘김 후 결제', 5000, now(), 'manual');
  select balance, balance_month into bal, bmonth from public.cards where id = card_a;
  results := results || jsonb_build_object('item', 'f', 'ok', bal = 95000 and bmonth = period_start,
    'detail', format('cards.balance=%s, balance_month=%s (기대 95000, %s)', bal, bmonth, period_start));

  -- (g) 초기 잔액을 고쳐도 이번 달 잔액은 그대로다(다음 달 1일부터 적용)
  update public.cards set initial_balance = 777000 where id = card_a;
  select balance into bal from public.cards where id = card_a;
  results := results || jsonb_build_object('item', 'g', 'ok', bal = 95000,
    'detail', format('cards.balance=%s (기대 95000, 초기 잔액 수정은 잔액 불변)', bal));

  -- (h) roll_over_balances(): 잔액 기간이 지난 카드를 초기 잔액으로 채운다.
  --     auth.uid() 가 null 이면 0 이므로, 먼저 그것을 확인하고 JWT 클레임을 심어 실제 동작을 본다.
  insert into public.cards (owner_id, name, initial_balance)
    values (owner_uuid, '스모크 카드 B', 50000) returning id into card_b;
  update public.cards set balance = 111, balance_month = last_month where id = card_b;
  select public.roll_over_balances() into n;
  ok := (n = 0);
  detail := format('auth.uid() null → roll_over_balances()=%s (기대 0)', n);
  perform set_config('request.jwt.claims', json_build_object('sub', owner_uuid)::text, true);
  select public.roll_over_balances() into n;
  select balance, balance_month into bal, bmonth from public.cards where id = card_b;
  ok := ok and n >= 1 and bal = 50000 and bmonth = period_start;
  detail := detail || format('; 로그인 상태 roll_over_balances()=%s (기대 1 이상), 카드 B balance=%s/balance_month=%s (기대 50000, %s)',
    n, bal, bmonth, period_start);
  results := results || jsonb_build_object('item', 'h', 'ok', ok, 'detail', detail);

  -- (i) purge_old_payments(): 이번 달 1일에서 2개월 전보다 오래된 결제만 지운다(카드 초기화 조건 없음)
  insert into public.payments (owner_id, card_id, merchant, amount, paid_at, source) values
    (owner_uuid, card_a, '스모크 4개월 전 결제', 5000, now() - interval '4 months', 'manual'),
    (owner_uuid, card_b, '스모크 1개월 전 결제', 5000, now() - interval '1 month', 'manual');
  select public.purge_old_payments() into n;
  ok := (n >= 1);
  detail := format('purge_old_payments()=%s (기대 1 이상)', n);
  select count(*) into n from public.payments where merchant = '스모크 4개월 전 결제';
  ok := ok and (n = 0);
  detail := detail || format('; 4개월 전 결제 남은 건수=%s (기대 0)', n);
  select count(*) into n from public.payments where merchant = '스모크 1개월 전 결제';
  ok := ok and (n = 1);
  detail := detail || format('; 1개월 전 결제 남은 건수=%s (기대 1)', n);
  results := results || jsonb_build_object('item', 'i', 'ok', ok, 'detail', detail);

  -- (j) ocr_quota_consume(): 한도까지 부르면 available 이 false 가 된다(Gemini 하루 20건).
  --     한도는 사용자별이 아니라 프로젝트 전체라 실 사용량이 섞이지 않게 시작 상태를 비우고 센다(롤백됨).
  delete from public.ocr_usage;
  select limit_count into n from public.ocr_limits where provider = 'gemini';
  ok := true;
  for i in 1..n loop
    if not public.ocr_quota_consume('gemini') then ok := false; end if;
  end loop;
  quota := public.ocr_quota();
  ok := ok and not public.ocr_quota_consume('gemini')
    and (quota->'gemini'->>'available')::boolean = false
    and (quota->'gemini'->>'used')::integer = n
    and (quota->'gemini'->>'remaining')::integer = 0;
  results := results || jsonb_build_object('item', 'j', 'ok', ok,
    'detail', format('gemini %s건 소진 후 available=%s/used=%s/remaining=%s (기대 false/%s/0), 한 건 더 소비=false 기대',
      n, quota->'gemini'->>'available', quota->'gemini'->>'used', quota->'gemini'->>'remaining', n));

  -- (k) ocr_quota 의 최상위 available 은 둘 중 하나라도 살아 있으면 true 다(지금은 CLOVA 가 살아 있다)
  results := results || jsonb_build_object('item', 'k', 'ok', (quota->>'available')::boolean,
    'detail', format('gemini 소진·clova 여유일 때 최상위 available=%s (기대 true)', quota->>'available'));

  -- (l) ocr_quota_exhaust(): 우리 계수가 남아 있어도 즉시 false 가 된다. 그러면 최상위도 false 다.
  perform public.ocr_quota_exhaust('clova');
  quota := public.ocr_quota();
  ok := (quota->'clova'->>'available')::boolean = false
    and (quota->'clova'->>'used')::integer = 0
    and (quota->>'available')::boolean = false;
  results := results || jsonb_build_object('item', 'l', 'ok', ok,
    'detail', format('exhaust 후 clova available=%s/used=%s (기대 false/0), 최상위 available=%s (기대 false)',
      quota->'clova'->>'available', quota->'clova'->>'used', quota->>'available'));

  -- (m) 기간 문자열이 바뀌면 다시 available 이 true 다(지난달·어제 기간 행은 이번 기간에 영향을 주지 않는다)
  update public.ocr_usage set period = to_char((now() at time zone 'Asia/Seoul') - interval '1 month', 'YYYY-MM')
   where provider = 'clova';
  update public.ocr_usage set period = to_char((now() at time zone 'Asia/Seoul') - interval '1 day', 'YYYY-MM-DD')
   where provider = 'gemini';
  quota := public.ocr_quota();
  ok := (quota->>'available')::boolean
    and (quota->'clova'->>'available')::boolean
    and (quota->'gemini'->>'available')::boolean
    and (quota->'gemini'->>'used')::integer = 0;
  results := results || jsonb_build_object('item', 'm', 'ok', ok,
    'detail', format('지난 기간 행만 남겼을 때 clova available=%s, gemini available=%s/used=%s, 최상위=%s (모두 true, used 0 기대)',
      quota->'clova'->>'available', quota->'gemini'->>'available', quota->'gemini'->>'used', quota->>'available'));

  -- (n) 결제를 지우면 그 결제의 영수증 사진도 cascade 로 함께 사라진다.
  insert into public.payments (owner_id, card_id, merchant, amount, paid_at, source)
    values (owner_uuid, card_a, '스모크 사진 결제', 1000, now(), 'receipt') returning id into pay_photo;
  insert into public.receipt_images (payment_id, owner_id, data_url, width, height)
    values (pay_photo, owner_uuid, 'data:image/jpeg;base64,' || repeat('A', 200), 1200, 900);
  delete from public.payments where id = pay_photo;
  select count(*) into n from public.receipt_images where payment_id = pay_photo;
  results := results || jsonb_build_object('item', 'n', 'ok', n = 0,
    'detail', format('결제 삭제 후 남은 사진 건수=%s (기대 0, cascade)', n));

  -- (o) data_url 제약: data: 로 시작하지 않거나 60만 자를 넘는 값은 거부한다.
  insert into public.payments (owner_id, card_id, merchant, amount, paid_at, source)
    values (owner_uuid, card_a, '스모크 제약 결제', 1000, now(), 'receipt') returning id into pay_photo;
  begin
    insert into public.receipt_images (payment_id, owner_id, data_url)
      values (pay_photo, owner_uuid, repeat('A', 200));
    ok := false; detail := 'data: 로 시작하지 않는 값이 들어갔다';
  exception when others then
    ok := true; detail := 'data: 아닌 값 거부';
  end;
  begin
    insert into public.receipt_images (payment_id, owner_id, data_url)
      values (pay_photo, owner_uuid, 'data:image/jpeg;base64,' || repeat('A', 600001));
    ok := false; detail := detail || '; 60만 자를 넘는 값이 들어갔다';
  exception when others then
    detail := detail || '; 60만 자 초과 거부';
  end;
  results := results || jsonb_build_object('item', 'o', 'ok', ok, 'detail', detail);

  -- (p) purge_old_payments() 로 지워진 오래된 결제의 사진도 함께 사라진다.
  insert into public.payments (owner_id, card_id, merchant, amount, paid_at, source)
    values (owner_uuid, card_a, '스모크 오래된 사진 결제', 1000, now() - interval '4 months', 'receipt')
    returning id into pay_photo;
  insert into public.receipt_images (payment_id, owner_id, data_url)
    values (pay_photo, owner_uuid, 'data:image/jpeg;base64,' || repeat('A', 200));
  select public.purge_old_payments() into n;
  select count(*) into n from public.receipt_images where payment_id = pay_photo;
  results := results || jsonb_build_object('item', 'p', 'ok', n = 0,
    'detail', format('오래된 결제 정리 후 남은 사진 건수=%s (기대 0)', n));

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
