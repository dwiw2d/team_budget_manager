# SW2HW 장부 설계 스펙

작성일 2026-09-16. 이 문서는 구현 작업자 전원의 계약서다. 여기 없는 기능은 만들지 않는다. 용어는 `CONTEXT.md`, 백엔드 선택 배경은 `docs/adr/0001`을 따른다.

## 1. 목표와 비목표

**목표**: 공용 비밀번호 하나로 여러 사람이 접속하는 모바일 우선 PWA. 카드를 등록해 예산을 두고, 영수증 입력(네이버 CLOVA General OCR + 필요할 때만 Gemini 보완) 또는 수동 입력으로 결제를 기록하면 카드 잔액이 줄어든다. 언제든 접속해 총 잔액·카드별 잔액·결제 내역을 본다.

**비목표(만들지 않음)**: 회원가입, 다중 계정, 카테고리·태그, 통계·차트, 품목 저장, 오프라인 입력, 입금 기록, 결제 수정·삭제(메모 제외), 사용자가 누르는 초기화 버튼, 검색.

## 2. 확정된 결정 요약

| # | 결정 |
|---|---|
| 1 | 단일 계정, PIN 6자리 하나. 계정은 배포 시 PM이 관리자 API로 1개 생성. 앱에는 로그인(PIN 입력) 화면만 있음. 공개 가입 차단 |
| 2 | Supabase(Postgres, Auth, Edge Function) + 정적 SPA. 자체 호스팅 Supabase(Docker)로 이전 가능하게 유지(ADR 0001) |
| 3 | 카드마다 예산(한 달 치 한도). **잔액은 계산값이 아니라 `cards.balance` 에 저장된 숫자다.** 결제를 넣으면 빠지고 취소하면 다시 더해진다 |
| 4 | 입금 없음. 매월 1일 0시(KST)에 잔액이 그 시점의 예산으로 다시 채워진다(월 초기화). **사용자가 누르는 초기화 버튼은 없다.** 스케줄러·배치도 두지 않고, 결제 트리거·앱 진입 시 RPC·뷰의 조회 시 보정 세 곳이 넘김을 맡는다 |
| 4-1 | 결제 날짜가 지금의 잔액 기간(이번 달 1일 0시 KST 이후)에 속할 때만 잔액이 움직인다. 지난달 영수증을 늦게 넣으면 내역에만 들어가고 이번 달 잔액은 그대로다. 취소도 같은 기준이라 잔액에서 빠졌던 결제만 다시 더해진다 |
| 4-2 | 예산은 언제든 수정 가능하되 이번 달 잔액은 바뀌지 않는다. 다음 달 1일부터 적용된다 |
| 5 | 결제 = 카드, 가맹점, 금액, 결제 일시, 메모(선택), 영수증에서 읽은 카드번호 일부, 출처(receipt/manual) |
| 5-1 | OCR 은 두 단계다. 1단계 CLOVA General OCR + 자체 파서, 2단계는 파서가 확신하지 못한 필드가 있을 때만 Gemini 로 보완한다. 유료 영수증 전용 모델은 쓰지 않는다 |
| 5-3 | 두 OCR 제공자의 무료 한도(CLOVA 월 100건, Gemini 하루 20건, KST)는 물어볼 API 가 없어 우리가 직접 센다. 둘 다 소진이면 제공자를 부르지 않고 429 다 |
| 5-2 | 카드 자동 선택은 카드번호 **앞자리**로 맞춘다. 한국 카드전표는 뒤 4자리를 가리므로(실측 "4265-86**-****-****", "42658698********") 뒤 4자리로는 영영 맞출 수 없다 |
| 6 | 영수증 사진은 결제와 함께 보관한다. 무료 몫이 더 큰 파일 저장소(비공개 버킷 `receipts`, 경로 `{owner_id}/{payment_id}.jpg`)에 긴 변 1200px·JPEG 0.7 로 올리고(장당 약 200KB), 결제가 지워지면 데이터베이스 트리거가 그 파일도 함께 지운다(앱이 열려야만 정리되는 구조를 피한다). 목록 조회는 그대로이고 상세 시트를 열 때만 서명 URL 을 받는다 |
| 7 | 온라인 전용 PWA. 오프라인이면 안내 배너만 |
| 8 | Vite + React + TypeScript + Tailwind + vite-plugin-pwa + react-router + supabase-js. 상태관리·컴포넌트 라이브러리 없음 |
| 9 | 프런트 호스팅: GitHub Pages(dwiw2d 계정, 공개 저장소 `team_budget_manager`) + GitHub Actions. Docker(nginx) 이미지도 제공 |
| 10 | 결제 내역: 월별 목록 + 카드 필터 + 월 합계. 메모만 수정. 삭제 없음. 잘못된 결제는 취소(되돌릴 수 없음) |
| 11 | 보관: 이번 달 포함 최근 3개월. 그보다 오래된 결제는 앱 시작 시 서버 함수로 삭제 |
| 12 | 앱 이름 "SW2HW 장부". 시간대 Asia/Seoul 고정. 금액은 원 단위 정수 |

## 3. 아키텍처

```
브라우저(PWA, React SPA, 정적 파일)
  ├─ supabase-js ─▶ Supabase Auth (계정 1개)
  ├─ supabase-js ─▶ Postgres: cards, payments, card_balances(뷰), roll_over_balances()·purge_old_payments()(RPC)
  ├─ supabase-js ─▶ Storage: 비공개 버킷 `receipts` (영수증 사진, 경로 {owner_id}/{payment_id}.jpg)
  └─ fetch ───────▶ Edge Function `ocr` ─┬▶ 네이버 CLOVA General OCR (1단계)
                                         └▶ Gemini generateContent (2단계, 확신 없을 때만)
```

- 서버 코드는 `supabase/migrations/*.sql`과 `supabase/functions/ocr/` 뿐이다. 대시보드 수작업 금지.
- 브라우저 빌드 환경 변수: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_BASE_PATH`(기본 `/`, Pages는 `/team_budget_manager/`).
- 로컬 비밀 값은 `.env.local`(git 무시)에 있다. 키 이름: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `APP_OWNER_EMAIL`, `APP_OWNER_PASSWORD`, (아침에 추가) `NAVER_OCR_GENERAL_INVOKE_URL`, `NAVER_OCR_GENERAL_SECRET`, (선택) `GEMINI_API_KEY`, `GEMINI_MODEL`. **값을 로그·커밋·문서에 절대 출력하지 않는다.**
- Supabase 프로젝트 ref `owxbsjsetesazmnqvzxd`(도쿄). CLI는 `npx supabase`(2.117.0)로 실행하고 `SUPABASE_ACCESS_TOKEN` 환경 변수를 넘긴다.

## 4. 데이터 모델 (마이그레이션 `supabase/migrations/0001_init.sql` ~ `0009_function_grants.sql`)

아래 DDL이 계약이다. 컬럼 이름을 바꾸지 않는다. 마이그레이션은 `0001` ~ `0009` 아홉 개이고, 클라우드에 적용된 파일은 수정하지 않으며 이후 변경은 번호를 올린 파일로 쌓는다. `0002_reset_at.sql` 이 `cards.reset_date date` 를 `cards.reset_at timestamptz` 로 바꿨고, `0003_card_prefix.sql` 이 `cards.last4` 를 `cards.card_prefix` 로 바꿨다(영수증이 뒤 4자리를 가리므로 앞자리로 맞춘다). `0004_stored_balance.sql` 이 잔액을 저장값으로 바꾼다: `cards.balance`·`cards.balance_month` 를 더하고 `cards.reset_at` 을 없애며, 결제 트리거·`roll_over_balances()`·뷰를 새로 만든다. `0005_ocr_quota.sql` 이 OCR 무료 한도용 `ocr_limits`·`ocr_usage` 두 표와 `ocr_period`·`ocr_quota`·`ocr_quota_consume`·`ocr_quota_exhaust` 네 함수를 더한다(§5 참조). `0006_receipt_images.sql` 이 영수증 사진 표 `receipt_images` 를 더했고, `0008_receipt_storage.sql` 이 그 표를 지우고 사진을 파일 저장소로 옮기면서 `purge_old_payments()` 를 다시 만든다(아래 참조). `0009_function_grants.sql` 은 스키마를 건드리지 않고 권한만 정리한다: `payments_adjust_balance()` 의 EXECUTE 회수, `payments_before_update`·`current_period_start`·`cards_set_balance`·`ocr_period(text)` 네 함수에 `search_path = public` 고정, `cards`·`payments`·`card_balances` 에서 `anon` 권한 회수(`authenticated` 와 `ping()` 은 그대로 둔다). 아래는 장부 쪽 마이그레이션(`0001`~`0004`, `0008`)을 적용한 최종 형태다.

**매월 채움을 스케줄러 없이 구현한 방법**: `pg_cron` 같은 배치를 두지 않고, 잔액 기간이 지난 카드를 손대는 세 순간에 각각 넘긴다 — (1) 결제 트리거가 잔액을 조정하기 직전, (2) 앱 진입 시 `roll_over_balances()` RPC, (3) 그래도 아직 안 넘어간 카드를 위해 뷰 `card_balances` 가 조회 시 예산으로 보정해서 낸다.

```sql
create table public.cards (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id),
  name text not null check (length(trim(name)) between 1 and 40),
  initial_balance bigint not null check (initial_balance >= 0),
  card_prefix text check (card_prefix ~ '^[0-9]{6,8}$'),
  balance bigint not null default 0,
  balance_month date not null default (date_trunc('month', now() at time zone 'Asia/Seoul'))::date,
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

-- 0008_receipt_storage.sql (영수증 사진은 표가 아니라 저장소 버킷에 둔다)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 1048576, array['image/jpeg'])
on conflict (id) do nothing;
```

**버킷 `receipts`**: 영수증 사진을 결제 하나당 한 장 담는 비공개 버킷이다. 경로 규칙은 `{owner_id}/{payment_id}.jpg` 이고 파일당 상한은 1MB, 허용 형식은 `image/jpeg` 뿐이다. DB 가 아니라 파일 저장소에 두는 이유는 무료 요금제의 몫이 다르기 때문이다 — Database 500MB 보다 File storage 1GB 가 커서, 사진을 빼면 500MB 를 결제 기록에만 쓸 수 있다(월 전송량 5GB, 파일당 최대 50MB). 앱은 긴 변 1200px·JPEG 품질 0.7 로 줄여 올려 장당 약 200KB 를 목표한다. 목록·홈은 사진을 부르지 않고 상세 시트를 열 때만 유효기간 5분짜리 서명 URL 을 한 번 받는다. 수동 입력으로 만든 결제에는 파일이 없다.

**저장소 접근 제어(`storage.objects`)**: 역할 `authenticated` 에 대해 `bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text` 조건으로 select·insert·delete 세 정책. update 정책은 없다(사진은 고치지 않는다). `anon` 정책은 없다.

**컬럼 `cards.initial_balance`**: 화면에서 "예산" 으로 부르는 값, 곧 한 달 치 한도다. 컬럼 이름은 `initial_balance` 그대로 둔다.

**행 단위 접근 제어(RLS)**: 두 테이블 모두 활성화. 역할 `authenticated`에 대해 `owner_id = auth.uid()` 조건으로 cards는 select/insert/update/delete, payments는 select/insert/update만. payments에 delete 정책은 없다(삭제 불가). `anon`에는 아무 정책도 없다.

**payments 갱신 트리거** (`before update`): memo 변경과 "canceled_at이 null → 값" 전이만 허용. 다른 컬럼이 바뀌거나 이미 취소된 행의 canceled_at이 바뀌면 `raise exception`. canceled_at이 새로 설정되면 서버가 `now()`로 덮어쓴다.

**헬퍼 함수 `current_period_start() returns date`** (`stable`): `(date_trunc('month', now() at time zone 'Asia/Seoul'))::date`. 지금의 잔액 기간이 시작한 날이다. 트리거·함수·뷰가 모두 이 하나를 쓴다.

**cards 생성 트리거** (`before insert`): 새 카드의 `balance := initial_balance`, `balance_month := current_period_start()`. 컬럼 default 는 다른 컬럼을 참조할 수 없어서(`balance` 의 `default 0` 은 기존 행을 not null 로 채우려고 둔 것) 트리거로 맞춘다.

**payments 잔액 트리거 `payments_adjust_balance`** (`after insert or update of canceled_at`, `security definer`, `set search_path = public`): 저장된 잔액을 움직이는 유일한 곳이다.

```
update 는 canceled_at 이 null → 값으로 바뀌는 전이일 때만 진행한다(메모 수정은 무시).
카드 행을 for update 로 잠근다.
if c.balance_month < current_period_start() then      -- 먼저 넘긴다
  c.balance := c.initial_balance; c.balance_month := current_period_start();
if new.paid_at >= (c.balance_month::timestamp at time zone 'Asia/Seoul') then
  c.balance := c.balance + (insert 이면 -new.amount, 취소면 +new.amount);
```

즉 **결제 날짜가 그 카드의 지금 잔액 기간에 속할 때만** 잔액이 움직인다. 지난달 날짜로 넣은 결제는 내역에만 남고, 취소해도 잔액에서 빠진 적이 없으므로 다시 더해지지 않는다.

**함수 `roll_over_balances() returns integer`** (`security definer`, `set search_path = public`, `authenticated`에만 execute 허용, `anon`/`public`은 revoke): 호출한 사용자의 카드 중 `balance_month < current_period_start()` 인 것을 모두 `balance := initial_balance`, `balance_month := current_period_start()` 로 넘기고 넘긴 카드 수를 돌려준다. `auth.uid()`가 null이면 0.

**뷰 `card_balances`** (`security_invoker = true`): cards의 컬럼 + 보정된 `balance bigint` + 보정된 `balance_month date`. 넘김이 아직 안 돈 카드도 화면에 맞게 보이도록 조회 시 보정한다.

```
case when c.balance_month < current_period_start() then c.initial_balance else c.balance end as balance,
greatest(c.balance_month, current_period_start()) as balance_month
```

**함수 `purge_old_payments() returns integer`** (`security definer`, `set search_path = public`, `authenticated`에만 execute 허용, `anon`/`public`은 revoke):

```
cutoff := (current_period_start() - interval '2 months')::date;
delete from payments
 where owner_id = auth.uid()
   and (paid_at at time zone 'Asia/Seoul')::date < cutoff;
return 삭제 건수;
```

`auth.uid()`가 null이면 0을 반환하고 아무것도 지우지 않는다.

**트리거 `payments_delete_receipt_object`** (`after delete on public.payments for each row`, 함수는 `security definer`, `set search_path = public, extensions`): 결제가 지워지면 데이터베이스가 그 결제의 사진 파일도 함께 지운다. 앱이 열려야만 정리되는 구조를 피하려는 것이다. SQL 로는 저장소 파일을 지울 수 없으므로 `pg_net` 으로 저장소 REST API 에 `DELETE {project_url}/storage/v1/object/receipts/{owner_id}/{payment_id}.jpg` 를 보낸다(헤더 `Authorization: Bearer {service_role_key}`, `apikey: {service_role_key}`). 필요한 두 값은 Vault 에서 이름(`app_project_url`, `app_service_role_key`)으로 읽으며 마이그레이션 파일에는 읽는 코드만 있다. 값이 아직 없으면 트리거는 아무것도 하지 않고 끝난다 — 비밀보다 결제 삭제가 먼저 동작해야 한다. **한계**: `pg_net` 은 비동기라 결제 삭제를 막지 않는 대신, 요청이 실패해도 다시 시도하지 않는다(파일만 남고 결제 기록은 이미 없다). 사진이 없는 결제(직접 입력)도 요청을 보내지만 저장소가 404 를 돌려줄 뿐이다.

**카드 삭제**: 결제가 있으면 FK restrict로 실패한다. 앱은 "결제 N건이 있어 삭제할 수 없습니다"를 보여준다.

## 5. Edge Function `ocr`

- 경로 `supabase/functions/ocr/index.ts`(Deno). `supabase/config.toml`의 `[functions.ocr] verify_jwt = false`로 두고 함수 안에서 `Authorization: Bearer <access_token>`을 `supabase.auth.getUser()`로 검증한다. 실패 시 401.
- 요청: `POST` JSON `{ "image": "<base64, data: 접두어 없음>", "format": "jpg" | "png" }`. 최대 5MB(base64 기준 초과 시 413).
- **CORS**: `Access-Control-Allow-Headers` 는 손으로 적지 않고 SDK 가 내놓는 목록(`npm:@supabase/supabase-js@2/cors` 의 `corsHeaders`)과 우리 목록 `authorization, apikey, content-type, x-client-info, x-region` 의 합집합이다. 손 목록이 SDK 를 못 따라가 `x-retry-count` 가 빠지자 브라우저가 프리플라이트에서 막아 본 POST 가 아예 나가지 않은 적이 있다(`x-region` 은 `region` 옵션을 쓸 때 붙고 SDK 목록에는 없다). 가져온 값이 비어 있거나 모양이 달라도 우리 목록만으로 돌아간다. `Access-Control-Allow-Origin` 은 `*` 이다 — 이 함수는 쿠키 없이 Bearer 토큰만 보고 `Allow-Credentials` 도 없어 제3 사이트가 사용자 세션을 자동으로 실어 보낼 수 없으며, CORS 는 애초에 브라우저 밖 호출을 막지 못한다.
- 응답 200: `{ "merchant": string|null, "paidAt": string|null, "amount": number|null, "cardNumber": string|null, "uncertain": string[] }`. `paidAt`은 `YYYY-MM-DDTHH:mm:ss+09:00` 형식. 읽지 못한 항목은 null. `uncertain`은 사용자가 확인해야 하는 필드 이름들이다.
- **1단계 CLOVA General OCR**: `POST ${NAVER_OCR_GENERAL_INVOKE_URL}`(콘솔이 주는 Invoke URL 이 이미 `/general` 로 끝나므로 뒤에 아무것도 붙이지 않는다), 헤더 `X-OCR-SECRET: ${NAVER_OCR_GENERAL_SECRET}`, 본문 `{ version: "V2", requestId: <uuid>, timestamp: Date.now(), lang: "ko", images: [{ format, name: "receipt", data: <base64> }] }`. 응답 `images[0].fields[]`(`inferText`, `lineBreak`, `boundingPoly`)를 `clova-general.ts` 파서가 네 필드로 바꾼다.
- 상호는 (a) `상호:`/`가맹점명:` 라벨 값 → (c) 사업자번호 줄 바로 위 줄 → (b) 대표자/TEL 줄의 오른쪽 끝 토막 순서로 찾는다. (c) 가 (b) 보다 앞이다 — 상호가 제 줄에 따로 있는데도 사업자번호 줄 오른쪽 끝의 대표자 이름을 집어가는 영수증이 있다. (c) 는 `사업자번호` 라벨 없이 번호만 찍는 영수증이 많아 `\d{3}-\d{2}-\d{5}` 모양도 같이 본다. **(c) 의 확신도는 라벨 유무로 가른다**: `사업자번호` 글자가 실제로 찍힌 줄은 POS 머리글이라 제목/상호/사업자번호 차례가 거의 지켜지므로 확신하고, 라벨 없이 숫자 모양만 보고 찾았으면 영수번호 같은 다른 3-2-5 번호일 수 있어 값을 내되 `weak` 에 `merchant` 를 단다. 상호 후보에서 거르는 말에는 `대표`·`사장`·`점장`·`담당`·`계산원` 같은 사람 역할과, 시/도 이름 없이 시작하는 주소(`…시`·`…구`·`…동`·`…로`·`…길` 로 끝나는 토막이 둘 이상인 줄 — 하나만으로 거르면 `맷돌로` 같은 상호가 날아간다)가 들어간다.
- 파서는 `weak: string[]` 로 확신 없음을 알린다: merchant가 null / merchant를 라벨 없는 사업자번호 모양 줄의 윗줄이라는 자리만 보고 고름 / amount가 null / amount를 "합계·총액·결제금액" 같은 낱말 없이 "가장 큰 숫자" 규칙으로 고름 / paidAt이 null / 시각을 못 찾아 `00:00:00`으로 채움. cardNumber는 영수증에 원래 없는 경우가 많아 weak에 넣지 않는다.
- **2단계 Gemini**: `weak`가 비어 있지 않거나 **1단계가 통째로 실패했고**(네트워크 오류, HTTP 오류, `inferResult`가 `SUCCESS`가 아님, 응답 파싱 실패) `GEMINI_API_KEY`가 있을 때 `POST https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`(헤더 `x-goog-api-key`)를 부른다. 모델 기본값은 `gemini-3.6-flash`(`gemini-2.5-flash`는 신규 사용자에게 막혀 404). 구조화 출력으로 같은 네 필드를 받는다.
- **병합 규칙**(`merge.ts`, 순수 TS + Vitest): 각 필드에 대해 CLOVA 값이 null이거나 weak면 Gemini 값을 쓴다. 둘 다 값이 있고 서로 다르면 Gemini 값을 쓰되 그 필드 이름을 `uncertain`에 넣는다. weak인데 Gemini도 읽지 못하면 CLOVA 값을 두고 `uncertain`에 넣는다. Gemini 호출이 실패하면 CLOVA 값을 그대로 쓰고 `weak`를 그대로 `uncertain`으로 옮긴다. **1단계 성공 시 Gemini 실패는 오류로 만들지 않는다.**
- **1단계가 통째로 실패한 경우**(`merge.ts`의 `resolve`): Gemini 결과만으로 응답한다. 대조할 CLOVA 근거가 하나도 없으므로 값이 있는 필드 이름을 전부(`cardNumber` 포함) `uncertain`에 넣어 사용자가 확인하게 한다. Gemini도 실패하면 502다. 2단계를 부를지 정하는 이 판단은 `index.ts`가 아니라 `merge.ts`의 순수 함수 `resolve(clova, askGemini)`에 있고 Vitest로 네 경우(1단계 성공·weak 없음 / 성공·weak 있음 / 실패·Gemini 성공 / 실패·Gemini 실패)를 덮는다.
- 파서와 Gemini 모듈은 `supabase/functions/ocr/{clova-general,gemini,merge}.ts`에 Deno 의존성 없는 순수 TS로 두고 Vitest로 테스트한다(`*.fixtures.ts`는 실제 응답에서 옮긴 것). `scripts/ocr-bench/lib/*-extract.mjs`는 이 `.ts` 를 재수출하는 껍데기다.
- 오류: 시크릿 없음(`NAVER_OCR_GENERAL_INVOKE_URL` 또는 `NAVER_OCR_GENERAL_SECRET` 미설정) → 503 `{ "error": "ocr_not_configured" }`. **1단계와 2단계가 모두 실패**(또는 1단계 실패 + `GEMINI_API_KEY` 없음) → 502 `{ "error": "ocr_failed" }`. 1단계만 실패하고 2단계가 성공하면 200 이다.
- 오류: **네 필드(`merchant`, `paidAt`, `amount`, `cardNumber`)를 하나도 못 읽으면**(영수증이 아닌 사진이라 2단계가 전부 null 을 돌려준 경우 포함) 어느 경로로 왔든 성공이 아니라 502 `{ "error": "ocr_failed" }` 다. 이 판단도 `merge.ts`의 `resolve` 안에 있다.
- **무료 한도**(`0005_ocr_quota.sql`): 두 제공자 모두 남은 무료 한도를 물어볼 수 있는 API 가 없으므로 우리가 직접 센다. 확정된 한도는 CLOVA General OCR **월 100건**, Gemini **하루 20건**이고 기간은 모두 한국 시간 기준이다. 한도는 프로젝트의 API 키에 붙는 것이라 사용자별이 아니다(`owner_id` 없음). 한도 값은 코드가 아니라 `ocr_limits(provider, period_kind, limit_count)` 표에 있어 대시보드에서 고칠 수 있다. 사용량은 `ocr_usage(provider, period, used, exhausted_at)` 에 기간 문자열(`YYYY-MM` 또는 `YYYY-MM-DD`, KST)별로 쌓인다. 기간이 바뀌면 키가 달라져 새 행이 생기므로 따로 초기화하지 않는다. 두 표는 RLS 를 켜고 `authenticated` 에 select 만 열며, 쓰기는 `security definer` 함수 `ocr_quota_consume(provider)`·`ocr_quota_exhaust(provider)` 로만 한다. 상태 조회는 `ocr_quota()` 로, 제공자별 `{provider, period, used, limit_count, remaining, available}` 과 최상위 `available`(둘 중 하나라도 쓸 수 있으면 true)을 돌려준다.
- **한도 판단과 소비 시점**: 어느 제공자를 부를 수 있는지는 `index.ts` 가 아니라 순수 함수 `quota.ts` 의 `decideProviders(quota)` 가 정하고 Vitest 로 네 경우(둘 다 가능 / CLOVA 만 / Gemini 만 / 둘 다 불가)를 덮는다. 제공자를 **부르기 직전에** `ocr_quota_consume` 으로 1건을 선차감한다(응답이 유실돼도 과금분이 세어지도록). false 가 오면 그 제공자를 건너뛴다. 제공자가 한도 초과로 보이는 응답(HTTP 429, 또는 오류 응답의 코드·메시지에 quota/limit/exceed/초과)을 주면 `quota.ts` 의 `isQuotaExceeded` 가 그것을 알아보고 `ocr_quota_exhaust` 로 그 기간을 닫은 뒤 다음 제공자로 넘어간다. 그 밖의 실패는 기존 폴백 경로 그대로다. CLOVA 가 소진이고 Gemini 만 남으면 Gemini 가 주 엔진이 되며, 결과는 "1단계 실패 후 Gemini" 경로와 같게 값이 있는 필드를 모두 `uncertain` 에 넣는다.
- 오류: **두 제공자를 모두 부를 수 없으면**(처음부터 소진이거나 처리 도중 소진된 경우 포함) 제공자를 부르지 않고 429 `{ "error": "ocr_quota_exceeded" }` 다. 화면은 이 코드일 때만 한도 안내를 띄운다(`src/lib/ocr.ts` 의 순수 함수 `ocrErrorCode`).
- `NAVER_OCR_MOCK=1` 은 제공자를 부르지 않으므로 한도 검사보다 앞에 둔다(세지도, 막지도 않는다).
- `NAVER_OCR_MOCK=1`이 설정된 경우에만 아무것도 호출하지 않고 CLOVA 픽스처를 파서에 통과시킨 고정 응답을 돌려준다(QA 전용, 클라우드에는 설정하지 않음).
- 시크릿 등록은 `npm run sb:secrets`(`.env.local`에 있는 `NAVER_OCR_GENERAL_INVOKE_URL`, `NAVER_OCR_GENERAL_SECRET`, `GEMINI_API_KEY`, `GEMINI_MODEL` 중 존재하는 값만 `supabase secrets set`으로 올리고 이름만 출력).

## 6. 화면 명세 (모두 한국어, 모바일 우선, 최소 폭 360px)

공통: 하단 탭 4개(홈, 내역, 카드, 설정) + 홈·내역 화면 우하단 "결제 추가" 플로팅 버튼. 세션 없으면 어느 경로든 `/login`으로. 오프라인(`navigator.onLine === false`)이면 상단에 "네트워크 연결을 확인하세요" 배너. 금액 표시는 `1,234,567원`. 로딩 중 스켈레톤 없이 "불러오는 중…" 텍스트면 충분.

1. **로그인 `/login`**: 앱 이름, 안내 문구 "PIN 6자리를 입력하세요", PIN 입력 하나(`type=password`, `inputMode=numeric`, 최대 6자, 숫자만 남기고 가운데 정렬·자간 확대), 로그인 버튼. 이메일은 코드 상수 `owner@sw2hw.local`. 6자리가 채워지면 자동으로 로그인을 시도하고, 버튼은 6자리가 아니면 비활성. 실패 시 "PIN이 올바르지 않습니다"와 함께 입력을 비운다. 성공 시 `/`. 세션은 supabase-js 기본(localStorage)으로 유지.
2. **홈 `/`(대시보드)**: 좌측 상단 제목 "홈"(다른 화면과 같은 `h1`), 총 잔액(큰 글씨), 카드별 잔액 목록(이름, 카드번호 앞자리, 잔액. 음수는 빨간색), 최근 결제 5건(가맹점, 금액, 카드 이름, 일시. 취소 건은 취소선). 진입 시 `roll_over_balances` → `purge_old_payments` RPC 를 차례로 호출한 뒤 데이터 로드(둘 다 실패해도 화면은 진행).
3. **결제 추가 `/add`**: 상단에 "영수증 입력"(`<input type="file" accept="image/*">`)과 "직접 입력" 두 버튼. 사진을 고르면 canvas로 긴 변 1600px, JPEG 0.85로 줄여 base64로 `ocr` 함수 호출, "영수증을 읽는 중…" 표시. 결과로 폼을 채우고 OCR이 읽은 카드번호를 읽기 전용으로 표시. 카드 자동 선택: 읽은 번호에서 공백·하이픈을 걷어낸 뒤 첫 마스킹 문자 앞까지의 연속된 숫자를 뽑아 카드의 `card_prefix`와 앞에서부터 비교한다. 비교 길이는 둘 중 짧은 쪽이며 6자리 미만이면 선택하지 않는다. 정확히 한 장만 일치할 때만 선택. 여러 장이 일치하면 고르지 않고 빨간 스낵바로 직접 고르라고 알린다 — 카드 칸은 빈 채로 두고 나머지 칸은 평소대로 채운 뒤, 화면 아래 고정된 빨간 막대(`role="alert"`, `fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+5rem)] mx-auto max-w-md`, 하단 탭 바를 가리지 않는다)로 "앞자리가 같은 카드가 N장 있습니다. 카드를 직접 선택해 주세요"(N은 실제 일치 장수)를 띄운다. 5초 뒤 저절로 사라지고 누르면 바로 사라지며, 화면을 벗어나거나 다시 인식하면 지운다. 기존 안내 자리(한도·인식 실패)와 겹치지 않게 카드 겹침은 스낵바로만 알린다. 폼: 카드(select, 필수), 가맹점(필수), 금액(필수, 양의 정수), 결제 일시(`datetime-local`, 기본 지금), 메모(선택). 응답의 `uncertain`에 든 필드의 입력은 호박색 테두리(`border-amber-500`)와 그 아래 작은 안내("확인해 주세요")로 표시하고, 사용자가 그 칸을 고치면 표시를 지운다(`cardNumber`는 카드 선택 칸에 표시). 저장 → insert(`source`는 사진을 고르면 `receipt`, 아니면 `manual`; OCR 실패 후 직접 입력해도 `manual`) → 새 결제의 id 를 받아, 고른 사진이 있으면 긴 변 1200px·JPEG 0.7(`src/lib/image.ts` 의 `resizeToBlob`)로 줄여 저장소 `receipts` 버킷의 `{owner_id}/{payment_id}.jpg` 에 올린다(`uploadReceipt`) → 홈으로. **사진 보관 실패는 결제 저장을 되돌리지 않는다** — 결제는 그대로 두고 "결제는 저장했지만 영수증 사진은 보관하지 못했습니다" 한 줄만 알린 뒤 홈으로 간다. OCR 실패(503/502/네트워크)는 "영수증을 읽지 못했습니다. 직접 입력해 주세요" 후 빈 폼. 화면에 들어올 때 `ocr_quota` 를 읽어 두 제공자가 모두 소진이면 "영수증 입력" 버튼을 비활성 모양으로 둔다(`disabled` 속성은 쓰지 않는다 — 비활성 버튼은 탭 이벤트가 오지 않아 안내를 띄울 수 없다. `aria-disabled="true"` + slate-300/slate-400 회색 + `cursor-not-allowed`, 파일 선택 창은 열지 않는다). 누르면 버튼 바로 아래에 말풍선(`role="status"`, 어두운 배경·흰 글씨·위쪽 삼각형 꼭지)으로 "이번 달 영수증 인식 한도를 모두 썼습니다. 직접 입력을 이용해 주세요" 를 띄우고, 다시 누르거나 다른 곳을 누르면 닫는다. 한도 읽기에 실패하면 버튼을 막지 않는다. 인식 중 429 `ocr_quota_exceeded` 를 받으면 같은 문구를 기존 안내 자리에 띄우고 빈 폼으로 넘어간다.
4. **내역 `/payments`**: 상단 월 이동(◀ 2026년 9월 ▶, 기본 이번 달), 카드 필터(전체/각 카드), 월 합계(취소 제외). 목록은 결제 일시 내림차순. 항목 클릭 → 상세 시트: 모든 필드 읽기 전용, 메모만 편집·저장, "취소" 버튼(확인창: "이 결제를 취소하면 되돌릴 수 없습니다"). 시트를 열 때 그 결제의 영수증 사진에 대해 유효기간 5분짜리 서명 URL 을 한 번 받아(`getReceiptUrl`), 있으면 다른 항목과 같은 한 줄로 `<dl>` 맨 끝("상태" 다음)에 "영수증 사진" 줄을 더한다 — 오른쪽은 값이 아니라 작은 사진 아이콘 버튼이다(인라인 SVG 20px, `stroke="currentColor"`·`fill="none"`·`stroke-width="1.5"`, 터치 크기를 지키는 `min-h-11 min-w-11` 에 옅은 테두리, `aria-label="영수증 사진 크게 보기"`). 누르면 전체 화면으로 크게 본다(시트 z-20 위에 오도록 `fixed inset-0 z-30 bg-black/90` 오버레이 + `max-h-full max-w-full object-contain`, 아무 곳이나 누르면 닫히고 `aria-label="닫기"` 버튼도 하나 둔다). 사진이 없으면(직접 입력 등) 서명 URL 이 null 이므로 아무것도 그리지 않고 빈 자리도 만들지 않는다. 받는 동안에도 아무것도 표시하지 않고, 실패하면 조용히 넘어간다. 취소된 항목은 취소선 + "취소됨". 월 경계는 KST(+09:00 고정) 기준으로 계산해 `paid_at gte/lt`로 조회.
5. **카드 `/cards`**: 카드 목록(이름, 카드번호 앞자리, 예산, 잔액). 목록 위에는 "카드 추가" 버튼 하나만 둔다. 카드 추가/수정 모달(이름, 예산, 카드번호 앞자리 선택): 예산 입력 아래에 "예산을 바꾸면 다음 달 1일부터 적용됩니다" 를 작은 글씨로 우측 정렬해 둔다. 앞자리 입력의 라벨은 "카드번호 앞 6~8자리(선택)"이고 그 아래에 "영수증은 뒤 4자리를 가리므로 앞자리로 맞춥니다" 한 줄을 둔다. 숫자 6~8자리가 아니면 저장하지 않는다. 카드 상세 시트: 이름·카드번호 앞자리·예산·잔액을 보여주고 예산 아래에 같은 안내 한 줄을 우측 정렬해 둔다. 버튼은 "수정"·"삭제" 둘뿐이다(`grid-cols-2`). **초기화 버튼은 카드별도 전체도 없다** — 잔액은 매월 1일 0시에 저절로 채워진다. 삭제는 확인창 후 실행하고 FK 오류면 안내.
6. **설정 `/settings`**: PIN 변경(현재 PIN·새 PIN·새 PIN 확인 3개 입력. 현재 PIN 은 `signInWithPassword`로 확인한 뒤 `auth.updateUser`로 변경), 로그아웃, 앱 버전 표시.

PWA: manifest `name`/`short_name` "SW2HW 장부", `display: standalone`, `lang: ko`, `theme_color`, 아이콘 192·512 PNG(+ SVG 원본, 글자 "S"). 서비스워커는 vite-plugin-pwa `generateSW`, `registerType: 'prompt'`, 앱 셸만 프리캐시하고 Supabase 요청은 캐시하지 않는다. 입력 중인 화면이 말없이 새로고침되지 않게 자동 적용 대신 `useRegisterSW()` 의 `needRefresh` 로 오프라인 막대 옆에 "새 버전이 있습니다. 새로고침" 한 줄을 띄우고, 누르면 `updateServiceWorker(true)` 가 갈아끼운다.

## 7. 인증·보안

- Supabase Auth 이메일+비밀번호를 쓰되, 비밀번호 자리에 숫자 6자리 PIN 을 넣는다(프로젝트 설정: 최소 길이 6, 문자 종류 요구 없음, HIBP 검사 꺼짐). PIN 형식 검증은 클라이언트(`src/lib/auth.ts`의 `isPin`)가 한다. 계정 1개는 PM이 `scripts/seed-owner.mjs`로 생성(service_role 키로 `POST /auth/v1/admin/users`, `email_confirm: true`). 이 스크립트는 `.env.local`의 `APP_OWNER_EMAIL`, `APP_OWNER_PASSWORD`를 읽는다. 값은 출력하지 않는다.
- 공개 가입 차단: `supabase/config.toml` `[auth] enable_signup = false` + 클라우드에는 `scripts/disable-signup.mjs`(Management API `PATCH /v1/projects/{ref}/config/auth` `{ "disable_signup": true }`, PAT 사용). 차단 확인은 anon 키로 `signUp` 시도 → 오류.
- PIN 복구(앱 밖): README에 SQL 편집기용 `update auth.users set encrypted_password = crypt('새비밀번호', gen_salt('bf')) where email = 'owner@sw2hw.local';` 를 적는다.
- 브라우저에는 anon 키만 있다. 데이터 보호는 RLS, 삭제·수정 금지는 정책과 트리거가 맡는다. UI 제한은 보조일 뿐이다.
- CSP: 배포처인 GitHub Pages 가 HTTP 헤더를 넣을 수 없어 `index.html` 의 `<meta http-equiv="Content-Security-Policy">` 로 둔다(`script-src 'self'`, `style-src 'self' 'unsafe-inline'`, `img-src`·`connect-src` 는 `'self'` + Supabase 출처. 출처는 Vite 가 `%VITE_SUPABASE_URL%` 을 빌드 때 치환한다). `Referrer-Policy` 는 meta 로 온전히 대체되므로 `<meta name="referrer">` 도 함께 둔다. `frame-ancestors` 는 meta 로는 무시되므로 `nginx.conf` 쪽에만 둔다 — 자체 호스팅 경로는 같은 정책을 진짜 헤더로 내보내고 `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`(`camera=(self)`), `X-Frame-Options: DENY` 를 더한다(nginx 는 하위 블록에 `add_header` 가 있으면 상위를 물려주지 않으므로 두 `location` 에 모두 적는다).
- 오류 문구: Supabase/Postgres 원본 메시지(RLS 정책 이름·테이블명·제약조건 원문)를 화면에 그대로 내보내지 않는다. 화면은 `src/lib/errors.ts` 의 `userMessage(e, fallback)` 로 고정 한국어 문구를 쓴다(오프라인이면 네트워크 안내, `code`·`status` 가 없는 Error 는 `db.ts` 가 직접 만든 안내 문구라 그대로 통과).

## 8. 배포·운영

- **저장소**: GitHub `dwiw2d/team_budget_manager`(공개). 이 워크트리의 현재 브랜치(`receipt-tracker-pwa`)를 원격 `main`으로 푸시한다(`git push origin HEAD:main`). 브랜치 이름을 명령에 쓰지 말고 항상 `HEAD:main`을 쓴다.
- **GitHub Actions** `.github/workflows/deploy.yml`: `main` 푸시 시 `npm ci` → `npm test` → `npm run typecheck` → `npm run build`(`VITE_BASE_PATH=/team_budget_manager/`, `VITE_SUPABASE_URL`·`VITE_SUPABASE_ANON_KEY`는 저장소 **variables**) → `dist/404.html`을 `index.html` 복사본으로 생성 → `actions/upload-pages-artifact` → `actions/deploy-pages`. Pages 소스는 GitHub Actions. 저장소 변수는 `gh variable set`으로 등록.
- **Docker**: `Dockerfile`(1단계 node:24-alpine 빌드, `ARG VITE_*`; 2단계 nginx:alpine, `nginx.conf`에 `try_files $uri /index.html`), `docker-compose.yml`(포트 8080). `docker build`가 성공해야 한다.
- **Supabase 스크립트(package.json)**: `sb:link`, `sb:push`(`supabase db push`), `sb:functions`(`supabase functions deploy ocr`), `sb:secrets`, `sb:seed-owner`, `sb:disable-signup`, `sb:db-secrets`(Vault 에 `app_project_url`·`app_service_role_key` 저장), `db:smoke`. 전부 `.env.local`을 읽는다(`dotenv` 없이 Node 24의 `process.loadEnvFile` 사용).
- **README.md**(한국어): 로컬 개발, 환경 변수, 클라우드 배포 순서, 아침에 할 일(NAVER 시크릿 2개 넣고 `npm run sb:secrets`), 자체 호스팅 Supabase로 옮기는 절차(공식 docker compose, `GOTRUE_DISABLE_SIGNUP=true`, 마이그레이션 적용, 함수 배포, 계정 생성, 프런트 Docker 실행), 비밀번호 복구 SQL.

## 9. 테스트 전략

- **Vitest 단위**: `src/lib/money.test.ts`(원 표기), `src/lib/dates.test.ts`(KST 월 경계, datetime-local 변환), `src/lib/cards.test.ts`(앞자리 자동 선택), `src/lib/image.test.ts`(축소 배율·data URL 접두어 제거. canvas 가 없어 `resizeToDataUrl`·`resizeToBlob` 자체는 부르지 않는다), `supabase/functions/ocr/{clova-general,gemini,merge,quota}.test.ts`(실제 응답 픽스처 → 네 필드 + weak, Gemini 응답 정규화, 병합 규칙, 한도 판단), `src/lib/ocr.test.ts`(함수 응답 → 오류 코드).
- **DB 스모크 `scripts/db-smoke.mjs`**: Management API `POST /v1/projects/{ref}/database/query`(PAT)로 한 트랜잭션 안에서 저장 잔액 규칙 전부를 검증한다 — 결제 삽입 시 `cards.balance` 차감 / 금액 수정 시도(실패 기대) / 취소 시 복구 / 취소 되돌리기 시도(실패 기대) / 지난달 날짜 결제는 잔액 불변 / `balance_month` 가 지난달인 카드에 결제를 넣으면 예산으로 넘어간 뒤 차감 / 예산 수정은 잔액 불변 / `roll_over_balances()` 넘김 / `purge_old_payments()` 3개월 규칙 / 영수증 사진 삭제(결제를 지우면 트리거가 그 경로의 삭제 요청을 `pg_net` 큐에 남기고, Vault 비밀이 없으면 조용히 지나가되 결제 삭제는 성공한다. 큐 행도 같은 트랜잭션이라 롤백되므로 실제 저장소 요청은 나가지 않는다. 저장소 파일 자체는 SQL 로 볼 수 없어 확인하지 않는다) / OCR 한도(한도까지 `ocr_quota_consume` 하면 `available` 이 false, `ocr_quota_exhaust` 는 즉시 false, 기간 문자열이 바뀌면 다시 true, 최상위 `available` 은 둘 중 하나라도 살아 있으면 true). 마지막에 `raise exception` 으로 강제 롤백하므로 실 데이터에 흔적을 남기지 않는다. (superuser라 RLS는 우회되므로 RLS 자체는 아래 QA가 확인. `auth.uid()` 를 요구하는 RPC 는 `set_config('request.jwt.claims', ...)` 로 트랜잭션 안에서만 sub 클레임을 심어 확인한다)
- **QA 시나리오(수동, 브라우저)**: 11절 체크리스트 전 항목. QA는 가능하면 로컬 Supabase(`supabase start`, Docker)에서 수행하고, 불가하면 클라우드에서 수행한 뒤 만든 테스트 데이터를 정리한다. RLS 확인: anon 키로 로그인 없이 select → 0건, 로그인 후 delete 시도 → 0건 삭제.
- **빌드 게이트**: `npm run typecheck`, `npm test`, `npm run build`, `docker build` 모두 성공.

## 10. 저장소 구조

```
.github/workflows/deploy.yml
src/
  main.tsx, App.tsx(라우터·세션 가드·오프라인 배너)
  lib/supabase.ts, lib/money.ts, lib/dates.ts, lib/ocr.ts(함수 호출), lib/image.ts(canvas 축소 공용), lib/db.ts(쿼리 함수)
  pages/Login.tsx, Home.tsx, AddPayment.tsx, Payments.tsx, Cards.tsx, Settings.tsx
  components/(공통 소품 최소)
public/icons/
supabase/config.toml, migrations/{0001_init,0002_reset_at,0003_card_prefix,0004_stored_balance,0005_ocr_quota,0006_receipt_images,0007_*,0008_receipt_storage,0009_function_grants}.sql
          functions/ocr/{index.ts,clova-general.ts,gemini.ts,merge.ts,quota.ts,*.fixtures.ts,*.test.ts}
scripts/{seed-owner,disable-signup,set-secrets,set-db-secrets,db-smoke}.mjs
Dockerfile, nginx.conf, docker-compose.yml, README.md
docs/adr/, docs/superpowers/specs/, docs/scrum/, docs/qa/
```

## 11. 기능 체크리스트 (QA 검수 기준)

- [ ] PIN 6자리만으로 로그인(6자리를 채우면 자동 시도), 틀리면 오류 메시지와 입력 비우기, 세션 유지, 로그아웃
- [ ] 로그인 없이 어떤 경로로 들어가도 `/login`으로 이동
- [ ] 카드 추가(이름, 예산, 카드번호 앞 6~8자리 선택) / 수정 / 삭제(결제 있으면 거부 안내)
- [ ] 홈: 총 잔액 = 카드 잔액 합, 카드별 잔액, 최근 결제 5건
- [ ] 수동 결제 추가 → 해당 카드 잔액 즉시 감소
- [ ] 영수증 입력 → OCR → 폼 자동 채움(가맹점·금액·일시·카드번호) → 카드 자동 선택(앞자리 일치 시) → 저장
- [ ] 앞 6자리가 같은 카드를 두 장 등록해 두고 그 카드 영수증을 읽으면 카드 칸이 빈 채로 남고, 화면 아래 빨간 스낵바로 "앞자리가 같은 카드가 2장 있습니다. 카드를 직접 선택해 주세요" 가 뜨며 5초 뒤 사라지고 누르면 바로 사라짐
- [ ] OCR 이 확신하지 못한 칸은 호박색 테두리 + "확인해 주세요" 표시, 그 칸을 고치면 표시가 사라짐
- [ ] `GEMINI_API_KEY` 없이 CLOVA 만으로도 영수증 입력 흐름이 끝까지 동작(읽지 못한 칸은 `uncertain` 표시)
- [ ] OCR 실패 시 안내 후 직접 입력 가능
- [ ] 무료 한도가 둘 다 소진이면 "영수증 입력" 버튼이 회색 비활성 모양(누를 수는 있음)이고, 누르면 버튼 아래 말풍선으로 한도 안내가 뜨며 다시 누르거나 다른 곳을 누르면 닫힘. 파일 선택 창은 열리지 않음
- [ ] 인식 도중 429 `ocr_quota_exceeded` 를 받으면 같은 한도 문구를 안내 자리에 띄우고 직접 입력 폼으로 넘어감. "직접 입력" 버튼은 한도와 무관하게 그대로 동작
- [ ] 내역: 월 이동, 카드 필터, 월 합계(취소 제외), 정렬 최신순
- [ ] 결제 상세: 메모만 수정 가능, 다른 필드 편집 불가
- [ ] 영수증으로 넣은 결제의 상세 시트 맨 아래 "영수증 사진" 줄에 아이콘 버튼이 보이고, 누르면 전체 화면으로 커지며 아무 곳이나 누르거나 닫기 버튼으로 닫힌다
- [ ] 직접 입력으로 만든 결제의 상세 시트에는 사진 자리가 아예 없다
- [ ] 사진 보관에 실패해도 결제는 저장된 채 홈으로 가고 안내 한 줄이 뜬다
- [ ] 결제가 지워지면(3개월 정리 포함) 데이터베이스 트리거가 그 영수증 사진도 저장소에서 지운다(스모크 스크립트로 pg_net 요청 검증)
- [ ] Vault 에 비밀을 넣기 전에도 결제 삭제가 정상 동작한다(트리거가 조용히 지나간다)
- [ ] 결제 취소: 확인창, 취소 후 잔액에 다시 더해짐, 취소선 표시, 되돌리기 불가
- [ ] 카드 화면에 초기화 버튼이 없다(카드별도, "모든 카드 초기화" 도). 상세 시트 버튼은 수정·삭제 둘뿐
- [ ] 지난달 날짜로 결제를 추가하면 내역에만 들어가고 이번 달 잔액은 그대로
- [ ] 예산을 고쳐도 이번 달 잔액은 그대로(안내 문구 "예산을 바꾸면 다음 달 1일부터 적용됩니다" 우측 정렬로 표시)
- [ ] 월 초기화: `cards.balance_month` 를 지난달로 만들어 두고 앱을 열면 잔액이 예산으로 채워짐(`roll_over_balances`), 결제를 넣으면 넘김 뒤 차감됨
- [ ] 3개월 지난 결제 정리 규칙(스모크 스크립트로 검증)
- [ ] 저장소 `receipts` 는 비공개이고, 다른 폴더(`{다른 owner_id}/…`)의 파일은 읽거나 지울 수 없다
- [ ] 현재 PIN 확인 후 PIN 변경, 변경 뒤에는 새 PIN 으로만 로그인
- [ ] PWA 설치 가능(manifest, 아이콘, 서비스워커), 오프라인 배너
- [ ] DB 직접 접근: anon으로 0건, 로그인 후 delete 0건, 금액 update 거부
- [ ] 공개 가입 차단 확인
- [ ] GitHub Pages 배포 URL에서 로그인 화면 표시, 하위 경로 새로고침 정상
- [ ] `docker build` 성공, 컨테이너에서 로그인 화면 표시
