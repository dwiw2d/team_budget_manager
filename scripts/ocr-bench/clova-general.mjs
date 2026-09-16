// 방식 A: 네이버 CLOVA OCR General OCR 로 글자만 읽고, 파서로 네 필드를 뽑는다.
//
//   node scripts/ocr-bench/clova-general.mjs <이미지경로>
//   -> stdout 마지막 줄에 { merchant, paidAt, amount, cardNumber } JSON 한 줄
//
// 요청/응답 규격 (2026-09-16 확인):
//   https://api.ncloud-docs.com/docs/ai-application-service-ocr-ocr
//   POST <Invoke URL>/general
//   헤더  X-OCR-SECRET: <Secret Key>, Content-Type: application/json
//   본문  { version: "V2", requestId, timestamp, lang: "ko",
//           images: [{ format, name, data(base64) }] }
//   응답  { images: [{ inferResult, fields: [{ inferText, inferConfidence,
//                                              type, lineBreak, boundingPoly }] }] }

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { extract } from './lib/clova-general-extract.mjs';

const ENV_NAMES = ['NAVER_OCR_GENERAL_INVOKE_URL', 'NAVER_OCR_GENERAL_SECRET'];

const die = (code, msg) => {
  process.stderr.write(`${msg}\n`);
  process.exit(code);
};

try {
  process.loadEnvFile('.env.local');
} catch {
  // .env.local 이 없어도 진짜 환경 변수로 돌 수 있다. 아래에서 판정한다.
}

const missing = ENV_NAMES.filter((n) => !process.env[n]);
if (missing.length) die(2, `환경 변수 없음: ${missing.join(' ')}`);

const imagePath = process.argv[2];
if (!imagePath) die(1, '사용법: node scripts/ocr-bench/clova-general.mjs <이미지경로>');

const format = extname(imagePath).slice(1).toLowerCase();
if (!['jpg', 'jpeg', 'png', 'pdf', 'tif', 'tiff'].includes(format)) {
  die(1, `지원하지 않는 형식: ${format || '(확장자 없음)'}`);
}

let data;
try {
  data = readFileSync(imagePath).toString('base64');
} catch (e) {
  die(1, `이미지를 읽지 못했다: ${e.message}`);
}

const url = process.env.NAVER_OCR_GENERAL_INVOKE_URL.replace(/\/+$/, '');
const res = await fetch(`${url}/general`, {
  method: 'POST',
  headers: { 'X-OCR-SECRET': process.env.NAVER_OCR_GENERAL_SECRET, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    version: 'V2',
    requestId: crypto.randomUUID(),
    timestamp: Date.now(),
    lang: 'ko',
    images: [{ format, name: basename(imagePath), data }],
  }),
});

const body = await res.text();
if (!res.ok) die(1, `CLOVA ${res.status}: ${body.slice(0, 500)}`);

let json;
try {
  json = JSON.parse(body);
} catch {
  die(1, `JSON 이 아닌 응답: ${body.slice(0, 500)}`);
}

// 원본은 .local/ 에 남긴다(git 에 올라가지 않는 폴더). 나중에 픽스처로 쓴다.
try {
  mkdirSync('.local/ocr-raw', { recursive: true });
  const stamp = `${basename(imagePath, extname(imagePath))}-${Date.now()}`;
  writeFileSync(`.local/ocr-raw/clova-general-${stamp}.json`, JSON.stringify(json, null, 2));
} catch (e) {
  process.stderr.write(`원본 저장 실패(무시): ${e.message}\n`);
}

const image = json.images?.[0];
if (image?.inferResult !== 'SUCCESS') die(1, `inferResult=${image?.inferResult}: ${image?.message ?? ''}`);

process.stdout.write(`${JSON.stringify(extract(image.fields))}\n`);
