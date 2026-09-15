# Supabase 클라우드로 시작하되, 자체 호스팅 Supabase(Docker)로 이전 가능하게 유지한다

개인용 가계부 앱의 백엔드로 Supabase 무료 티어를 쓴다. 이미 준비된 자체 서버 장비로 나중에 옮길 계획이 있으므로, 이전 경로는 "백엔드 교체"가 아니라 "공식 Docker Compose로 자체 호스팅한 Supabase에 그대로 배포"로 정한다.

## 제약

- 스키마는 `supabase/migrations/*.sql`, 서버 로직은 `supabase/functions/*` (Edge Function), Storage 버킷도 마이그레이션 SQL로 만든다. 대시보드에서 손으로 만든 것은 없어야 한다.
- Supabase 클라우드 전용 기능(브랜칭, 관리형 로그 탐색기 등)에 의존하지 않는다.
- 프런트엔드는 Supabase URL·anon key를 환경 변수로만 받는다. 자체 서버로 옮길 때 값만 바꾸면 된다.
- 프런트엔드 정적 빌드는 nginx 이미지로 감싼 `Dockerfile` + `docker-compose.yml`을 함께 둔다.

## 고려한 대안

- Cloudflare Pages + D1 + R2: 일시정지 없고 무료지만, 자체 서버로 옮길 때 D1·R2를 대체할 코드가 필요하다.
- 처음부터 Node + SQLite 자체 서버: 가장 이식성이 좋지만 개발 첫날 밤에 배포·검증까지 끝낼 수 없다.

## 결과

- Supabase 무료 프로젝트는 7일간 요청이 없으면 일시정지된다. 자체 서버로 옮기면 사라지는 문제다.
- 자체 호스팅 Supabase는 컨테이너가 10개 안팎으로 무겁다. 장비가 이미 있으므로 감수한다.
