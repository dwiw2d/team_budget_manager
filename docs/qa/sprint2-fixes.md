# 스프린트 2 QA 수정 내역

- 작성일: 2026-09-16 (새벽)
- 대상: `docs/qa/sprint2-report.md`(커밋 `5d13dde`)의 FAIL 1건(§11-6), 버그 2건, 스펙 이탈·관찰 7건
- 기준: 설계 스펙 `docs/superpowers/specs/2026-09-16-sw2hw-ledger-design.md`, PM 결정(`docs/scrum/sprint-log.md` 스프린트 2 항목 및 PM 지침 메시지)
- 형식: `번호 - 원인 - 수정 파일 - 검증 방법`. 고치지 않은 항목은 사유를 적는다.

## 버그

- BUG-1 (high, §11-6 FAIL) - `compressImage` 가 `{ base64, format }` 를 돌려주고 `recognizeReceipt` 가 그대로 본문으로 보내는데 함수는 스펙 §5 대로 `body.image` 를 읽어 항상 400 `invalid_request` - `src/lib/ocr.ts`(반환 키 `base64` → `image`; 함수 쪽은 스펙 계약 그대로라 손대지 않음) - 로컬 Supabase(`supabase start`, 0001 마이그레이션 적용) + `supabase functions serve ocr --env-file`(`NAVER_OCR_MOCK=1`) + Vite 5174(로컬 URL·anon 키) 에서 브라우저로 로그인 → 결제 추가 → "영수증 촬영" 으로 PNG 업로드: 네트워크 `POST /functions/v1/ocr → 200`, 폼 자동 채움(가맹점 "GS25 역삼점", 금액 12300, 일시 2026-09-15T12:34, 영수증 카드번호 "1234-56**-****-5678"), 카드 자동 선택 "로컬카드A (5678)". 같은 로그인 토큰으로 직접 호출: `{image,format}` → 200, 옛 본문 `{base64,format}` → 400 `invalid_request`
- BUG-2 (low) - `autoCardId` 가 숫자만 남긴 뒤 `slice(-4)` 를 써서 끝이 마스킹된 번호(`…-****`)가 가운데 숫자(예 3456)로 매칭될 수 있음 - `src/lib/cards.ts`(신규; PM 확정 규칙: 공백·하이픈만 제거 → 마지막 4문자가 모두 숫자일 때만 `last4` 와 비교 → 같은 카드가 정확히 하나면 선택, 마스킹이면 선택 안 함), `src/lib/cards.test.ts`(신규), `src/pages/AddPayment.tsx`(함수를 lib 로 옮기고 import) - `npm test` 에 `autoCardId` 3건 추가(끝 4자리 일치 시 선택·공백/하이픈 무시 / 끝 마스킹 시 미선택 / 중복·불일치·빈 값 미선택), 위 BUG-1 브라우저 검증에서 `3456` 카드가 함께 있어도 `5678` 카드만 선택됨

## 스펙 이탈·관찰

- D-1 - 설정의 비밀번호 변경이 클라이언트에서 8자 이상 요구 - 변경 없음 - PM 결정: 유지
- D-2 - Edge Function 이 POST/OPTIONS 외 메서드에 405 - 변경 없음 - PM 결정: 변경 없음(스펙의 "POST" 계약을 지키는 방어 응답이지 기능이 아님)
- D-3 - 확인창 문구 뒤 "계속할까요?" - 변경 없음 - PM 결정: 변경 없음(스펙 문구 포함, info)
- D-4 - `vite.config.ts` 의 `package.json` import 에 import attribute 가 없어 Vite 가 `configLoader: 'native'` 비호환 경고 - `vite.config.ts`(`with { type: "json" }` 추가) - `npm run build` 를 원본·수정본으로 각각 실행해 대조: 원본은 `JSON import "./package.json" without import attributes` 경고 출력, 수정본은 경고 없음
- D-5 - 빌드 청크 500 kB 초과 경고 - 변경 없음 - PM 결정: 변경 없음(기능 영향 없음, 코드 분할은 스펙 밖)
- D-6 - README 의 `docker compose --env-file .env.local up -d --build` 경로 미검증 - 변경 없음(명령이 그대로 동작해 README 수정 불필요) - 실제 실행: `docker compose --env-file .env.local config --quiet` 경고 없음 → `up -d --build` 후 `/`·`/payments`·`/cards/deep/path` → 200 `text/html`(`<title>SW2HW 장부</title>`), `manifest.webmanifest` → 200 `application/manifest+json`, `sw.js` → 200 + `Cache-Control: no-cache` → `docker compose --env-file .env.local down` 정상 종료
- D-7 - 내장 브라우저 도구 특성(라우트 전환 클릭 시간 초과) - 변경 없음 - 앱 문제 아님. 이번 검증도 QA 와 같이 `eval` 의 DOM `requestSubmit()` 으로 우회

## 게이트 재실행 (전 수정 반영 후)

| 게이트 | 결과 |
|---|---|
| `npm run typecheck` | 성공(오류 0) |
| `npm test` | 성공, 4 파일 / 17 테스트(기존 14 + `cards.test.ts` 3) |
| `npm run build` | 성공, PWA precache 11 entries. import attribute 경고 없음(청크 500 kB 경고는 D-5 그대로) |
| `npm run db:smoke` | (a)~(f) 전부 PASS, 트랜잭션 롤백 |
| `docker build` | 성공(이미지 `sw2hw-fix`, `.env.local` 값은 환경 변수로만 전달), 컨테이너 `/`·`/cards` → 200 |

## 스키마·함수·배포

- 마이그레이션 추가 없음(`0002_*.sql` 없음), Edge Function 변경 없음 → `sb:push`·`sb:functions` 를 실행하지 않았다.
- 원격 갱신은 `git push origin HEAD:main`(워크트리 브랜치 `receipt-tracker-pwa`). Actions 결과 확인은 T6.

## 로컬 검증 환경 정리

- 로컬 Supabase 스택(`supabase stop --no-backup`), 함수 serve, Vite(5174), 브라우저 탭 모두 종료. 로컬 계정·카드는 로컬 볼륨과 함께 삭제됐다.
- 클라우드에는 MOCK 을 설정하지 않았고 마이그레이션·함수 재배포·데이터 생성도 하지 않았다.
