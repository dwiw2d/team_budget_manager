# 최종 검수 사인오프 (스프린트 3, T7)

- 작성일: 2026-09-16 04:40 KST
- 대상: 배포본 https://dwiw2d.github.io/team_budget_manager/ + 클라우드 Supabase(`.env.local` 의 `SUPABASE_PROJECT_REF`)
- 배포 번들: `index-CvbX2FgX.js`. 로컬에서 `VITE_BASE_PATH=/team_budget_manager/ npm run build` 한 결과와 해시가 같다 → 배포본 = `origin/main`(263ca0a) 소스. 마지막 소스 변경 커밋은 5e8648f, 이후 커밋은 문서뿐.
- 기준 문서: `docs/superpowers/specs/2026-09-16-sw2hw-ledger-design.md` §11 전 항목 + `docs/qa/sprint2-report.md`(이전 FAIL: §11-6) + `docs/qa/sprint2-fixes.md`
- 결론: **§11 20개 항목 중 PASS 19, BLOCKED 1, FAIL 0.** BLOCKED 는 §11-6 "실제 영수증 인식"뿐이며 네이버 키가 아직 없어서다(503 경로와 안내 문구는 배포본에서 확인). 스프린트 2 의 FAIL(§11-6 BUG-1 요청 키 불일치)은 배포 함수에 `{image, format}` 계약이 그대로 통하고 옛 키 `{base64, format}` 은 400 인 것으로 수정 반영을 확인했다. **사인오프: 아침 할 일(아래 §5)만 하면 사용 가능.**

## 1. §11 체크리스트 판정 (배포 URL 기준)

브라우저 시나리오는 모두 배포 URL 을 Orca 내장 브라우저로 조작했다(새 탭, 검수 후 닫음). 테스트 데이터는 `QA-` 접두어. 판정 근거는 화면 텍스트·DOM 검사·네트워크 로그·REST 응답 코드.

| # | 항목 | 판정 | 근거 |
|---|---|---|---|
| 1 | 비밀번호만으로 로그인, 틀리면 오류, 세션 유지, 로그아웃 | PASS | 오답 → "비밀번호가 올바르지 않습니다"(`/login` 유지). 정답 → `/` 홈, localStorage 에 세션 키 생성. 새로고침 후 홈 유지, `/settings` 직접 진입 정상. 설정의 로그아웃 → `/login`, localStorage 비워짐 |
| 2 | 로그인 없이 어떤 경로든 `/login` | PASS | 로그아웃 상태에서 `/cards`, `/payments` 직접 접속 → 둘 다 `/login` 으로 이동, 로그인 화면만 렌더 |
| 3 | 카드 추가/수정/삭제(결제 있으면 거부) | PASS | `QA-카드A`(100,000, 5678), `QA-카드B`(30,000, 뒤 4자리 없음) 추가. 뒤 4자리 "12" 는 `pattern` 검증(`patternMismatch`) 으로 제출 차단. 수정 → `QA-카드B2`/40,000/1111 반영. 빈 카드 삭제 확인창 "'QA-카드B2' 카드를 삭제할까요?" 후 목록에서 제거. 결제 4건 있는 `QA-카드A` 삭제 → "결제 4건이 있어 삭제할 수 없습니다", 카드 유지 |
| 4 | 홈: 총 잔액 = 카드 잔액 합, 카드별 잔액, 최근 결제 5건 | PASS | 150,000 = 100,000 + 50,000. 이후 매 단계 합계 일치(145,500 / 142,500 / 129,266 / 130,500 / 140,500 / 150,000). 결제 6건일 때 최근 결제 5건만, 일시 내림차순 |
| 5 | 수동 결제 추가 → 카드 잔액 즉시 감소 | PASS | `QA-편의점` 4,500 저장 직후 홈: `QA-카드A` 95,500, 총 145,500. 결제 일시 기본값은 현재 시각(`datetime-local`) |
| 6 | 영수증 촬영 → OCR → 폼 자동 채움 → 카드 자동 선택 → 저장 | **BLOCKED** (실제 인식) | `.env.local` 에 `NAVER_OCR_INVOKE_URL`/`NAVER_OCR_SECRET` 없음 → `sb:secrets` 미실행, 실제 영수증 인식 불가. 확인된 것: 촬영 input `accept="image/*" capture="environment"`, PNG 선택 시 "영수증을 읽는 중…" 표시 후 `POST /functions/v1/ocr`(OPTIONS 204) 호출. 배포 함수에 로그인 토큰 + 스펙 본문 `{image, format}` → **503 `ocr_not_configured`**(브라우저 안 fetch 와 Node 직접 호출 모두), 옛 본문 `{base64, format}` → 400 `invalid_request` → BUG-1 수정이 배포본에 반영됨. 자동 채움·카드 자동 선택 로직은 스프린트 2 수정 검증(로컬 MOCK)과 단위 테스트(`cards.test.ts` 3건)로만 확인 |
| 7 | OCR 실패 시 안내 후 직접 입력 가능 | PASS | 배포본에서 촬영 → "영수증을 읽지 못했습니다. 직접 입력해 주세요" + 빈 폼(카드 미선택, 가맹점·금액 빈 값, 일시는 현재). 이어서 `QA-직접` 3,000 저장 → 홈 반영(92,500), 상세의 출처 "직접 입력" |
| 8 | 내역: 월 이동, 카드 필터, 월 합계(취소 제외), 최신순 | PASS | 기본 "2026년 9월", 4건 내림차순(04:34 → 04:33 → 04:32 → 전날 14:00), 합계 18,734. ◀ → "2026년 8월" `QA-8월` 1건, 합계 2,000. ▶ 복귀. 필터 `QA-카드B` → `QA-B편의점` 1건, 합계 1,234. 취소 후 전체 합계 17,500(취소 1,234 제외) |
| 9 | 결제 상세: 메모만 수정, 다른 필드 편집 불가 | PASS | 시트 안 편집 요소 `TEXTAREA` 1개, `input`/`select` 0개. 버튼은 ✕·메모 저장·취소뿐. 메모 `QA-메모1` → `QA-메모2` 저장 후 재열기 시 유지. DB 수준은 §1-17 참고 |
| 10 | 결제 취소: 확인창, 잔액 제외, 취소선, 되돌리기 불가 | PASS | 확인창 "이 결제를 취소하면 되돌릴 수 없습니다. 계속할까요?". 취소 후 "취소됨" 배지, `line-through` 요소 2개, 시트 닫힘, 카드B 잔액 48,000 복귀. 재열기 시 취소 버튼 없음, 상태 "취소됨 (9월 16일 04:35)". REST 로 `canceled_at` null → 400 "취소는 되돌릴 수 없습니다" |
| 11 | 카드별 초기화(기준일) → 잔액 초기화, 기준일 이전 결제는 내역에만 | PASS | 패널 날짜 기본값 `2026-09-16`. 확인창 "이 카드의 잔액을 2026-09-16 기준으로 초기 잔액으로 되돌립니다. 계속할까요?". 후 "초기화 기준일 2026-09-16", 잔액 92,500 = 100,000 − 당일 7,500(전날 10,000 제외). `QA-마트` 는 내역에 그대로 |
| 12 | 모든 카드 초기화 | PASS | 기준일 2026-09-17 로 실행. 확인창 "모든 카드의 잔액을 2026-09-17 기준으로 초기 잔액으로 되돌립니다. 계속할까요?". 두 카드 "초기화 기준일 2026-09-17", 잔액 100,000 / 50,000, 홈 총 150,000. 내역 9월 5건 유지(합계 22,500) |
| 13 | 초기화 후 기준일 이전 결제 → 잔액 불변 | PASS | 기준일 09-16 상태에서 `QA-과거` 5,000(2026-09-10 10:00) 저장 → `QA-카드A` 92,500 그대로, 총 140,500. 내역에는 표시 |
| 14 | 3개월 지난 결제 정리 규칙 | PASS | `npm run db:smoke` (a)~(f) 전부 PASS, 트랜잭션 롤백. RPC: anon → 401 `permission denied for function purge_old_payments`, 로그인 → 200 `0` |
| 15 | 비밀번호 변경 후 새 비밀번호로만 로그인 | PASS | 검증 문구 "비밀번호는 8자 이상이어야 합니다", "두 비밀번호가 일치하지 않습니다". 임시 비밀번호로 변경 → "비밀번호를 변경했습니다". 로그아웃 후 원래 비밀번호 → 오류, 임시 → 홈. 검수 후 README 복구 SQL 을 Management API 로 실행(updated 1) → REST 원래 200 / 임시 400, 브라우저 원래 비밀번호 로그인 → 홈 |
| 16 | PWA 설치 가능(manifest, 아이콘, 서비스워커), 오프라인 배너 | PASS | manifest: name/short_name "SW2HW 장부", display standalone, lang ko, theme `#0f172a`, scope `/team_budget_manager/`, start_url `.`. 아이콘 192/512 → 200 `image/png`. `serviceWorker.getRegistration()` active, scriptURL `.../team_budget_manager/sw.js`, controller 있음. `sw.js` precache 에 supabase 항목 0. 오프라인 배너: `offline` 이벤트 → "네트워크 연결을 확인하세요" 표시, `online` 이벤트 → 사라짐 |
| 17 | DB 직접 접근: anon 0건, 로그인 후 delete 0건, 금액 update 거부 | PASS | anon: cards/payments/card_balances select → 200 `[]`, insert → 401 RLS, delete → 200 `[]`, rpc → 401. 로그인: payments DELETE(전체) → 200 삭제 0건(6행 유지), amount/merchant/paid_at PATCH → 400 P0001 "memo 와 취소 외에는 수정할 수 없습니다", memo PATCH → 200 |
| 18 | 공개 가입 차단 | PASS | anon `POST /auth/v1/signup` → 422 `signup_disabled` "Signups not allowed for this instance" |
| 19 | GitHub Pages 에서 로그인 화면, 하위 경로 새로고침 정상 | PASS | `/` → 200 로그인 화면. `/payments`, `/cards` 직접 접속 → HTTP 404 이지만 본문은 `index.html` 과 동일(같은 번들 해시), 세션 없으면 `/login`, 세션 있으면 해당 화면 렌더. `/cards` 에서 `reload` → 세션·경로 유지. manifest/sw.js/아이콘 200 |
| 20 | `docker build` 성공, 컨테이너에서 로그인 화면 | PASS | `docker build`(`.env.local` 값은 build-arg 로만 전달) 성공. 컨테이너(18080): `/`, `/cards`, `/payments/deep/path` → 200 `text/html`(`<title>SW2HW 장부</title>`), `manifest.webmanifest` → 200 `application/manifest+json`, `sw.js` → 200 + `Cache-Control: no-cache`. 컨테이너·이미지 삭제 완료. Docker Desktop 은 꺼져 있어 QA 가 켬(켜 둠) |

## 2. 추가 확인 (배포본 운영 관점)

| 항목 | 결과 |
|---|---|
| 하위 경로 새로고침(`/payments`, `/cards` 직접 접속) | 세션 없음 → `/login`, 세션 있음 → 해당 화면. HTTP 상태는 Pages 404.html fallback 특성으로 404 (README 에 기록된 알려진 동작) |
| PWA manifest·서비스워커 로드 | §1-16 참고. 모두 정상 |
| 로그아웃 후 `/cards` 직접 접속 | `/login` 이동 |
| 잘못된 비밀번호 오류 문구 | "비밀번호가 올바르지 않습니다" |
| Edge Function 계약(배포 함수 직접 호출) | 토큰 없음 401, 잘못된 토큰 401, `{image,format}` 503 `ocr_not_configured`, `{base64,format}` 400 `invalid_request`, base64 아님 400 `invalid_image`, 5MB 초과 413, OPTIONS 204 `Access-Control-Allow-Origin: *` |
| 로그인 REST | 정답 200, 오답 400 `invalid_credentials` |

## 3. 남은 이슈

FAIL 없음. 코드 수정이 필요한 버그는 발견하지 못했다. 관찰 사항:

| # | 내용 | 심각도 | 대응 |
|---|---|---|---|
| O-1 | §11-6 실제 영수증 인식은 네이버 키 미등록으로 BLOCKED. 키 등록 후 영수증 1장으로 "촬영 → 자동 채움 → 저장" 을 한 번 확인해야 한다 | high(기능 미확인) | §5 아침 할 일 1 |
| O-2 | 현재 초기 비밀번호는 5자로 짧고 추측하기 쉬운 문자열이며, 설정 화면의 8자 이상 규칙(D-1, PM 결정 유지) 때문에 앱에서 같은 값으로 되돌릴 수도 없다(QA 는 README 복구 SQL 로 복원). 공개 배포본이므로 아침에 반드시 바꿔야 한다 | high(운영) | §5 아침 할 일 2 |
| O-3 | Pages 하위 경로 직접 접속의 HTTP 상태가 404(본문은 앱). 사용자 체감 영향 없음 | info | 없음(README 기록됨) |
| O-4 | Orca 내장 브라우저의 네트워크 캡처에 OCR `POST` 의 응답 코드가 기록되지 않았다(요청·OPTIONS 204 는 기록). 도구 특성으로 판단하고 같은 토큰으로 브라우저 안 `fetch` 와 Node 직접 호출로 503 을 확인했다 | info | 테스트 방법 메모 |
| O-5 | 빌드 청크 500 kB 초과 경고(D-5) 그대로. 기능 영향 없음 | info | 없음 |

## 4. 정리 결과 (클라우드 QA 데이터)

Management API `POST /v1/projects/{ref}/database/query` 로 `QA-` 접두어(가맹점 또는 카드 이름) 데이터를 payments → cards 순서로 삭제했다.

| 시점 | QA payments | QA cards | 전체 payments | 전체 cards |
|---|---|---|---|---|
| 검수 시작 | 0 | 0 | 0 | 0 |
| 삭제 전 | 6 | 2 | 6 | 2 |
| 삭제 건수 | 6 | 2 | — | — |
| 삭제 후 | 0 | 0 | 0 | 0 |

삭제 후 배포본 홈: 총 잔액 0원, "등록된 카드가 없습니다", "결제가 없습니다". 소유자 비밀번호는 `.env.local` 값으로 복원됐고(REST·브라우저 로그인 확인) QA 탭은 로그아웃 후 닫았다. 클라우드 시크릿·마이그레이션·함수는 건드리지 않았다.

## 5. 아침에 사용자가 할 일

1. **네이버 OCR 시크릿 등록**: `.env.local` 에 `NAVER_OCR_INVOKE_URL`, `NAVER_OCR_SECRET` 두 줄을 추가하고 `npm run sb:secrets` 실행. 그다음 앱에서 결제 추가 → "영수증 촬영" 으로 실제 영수증 1장을 찍어 가맹점·금액·일시·카드번호가 채워지고 저장되는지 확인(§11-6 BLOCKED 해소). 실패하면 네이버 콘솔에서 영수증(Receipt) 도메인의 Invoke URL·Secret 인지 확인.
2. **비밀번호 변경(필수)**: 현재 초기 비밀번호는 짧고 추측하기 쉬우므로 오늘 안에 바꾼다. 앱 로그인 → 설정 → 새 비밀번호(8자 이상) 2회 입력 → "비밀번호 변경". 바꾼 비밀번호를 함께 쓰는 사람에게 공유. (`.env.local` 의 `APP_OWNER_PASSWORD` 는 로그인 화면과 무관하므로 갱신은 선택.)
3. **첫 카드 등록**: 카드 탭 → "카드 추가" → 이름, 초기 잔액(원), 카드번호 뒤 4자리(영수증 자동 선택에 쓰이므로 입력 권장) → 저장. 계좌·현금도 같은 방식으로 카드로 등록.
4. (선택) 휴대폰 브라우저에서 배포 주소를 열어 "홈 화면에 추가" 로 PWA 설치.
5. (참고) Supabase 무료 프로젝트는 7일간 요청이 없으면 일시정지된다. 오래 안 쓰면 대시보드에서 다시 켠다(README "주의").

## 6. 테스트 환경·방법

- 브라우저: Orca 내장 브라우저 새 탭(배포 URL). 화면 확인은 `eval` 로 DOM 텍스트·속성 검사, React 제어 입력은 네이티브 value setter + `input`/`change` 이벤트, 라우트가 바뀌는 제출은 `form.requestSubmit()`/DOM `click()`(스프린트 2 D-7 과 같은 우회). `window.confirm` 은 문구를 기록하고 `true` 를 돌려주는 함수로 바꿔 확인창 문구를 검증.
- REST·Management API: 임시 Node 스크립트(커밋하지 않음, 세션 임시 폴더)로 PostgREST/GoTrue/Edge Function 호출과 집계·정리·비밀번호 복원. 비밀 값은 `.env.local` 에서 읽고 출력하지 않았다.
- 게이트: `npm run db:smoke`(클라우드), `VITE_BASE_PATH=/team_budget_manager/ npm run build`(번들 해시 대조), `docker build` + 컨테이너 curl. Node 24.14, Docker 29.6.2.
- 소스 코드는 수정하지 않았다. 산출물은 이 문서 하나.
