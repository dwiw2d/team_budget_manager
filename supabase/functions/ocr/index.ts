// Edge Function `ocr`: 영수증 이미지(base64)를 네이버 CLOVA OCR 영수증 API 로 보내고 정규화한 결과를 돌려준다.
// 계약은 설계 스펙 §5. config.toml 의 [functions.ocr] verify_jwt = false 이므로 JWT 는 여기서 직접 검증한다.
// 이 파일은 Deno 전용이라 tsconfig 의 typecheck 대상에서 제외되어 있다(exclude).
import { createClient } from "npm:@supabase/supabase-js@2";
import { normalizeNaverReceipt } from "./normalize.ts";
import fixture from "./fixtures/naver-receipt.json" with { type: "json" };

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

  // 3. QA 전용 목: NAVER_OCR_MOCK=1 이면 네이버를 부르지 않고 fixture 로 만든 고정 응답
  if (Deno.env.get("NAVER_OCR_MOCK") === "1") return json(200, normalizeNaverReceipt(fixture));

  // 4. 네이버 CLOVA OCR 호출
  const invokeUrl = Deno.env.get("NAVER_OCR_INVOKE_URL");
  const secret = Deno.env.get("NAVER_OCR_SECRET");
  if (!invokeUrl || !secret) return json(503, { error: "ocr_not_configured" });

  try {
    const res = await fetch(invokeUrl, {
      method: "POST",
      headers: { "X-OCR-SECRET": secret, "Content-Type": "application/json" },
      body: JSON.stringify({
        version: "V2",
        requestId: crypto.randomUUID(),
        timestamp: Date.now(),
        images: [{ format, name: "receipt", data: image }],
      }),
    });
    if (!res.ok) return json(502, { error: "ocr_failed" });
    const data = await res.json();
    if (data?.images?.[0]?.inferResult !== "SUCCESS") return json(502, { error: "ocr_failed" });
    return json(200, normalizeNaverReceipt(data));
  } catch {
    return json(502, { error: "ocr_failed" });
  }
});
