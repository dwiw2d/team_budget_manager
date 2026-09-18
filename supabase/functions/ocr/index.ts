// Edge Function `ocr`: 영수증 이미지(base64)를 두 단계로 읽는다(설계 스펙 §5).
//   1단계 CLOVA General OCR 로 글자를 읽고 clova-general.ts 파서로 네 필드를 뽑는다.
//   2단계 파서가 확신하지 못한 필드(weak)가 있거나 1단계가 통째로 실패했고
//        GEMINI_API_KEY 가 있으면 Gemini 를 부른다. 부를지 말지는 merge.ts 의 resolve 가 정한다.
// 두 제공자 모두 남은 무료 한도를 물어볼 수 있는 API 가 없으므로 우리가 직접 센다(0005 마이그레이션).
//   부르기 직전에 ocr_quota_consume 으로 1건을 선차감하고, 제공자가 한도 초과를 알려 오면 ocr_quota_exhaust 로 기간을 닫는다.
// config.toml 의 [functions.ocr] verify_jwt = false 이므로 JWT 는 여기서 직접 검증한다.
// 이 파일은 Deno 전용이라 tsconfig 의 typecheck 대상에서 제외되어 있다(exclude).
import { createClient } from "npm:@supabase/supabase-js@2";
import { extract, type OcrField } from "./clova-general.ts";
import { buildRequest, DEFAULT_MODEL, parseResponse, type GeminiResult } from "./gemini.ts";
import { type ClovaOutcome, merge, resolve } from "./merge.ts";
import { decideProviders, isQuotaExceeded, type OcrQuota } from "./quota.ts";
import { receipt1Fields } from "./clova-general.fixtures.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  // supabase-js 가 X-Client-Info 를 항상 보낸다. 빠지면 브라우저가 프리플라이트에서 막아
  // POST 자체가 나가지 않는다. x-region 은 functions.invoke 의 region 옵션을 쓸 때 붙는다.
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-region",
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

type Db = ReturnType<typeof createClient>;

/** 한도 상태. RPC 가 실패하면 null 이고, 그러면 선차감도 못 하므로 제공자를 부르지 않는다. */
async function readQuota(db: Db): Promise<OcrQuota | null> {
  const { data, error } = await db.rpc("ocr_quota");
  return error ? null : (data as OcrQuota);
}

/** 선차감. 응답이 유실돼도 과금분이 세어지도록 부르기 직전에 1건을 깎는다. false 면 그 사이 한도가 찼다. */
async function consume(db: Db, provider: string): Promise<boolean> {
  const { data, error } = await db.rpc("ocr_quota_consume", { p_provider: provider });
  return !error && data === true;
}

/** 제공자가 한도 초과를 알려 왔다. 우리 계수와 상관없이 이번 기간을 닫는다. */
async function exhaust(db: Db, provider: string): Promise<void> {
  await db.rpc("ocr_quota_exhaust", { p_provider: provider });
}

/** 2단계. 실패는 오류로 만들지 않는다(보조일 뿐이다). 한도 초과 응답만 따로 알린다. */
async function askGemini(
  apiKey: string,
  image: string,
  format: string,
  onQuotaExceeded: () => Promise<void>,
): Promise<GeminiResult | null> {
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
    if (!res.ok) {
      if (isQuotaExceeded(res.status, await res.json().catch(() => null))) await onQuotaExceeded();
      return null;
    }
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

  // 3. QA 전용 목: NAVER_OCR_MOCK=1 이면 아무것도 부르지 않고 픽스처를 파서에 통과시킨다.
  //    제공자를 부르지 않으므로 한도 검사보다 앞에 둔다(세지도, 막지도 않는다).
  if (Deno.env.get("NAVER_OCR_MOCK") === "1") {
    const { weak, ...values } = extract(receipt1Fields);
    return json(200, merge(values, weak, null));
  }

  // 4. 무료 한도: 둘 다 소진이면 제공자를 전혀 부르지 않는다.
  //    한도로 못 부른 제공자를 표시해 둔다. 끝까지 둘 다 한도면 502 가 아니라 429 다.
  const allow = decideProviders(await readQuota(supabase));
  if (allow.blocked) return json(429, { error: "ocr_quota_exceeded" });
  let clovaBlocked = !allow.clova;
  let geminiBlocked = !allow.gemini;

  // 5. 1단계: CLOVA General OCR. 콘솔이 주는 Invoke URL 이 이미 /general 로 끝난다.
  const invokeUrl = Deno.env.get("NAVER_OCR_GENERAL_INVOKE_URL");
  const secret = Deno.env.get("NAVER_OCR_GENERAL_SECRET");
  if (!invokeUrl || !secret) return json(503, { error: "ocr_not_configured" });

  //    실패해도 여기서 502 를 내지 않는다. 흐릿한 사진일수록 2단계가 필요하다.
  let clova: ClovaOutcome = { ok: false };
  if (!clovaBlocked && !(await consume(supabase, "clova"))) clovaBlocked = true;
  if (!clovaBlocked) {
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
      if (res.ok) {
        const data = await res.json();
        if (data?.images?.[0]?.inferResult === "SUCCESS") {
          const fields: OcrField[] = data.images[0].fields ?? [];
          const { weak, ...values } = extract(fields);
          clova = { ok: true, values, weak };
        }
      } else if (isQuotaExceeded(res.status, await res.json().catch(() => null))) {
        clovaBlocked = true;
        await exhaust(supabase, "clova");
      }
    } catch {
      // 네트워크 오류도 1단계 실패로 본다
    }
  }

  // 6. 2단계: Gemini. 부를지 말지와 합치는 방법은 resolve 가 정한다.
  //    CLOVA 가 소진이라 1단계가 통째로 없는 경우에도 같은 경로를 타므로 Gemini 가 주 엔진이 된다.
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  const askGeminiOnce = async (): Promise<GeminiResult | null> => {
    if (!geminiKey) return null; // 키가 없으면 한도와 무관하게 2단계가 없다
    if (geminiBlocked || !(await consume(supabase, "gemini"))) {
      geminiBlocked = true;
      return null;
    }
    return askGemini(geminiKey, image, format, async () => {
      geminiBlocked = true;
      await exhaust(supabase, "gemini");
    });
  };

  const result = await resolve(clova, askGeminiOnce);
  if (result) return json(200, result);
  //    도중에 소진돼 둘 다 부를 수 없게 된 경우도 429 로 끝낸다.
  return clovaBlocked && geminiBlocked
    ? json(429, { error: "ocr_quota_exceeded" })
    : json(502, { error: "ocr_failed" });
});
