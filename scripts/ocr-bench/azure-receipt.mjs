#!/usr/bin/env node
// node scripts/ocr-bench/azure-receipt.mjs <이미지경로>
// Azure AI Document Intelligence prebuilt-receipt (api-version=2024-11-30) 로 영수증을 읽는다.
// 성공하면 stdout 마지막 줄에 { merchant, paidAt, amount, cardNumber } 를 한 줄 JSON 으로 낸다.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { extract } from './lib/azure-receipt-extract.mjs';

const API_VERSION = '2024-11-30';
const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 60_000;

try {
  process.loadEnvFile('.env.local');
} catch {
  // .env.local 이 없어도 아래 환경 변수 검사에서 exit 2 로 걸린다.
}

const endpoint = process.env.AZURE_DI_ENDPOINT?.replace(/\/+$/, '');
const key = process.env.AZURE_DI_KEY;
if (!endpoint || !key) {
  console.error('AZURE_DI_ENDPOINT AZURE_DI_KEY');
  process.exit(2);
}

const imagePath = process.argv[2];
if (!imagePath) {
  console.error('사용법: node scripts/ocr-bench/azure-receipt.mjs <이미지경로>');
  process.exit(1);
}

const headers = { 'Ocp-Apim-Subscription-Key': key, 'Content-Type': 'application/json' };

// locale 은 힌트일 뿐이라 없어도 되지만, 한국어 영수증이므로 ko 를 준다.
const analyzeUrl =
  `${endpoint}/documentintelligence/documentModels/prebuilt-receipt:analyze` +
  `?api-version=${API_VERSION}&locale=ko`;

const started = await fetch(analyzeUrl, {
  method: 'POST',
  headers,
  body: JSON.stringify({ base64Source: readFileSync(imagePath).toString('base64') }),
});
if (started.status !== 202) {
  console.error(`분석 요청 실패 (HTTP ${started.status}): ${await started.text()}`);
  process.exit(1);
}

const operationLocation = started.headers.get('operation-location');
if (!operationLocation) {
  console.error('202 응답에 Operation-Location 헤더가 없다');
  process.exit(1);
}
console.error(`분석 시작: ${operationLocation}`);

const deadline = Date.now() + POLL_TIMEOUT_MS;
let result;
while (true) {
  await sleep(POLL_INTERVAL_MS);
  const res = await fetch(operationLocation, { headers: { 'Ocp-Apim-Subscription-Key': key } });
  if (!res.ok) {
    console.error(`결과 조회 실패 (HTTP ${res.status}): ${await res.text()}`);
    process.exit(1);
  }
  result = await res.json();
  if (result.status === 'succeeded') break;
  if (result.status === 'failed') {
    console.error(`분석 실패: ${JSON.stringify(result.error ?? result)}`);
    process.exit(1);
  }
  if (Date.now() > deadline) {
    console.error(`${POLL_TIMEOUT_MS / 1000}초 안에 끝나지 않았다 (마지막 status=${result.status})`);
    process.exit(1);
  }
}

mkdirSync('.local', { recursive: true });
const rawPath = `.local/azure-receipt-${basename(imagePath)}-${Date.now()}.json`;
writeFileSync(rawPath, JSON.stringify(result, null, 2));
console.error(`원본 응답 저장: ${rawPath}`);

console.log(JSON.stringify(extract(result)));
