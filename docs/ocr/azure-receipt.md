# 방식 B — Azure AI Document Intelligence `prebuilt-receipt`

영수증 전용 사전 구축 모델에 이미지를 던지면 구조화된 필드(`MerchantName`, `TransactionDate`, `Total` …)를
바로 돌려준다. 우리는 그중 네 개만 쓴다: `{ merchant, paidAt, amount, cardNumber }`.

- 실행: `node scripts/ocr-bench/azure-receipt.mjs <이미지경로>`
- 변환 로직: `scripts/ocr-bench/lib/azure-receipt-extract.mjs` (네트워크 없음)
- 테스트: `node --test "scripts/ocr-bench/lib/**/*.test.mjs"`

## 결론부터: 카드번호는 안 나온다

**`prebuilt-receipt` 스키마에 카드번호 필드가 없다.** 결제 관련 필드는 `Payments` 배열뿐이고,
그 안에도 `Payments.*.Method`(결제수단 이름)와 `Payments.*.Amount`(금액) 두 개만 있다.
카드번호·마스킹된 뒷자리·카드사 코드에 해당하는 필드는 전체 스키마 어디에도 없다.

→ `extract()` 의 `cardNumber` 는 **항상 `null`** 이다.
→ 앱의 **카드 자동 선택(뒤 4자리 매칭)은 이 방식만으로는 동작하지 않는다.**
   게다가 테스트 영수증 두 장 모두 카드번호 **뒤 4자리가 마스킹**되어 있어
   (`4265-86**-****-****`, `42658698********`), 설령 raw OCR 로 긁어내도 뒤 4자리는 얻을 수 없다.
   카드 자동 선택을 살리려면 앞 6~8자리(BIN) 매칭으로 바꾸거나 수동 선택으로 남겨야 한다.

출처: [receipt 모델 스키마 (2024-11-30 GA)](https://github.com/Azure-Samples/document-intelligence-code-samples/blob/main/schema/2024-11-30-ga/receipt.md)

## 키 발급 절차 (F0 무료 계층)

1. [Azure Portal](https://portal.azure.com) 로그인 (Azure 구독 필요, 없으면 무료 계정 생성).
2. **리소스 만들기 → "Document Intelligence" 검색 → 만들기**
   (직접 링크: <https://portal.azure.com/#create/Microsoft.CognitiveServicesFormRecognizer>)
3. 입력값
   - 구독 / 리소스 그룹: 아무거나 (없으면 새로 만들기)
   - 지역: **Korea Central** 권장 (데이터가 같은 지역에서 처리된다)
   - 이름: 임의 (엔드포인트 호스트명이 된다)
   - **가격 책정 계층: `Free F0`** ← 반드시 F0 선택. 구독당 리전당 F0 리소스는 1개만 만들 수 있다.
4. 배포 완료 후 **리소스로 이동 → 왼쪽 메뉴 "키 및 엔드포인트"**
5. `엔드포인트`(예: `https://<이름>.cognitiveservices.azure.com/`)와 `키 1` 을 복사.

`.env.local` 에 넣는다 (키 값은 커밋하지 않는다):

```
AZURE_DI_ENDPOINT=https://<이름>.cognitiveservices.azure.com
AZURE_DI_KEY=<키 1>
```

둘 중 하나라도 없으면 스크립트는 stderr 에 `AZURE_DI_ENDPOINT AZURE_DI_KEY` 를 찍고 **exit code 2** 로 끝난다.

## 호출 방식 (REST, api-version=2024-11-30)

분석 시작 → `Operation-Location` 폴링, 두 단계다.

```http
POST {endpoint}/documentintelligence/documentModels/prebuilt-receipt:analyze?api-version=2024-11-30&locale=ko
Ocp-Apim-Subscription-Key: <키>
Content-Type: application/json

{ "base64Source": "<이미지 base64>" }
```

→ `202 Accepted` + `Operation-Location: {endpoint}/documentintelligence/documentModels/prebuilt-receipt/analyzeResults/{id}?api-version=2024-11-30`

```http
GET {Operation-Location}
Ocp-Apim-Subscription-Key: <키>
```

→ `status` 가 `notStarted` / `running` / `succeeded` / `failed`. `succeeded` 가 될 때까지 폴링한다
(스크립트는 1초 간격, 최대 60초). MS 권장은 2초 이상 간격 + 응답의 `Retry-After` 헤더 존중.

요청 본문은 `base64Source`(base64 문자열) 또는 `urlSource`(공개 URL) 중 하나. 우리는 로컬 파일이라 `base64Source`.
`locale` 은 **선택 파라미터**이며 텍스트 인식 힌트일 뿐이다(언어 자동 감지가 기본). 한국어 영수증이라 `ko` 를 준다.

필드가 담기는 경로:

```
analyzeResult.documents[0].fields.<필드명>
```

값 표현:

| 필드 | 타입 | 값 경로 | 예 |
| --- | --- | --- | --- |
| `MerchantName` | string | `.valueString` | `"동남집"` |
| `TransactionDate` | date | `.valueDate` | `"2026-09-04"` |
| `TransactionTime` | time | `.valueTime` | `"12:06:09"` (24시간제) |
| `Total` | currency | `.valueCurrency.amount` | `59000` (+ `currencyCode: "KRW"`) |
| `Subtotal` | currency | `.valueCurrency.amount` | `53636` |
| `TotalTax` | currency | `.valueCurrency.amount` | `5364` |

각 필드에는 `content`(원문 그대로)와 `confidence`(0~1)도 함께 온다.

**`Total` 이 없을 때 `Subtotal` 로 대체하면 안 된다.** 한국 영수증에서 `Subtotal` 은 공급가액이라
부가세가 빠진 금액이다(53,636 / 32,727). `Total` 이 없으면 `amount` 는 `null` 이다.

출처:
[Analyze Document REST 레퍼런스](https://learn.microsoft.com/en-us/rest/api/aiservices/document-models/analyze-document?view=rest-aiservices-v4.0%20(2024-11-30)&tabs=HTTP) ·
[Get Analyze Result 레퍼런스](https://learn.microsoft.com/en-us/rest/api/aiservices/document-models/get-analyze-result?view=rest-aiservices-v4.0%20(2024-11-30)&tabs=HTTP) ·
[receipt 모델 개요](https://learn.microsoft.com/ko-kr/azure/ai-services/document-intelligence/prebuilt/receipt)

## 한국어 지원

**지원한다.** `prebuilt-receipt` 의 "Thermal receipts" 지원 언어 표에 **Korean `ko`** 가 들어 있다
(약 110개 언어). 단, "Hotel receipts" 지원 언어는 `en-US`/`fr-FR`/`de-DE`/`it-IT`/`ja-JP`/`pt-PT`/`es-ES` 7개뿐이라
호텔 영수증은 한국어가 안 된다. 우리가 쓰는 일반 카드전표/POS 영수증은 thermal 쪽이라 문제없다.

`locale` 파라미터는 **필수가 아니다**. 기본 동작이 자동 감지다.

출처: [prebuilt 모델 언어 지원](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/language-support/prebuilt)

## 한도와 요금

### F0 (무료) vs S0 (표준) — 서비스 쿼터

| 항목 | Free (F0) | Standard (S0) |
| --- | --- | --- |
| Analyze 초당 트랜잭션(TPS) | **1** (조정 불가) | 15 (기본값, 조정 가능) |
| Get(결과 조회) 초당 트랜잭션 | **1** (조정 불가) | 50 (기본값, 조정 가능) |
| 리전당 최대 리소스 수 | **1** | 20 |
| 최대 문서 크기 | **4 MB** | 500 MB |
| 문서당 최대 페이지 수(분석) | **2** | 2,000 |
| 이미지 크기 | 50×50 px ~ 10,000×10,000 px (공통) | 좌동 |
| 최소 글자 높이 | 1024×768 이미지 기준 12 px (≈150 DPI 에서 8pt) (공통) | 좌동 |

**월 페이지 한도: F0 는 월 500페이지 무료** (Azure 요금 페이지 "0 - 500 pages free per month").

지원 입력 포맷(프리빌트 모델): PDF, JPEG/JPG, PNG, BMP, TIFF, HEIF. Office 문서는 프리빌트 모델 미지원.

출처: [서비스 할당량 및 제한](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/service-limits) ·
[요금 페이지](https://azure.microsoft.com/en-us/pricing/details/ai-document-intelligence/)

### S0 유료 단가 (Korea Central, USD)

Azure Retail Prices API(`https://prices.azure.com/api/retail/prices`, `productName eq 'Azure Document Intelligence' and armRegionName eq 'koreacentral'`) 조회 결과:

| 미터 | 단가 | 단위 |
| --- | --- | --- |
| **S0 Pre-built Pages** (← receipt 모델이 여기) | **$10** | 1,000 페이지 |
| S0 Read Pages | $1.50 / $0.60 (볼륨 구간) | 1,000 페이지 |
| S0 Custom Pages | $30 | 1,000 페이지 |
| S0 Query Pages | $200 | 1,000 페이지 |
| Free Transactions | $0 | 1,000 페이지 |

즉 영수증 1장 = 1페이지 기준 **장당 $0.01**. 월 500장까지는 F0 로 무료.

출처: [Azure Retail Prices API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices) ·
[요금 페이지](https://azure.microsoft.com/en-us/pricing/details/ai-document-intelligence/)

## 입력 데이터가 모델 학습에 쓰이나

**아니다.** 데이터·프라이버시 문서에 학습 사용 조항이 없고, 보관 정책만 명시되어 있다:

> "The service stores submitted input data and analyze results for **24 hours** after an analysis operation
> completes. Document Intelligence automatically deletes both after this retention period."

비동기 분석(요청 → 폴링)을 위해 같은 리전의 Azure Storage 에 **24시간** 임시 저장되고 자동 삭제된다.
더 빨리 지우려면 [Delete Analyze Result](https://learn.microsoft.com/en-us/rest/api/aiservices/document-models/delete-analyze-result?view=rest-aiservices-v4.0%20(2024-11-30)&tabs=HTTP) API 를 호출한다.
**F0 와 S0 에 차이를 두는 문구는 없다** — 무료 계층이라고 학습에 쓴다는 내용은 없다.

출처: [Document Intelligence 데이터·프라이버시·보안](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/data-privacy-security)

## 알려진 함정

- `node --test scripts/ocr-bench/lib/` (디렉터리 인자)는 **Node 24.14.0 에서 동작하지 않는다.**
  테스트 러너가 위치 인자를 glob 패턴으로 해석해 디렉터리를 모듈로 로드하려다 `MODULE_NOT_FOUND` 로 죽는다.
  이 워크트리의 파일과 무관한 Node 자체 동작이다. 대신 `node --test "scripts/ocr-bench/lib/**/*.test.mjs"` 를 쓴다.
- F0 는 Analyze TPS 가 1 이라 영수증 여러 장을 병렬로 던지면 429 가 난다. 순차로 돌려야 한다.
