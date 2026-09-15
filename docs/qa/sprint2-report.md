# 스프린트 2 QA 보고서

- 작성일: 2026-09-16 (새벽)
- 대상 커밋: `77cb7a0` (브랜치 `receipt-tracker-pwa`, GitHub Pages 배포본과 번들 해시 `index-Bn9fBZfY.js` 동일)
- 기준 문서: `docs/superpowers/specs/2026-09-16-sw2hw-ledger-design.md` §11 체크리스트 전 항목
- 검수 범위: 저장소 전체(src, supabase, scripts, .github, Dockerfile, README) + 클라우드 Supabase 프로젝트(.env.local 의 `SUPABASE_PROJECT_REF`)
- 결론: **§11 20개 항목 중 PASS 19, FAIL 1(부분 BLOCKED)**. high 버그 1건(OCR 요청 본문 키 불일치)이 영수증 인식 기능 전체를 막고 있다. 나머지 화면·DB 규칙·배포·PWA 는 스펙대로 동작한다.

## 1. 게이트 결과

| 게이트 | 결과 | 근거 / 비고 |
|---|---|---|
| `npm install` | 성공 | 취약점 0. 동시 작업자의 `node_modules` 삭제를 피하려고 `npm ci` 대신 `npm install` 사용. lockfile 변경 없음(`git status` clean) |
| `npm run typecheck` | 성공 | `tsc --noEmit` 오류 0 |
| `npm test` | 성공 | Vitest 3 파일 / 14 테스트 통과 (money 1, dates 9, normalize 4) |
| `npm run build` | 성공 | PWA generateSW, precache 11 entries(523 KiB). 경고: 청크 500 kB 초과(정보성), `vite.config.ts` 의 `package.json` import 에 `with { type: 'json' }` 없음(Vite 차기 버전 경고) |
| `VITE_BASE_PATH=/team_budget_manager/ npm run build` | 성공 | `dist/index.html` 자산·manifest·registerSW 경로 모두 `/team_budget_manager/...`, manifest `scope` `/team_budget_manager/`, SW `register('/team_budget_manager/sw.js', {scope:'/team_budget_manager/'})`. 주의: Git Bash 에서는 `MSYS_NO_PATHCONV=1` 없이 실행하면 셸이 `/team_budget_manager/` 를 Windows 경로로 바꿔 버림(코드 문제 아님) |
| `docker build` (`.env.local` 값을 build-arg 로) | 성공 | 이미지 `sw2hw-qa:latest`. 컨테이너(18080) `GET /`, `/payments`, `/cards/deep/path` → 200, `<title>SW2HW 장부</title>`, `manifest.webmanifest` → `application/manifest+json`, `sw.js` → `Cache-Control: no-cache`. Docker Desktop 이 꺼져 있어 QA 가 시작함(끝나고도 켜 둠) |
| `npm run db:smoke` | 성공 | (a) balance 40000 (b) amount 수정 예외 (c) 취소 후 70000 (d) 취소 되돌리기 예외 (e) reset_date 후 80000 (f) purge 규칙 1건 — 전부 PASS, 트랜잭션 롤백 |

## 2. §11 체크리스트 판정

브라우저 시나리오는 `npm run dev`(127.0.0.1:5173, 클라우드 Supabase) 를 Orca 내장 브라우저로 조작했다. 테스트 데이터는 모두 `QA-` 접두어. 판정 근거는 스냅샷(접근성 트리)·네트워크 로그·REST 응답 코드다.

| # | 항목 | 판정 | 근거 |
|---|---|---|---|
| 1 | 비밀번호만으로 로그인, 틀리면 오류, 세션 유지, 로그아웃 | PASS | 오답 → "비밀번호가 올바르지 않습니다". 정답 → `/` 홈. 새로고침 후에도 로그인 유지, `/settings` 직접 진입 정상. 설정의 로그아웃 → `/login` |
| 2 | 로그인 없이 어떤 경로든 `/login` | PASS | 세션 없이 `/cards`(dev), Pages `/team_budget_manager/payments`, 컨테이너 `/cards` 모두 로그인 화면으로 이동 |
| 3 | 카드 추가/수정/삭제(결제 있으면 거부) | PASS | `QA-카드A`(100,000, 5678), `QA-카드B`(30,000, 뒤 4자리 없음) 추가. 뒤 4자리 "12" 는 `pattern="[0-9]{4}"` 브라우저 검증에 막힘. 수정 → `QA-카드B2`/40,000/1111 반영. 빈 카드 삭제 시 확인창 "'QA-카드B2' 카드를 삭제할까요?" 후 목록에서 제거. 결제 있는 카드 삭제 → "결제 1건이 있어 삭제할 수 없습니다" |
| 4 | 홈: 총 잔액 = 카드 잔액 합, 카드별 잔액, 최근 결제 5건 | PASS | 총 잔액 150,000 = 50,000 + 100,000. 이후 모든 단계에서 합계 일치(145,500 / 140,000 / 137,000 / 147,000 / 90,000). 최근 결제에 취소 건 "취소됨" 표시. 음수 잔액 `-10,000원` 은 `text-red-600` 클래스 확인 |
| 5 | 수동 결제 추가 → 카드 잔액 즉시 감소 | PASS | `QA-편의점` 4,500 저장 직후 홈: `QA-카드A` 95,500, 총 145,500 |
| 6 | 영수증 촬영 → OCR → 폼 자동 채움 → 카드 자동 선택 → 저장 | **FAIL** (실제 영수증 인식은 BLOCKED) | **BUG-1**: 앱이 함수에 `{ base64, format }` 를 보내는데 함수는 `image` 키를 읽어 항상 400 `invalid_request`. 로컬 MOCK 함수(`NAVER_OCR_MOCK=1`)에 앱이 보낸 요청이 네트워크 로그에서 `POST /functions/v1/ocr → 400`. 같은 본문을 직접 보내도 400, 스펙 본문 `{ image, format }` 은 200. 클라우드 배포 함수도 동일(400). 참고: 페이지 안에서 `JSON.stringify` 를 감싸 키만 `image` 로 바꾸는 임시 shim 을 넣고 다시 촬영하면 가맹점 "GS25 역삼점"·금액 12300·일시 2026-09-15T12:34·영수증 카드번호 "1234-56**-****-5678" 자동 채움, 뒤 4자리 5678 카드 자동 선택, 저장 후 잔액 187,700, 상세의 출처 "영수증"·영수증 카드번호 저장까지 모두 정상 → 키 이름만 고치면 통과 예상. 네이버 실제 인식은 키 미등록으로 BLOCKED. `normalize.test.ts` 4건 통과 |
| 7 | OCR 실패 시 안내 후 직접 입력 가능 | PASS | 클라우드에서 촬영 → "영수증을 읽지 못했습니다. 직접 입력해 주세요" + 빈 폼(카드 미선택). 이어서 직접 입력 저장 → 상세의 출처 "직접 입력"(`manual`). 배포 함수 503 계약은 직접 호출로 확인: 로그인 토큰 + 스펙 본문 → `503 {"error":"ocr_not_configured"}` (앱이 실제로 받은 코드는 BUG-1 때문에 400) |
| 8 | 내역: 월 이동, 카드 필터, 월 합계(취소 제외), 최신순 | PASS | 기본 "2026년 9월". ◀ → "2026년 8월" + "이 달의 결제가 없습니다", ▶ 복귀. 필터 `QA-probe 카드` → 해당 카드 결제만, 합계 0원(취소 건 제외). 전체 합계 4,500(취소된 1,234 제외). 목록 02:47 → 02:28 → 01:00 → 전날 14:00 → 9/10 순 내림차순 |
| 9 | 결제 상세: 메모만 수정, 다른 필드 편집 불가 | PASS | 시트 안 편집 요소: `textarea` 1개, `input`/`select` 0개, 버튼은 ✕·메모 저장·취소뿐. 메모 `QA-메모1` → `QA-메모2` 저장 후 재열기 시 유지. DB 수준(§4-17 참고): amount/merchant/paid_at PATCH → 400 P0001 |
| 10 | 결제 취소: 확인창, 잔액 제외, 취소선, 되돌리기 불가 | PASS | 확인창 문구 "이 결제를 취소하면 되돌릴 수 없습니다. 계속할까요?". 취소 후 "취소됨" 배지, `line-through` 요소 2개(가맹점·금액), 월 합계 0원, 카드 잔액 100,000 으로 복귀. 재열기 시 취소 버튼 없음, 상태 "취소됨 (9월 16일 03:04)". REST 로 `canceled_at` null 되돌리기 → 400 "취소는 되돌릴 수 없습니다" |
| 11 | 카드별 초기화(기준일 입력) → 잔액 초기화, 기준일 이전 결제는 내역에만 | PASS | 초기화 패널 날짜 기본값 `2026-09-16`(오늘). 확인창 "이 카드의 잔액을 2026-09-16 기준으로 초기 잔액으로 되돌립니다. 계속할까요?". 후: "초기화 기준일 2026-09-16", 잔액 97,000 = 100,000 − 3,000(당일 결제만 반영, 전날 10,000 제외, 취소 건 제외). 전날 결제 `QA-마트` 는 내역에 그대로 |
| 12 | 모든 카드 초기화 | PASS | 기준일을 2026-09-17 로 바꿔 실행. 확인창 "모든 카드의 잔액을 2026-09-17 기준으로 초기 잔액으로 되돌립니다. 계속할까요?". 두 카드 모두 "초기화 기준일 2026-09-17", 잔액 50,000 / 100,000, 총 150,000 |
| 13 | 초기화 후 기준일 이전 날짜 결제 → 잔액 불변 | PASS | 기준일 09-16 상태에서 `QA-과거` 5,000 (2026-09-10 10:00) 저장 → `QA-카드A` 97,000 그대로, 총 147,000. 내역에는 표시 |
| 14 | 3개월 지난 결제 정리 규칙 | PASS | `db:smoke` (f): 기준일 있는 카드의 4개월 전 결제 1건만 삭제 대상. RPC 권한: anon → 401 `permission denied for function purge_old_payments`, 로그인 → 0 반환 |
| 15 | 비밀번호 변경 후 새 비밀번호로만 로그인 | PASS | 검증 문구 "비밀번호는 8자 이상이어야 합니다", "두 비밀번호가 일치하지 않습니다" 확인. 임시 비밀번호로 변경 → "비밀번호를 변경했습니다". 로그아웃 후 원래 비밀번호 → 오류, 새 비밀번호 → 홈. 검수 후 README 의 복구 SQL(`crypt(..., gen_salt('bf'))`)을 Management API 로 실행해 원래 비밀번호로 복원(updated 1), REST 와 브라우저 모두 원래 비밀번호 로그인 확인 |
| 16 | PWA 설치 가능(manifest, 아이콘, 서비스워커), 오프라인 배너 | PASS | Pages: `link[rel=manifest]` → name/short_name "SW2HW 장부", display standalone, lang ko, theme_color #0f172a, scope `/team_budget_manager/`, start_url `.`, 아이콘 192/512 → 200 image/png, `navigator.serviceWorker.getRegistration()` active, scriptURL `/team_budget_manager/sw.js`. 컨테이너: manifest 200 `application/manifest+json`, SW active. `sw.js` precache 11개(앱 셸만, supabase 항목 0). 오프라인 배너: DevTools 오프라인 전환이 불가하여 `window.dispatchEvent(new Event('offline'))` 로 "네트워크 연결을 확인하세요" 표시, `online` 이벤트로 사라짐을 확인 + 코드 리뷰(`navigator.onLine` 초기값·이벤트 리스너) |
| 17 | DB 직접 접근: anon 0건, 로그인 후 delete 0건, 금액 update 거부 | PASS | anon: cards/payments/card_balances select → 200 `[]`, insert → 401 RLS, delete → 200 `[]`, rpc → 401. 로그인: payments DELETE(단건·전체) → 200 `[]`(행 유지 확인), amount/merchant/paid_at PATCH → 400 P0001 "memo 와 취소 외에는 수정할 수 없습니다", memo PATCH → 200, canceled_at 설정 → 서버가 now() 로 덮어씀(보낸 2000-01-01 무시), null 되돌리기·다른 시각 재설정 → 400 |
| 18 | 공개 가입 차단 | PASS | anon `POST /auth/v1/signup` → 422 `signup_disabled` "Signups not allowed for this instance" |
| 19 | GitHub Pages 에서 로그인 화면, 하위 경로 새로고침 정상 | PASS | `https://dwiw2d.github.io/team_budget_manager/` → 200, 로그인 화면. `/team_budget_manager/payments` 직접 진입 → HTTP 404 이지만 본문은 앱(404.html 복사본) → 로그인 화면 렌더링. manifest/sw.js 200. 배포 번들 해시가 HEAD 의 base path 빌드와 동일 |
| 20 | `docker build` 성공, 컨테이너에서 로그인 화면 | PASS | §1 참고. 브라우저로 `http://localhost:18080/cards` 진입 → 로그인 화면 |

## 3. 버그 목록

### BUG-1 (high) OCR 요청 본문 키 불일치로 영수증 인식이 항상 실패
- 관련 파일: `src/lib/ocr.ts`(`compressImage` 가 `{ base64, format }` 반환, `recognizeReceipt` 가 그대로 `body` 로 전송), `supabase/functions/ocr/index.ts`(`body.image` 를 읽음)
- 재현: 로그인 → 결제 추가 → "영수증 촬영" 으로 아무 이미지 선택 → 네트워크 `POST /functions/v1/ocr` 응답 400 `{"error":"invalid_request"}` → 화면 "영수증을 읽지 못했습니다. 직접 입력해 주세요". 함수에 직접 `{ "base64": "...", "format": "jpg" }` 를 보내도 400, `{ "image": "...", "format": "jpg" }` 는 200(로컬 MOCK) / 503(클라우드, 시크릿 없음)
- 기대: 스펙 §5 요청 `{ "image": "<base64>", "format": "jpg" }` 로 호출되어 200(또는 시크릿 없으면 503)
- 실제: 항상 400. 네이버 키를 등록해도 영수증 인식이 동작하지 않는다
- 참고: 키만 바꿔 주는 임시 shim 으로 이후 흐름(자동 채움·카드 자동 선택·저장·출처 receipt)은 정상 확인됨

### BUG-2 (low) 카드 자동 선택이 "마지막 4자리" 대신 "숫자만 남긴 뒤 마지막 4자리" 를 쓴다
- 관련 파일: `src/pages/AddPayment.tsx` `autoCardId`
- 재현(코드 수준): OCR 카드번호가 `1234-56**-****-****` 처럼 끝이 마스킹된 경우 숫자만 남기면 `123456` 이 되고 `slice(-4)` = `3456` → 뒤 4자리가 3456 인 카드가 있으면 잘못 자동 선택된다
- 기대(스펙 §6-3): 읽은 번호의 마지막 4자리와 `last4` 가 같은 카드가 정확히 하나일 때만 선택. 끝이 마스킹되면 선택하지 않아야 한다
- 실제: 가운데 숫자로 매칭될 수 있음. fixture(`...-5678`)처럼 끝 4자리가 보이는 경우는 정상

## 4. 스펙 이탈·관찰 (버그 아님)

| # | 내용 | 심각도 | 위치 |
|---|---|---|---|
| D-1 | 설정의 비밀번호 변경이 클라이언트에서 8자 이상을 요구한다. 스펙은 길이를 정하지 않았고 서버 기본 최소는 6자. 현재 운영 비밀번호(5자)는 UI 로 되돌릴 수 없어 QA 는 README 복구 SQL 을 썼다. 정책 확정 필요(PM 결정) | low | `src/pages/Settings.tsx` |
| D-2 | Edge Function 이 POST/OPTIONS 외 메서드에 405 를 돌려준다. 스펙에 없지만 무해 | info | `supabase/functions/ocr/index.ts` |
| D-3 | 확인창 문구가 스펙 문구 뒤에 "계속할까요?" 를 붙인다(취소·초기화). 스펙 문구는 포함되어 있음 | info | `Payments.tsx`, `Cards.tsx` |
| D-4 | `vite.config.ts` 의 `package.json` import 에 import attribute 가 없어 Vite 가 차기 메이저에서 깨질 수 있다고 경고 | low | `vite.config.ts` |
| D-5 | 빌드 청크 500 kB 초과 경고(supabase-js + react-router 단일 청크). 기능 영향 없음 | info | 빌드 출력 |
| D-6 | README 의 `docker compose --env-file .env.local up` 경로는 이번 검수에서 실행하지 않았다(`docker build` + `docker run` 으로 대체) | info | `README.md` |
| D-7 | 내장 브라우저에서 라우트가 바뀌는 클릭(플로팅 버튼, 결제 저장, 로그인)은 `orca click` 이 응답을 기다리다 시간 초과된다. 앱 문제가 아니라 도구 특성이며 DOM `click()`/`requestSubmit()` 으로 우회했다 | info | 테스트 방법 |

## 5. 코드 리뷰 요약 (스펙 대조)

- **§4 데이터 모델**: `0001_init.sql` 의 DDL·인덱스가 스펙과 글자 단위로 일치. RLS 정책은 authenticated 만 `owner_id = auth.uid()`, cards 4개/payments 3개(delete 없음), anon 정책 없음. 트리거는 memo 외 컬럼 변경과 취소 되돌리기를 예외로 막고 새 취소를 `now()` 로 덮어씀. `card_balances` 는 `security_invoker = true`, 잔액 식은 스펙과 동일(KST 날짜 비교). `purge_old_payments` 는 security definer + `search_path = public`, public/anon revoke, authenticated grant, `auth.uid()` null 이면 0. 삭제·수정 금지는 §2-17 의 REST 검증으로 DB 수준에서 강제됨을 확인.
- **§5 Edge Function**: `verify_jwt = false` + 함수 안 `getUser()` 검증(401), 본문 검증(400 `invalid_request`/`invalid_image`), 5MB 초과 413, 시크릿 없음 503, 네이버 실패 502, `NAVER_OCR_MOCK=1` 일 때만 fixture 응답(클라우드 미설정 → 503 관측), 네이버 요청 헤더·본문(`version V2, requestId uuid, timestamp, images[{format,name:"receipt",data}]`)과 응답 매핑(`storeInfo.name.text`, `paymentInfo.date/time.formatted`, `cardInfo.number.text`, `totalPrice.price.formatted.value` → `.text` 숫자) 이 스펙과 일치. `normalize.ts` 는 Deno 의존성 없음. CORS `*`, OPTIONS 204. 배포 함수 직접 호출 결과: 401 / 503 / 400 / 413 / 204 / 405.
- **§6 화면**: 탭 4개, 홈·내역 플로팅 버튼, 세션 가드, 오프라인 배너, 금액 `1,234,567원`, "불러오는 중…", 로그인 이메일 상수 `owner@sw2hw.local`, 오류 문구, 홈 구성(총 잔액·카드별·최근 5건·취소선·음수 빨강), 결제 추가(촬영 input `accept="image/*" capture="environment"`, canvas 1600px/JPEG 0.85, 자동 채움, 읽기 전용 카드번호, `source` 규칙, 실패 문구), 내역(월 이동·필터·합계·내림차순·KST 월 경계 `gte/lt`), 상세(메모만 편집, 확인창), 카드(목록 항목·폼·초기화 기준일 기본 오늘·확인창·FK 안내), 설정(2회 입력·`auth.updateUser`·로그아웃·버전) 모두 구현 확인. 스펙에 없는 기능은 발견하지 못했다(비목표 기능 없음).
- **PWA**: manifest 필드·아이콘·`registerType: 'autoUpdate'`·앱 셸만 precache(runtimeCaching 없음) 확인.
- **배포·운영**: `deploy.yml` 단계(`npm ci → test → typecheck → build(변수) → 404.html 복사 → upload/deploy-pages`)·`Dockerfile`(2단계, ARG VITE_*)·`nginx.conf`(`try_files`, manifest MIME, sw no-cache)·`docker-compose.yml`·package.json 스크립트 7종·README 필수 절(로컬 개발, 환경 변수, 배포 순서, 아침 할 일, 자체 호스팅 절차, 복구 SQL) 모두 스펙대로.
- **비밀 값 노출**: `.env.local`/`.env` 는 git 이력에 한 번도 없음(`git log --all -- .env.local` 비어 있음, `.gitignore`·`.dockerignore` 에 포함). 전체 이력에서 `sbp_` 0건, `eyJ...` 1건은 `package-lock.json` 의 sha512 integrity 해시(오탐). 작업 트리에도 토큰 문자열 없음. README·스펙·소스에 있는 프로젝트 ref, 계정 이메일, 번들 안 anon 키는 스펙상 공개 값.

## 6. 테스트 환경·방법

- 게이트·스크립트: Node 24.14, npm, Docker Desktop(엔진 29.6.2, QA 가 기동), Supabase CLI 2.117.0(`npx supabase`).
- 브라우저: Orca 내장 브라우저(`orca tab/snapshot/fill/click/upload/eval/network`). React 제어 입력은 네이티브 value setter + `input` 이벤트로 채움. `window.confirm` 은 문구를 기록하고 `true` 를 돌려주는 함수로 바꿔 확인창 문구를 검증(D-7 참고).
- OCR MOCK: `npx supabase start -x studio,...`(db/kong/auth/rest/edge-runtime 만) + `npx supabase functions serve ocr --env-file <NAVER_OCR_MOCK=1>` + Vite(5174, `VITE_SUPABASE_URL`/`ANON_KEY` 를 로컬 스택으로 지정). 로컬 계정은 로컬 admin API 로 생성. 검수 후 `supabase stop` 으로 정리. 클라우드에는 MOCK 을 설정하지 않았고 마이그레이션·함수 재배포도 하지 않았다.
- DB 직접 접근: 임시 Node 스크립트(커밋하지 않음)로 PostgREST/GoTrue REST 호출. 비밀 값은 `.env.local` 에서 읽고 출력하지 않았다.
- 비밀번호 복원: Management API `database/query` 로 README 복구 SQL 실행 후 REST·브라우저 로그인 확인.
- 종료 처리: dev 서버(5173, 5174)·함수 serve·로컬 Supabase 컨테이너·QA 컨테이너(18080) 모두 종료, QA 가 만든 브라우저 탭 4개 닫음. Docker Desktop 은 켜 둠.

## 7. 정리 결과 (클라우드 QA 데이터)

Management API `POST /v1/projects/{ref}/database/query` 로 `QA-` 접두어(카드 이름 또는 가맹점) 데이터를 payments → cards 순서로 삭제했다.

| 시점 | QA payments | QA cards | 전체 payments | 전체 cards |
|---|---|---|---|---|
| 삭제 전 | 7 | 2 | 7 | 2 |
| 삭제 | 7 | 2 | — | — |
| 삭제 후 | 0 | 0 | 0 | 0 |

검수 시작 시점에도 클라우드에는 실데이터가 없었다(전체 행이 모두 QA 데이터). 소유자 계정의 비밀번호는 `.env.local` 값으로 복원되어 있다.
