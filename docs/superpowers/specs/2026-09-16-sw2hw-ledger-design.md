# SW2HW 장부 설계 스펙

작성일 2026-09-16. 이 문서는 구현 작업자 전원의 계약서다. 여기 없는 기능은 만들지 않는다. 용어는 `CONTEXT.md`, 백엔드 선택 배경은 `docs/adr/0001`을 따른다.

## 1. 목표와 비목표

**목표**: 공용 비밀번호 하나로 여러 사람이 접속하는 모바일 우선 PWA. 카드를 등록해 초기 잔액을 두고, 영수증 촬영(네이버 CLOVA General OCR + 필요할 때만 Gemini 보완) 또는 수동 입력으로 결제를 기록하면 카드 잔액이 줄어든다. 언제든 접속해 총 잔액·카드별 잔액·결제 내역을 본다.

**비목표(만들지 않음)**: 회원가입, 다중 계정, 카테고리·태그, 통계·차트, 영수증 사진 보관, 품목 저장, 오프라인 입력, 입금 기록, 결제 수정·삭제(메모 제외), 자동 월초 초기화, 검색.

## 2. 확정된 결정 요약

| # | 결정 |
|---|---|
| 1 | 단일 계정, PIN 6자리 하나. 계정은 배포 시 PM이 관리자 API로 1개 생성. 앱에는 로그인(PIN 입력) 화면만 있음. 공개 가입 차단 |
| 2 | Supabase(Postgres, Auth, Edge Function) + 정적 SPA. 자체 호스팅 Supabase(Docker)로 이전 가능하게 유지(ADR 0001) |
| 3 | 카드마다 초기 잔액. 잔액 = 초기 잔액 − (마지막 초기화 시각 이후, 취소되지 않은 결제 합) |
| 4 | 입금 없음. 초기 잔액은 수정 가능. 초기화(카드별·전체)는 카드 관리 화면에서만, 확인창 한 번으로 실행한다. 초기화하면 그 시각 이전 결제가 잔액에서 빠져 잔액이 초기 잔액이 된다 |
| 5 | 결제 = 카드, 가맹점, 금액, 결제 일시, 메모(선택), 영수증에서 읽은 카드번호 일부, 출처(receipt/manual) |
| 5-1 | OCR 은 두 단계다. 1단계 CLOVA General OCR + 자체 파서, 2단계는 파서가 확신하지 못한 필드가 있을 때만 Gemini 로 보완한다. 유료 영수증 전용 모델은 쓰지 않는다 |
| 5-2 | 카드 자동 선택은 카드번호 **앞자리**로 맞춘다. 한국 카드전표는 뒤 4자리를 가리므로(실측 "4265-86**-****-****", "42658698********") 뒤 4자리로는 영영 맞출 수 없다 |
| 6 | 영수증 사진은 OCR 후 버림. 촬영 흐름은 저장 직전까지 File 객체를 유지해 나중에 업로드 단계를 끼울 수 있게 함 |
| 7 | 온라인 전용 PWA. 오프라인이면 안내 배너만 |
| 8 | Vite + React + TypeScript + Tailwind + vite-plugin-pwa + react-router + supabase-js. 상태관리·컴포넌트 라이브러리 없음 |
| 9 | 프런트 호스팅: GitHub Pages(dwiw2d 계정, 공개 저장소 `team_budget_manager`) + GitHub Actions. Docker(nginx) 이미지도 제공 |
| 10 | 결제 내역: 월별 목록 + 카드 필터 + 월 합계. 메모만 수정. 삭제 없음. 잘못된 결제는 취소(되돌릴 수 없음) |
| 11 | 보관: 이번 달 포함 최근 3개월. 그보다 오래되고 카드의 마지막 초기화보다 앞선 결제만 앱 시작 시 서버 함수로 삭제 |
| 12 | 앱 이름 "SW2HW 장부". 시간대 Asia/Seoul 고정. 금액은 원 단위 정수 |

## 3. 아키텍처

```
브라우저(PWA, React SPA, 정적 파일)
  ├─ supabase-js ─▶ Supabase Auth (계정 1개)
  ├─ supabase-js ─▶ Postgres: cards, payments, card_balances(뷰), purge_old_payments()(RPC)
  └─ fetch ───────▶ Edge Function `ocr` ─┬▶ 네이버 CLOVA General OCR (1단계)
                                         └▶ Gemini generateContent (2단계, 확신 없을 때만)
```

- 서버 코드는 `supabase/migrations/*.sql`과 `supabase/functions/ocr/` 뿐이다. 대시보드 수작업 금지.
- 브라우저 빌드 환경 변수: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_BASE_PATH`(기본 `/`, Pages는 `/team_budget_manager/`).
- 로컬 비밀 값은 `.env.local`(git 무시)에 있다. 키 이름: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `APP_OWNER_EMAIL`, `APP_OWNER_PASSWORD`, (아침에 추가) `NAVER_OCR_GENERAL_INVOKE_URL`, `NAVER_OCR_GENERAL_SECRET`, (선택) `GEMINI_API_KEY`, `GEMINI_MODEL`. **값을 로그·커밋·문서에 절대 출력하지 않는다.**
- Supabase 프로젝트 ref `owxbsjsetesazmnqvzxd`(도쿄). CLI는 `npx supabase`(2.117.0)로 실행하고 `SUPABASE_ACCESS_TOKEN` 환경 변수를 넘긴다.

## 4. 데이터 모델 (마이그레이션 `supabase/migrations/0001_init.sql` + `0002_reset_at.sql` + `0003_card_prefix.sql`)

아래 DDL이 계약이다. 컬럼 이름을 바꾸지 않는다. `0001_init.sql` 은 클라우드에 적용된 뒤 수정하지 않으며, 이후 변경은 번호를 올린 파일로 쌓는다. `0002_reset_at.sql` 이 `cards.reset_date date` 를 `cards.reset_at timestamptz` 로 바꾸고 뷰·함수를 다시 만든다(초기화를 날짜가 아니라 시각으로 기록해야 초기화 당일 결제가 잔액에서 빠진다). `0003_card_prefix.sql` 이 `cards.last4` 를 `cards.card_prefix` 로 바꾸고 뷰를 같은 정의로 다시 만든다(영수증이 뒤 4자리를 가리므로 앞자리로 맞춘다. 기존 4자리 값은 새 제약을 못 지켜 null 로 비운다). 아래는 세 마이그레이션을 적용한 최종 형태다.

```sql
create table public.cards (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id),
  name text not null check (length(trim(name)) between 1 and 40),
  initial_balance bigint not null check (initial_balance >= 0),
  card_prefix text check (card_prefix ~ '^[0-9]{6,8}$'),
  reset_at timestamptz,
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
```

**행 단위 접근 제어(RLS)**: 두 테이블 모두 활성화. 역할 `authenticated`에 대해 `owner_id = auth.uid()` 조건으로 cards는 select/insert/update/delete, payments는 select/insert/update만. payments에 delete 정책은 없다(삭제 불가). `anon`에는 아무 정책도 없다.

**payments 갱신 트리거** (`before update`): memo 변경과 "canceled_at이 null → 값" 전이만 허용. 다른 컬럼이 바뀌거나 이미 취소된 행의 canceled_at이 바뀌면 `raise exception`. canceled_at이 새로 설정되면 서버가 `now()`로 덮어쓴다.

**뷰 `card_balances`** (`security_invoker = true`): cards의 모든 컬럼 + `balance bigint`.

```
balance = initial_balance - coalesce(sum(p.amount), 0)
  where p.card_id = c.id and p.canceled_at is null
    and (c.reset_at is null or p.paid_at >= c.reset_at)
```

**함수 `purge_old_payments() returns integer`** (`security definer`, `set search_path = public`, `authenticated`에만 execute 허용, `anon`/`public`은 revoke):

```
cutoff := (date_trunc('month', now() at time zone 'Asia/Seoul') - interval '2 months')::date;
delete from payments p using cards c
 where p.card_id = c.id and p.owner_id = auth.uid() and c.reset_at is not null
   and (p.paid_at at time zone 'Asia/Seoul')::date < cutoff
   and p.paid_at < c.reset_at;
return 삭제 건수;
```

`auth.uid()`가 null이면 0을 반환하고 아무것도 지우지 않는다.

**카드 삭제**: 결제가 있으면 FK restrict로 실패한다. 앱은 "결제 N건이 있어 삭제할 수 없습니다"를 보여준다.

## 5. Edge Function `ocr`

- 경로 `supabase/functions/ocr/index.ts`(Deno). `supabase/config.toml`의 `[functions.ocr] verify_jwt = false`로 두고 함수 안에서 `Authorization: Bearer <access_token>`을 `supabase.auth.getUser()`로 검증한다. 실패 시 401.
- 요청: `POST` JSON `{ "image": "<base64, data: 접두어 없음>", "format": "jpg" | "png" }`. 최대 5MB(base64 기준 초과 시 413).
- 응답 200: `{ "merchant": string|null, "paidAt": string|null, "amount": number|null, "cardNumber": string|null, "uncertain": string[] }`. `paidAt`은 `YYYY-MM-DDTHH:mm:ss+09:00` 형식. 읽지 못한 항목은 null. `uncertain`은 사용자가 확인해야 하는 필드 이름들이다.
- **1단계 CLOVA General OCR**: `POST ${NAVER_OCR_GENERAL_INVOKE_URL}`(콘솔이 주는 Invoke URL 이 이미 `/general` 로 끝나므로 뒤에 아무것도 붙이지 않는다), 헤더 `X-OCR-SECRET: ${NAVER_OCR_GENERAL_SECRET}`, 본문 `{ version: "V2", requestId: <uuid>, timestamp: Date.now(), lang: "ko", images: [{ format, name: "receipt", data: <base64> }] }`. 응답 `images[0].fields[]`(`inferText`, `lineBreak`, `boundingPoly`)를 `clova-general.ts` 파서가 네 필드로 바꾼다.
- 파서는 `weak: string[]` 로 확신 없음을 알린다: merchant가 null / amount가 null / amount를 "합계·총액·결제금액" 같은 낱말 없이 "가장 큰 숫자" 규칙으로 고름 / paidAt이 null / 시각을 못 찾아 `00:00:00`으로 채움. cardNumber는 영수증에 원래 없는 경우가 많아 weak에 넣지 않는다.
- **2단계 Gemini**: `weak`가 비어 있지 않거나 **1단계가 통째로 실패했고**(네트워크 오류, HTTP 오류, `inferResult`가 `SUCCESS`가 아님, 응답 파싱 실패) `GEMINI_API_KEY`가 있을 때 `POST https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`(헤더 `x-goog-api-key`)를 부른다. 모델 기본값은 `gemini-3.6-flash`(`gemini-2.5-flash`는 신규 사용자에게 막혀 404). 구조화 출력으로 같은 네 필드를 받는다.
- **병합 규칙**(`merge.ts`, 순수 TS + Vitest): 각 필드에 대해 CLOVA 값이 null이거나 weak면 Gemini 값을 쓴다. 둘 다 값이 있고 서로 다르면 Gemini 값을 쓰되 그 필드 이름을 `uncertain`에 넣는다. weak인데 Gemini도 읽지 못하면 CLOVA 값을 두고 `uncertain`에 넣는다. Gemini 호출이 실패하면 CLOVA 값을 그대로 쓰고 `weak`를 그대로 `uncertain`으로 옮긴다. **1단계 성공 시 Gemini 실패는 오류로 만들지 않는다.**
- **1단계가 통째로 실패한 경우**(`merge.ts`의 `resolve`): Gemini 결과만으로 응답한다. 대조할 CLOVA 근거가 하나도 없으므로 값이 있는 필드 이름을 전부(`cardNumber` 포함) `uncertain`에 넣어 사용자가 확인하게 한다. Gemini도 실패하면 502다. 2단계를 부를지 정하는 이 판단은 `index.ts`가 아니라 `merge.ts`의 순수 함수 `resolve(clova, askGemini)`에 있고 Vitest로 네 경우(1단계 성공·weak 없음 / 성공·weak 있음 / 실패·Gemini 성공 / 실패·Gemini 실패)를 덮는다.
- 파서와 Gemini 모듈은 `supabase/functions/ocr/{clova-general,gemini,merge}.ts`에 Deno 의존성 없는 순수 TS로 두고 Vitest로 테스트한다(`*.fixtures.ts`는 실제 응답에서 옮긴 것). `scripts/ocr-bench/lib/*-extract.mjs`는 이 `.ts` 를 재수출하는 껍데기다.
- 오류: 시크릿 없음(`NAVER_OCR_GENERAL_INVOKE_URL` 또는 `NAVER_OCR_GENERAL_SECRET` 미설정) → 503 `{ "error": "ocr_not_configured" }`. **1단계와 2단계가 모두 실패**(또는 1단계 실패 + `GEMINI_API_KEY` 없음) → 502 `{ "error": "ocr_failed" }`. 1단계만 실패하고 2단계가 성공하면 200 이다.
- `NAVER_OCR_MOCK=1`이 설정된 경우에만 아무것도 호출하지 않고 CLOVA 픽스처를 파서에 통과시킨 고정 응답을 돌려준다(QA 전용, 클라우드에는 설정하지 않음).
- 시크릿 등록은 `npm run sb:secrets`(`.env.local`에 있는 `NAVER_OCR_GENERAL_INVOKE_URL`, `NAVER_OCR_GENERAL_SECRET`, `GEMINI_API_KEY`, `GEMINI_MODEL` 중 존재하는 값만 `supabase secrets set`으로 올리고 이름만 출력).

## 6. 화면 명세 (모두 한국어, 모바일 우선, 최소 폭 360px)

공통: 하단 탭 4개(홈, 내역, 카드, 설정) + 홈·내역 화면 우하단 "결제 추가" 플로팅 버튼. 세션 없으면 어느 경로든 `/login`으로. 오프라인(`navigator.onLine === false`)이면 상단에 "네트워크 연결을 확인하세요" 배너. 금액 표시는 `1,234,567원`. 로딩 중 스켈레톤 없이 "불러오는 중…" 텍스트면 충분.

1. **로그인 `/login`**: 앱 이름, 안내 문구 "PIN 6자리를 입력하세요", PIN 입력 하나(`type=password`, `inputMode=numeric`, 최대 6자, 숫자만 남기고 가운데 정렬·자간 확대), 로그인 버튼. 이메일은 코드 상수 `owner@sw2hw.local`. 6자리가 채워지면 자동으로 로그인을 시도하고, 버튼은 6자리가 아니면 비활성. 실패 시 "PIN이 올바르지 않습니다"와 함께 입력을 비운다. 성공 시 `/`. 세션은 supabase-js 기본(localStorage)으로 유지.
2. **홈 `/`(대시보드)**: 상단 총 잔액(큰 글씨), 카드별 잔액 목록(이름, 카드번호 앞자리, 잔액. 음수는 빨간색), 최근 결제 5건(가맹점, 금액, 카드 이름, 일시. 취소 건은 취소선). 진입 시 `purge_old_payments` RPC 호출 후 데이터 로드.
3. **결제 추가 `/add`**: 상단에 "영수증 촬영"(`<input type="file" accept="image/*" capture="environment">`)과 "직접 입력" 두 버튼. 촬영 시 canvas로 긴 변 1600px, JPEG 0.85로 줄여 base64로 `ocr` 함수 호출, "영수증을 읽는 중…" 표시. 결과로 폼을 채우고 OCR이 읽은 카드번호를 읽기 전용으로 표시. 카드 자동 선택: 읽은 번호에서 공백·하이픈을 걷어낸 뒤 첫 마스킹 문자 앞까지의 연속된 숫자를 뽑아 카드의 `card_prefix`와 앞에서부터 비교한다. 비교 길이는 둘 중 짧은 쪽이며 6자리 미만이면 선택하지 않는다. 정확히 한 장만 일치할 때만 선택. 폼: 카드(select, 필수), 가맹점(필수), 금액(필수, 양의 정수), 결제 일시(`datetime-local`, 기본 지금), 메모(선택). 응답의 `uncertain`에 든 필드의 입력은 호박색 테두리(`border-amber-500`)와 그 아래 작은 안내("확인해 주세요")로 표시하고, 사용자가 그 칸을 고치면 표시를 지운다(`cardNumber`는 카드 선택 칸에 표시). 저장 → insert(`source`는 촬영이면 `receipt`, 아니면 `manual`; OCR 실패 후 직접 입력해도 `manual`) → 홈으로. OCR 실패(503/502/네트워크)는 "영수증을 읽지 못했습니다. 직접 입력해 주세요" 후 빈 폼.
4. **내역 `/payments`**: 상단 월 이동(◀ 2026년 9월 ▶, 기본 이번 달), 카드 필터(전체/각 카드), 월 합계(취소 제외). 목록은 결제 일시 내림차순. 항목 클릭 → 상세 시트: 모든 필드 읽기 전용, 메모만 편집·저장, "취소" 버튼(확인창: "이 결제를 취소하면 되돌릴 수 없습니다"). 취소된 항목은 취소선 + "취소됨". 월 경계는 KST(+09:00 고정) 기준으로 계산해 `paid_at gte/lt`로 조회.
5. **카드 `/cards`**: 카드 목록(이름, 카드번호 앞자리, 초기 잔액, 잔액, 마지막 초기화 시각. 초기화 전이면 "초기화 전"). 카드 추가/수정 폼(이름, 초기 잔액, 카드번호 앞자리 선택). 앞자리 입력의 라벨은 "카드번호 앞 6~8자리(선택)"이고 그 아래에 "영수증은 뒤 4자리를 가리므로 앞자리로 맞춥니다" 한 줄을 둔다. 숫자 6~8자리가 아니면 저장하지 않는다. 카드별 "초기화" 버튼과 목록 상단 "모든 카드 초기화" 버튼: 둘 다 확인창 후 즉시 초기화하며 기준은 누른 그 시각. 카드 삭제 버튼: 확인창 후 삭제, FK 오류면 안내.
6. **설정 `/settings`**: PIN 변경(현재 PIN·새 PIN·새 PIN 확인 3개 입력. 현재 PIN 은 `signInWithPassword`로 확인한 뒤 `auth.updateUser`로 변경), 로그아웃, 앱 버전 표시.

PWA: manifest `name`/`short_name` "SW2HW 장부", `display: standalone`, `lang: ko`, `theme_color`, 아이콘 192·512 PNG(+ SVG 원본, 글자 "S"). 서비스워커는 vite-plugin-pwa `generateSW`, `registerType: 'autoUpdate'`, 앱 셸만 프리캐시하고 Supabase 요청은 캐시하지 않는다.

## 7. 인증·보안

- Supabase Auth 이메일+비밀번호를 쓰되, 비밀번호 자리에 숫자 6자리 PIN 을 넣는다(프로젝트 설정: 최소 길이 6, 문자 종류 요구 없음, HIBP 검사 꺼짐). PIN 형식 검증은 클라이언트(`src/lib/auth.ts`의 `isPin`)가 한다. 계정 1개는 PM이 `scripts/seed-owner.mjs`로 생성(service_role 키로 `POST /auth/v1/admin/users`, `email_confirm: true`). 이 스크립트는 `.env.local`의 `APP_OWNER_EMAIL`, `APP_OWNER_PASSWORD`를 읽는다. 값은 출력하지 않는다.
- 공개 가입 차단: `supabase/config.toml` `[auth] enable_signup = false` + 클라우드에는 `scripts/disable-signup.mjs`(Management API `PATCH /v1/projects/{ref}/config/auth` `{ "disable_signup": true }`, PAT 사용). 차단 확인은 anon 키로 `signUp` 시도 → 오류.
- PIN 복구(앱 밖): README에 SQL 편집기용 `update auth.users set encrypted_password = crypt('새비밀번호', gen_salt('bf')) where email = 'owner@sw2hw.local';` 를 적는다.
- 브라우저에는 anon 키만 있다. 데이터 보호는 RLS, 삭제·수정 금지는 정책과 트리거가 맡는다. UI 제한은 보조일 뿐이다.

## 8. 배포·운영

- **저장소**: GitHub `dwiw2d/team_budget_manager`(공개). 이 워크트리의 현재 브랜치(`receipt-tracker-pwa`)를 원격 `main`으로 푸시한다(`git push origin HEAD:main`). 브랜치 이름을 명령에 쓰지 말고 항상 `HEAD:main`을 쓴다.
- **GitHub Actions** `.github/workflows/deploy.yml`: `main` 푸시 시 `npm ci` → `npm test` → `npm run typecheck` → `npm run build`(`VITE_BASE_PATH=/team_budget_manager/`, `VITE_SUPABASE_URL`·`VITE_SUPABASE_ANON_KEY`는 저장소 **variables**) → `dist/404.html`을 `index.html` 복사본으로 생성 → `actions/upload-pages-artifact` → `actions/deploy-pages`. Pages 소스는 GitHub Actions. 저장소 변수는 `gh variable set`으로 등록.
- **Docker**: `Dockerfile`(1단계 node:24-alpine 빌드, `ARG VITE_*`; 2단계 nginx:alpine, `nginx.conf`에 `try_files $uri /index.html`), `docker-compose.yml`(포트 8080). `docker build`가 성공해야 한다.
- **Supabase 스크립트(package.json)**: `sb:link`, `sb:push`(`supabase db push`), `sb:functions`(`supabase functions deploy ocr`), `sb:secrets`, `sb:seed-owner`, `sb:disable-signup`, `db:smoke`. 전부 `.env.local`을 읽는다(`dotenv` 없이 Node 24의 `process.loadEnvFile` 사용).
- **README.md**(한국어): 로컬 개발, 환경 변수, 클라우드 배포 순서, 아침에 할 일(NAVER 시크릿 2개 넣고 `npm run sb:secrets`), 자체 호스팅 Supabase로 옮기는 절차(공식 docker compose, `GOTRUE_DISABLE_SIGNUP=true`, 마이그레이션 적용, 함수 배포, 계정 생성, 프런트 Docker 실행), 비밀번호 복구 SQL.

## 9. 테스트 전략

- **Vitest 단위**: `src/lib/money.test.ts`(원 표기), `src/lib/dates.test.ts`(KST 월 경계, datetime-local 변환), `src/lib/cards.test.ts`(앞자리 자동 선택), `supabase/functions/ocr/{clova-general,gemini,merge}.test.ts`(실제 응답 픽스처 → 네 필드 + weak, Gemini 응답 정규화, 병합 규칙).
- **DB 스모크 `scripts/db-smoke.mjs`**: Management API `POST /v1/projects/{ref}/database/query`(PAT)로 한 트랜잭션 안에서 카드·결제 삽입 → `card_balances` 검증 → 금액 수정 시도(실패 기대) → 취소 → 잔액 재검증 → 취소 되돌리기 시도(실패 기대) → 3개월 전 결제 삽입 후 purge 규칙 검증 → `rollback`. 실 데이터에 흔적을 남기지 않는다. (superuser라 RLS는 우회되므로 RLS 자체는 아래 QA가 확인)
- **QA 시나리오(수동, 브라우저)**: 11절 체크리스트 전 항목. QA는 가능하면 로컬 Supabase(`supabase start`, Docker)에서 수행하고, 불가하면 클라우드에서 수행한 뒤 만든 테스트 데이터를 정리한다. RLS 확인: anon 키로 로그인 없이 select → 0건, 로그인 후 delete 시도 → 0건 삭제.
- **빌드 게이트**: `npm run typecheck`, `npm test`, `npm run build`, `docker build` 모두 성공.

## 10. 저장소 구조

```
.github/workflows/deploy.yml
src/
  main.tsx, App.tsx(라우터·세션 가드·오프라인 배너)
  lib/supabase.ts, lib/money.ts, lib/dates.ts, lib/ocr.ts(압축·함수 호출), lib/db.ts(쿼리 함수)
  pages/Login.tsx, Home.tsx, AddPayment.tsx, Payments.tsx, Cards.tsx, Settings.tsx
  components/(공통 소품 최소)
public/icons/
supabase/config.toml, migrations/{0001_init,0002_reset_at,0003_card_prefix}.sql
          functions/ocr/{index.ts,clova-general.ts,gemini.ts,merge.ts,*.fixtures.ts,*.test.ts}
scripts/{seed-owner,disable-signup,set-secrets,db-smoke}.mjs
Dockerfile, nginx.conf, docker-compose.yml, README.md
docs/adr/, docs/superpowers/specs/, docs/scrum/, docs/qa/
```

## 11. 기능 체크리스트 (QA 검수 기준)

- [ ] PIN 6자리만으로 로그인(6자리를 채우면 자동 시도), 틀리면 오류 메시지와 입력 비우기, 세션 유지, 로그아웃
- [ ] 로그인 없이 어떤 경로로 들어가도 `/login`으로 이동
- [ ] 카드 추가(이름, 초기 잔액, 카드번호 앞 6~8자리 선택) / 수정 / 삭제(결제 있으면 거부 안내)
- [ ] 홈: 총 잔액 = 카드 잔액 합, 카드별 잔액, 최근 결제 5건
- [ ] 수동 결제 추가 → 해당 카드 잔액 즉시 감소
- [ ] 영수증 촬영 → OCR → 폼 자동 채움(가맹점·금액·일시·카드번호) → 카드 자동 선택(앞자리 일치 시) → 저장
- [ ] OCR 이 확신하지 못한 칸은 호박색 테두리 + "확인해 주세요" 표시, 그 칸을 고치면 표시가 사라짐
- [ ] `GEMINI_API_KEY` 없이 CLOVA 만으로도 촬영 흐름이 끝까지 동작(읽지 못한 칸은 `uncertain` 표시)
- [ ] OCR 실패 시 안내 후 직접 입력 가능
- [ ] 내역: 월 이동, 카드 필터, 월 합계(취소 제외), 정렬 최신순
- [ ] 결제 상세: 메모만 수정 가능, 다른 필드 편집 불가
- [ ] 결제 취소: 확인창, 취소 후 잔액에서 제외, 취소선 표시, 되돌리기 불가
- [ ] 카드별 초기화(확인창 후 즉시, 기준은 누른 그 시각) → 잔액이 초기 잔액과 같아지고, 그 시각 이전 결제는 내역에 남되 잔액 제외(같은 날 결제 포함)
- [ ] 모든 카드 초기화
- [ ] 초기화 후 초기화 시각 이전 일시의 결제를 추가하면 잔액이 줄지 않음
- [ ] 3개월 지난 결제 정리 규칙(스모크 스크립트로 검증)
- [ ] 현재 PIN 확인 후 PIN 변경, 변경 뒤에는 새 PIN 으로만 로그인
- [ ] PWA 설치 가능(manifest, 아이콘, 서비스워커), 오프라인 배너
- [ ] DB 직접 접근: anon으로 0건, 로그인 후 delete 0건, 금액 update 거부
- [ ] 공개 가입 차단 확인
- [ ] GitHub Pages 배포 URL에서 로그인 화면 표시, 하위 경로 새로고침 정상
- [ ] `docker build` 성공, 컨테이너에서 로그인 화면 표시
