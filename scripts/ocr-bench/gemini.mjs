#!/usr/bin/env node
// 사용법: node scripts/ocr-bench/gemini.mjs <이미지경로>
// 영수증 이미지를 Gemini 비전 모델에 그대로 보내고 네 필드를 한 줄 JSON 으로 낸다.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname } from "node:path";

import { buildRequest, parseResponse, DEFAULT_MODEL } from "./lib/gemini-extract.mjs";

try {
  process.loadEnvFile(".env.local");
} catch {
  // .env.local 이 없어도 진짜 환경 변수만으로 돌 수 있다.
}

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  process.stderr.write("GEMINI_API_KEY\n");
  process.exit(2);
}

const imagePath = process.argv[2];
if (!imagePath) {
  process.stderr.write("사용법: node scripts/ocr-bench/gemini.mjs <이미지경로>\n");
  process.exit(1);
}

const MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
};

const mimeType = MIME[extname(imagePath).toLowerCase()];
if (!mimeType) {
  process.stderr.write(`지원하지 않는 이미지 형식: ${imagePath}\n`);
  process.exit(1);
}

const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
const base64 = readFileSync(imagePath).toString("base64");

let raw;
try {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify(buildRequest(base64, mimeType)),
    },
  );
  raw = await response.text();

  mkdirSync(".local/ocr-bench", { recursive: true });
  const savedAt = `.local/ocr-bench/gemini-${basename(imagePath, extname(imagePath))}-${Date.now()}.json`;
  writeFileSync(savedAt, raw);
  process.stderr.write(`모델: ${model}, 원본 응답: ${savedAt}\n`);

  if (!response.ok) {
    process.stderr.write(`HTTP ${response.status} ${response.statusText}\n`);
    process.exit(1);
  }
} catch (error) {
  process.stderr.write(`호출 실패: ${error.message}\n`);
  process.exit(1);
}

try {
  process.stdout.write(`${JSON.stringify(parseResponse(JSON.parse(raw)))}\n`);
} catch (error) {
  process.stderr.write(`응답 해석 실패: ${error.message}\n`);
  process.exit(1);
}
