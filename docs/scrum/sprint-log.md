# 스프린트 로그

PM(코디네이터 세션)이 유지한다. 각 스프린트의 목표, 결과, 막힌 것을 적는다.

## 스프린트 0: 뼈대 (2026-09-16 새벽)
- 목표: 빌드 가능한 프로젝트 골격, 마이그레이션, 스크립트 자리.
- 결과: 완료. 커밋 b3b3f48. React 19 / Vite 8 / Tailwind 4 / vite-plugin-pwa 1.3 / supabase-js 2.116. typecheck·test·build·base path 빌드 모두 통과(PM 재검증).
- 막힌 것: Orca 작업자의 worker_done 이 capability 오류로 거부되어 PM 이 status 메시지로 정산. 워크트리 브랜치가 receipt-tracker-pwa 라 스펙 push 명령을 HEAD:main 으로 정정.

## 스프린트 1: 백엔드·프런트·운영 병렬 (2026-09-16 새벽)
- 목표: T1 스키마·RLS·Edge Function·운영 스크립트 및 클라우드 적용, T2 6개 화면, T3 GitHub 저장소·Pages 워크플로·Docker·README.
- 결과(T1 백엔드): 0001 마이그레이션·ocr 함수·스크립트 3개 커밋(96a08e4, 672b5a0, 8ebecbf). 클라우드 적용 완료: 마이그레이션 remote 적용, ocr ACTIVE, 가입 차단(422 signup_disabled), 계정 1개 생성 및 로그인 확인, db:smoke (a)~(f) PASS, 함수 401/503/400/204 확인. 네이버 시크릿은 아침에 등록.
- 결과(T2 프런트): 데이터 계층 + 화면 6개 커밋(97dd2e6, 2ba5a85, cd20a79). typecheck·test 14건·build·base path 빌드 통과. 로그인 화면·오류 문구 브라우저 확인. 로그인 이후 실데이터 확인은 계정 생성 전이라 QA 로 이관.
- 결과(T3 운영): 공개 저장소 dwiw2d/team_budget_manager 생성·푸시, Pages(workflow)·변수 등록, deploy.yml·Dockerfile·nginx.conf·compose·README 커밋(91cc612, f06d36b, 0814002). Actions success, https://dwiw2d.github.io/team_budget_manager/ 200, docker build·컨테이너 curl 200.
- 막힌 것: 없음. 참고: APP_OWNER_PASSWORD 가 5자(Supabase 기본 최소 6자)지만 관리자 API 생성·로그인은 정상. 설정의 비밀번호 변경은 8자 이상 요구.

## 스프린트 2: QA 검수 및 수정 (2026-09-16 새벽)
- 목표: T4 체크리스트 전 항목 검증·보고서, T5 발견 사항 수정 및 게이트 재통과.
- 결과(T4 QA): 게이트 7종 통과. §11 20항목 중 PASS 19 / FAIL 1. 보고서 docs/qa/sprint2-report.md(5d13dde). BUG-1(high) OCR 요청 본문 키 불일치(앱 base64 vs 함수 image), BUG-2(low) 카드 자동 선택이 마스킹된 끝자리를 무시, 스펙 이탈·관찰 7건(D-1~D-7). 실제 영수증 인식은 네이버 키 대기로 BLOCKED. 클라우드 QA 데이터 정리 완료.
- PM 결정: BUG-1 은 스펙 §5 계약(image/format)대로 클라이언트 수정. BUG-2 는 "공백·하이픈 제거 후 마지막 4문자가 모두 숫자일 때만 비교, 마스킹 시 자동 선택 안 함"으로 확정. D-1(비밀번호 8자 이상)은 유지. D-4·D-6 은 단순 수정, 나머지는 변경 없음.
- 결과(T5 수정): BUG-1(OCR 요청 키 image), BUG-2(카드 자동 선택 규칙), D-4(import attribute) 수정. D-1 유지, D-6 은 실제 실행 확인 후 수정 불필요. 커밋 4efbbf1, 92387ea, 5e8648f, 202f711. 게이트 5개(typecheck, test 17건, build, db:smoke, docker build) 재통과. 로컬 Supabase + MOCK 으로 영수증 업로드→자동 채움→카드 자동 선택 확인. origin/main = 202f711. 수정 내역 docs/qa/sprint2-fixes.md.

## 스프린트 3: 배포 및 최종 검수 (2026-09-16 새벽)
- 목표: T6 Actions·Pages·Docker 배포 검증 및 배포 기록, T7 배포본에서 체크리스트 재검수·사인오프.
- 결과(T6 배포): Actions run 35012636899 success(후속 35013243529 도 success). https://dwiw2d.github.io/team_budget_manager/ 200, manifest·sw.js 200, /payments 는 Pages 404.html fallback 특성으로 상태 404 지만 앱 셸 렌더 정상. 브라우저에서 로그인→홈 확인. docker build·컨테이너 200 확인. 배포 기록 docs/scrum/deploy-record.md(263ca0a). origin/main = 263ca0a.
- 결과(T7 최종 검수): 배포본에서 §11 20항목 재검수 PASS 19 / BLOCKED 1(실제 영수증 인식, 네이버 키 미등록) / FAIL 0. 하위 경로 새로고침·PWA·세션 가드·REST 직접 접근(anon 0건, delete 0건, update 거부, signup 422)·docker build·db:smoke 통과. QA 데이터 정리(결제 6건, 카드 2장) 및 비밀번호 원복. 사인오프 docs/qa/final-signoff.md(19d0e35, 4a4a2cd).

## 총평 (PM)
- 4개 스프린트(0~3), 작업자 8명(T0~T7)으로 배포 준비 완료 상태 도달. origin/main = 4a4a2cd. 배포 URL https://dwiw2d.github.io/team_budget_manager/
- 아침에 사용자가 할 일: (1) 설정에서 비밀번호 변경(최우선), (2) .env.local 에 NAVER_OCR_INVOKE_URL·NAVER_OCR_SECRET 추가 후 `npm run sb:secrets`, 영수증 1장으로 인식 확인, (3) 첫 카드 등록.
- 운영 메모: Orca 작업자 worker_done 이 T0 에서만 capability 오류로 거부됨(이후 작업자는 정상). Docker Desktop 은 QA 가 켜 두었음.
