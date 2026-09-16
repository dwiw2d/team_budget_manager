# 방식 A — CLOVA General OCR + 자체 파서

네이버 클라우드 CLOVA OCR 의 **General OCR** 로 영수증의 글자만 읽고,
한국 영수증용 파서로 `{ merchant, paidAt, amount, cardNumber }` 네 필드를 직접 뽑는다.
영수증 전용(Document OCR) 모델은 **월 기본료**가 붙어서 쓰지 않는다(아래 요금 참고).

## 1. 키 발급 절차 (콘솔)

1. <https://www.ncloud.com> 로그인 → **Services > AI Services > CLOVA OCR**. 이용 신청.
2. **CLOVA OCR > Domain > 도메인 생성**
   - 서비스 타입: **General** (Template 이나 Document 가 아니다)
   - 도메인 이름 / 코드: 아무거나 (예: `team-budget-receipt`)
   - 인식 언어: **한국어** (영문 섞이면 한국어+영어)
3. 만들어진 도메인의 **API Gateway 연동** 을 누르고 **자동 연동** 을 선택한다.
   API Gateway 에 스테이지가 만들어지고 **APIGW Invoke URL** 이 나온다.
4. 도메인 목록에서 **배포** 를 눌러 서비스에 반영한다. 배포 전에는 호출해도 404 가 난다.
5. 같은 화면의 **Secret Key** 를 복사한다. 이게 `X-OCR-SECRET` 헤더 값이다.

호출 경로는 `<Invoke URL>/general` 인데, **콘솔에 표시된 Invoke URL 이 이미 `/general` 로 끝난다**.
그러니 콘솔에 표시된 주소를 그대로 환경 변수에 넣으면 된다.
스크립트는 `/general` 로 끝나면 그대로 쓰고, 아니면 붙인다
(예전에는 무조건 붙여서 `/general/general` 로 404 가 났다).

## 2. 환경 변수

`.env.local` 에 넣는다. 값은 커밋하지 않는다.

```
NAVER_OCR_GENERAL_INVOKE_URL=https://xxxxxxxx.apigw.ntruss.com/custom/v1/00000/xxxxxxxx/general
NAVER_OCR_GENERAL_SECRET=<Secret Key>
```

URL 은 콘솔에 나온 Invoke URL 을 그대로 붙여 넣는다. `/general` 이 붙어 있어도, 없어도 된다.

둘 중 하나라도 없으면 실행 스크립트가 이름을 stderr 에 적고 **exit 2** 로 끝난다.

## 3. 실행

```sh
node scripts/ocr-bench/clova-general.mjs .local/receipts/receipt-1.png
# stdout 마지막 줄: {"merchant":"동남집","paidAt":"2026-09-04T12:06:09+09:00","amount":59000,"cardNumber":"4265-86**-****-****"}
```

응답 원본은 `.local/ocr-raw/clova-general-<이미지>-<타임스탬프>.json` 에 남는다(git 제외 폴더).

테스트:

```sh
node --test "scripts/ocr-bench/lib/**/*.test.mjs"
```

> Node 24.14 + Windows 에서는 `node --test scripts/ocr-bench/lib/` 처럼 **디렉터리**를 주면
> 디렉터리 자체를 테스트 파일로 실행하려다 `Cannot find module` 로 실패한다.
> 저장소 밖 빈 폴더로도 똑같이 재현되는 Node 쪽 동작이다. 위의 glob 형태를 쓴다.

## 4. API 규격 (확인한 것)

출처: <https://api.ncloud-docs.com/docs/ai-application-service-ocr-ocr> (2026-09-16 확인)

요청 `POST <Invoke URL>` (콘솔 Invoke URL 이 이미 `/general` 로 끝난다), 헤더 `X-OCR-SECRET: <Secret Key>`

| 필드 | 값 |
| --- | --- |
| `version` | `V1` 또는 `V2` |
| `requestId` | UUID |
| `timestamp` | Unix ms |
| `lang` | `ko` / `ja` / `zh-TW` (쉼표로 조합) |
| `images[].format` | `jpg` `jpeg` `png` `pdf` `tif` `tiff` |
| `images[].name` | 이미지 식별자 |
| `images[].data` 또는 `.url` | base64 또는 공개 URL |
| `enableTableDetection` | 기본 `false` |

응답 `images[]`:

| 경로 | 뜻 |
| --- | --- |
| `images[].inferResult` | `SUCCESS` / `FAILURE` / `ERROR` |
| `images[].uid` | 이미지 식별자 |
| `images[].fields[].inferText` | 인식한 글자 조각 |
| `images[].fields[].inferConfidence` | 0~1 |
| `images[].fields[].type` | `NORMAL` / `MULTI_BOX` / `CHECKBOX` |
| `images[].fields[].lineBreak` | 이 조각이 한 줄의 마지막이면 true |
| `images[].fields[].boundingPoly.vertices` | `[{x, y}] x 4` |

**실측으로 확인된 것 (2026-09-16):** `fields` 배열은 **읽는 순서가 아니다.**
`lineBreak` 도 "사람이 보는 한 줄"이 아니라 CLOVA 가 한 번에 읽은 조각 묶음이라,
영수증처럼 좌우로 나뉜 표에서는 라벨과 값이 서로 다른 묶음으로 떨어져 나온다.

- receipt-1: `"합계:"` 와 `"59,000원"` 이 각각 다른 `lineBreak` 묶음
- receipt-2: `"공급가"` 는 56번째 조각인데 그 값 `"32,727"` 은 76번째 조각

그래서 파서는 `lineBreak` 묶음을 **세로 중심 좌표로 다시 정렬한 뒤**,
중심이 글자 높이 절반 안에 드는 묶음끼리 한 줄로 합친다.

## 5. 요금 · 한도 · 제약

| 항목 | 값 | 출처 |
| --- | --- | --- |
| General OCR 월 기본료 | **없음** (순수 종량제) | <https://guide.ncloud-docs.com/docs/clovaocr-spec> — "General OCR 과 무료 요금제를 제외한 모든 요금제는 API 를 호출하지 않아도 기본 유지 비용이 부과됩니다" |
| Document OCR(영수증 포함) 월 기본료 | **있음** — 호출이 0건이어도 월 요금 발생 | 같은 문서, 같은 문장 |
| 권장 호출 성능 | **계정당 최대 1 TPS** (더 필요하면 고객지원 승인) | <https://guide.ncloud-docs.com/docs/clovaocr-spec> |
| API Gateway 요금 | CLOVA OCR 과 **별도로** 과금 (호출이 API Gateway 를 거친다) | <https://guide.ncloud-docs.com/docs/clovaocr-overview> |
| Template OCR 과금 단위 | 템플릿의 인식 영역 수 기준, **영역 최대 50개**, 초과분 추가 과금 | <https://guide.ncloud-docs.com/docs/clovaocr-spec> |
| 45도 이상 회전한 문서 | 인식률 저하 | <https://guide.ncloud-docs.com/docs/clovaocr-spec> |
| 리전 / 언어 | 한국(KR-1, KR-2)·일본 / 한국어·영어·일본어 | <https://guide.ncloud-docs.com/docs/en/clovaocr-spec> |

**미확인 (정확한 숫자를 공개 문서에서 못 찾음):**

- General OCR **건당 단가(원)** 와 **무료 제공량(건)**.
  공개 문서·제품 페이지(<https://www.ncloud.com/product/aiService/ocr>)는 모두
  "포털 > Services > AI Services > CLOVA OCR 의 요금 안내 참조"로만 넘긴다.
  실제 숫자는 **로그인한 콘솔의 요금 안내 페이지**에서 확인해야 한다.
- 이미지 최대 용량(MB), 최대/최소 해상도, 한 요청당 이미지 수.

## 6. Document OCR(영수증 전용)과의 차이

| | General OCR | Document OCR (Receipt) |
| --- | --- | --- |
| 돌려주는 것 | 글자 조각 + 좌표 (`fields[]`) | 영수증 의미 필드(가맹점·일자·총액·카드번호 등) |
| 파서 | **우리가 직접 짜야 함** (`lib/clova-general-extract.mjs`) | 불필요 |
| 월 기본료 | 없음 | **있음** |
| 이 실험에서 | 채택 | 월 기본료 때문에 제외 |

## 7. 파서가 하는 일

`scripts/ocr-bench/lib/clova-general-extract.mjs` (네트워크 없음)

- `linesFromFields(fields)` — 글자 조각을 사람이 읽는 줄로 복원한다.
  `lineBreak` 묶음은 쪼개지 않고, 묶음을 **세로 중심으로 정렬해** 중심이 글자 높이 절반
  안에 드는 것끼리 합친다. 줄마다 `{ text, words, top, height }`.
  (파서 실패의 절반은 여기서 났다 — 아래 9절.)
- `extract(fields)` — 네 필드. 확신이 없는 항목은 `null`.
  - **금액**: `합계/총액/받을금액/결제금액/판매금액/카드매출` 줄의 가장 오른쪽 숫자.
    같은 값이 여러 번 나오면 그 값. `금액/부가세/공급가/단가` 줄은 뺀다.
    키워드 줄이 없으면 날짜·전화·사업자번호·승인번호를 걸러낸 뒤 최댓값.
  - **일시**: 날짜와 시각을 **따로 찾아 짝짓는다**(조각이 쪼개져 나오기 때문).
    날짜는 `YYYY-MM-DD` / `YYYYMMDD` / `YY/MM/DD`(두 자리 연도는 2000년대),
    시각은 콜론 앞뒤 공백을 허용해 `12:38: 27` 처럼 잘려 붙은 것도 읽는다.
    `거래일시/승인일시/판매시간` 줄 우선. 날짜 줄에 시각이 없으면 **이웃 줄까지** 본 뒤
    그래도 없을 때만 `00:00:00`. 항상 `+09:00`.
  - **카드번호**: `[0-9*-]` 12자 이상 덩어리. 별표가 있으면 최우선, 16자리면 차순위.
    사업자번호·TEL·승인번호·VANKEY 줄은 통째로 제외. 마스킹 포함 원문 그대로.
  - **가맹점**: (a) `가맹점명:`/`상호:` 라벨 값(**콜론 필수**) → (b) `대표자`/`TEL` 줄의
    오른쪽 끝 토막(빈칸 두 글자 이상 떨어져 있어야 하고, 대표자 이름이면 제외)
    → (c) `사업자번호` 줄 **바로 위 줄**. 안내 문구(`신고안내/포상금/여신금융협회/
    가맹점명·주소가/실제와 다른`), VAN사·카드사 이름, 대괄호 말머리(`[고객용]`),
    표 머리글(`테이블명/판매사원/영수번호/상품/단가/수량/금액`), 주소, 숫자 세 자리가
    든 토막은 모두 후보에서 뺀다. 못 찾으면 `null`(사용자가 폼에서 채운다).

## 8. 알아둘 것 — 카드번호 뒤 4자리가 없다

테스트 영수증 두 장 모두 카드번호의 **뒤 4자리가 마스킹**돼 있다.

- receipt-1: `4265-86**-****-****`
- receipt-2: `42658698********`

앱의 카드 자동 선택은 **뒤 4자리**를 쓰는데, 이 표본으로는 자동 선택이 불가능하다.
앞 6~8자리(BIN)로 카드사까지는 좁혀지지만 카드 한 장을 특정하지는 못한다.
OCR 방식과 무관한, 영수증 자체의 한계다. (`clova-general-extract.test.mjs` 에 단언으로 박아 뒀다.)

## 9. 실측 결과 (2026-09-16)

실제 CLOVA General OCR 로 영수증 두 장을 호출했다. 응답 원본은 `.local/ocr-raw/` 에 있고,
개인·사업자 식별 정보를 치환한 사본이 `lib/clova-general-fixtures.mjs` 에 들어 있다.

| | receipt-1 (KIS VAN 승인전표) | receipt-2 (POS 카드판매 영수증) |
| --- | --- | --- |
| 응답 시간 | 약 4.6초 | 약 4.6초 |
| 인식한 글자 조각 수 | 56 | 82 |
| 글자 인식 정확도 | 틀린 글자 없음 | 틀린 글자 없음 |

**글자 인식은 두 장 모두 완벽했다.** `동남집`, `세상끝의라멘`, `판매시간:`, `12:38:`, `27`,
`12:38:31` 이 전부 제대로 들어 있었다. 그러니 아래 실패는 **전부 파서 탓**이다.

### 고치기 전 — 8항목 중 5개 (5/8)

| 항목 | receipt-1 | receipt-2 |
| --- | --- | --- |
| merchant | ❌ `주소가 실제와 다른경우` | ❌ `테이블명: 1T` |
| paidAt | ✅ `2026-09-04T12:06:09+09:00` | ❌ `2026-09-15T00:00:00+09:00` (시각 누락) |
| amount | ✅ `59000` | ✅ `36000` |
| cardNumber | ✅ `4265-86**-****-****` | ✅ `42658698********` |

무엇을 틀렸나:

1. **줄 복원이 틀렸다.** `lineBreak` 만 믿고 줄을 끊어서 라벨과 값이 갈라졌다.
   `"판매시간: 20260915"` 과 `"12:38: 27"` 이 다른 줄이 되는 바람에 시각을 못 읽었다.
2. **`가맹점명` 라벨 규칙이 안내 문구를 물었다.** VAN사가 찍는
   `"가맹점명/주소가 실제와 다른경우"` 에 콜론이 없는데도 라벨로 봤다.
3. **"제일 큰 글자가 상호"라는 가정이 틀렸다.** receipt-2 에서 가장 큰 글자는
   상호(높이 38)가 아니라 `"테이블명: 1T"`(높이 58) 였다.
   상상으로 만든 옛 픽스처는 이 배치를 몰라서 파서를 통과시켰다.

### 고친 뒤 — 8/8

| 항목 | receipt-1 | receipt-2 |
| --- | --- | --- |
| merchant | ✅ `동남집` | ✅ `세상끝의라멘` |
| paidAt | ✅ `2026-09-04T12:06:09+09:00` | ✅ `2026-09-15T12:38:27+09:00` |
| amount | ✅ `59000` | ✅ `36000` |
| cardNumber | ✅ `4265-86**-****-****` | ✅ `42658698********` |

바꾼 규칙 셋:

- **줄 복원**: `lineBreak` 묶음을 세로 중심으로 정렬해 겹치는 묶음끼리 합친다.
  이것만으로 `"합계: 59,000원"`, `"공급가 32,727"`, `"판매시간: 20260915 12:38: 27 (POS100)"`
  같은 줄이 제대로 복원되고, 금액 규칙은 이제 최댓값 추측이 아니라 `합계`/`카드매출`
  키워드로 맞힌다(값은 그대로 59,000 / 36,000).
- **가맹점**: 라벨은 콜론이 있어야 인정하고, `대표자/TEL` 줄의 오른쪽 끝 토막 →
  `사업자번호` 줄 바로 위 줄 순서로 본다. 안내 문구·표 머리글·VAN사·카드사 이름은 뺀다.
  확신이 없으면 `null` 을 준다 — 틀린 상호보다 빈 칸이 낫다.
- **시각**: 날짜와 시각을 따로 찾아 짝짓고, 콜론 앞뒤 공백을 허용한다(`12:38: 27`).
  날짜 줄에 시각이 없으면 이웃 줄까지 뒤진 뒤에야 `00:00:00` 으로 둔다.

두 영수증에만 통하는 하드코딩은 넣지 않았다. 함정(금액 `53,636`/`32,727`/`33,000`,
상호 `주소가 실제와 다른경우`/`테이블명: 1T`)은 `clova-general-extract.test.mjs` 에
단언으로 박아 뒀다.
