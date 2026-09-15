# 배포 기록

스프린트 3 T6(배포 및 운영 검증)에서 확인한 실제 배포 결과를 적는다. 시각은 KST.

## 2026-09-16 04:16 KST — 커밋 89b66fa

- 커밋 SHA: `89b66fa086a0a25f0f7dfce64c719c476d1cbc1b` (`git push origin HEAD:main`, 202f711 → 89b66fa)
- Actions 실행: https://github.com/dwiw2d/team_budget_manager/actions/runs/35012636899 — 결과 success (build 24s, deploy 9s). 시작 04:16:29, 완료 04:17:09.
- Pages 배포 환경 github-pages, 배포 SHA 89b66fa (GitHub deployments API 확인).

### 배포 URL 확인 (curl, 04:18 KST, 1회차에 통과)

| URL | 상태 | 비고 |
|---|---|---|
| https://dwiw2d.github.io/team_budget_manager/ | 200 | HTML 에 `SW2HW 장부` 포함 |
| https://dwiw2d.github.io/team_budget_manager/payments | 404 | 본문은 index.html 과 동일(`cmp` 일치). GitHub Pages 는 404.html fallback 을 HTTP 404 로 내려주므로 상태 코드는 404 이지만 앱은 정상 로드됨(README 에 기록된 동작) |
| https://dwiw2d.github.io/team_budget_manager/manifest.webmanifest | 200 | |
| https://dwiw2d.github.io/team_budget_manager/sw.js | 200 | |

### 브라우저 확인 (Orca 내장 브라우저)

- `/` 접속 → `/login` 으로 이동, 제목 "SW2HW 장부", 비밀번호 입력, 로그인 버튼 렌더 확인.
- `.env.local` 의 소유자 비밀번호로 로그인 → `/` 홈 렌더: 총 잔액 0원, "등록된 카드가 없습니다", "결제가 없습니다", 하단 탭 4개(홈·내역·카드·설정), "＋ 결제 추가" 링크. 데이터는 만들지 않음.
- `/payments` 를 주소창에 직접 입력해 새로 로드 → "결제 내역" 화면(2026년 9월, 카드 필터, 월 합계 0원) 렌더. 하위 경로 새로고침 정상.

### Docker 확인 (04:22 KST)

- `docker build --build-arg VITE_SUPABASE_URL=… --build-arg VITE_SUPABASE_ANON_KEY=… -t sw2hw-ledger:t6 .` 성공 (Docker 29.6.2).
- `docker run -d --rm -p 18080:80 sw2hw-ledger:t6` 후: `/` 200(HTML 에 `SW2HW 장부` 포함), `/payments` 200, `/manifest.webmanifest` 200 (`application/manifest+json`), `/sw.js` 200.
- 컨테이너 중지, 이미지 삭제 완료.

### README 점검

- 배포 주소, 클라우드 배포 순서(`git push origin HEAD:main`), 워크플로 단계(test → typecheck → build → 404.html → Pages), 하위 경로 404 상태 안내, Docker 실행 절차 모두 실제와 일치. 수정 없음.
