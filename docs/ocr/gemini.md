# 방식 C — Gemini 비전 모델로 영수증에서 바로 추출

영수증 사진을 Gemini 에 그대로 보내고 `{ merchant, paidAt, amount, cardNumber }` 네 필드를
구조화 출력(JSON) 으로 받는다. 별도 OCR 서비스도, 손으로 쓴 텍스트 파서도 없다.

## 1. API 키 받는 절차

1. https://aistudio.google.com/apikey 에 구글 계정으로 들어간다.
2. **Create API key** 를 누르고 기존 Google Cloud 프로젝트를 고르거나 새로 만든다.
   - 결제(billing)를 붙이지 않은 프로젝트 → **무료 등급(Free tier)**
   - 결제를 붙인 프로젝트 → **유료 등급(Paid tier)**. 같은 키가 그대로 유료 등급으로 올라간다.
3. 발급된 키를 `.env.local` 에 넣는다. 저장소에 커밋하지 않는다(`.gitignore` 에 이미 있음).

```
GEMINI_API_KEY=AIza...
# 선택: 기본 모델을 덮어쓸 때만
GEMINI_MODEL=gemini-2.5-flash
```

| 환경 변수 | 필수 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `GEMINI_API_KEY` | 필수 | 없음 | 없으면 실행 스크립트가 이름만 stderr 에 찍고 exit 2 |
| `GEMINI_MODEL` | 선택 | `gemini-2.5-flash` | 무료 등급에서 쓸 수 있는 비전 지원 Flash 모델 |

## 2. 호출 형식

- 엔드포인트: `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
  (https://ai.google.dev/api/generate-content)
- 인증: `x-goog-api-key: <키>` 헤더. (쿼리스트링 `?key=` 도 되지만 로그에 남으므로 헤더를 쓴다.)
- 이미지: `contents[0].parts[]` 안에 `{ "inline_data": { "mime_type": "image/png", "data": "<base64>" } }`.
  인라인 이미지를 쓰면 **요청 전체가 20MB** 를 넘을 수 없다. 그보다 크면 Files API 를 써야 한다.
  (https://ai.google.dev/gemini-api/docs/image-understanding)
- 구조화 출력: `generationConfig.response_mime_type = "application/json"` 과
  `generationConfig.response_schema` 에 네 필드 스키마를 넣는다. 각 필드는 `nullable: true`.
  (https://ai.google.dev/gemini-api/docs/structured-output)

참고로 문서에는 새로 `POST /v1beta/interactions` 형태의 API 도 올라와 있다(`model` / `input` /
`response_format` 필드). 이 워크트리는 안정적으로 문서화되어 있는 `:generateContent` 를 쓴다.

## 3. 무료 등급 한도 — **구글이 더 이상 문서에 숫자를 적지 않는다**

https://ai.google.dev/gemini-api/docs/rate-limits 에서 모델별 RPM/TPM/RPD 표가 사라졌다.
현재 이 페이지는 이렇게만 말한다: "Rate limits depend on a variety of factors (such as your usage
tier) and can be viewed in Google AI Studio." 그리고
https://aistudio.google.com/rate-limit 로 보낸다. **자기 키의 실제 한도는 AI Studio 에서 확인해야 한다.**

참고로 남아 있는 숫자들(모두 2차 출처, 검증 안 됨):

| 출처 | 모델 | RPM | TPM | RPD |
| --- | --- | --- | --- | --- |
| 2026-09-02 실측 (https://dev.to/romeroyang/geminis-free-tier-measured-20-requests-a-day-and-google-no-longer-publishes-the-number-4gf2) | `gemini-3.5-flash` | — | — | **20** |
| 블로그에 남은 2025년 표 (https://www.aifreeapi.com/en/posts/gemini-api-free-tier-rate-limits) | `gemini-2.5-flash` | 15 | 1,000,000 | 1,500 |
| 같은 출처 | `gemini-2.5-flash-lite` | 30 | 1,000,000 | 1,000 |

실측 20 RPD 와 옛 표의 1,500 RPD 는 75배 차이다. **실제 한도는 하루 20건 쪽에 가깝다고 보고**
움직이는 편이 안전하다. 영수증 두 장 비교 실험에는 어느 쪽이든 충분하지만, 실제 서비스에는 무료
등급을 쓸 수 없다. 429 응답 본문의 `quotaValue` 필드에 그 순간의 실제 한도가 담겨 온다.

## 4. 유료 단가와 영수증 한 장당 비용

https://ai.google.dev/gemini-api/docs/pricing (100만 토큰당)

| 모델 | 무료 등급 | 입력(텍스트/이미지/비디오) | 출력 |
| --- | --- | --- | --- |
| `gemini-2.5-flash` | Free of charge | $0.30 | $2.50 |
| `gemini-2.5-flash-lite` | Free of charge | $0.10 | $0.40 |

이미지 토큰 계산: 가로·세로가 모두 384px 이하면 **258 토큰**, 그보다 크면 768×768 타일로 잘라
**타일당 258 토큰**. (https://ai.google.dev/gemini-api/docs/image-understanding)

영수증 사진 1080×1920 기준 → 2×3 = 6타일 = 1,548 토큰. 여기에 한국어 프롬프트 약 800 토큰,
출력 약 80 토큰을 더하면:

- `gemini-2.5-flash`: (2,350 × $0.30 + 80 × $2.50) / 1,000,000 ≈ **$0.0009 / 장** (약 1.3원)
  → 1,000장에 약 $0.9
- `gemini-2.5-flash-lite`: ≈ **$0.00027 / 장** (약 0.4원) → 1,000장에 약 $0.27

## 5. 무료 등급의 데이터 정책 — 영수증에는 개인정보가 들어 있다

https://ai.google.dev/gemini-api/terms 의 "How Google Uses Your Data":

- **무료(Unpaid) 등급**: 보낸 내용과 받은 내용을 구글 제품·서비스·머신러닝 기술을 "improve, and
  develop" 하는 데 쓴다. 그리고 **"human reviewers may read, annotate, and process your API input
  and output"** — 사람이 읽을 수 있다.
- **유료(Paid) 등급**: 프롬프트와 응답을 제품 개선에 쓰지 않는다. 남용 탐지와 법적 요구 목적으로만
  제한된 기간 로그를 남긴다.

**이 영수증 이미지에는 가맹점 상호, 사업자번호, 대표자 이름, 전화번호, 주소, 마스킹된 카드번호가
그대로 찍혀 있다.** 무료 등급으로 보내면 그 사진이 구글의 모델 개선에 쓰이고 사람 검토자가 읽을 수
있다는 뜻이다. 실험에는 무료 등급을 써도 되지만, **실제 팀 장부 서비스에 붙일 때는 반드시 결제를
붙인 유료 등급 프로젝트의 키를 써야 한다.**

## 6. 카드번호 뒤 4자리 문제

두 영수증 모두 카드번호 **뒤 4자리가 마스킹**되어 있다.

- receipt-1: `4265-86**-****-****`
- receipt-2: `42658698********`

앱의 카드 자동 선택은 뒤 4자리로 카드를 찾는데, 영수증에서 뒤 4자리를 얻을 수 없다. 대신 **앞
6~8자리(BIN)** 는 둘 다 읽을 수 있고 두 영수증이 같은 카드(`42658 6/98`)임을 알 수 있다.
→ 자동 선택 로직을 뒤 4자리가 아니라 앞자리 기준으로 바꾸거나, 카드 선택은 수동으로 두어야 한다.
이건 세 방식 모두에 공통으로 걸리는 제약이다(OCR 품질 문제가 아니라 영수증 자체의 제약).

## 7. Supabase Edge Function 에서도 그대로 되는가 — 된다

- 호출이 `fetch` 한 번이라 Deno 런타임에서 그대로 돈다. npm 패키지나 SDK 를 붙일 필요가 없다.
- base64 인코딩만 런타임에 맞춰 바꾸면 된다: Node 는 `Buffer.from(bytes).toString("base64")`,
  Deno 는 `encodeBase64()` (`jsr:@std/encoding/base64`).
- 키는 `supabase secrets set GEMINI_API_KEY=...` 로 넣고 `Deno.env.get("GEMINI_API_KEY")` 로 읽는다.
  클라이언트에 키가 나가지 않으므로 오히려 Edge Function 을 거치는 쪽이 맞다.
- 주의할 점: 인라인 이미지 20MB 제한과 Edge Function 자체의 요청 크기·실행 시간 제한. 휴대폰 사진은
  보내기 전에 줄이는 편이 비용(타일 수)과 지연 양쪽에 낫다.
- `scripts/ocr-bench/lib/gemini-extract.mjs` 는 네트워크에 의존하지 않는 순수 모듈이라 Edge Function
  으로 거의 그대로 옮길 수 있다.

## 8. 실행 방법

```sh
node scripts/ocr-bench/gemini.mjs .local/receipts/receipt-1.png
```

- 성공하면 stdout 마지막 줄에 네 필드 JSON 한 줄. 나머지 로그는 stderr.
- 모델 원본 응답은 `.local/ocr-bench/gemini-<파일명>-<타임스탬프>.json` 에 저장된다.
- `GEMINI_API_KEY` 가 없으면 stderr 에 `GEMINI_API_KEY` 한 줄만 찍고 exit 2.

### 테스트

```sh
node --test "scripts/ocr-bench/lib/**/*.test.mjs"
```

**주의:** Node 24 에서는 `node --test <디렉터리>` 가 동작하지 않는다. 위치 인자를 glob 패턴으로
해석하기 때문에 디렉터리 경로는 그 디렉터리 자체에 매치되고 `Cannot find module ...\lib` 로 죽는다.
확인한 버전은 v24.14.0. 디렉터리째 돌리려면 위처럼 glob 을 따옴표로 감싸서 넘겨야 한다.
