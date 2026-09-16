// prebuilt-receipt (api-version=2024-11-30) 의 GET analyzeResults 응답을 손으로 흉내낸 픽스처.
// 봉투(status/analyzeResult/documents[].fields)와 값 표현(valueString/valueDate/valueTime/valueCurrency)은
// https://learn.microsoft.com/en-us/rest/api/aiservices/document-models/get-analyze-result?view=rest-aiservices-v4.0%20(2024-11-30)
// pages/boundingRegions 같은 좌표 정보는 변환에 쓰지 않아 뺐다.

// .local/receipts/receipt-1.png — KIS정보통신 VAN 카드 승인전표 (동남집)
export const receipt1Response = {
  status: 'succeeded',
  createdDateTime: '2026-09-16T03:00:00Z',
  lastUpdatedDateTime: '2026-09-16T03:00:04Z',
  analyzeResult: {
    apiVersion: '2024-11-30',
    modelId: 'prebuilt-receipt',
    stringIndexType: 'textElements',
    documents: [
      {
        docType: 'receipt.retailMeal',
        confidence: 0.96,
        fields: {
          MerchantName: { type: 'string', valueString: '동남집', content: '동남집', confidence: 0.91 },
          MerchantPhoneNumber: {
            type: 'phoneNumber',
            valuePhoneNumber: '+82226273999',
            content: 'TEL:0226273999',
            confidence: 0.9,
          },
          MerchantAddress: {
            type: 'address',
            content: '서울 금천구 가산디지털1로 219 111호(가산동, 벽산디지털밸리6차)',
            confidence: 0.88,
          },
          TransactionDate: { type: 'date', valueDate: '2026-09-04', content: '26/09/04', confidence: 0.93 },
          TransactionTime: { type: 'time', valueTime: '12:06:09', content: '12:06:09', confidence: 0.93 },
          Subtotal: {
            type: 'currency',
            valueCurrency: { amount: 53636, currencyCode: 'KRW', currencySymbol: '₩' },
            content: '53,636원',
            confidence: 0.92,
          },
          TotalTax: {
            type: 'currency',
            valueCurrency: { amount: 5364, currencyCode: 'KRW', currencySymbol: '₩' },
            content: '5,364원',
            confidence: 0.92,
          },
          Total: {
            type: 'currency',
            valueCurrency: { amount: 59000, currencyCode: 'KRW', currencySymbol: '₩' },
            content: '59,000원',
            confidence: 0.94,
          },
          CountryRegion: { type: 'countryRegion', valueCountryRegion: 'KOR', confidence: 0.9 },
        },
      },
    ],
  },
};

// .local/receipts/receipt-2.png — POS 카드판매 영수증 (세상끝의라멘)
export const receipt2Response = {
  status: 'succeeded',
  createdDateTime: '2026-09-16T03:01:00Z',
  lastUpdatedDateTime: '2026-09-16T03:01:03Z',
  analyzeResult: {
    apiVersion: '2024-11-30',
    modelId: 'prebuilt-receipt',
    stringIndexType: 'textElements',
    documents: [
      {
        docType: 'receipt.retailMeal',
        confidence: 0.97,
        fields: {
          MerchantName: {
            type: 'string',
            valueString: '세상끝의라멘',
            content: '세상끝의라멘',
            confidence: 0.95,
          },
          MerchantPhoneNumber: {
            type: 'phoneNumber',
            valuePhoneNumber: '+82233613613',
            content: 'TEL: 023361361',
            confidence: 0.86,
          },
          MerchantAddress: {
            type: 'address',
            content: '서울특별시 마포구 양화로7길 6-5 2층 204호',
            confidence: 0.9,
          },
          TransactionDate: { type: 'date', valueDate: '2026-09-15', content: '20260915', confidence: 0.94 },
          TransactionTime: { type: 'time', valueTime: '12:38:27', content: '12:38:27', confidence: 0.94 },
          Items: {
            type: 'array',
            valueArray: [
              {
                type: 'object',
                valueObject: {
                  Description: { type: 'string', valueString: '첫라멘 R', content: '첫라멘 R', confidence: 0.9 },
                  Quantity: { type: 'number', valueNumber: 3, content: '3', confidence: 0.9 },
                  Price: {
                    type: 'currency',
                    valueCurrency: { amount: 11000, currencyCode: 'KRW', currencySymbol: '₩' },
                    content: '11,000',
                    confidence: 0.9,
                  },
                  TotalPrice: {
                    type: 'currency',
                    valueCurrency: { amount: 33000, currencyCode: 'KRW', currencySymbol: '₩' },
                    content: '33,000',
                    confidence: 0.9,
                  },
                },
              },
              {
                type: 'object',
                valueObject: {
                  Description: { type: 'string', valueString: '계란추가', content: '계란추가', confidence: 0.89 },
                  Quantity: { type: 'number', valueNumber: 3, content: '3', confidence: 0.89 },
                  Price: {
                    type: 'currency',
                    valueCurrency: { amount: 1000, currencyCode: 'KRW', currencySymbol: '₩' },
                    content: '1,000',
                    confidence: 0.89,
                  },
                  TotalPrice: {
                    type: 'currency',
                    valueCurrency: { amount: 3000, currencyCode: 'KRW', currencySymbol: '₩' },
                    content: '3,000',
                    confidence: 0.89,
                  },
                },
              },
            ],
          },
          Subtotal: {
            type: 'currency',
            valueCurrency: { amount: 32727, currencyCode: 'KRW', currencySymbol: '₩' },
            content: '32,727',
            confidence: 0.93,
          },
          TotalTax: {
            type: 'currency',
            valueCurrency: { amount: 3273, currencyCode: 'KRW', currencySymbol: '₩' },
            content: '3,273',
            confidence: 0.93,
          },
          Total: {
            type: 'currency',
            valueCurrency: { amount: 36000, currencyCode: 'KRW', currencySymbol: '₩' },
            content: '36,000',
            confidence: 0.95,
          },
          Payments: {
            type: 'array',
            valueArray: [
              {
                type: 'object',
                valueObject: {
                  // 카드번호 필드는 스키마에 없다. 결제수단 이름과 금액만 돌아온다.
                  Method: { type: 'string', valueString: 'Credit', content: 'KB 국민카드', confidence: 0.88 },
                  Amount: {
                    type: 'currency',
                    valueCurrency: { amount: 36000, currencyCode: 'KRW', currencySymbol: '₩' },
                    content: '36,000',
                    confidence: 0.9,
                  },
                },
              },
            ],
          },
          CountryRegion: { type: 'countryRegion', valueCountryRegion: 'KOR', confidence: 0.9 },
        },
      },
    ],
  },
};
