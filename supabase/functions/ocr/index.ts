// Edge Function `ocr`: 영수증 이미지(base64)를 두 단계로 읽는다(설계 스펙 §5).
//   1단계 CLOVA General OCR 로 글자를 읽고 clova-general.ts 파서로 네 필드를 뽑는다.
//   2단계 파서가 확신하지 못한 필드(weak)가 있고 GEMINI_API_KEY 가 있으면 Gemini 로 보완한다.
// config.toml 의 [functions.ocr] verify_jwt = false 이므로 JWT 는 여기서 직접 검증한다.
// 이 파일은 Deno 전용이라 tsconfig 의 typecheck 대상에서 제외되어 있다(exclude).
import { createClient } from "npm:@supabase/supabase-js@2";
import { extract, type OcrField } from "./clova-general.ts";
import { buildRequest, DEFAULT_MODEL, parseResponse, type GeminiResult } from "./gemini.ts";
import { merge } from "./merge.ts";
import { receipt1Fields } from "./clova-general.fixtures.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MAX_IMAGE_BASE64 = 5 * 1024 * 1024; // 5MB (base64 문자열 기준)
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

/** 2단계. 실패는 오류로 만들지 않는다(보조일 뿐이다). */
async function askGemini(image: string, format: string): Promise<GeminiResult | null> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return null;
  const model = Deno.env.get("GEMINI_MODEL") || DEFAULT_MODEL;
  const mimeType = format === "png" ? "image/png" : "image/jpeg";
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(buildRequest(image, mimeType)),
      },
    );
    if (!res.ok) return null;
    return parseResponse(await res.json());
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  // 1. 인증: Authorization: Bearer <access_token> 을 anon 클라이언트의 getUser() 로 검증
  const authorization = req.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return json(401, { error: "unauthorized" });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return json(401, { error: "unauthorized" });

  // 2. 본문 검증
  const raw = await req.text();
  if (raw.length > MAX_IMAGE_BASE64 + 4096) return json(413, { error: "payload_too_large" });
  let body: { image?: unknown; format?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: "invalid_json" });
  }
  const { image, format } = body ?? {};
  if (typeof image !== "string" || image.length === 0 || (format !== "jpg" && format !== "png")) {
    return json(400, { error: "invalid_request" });
  }
  if (image.length > MAX_IMAGE_BASE64) return json(413, { error: "payload_too_large" });
  if (!BASE64_RE.test(image)) return json(400, { error: "invalid_image" });

  // 3. QA 전용 목: NAVER_OCR_MOCK=1 이면 아무것도 부르지 않고 픽스처를 파서에 통과시킨다
  if (Deno.env.get("NAVER_OCR_MOCK") === "1") {
    const { weak, ...values } = extract(receipt1Fields);
    return json(200, merge(values, weak, null));
  }

  // 4. 1단계: CLOVA General OCR. 콘솔이 주는 Invoke URL 이 이미 /general 로 끝난다.
  const invokeUrl = Deno.env.get("NAVER_OCR_GENERAL_INVOKE_URL");
  const secret = Deno.env.get("NAVER_OCR_GENERAL_SECRET");
  if (!invokeUrl || !secret) return json(503, { error: "ocr_not_configured" });

  let fields: OcrField[];
  try {
    const res = await fetch(invokeUrl, {
      method: "POST",
      headers: { "X-OCR-SECRET": secret, "Content-Type": "application/json" },
      body: JSON.stringify({
        version: "V2",
        requestId: crypto.randomUUID(),
        timestamp: Date.now(),
        lang: "ko",
        images: [{ format, name: "receipt", data: image }],
      }),
    });
    if (!res.ok) return json(502, { error: "ocr_failed" });
    const data = await res.json();
    if (data?.images?.[0]?.inferResult !== "SUCCESS") return json(502, { error: "ocr_failed" });
    fields = data.images[0].fields ?? [];
  } catch {
    return json(502, { error: "ocr_failed" });
  }
  const { weak, ...clova } = extract(fields);

  // 5. 2단계: 확신 없는 칸이 있을 때만 Gemini 를 부른다
  const gemini = weak.length ? await askGemini(image, format) : null;
  return json(200, merge(clova, weak, gemini));
});
