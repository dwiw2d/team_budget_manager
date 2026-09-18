// Edge Function `ocr`: 영수증 이미지(base64)를 두 단계로 읽는다(설계 스펙 §5).
//   1단계 CLOVA General OCR 로 글자를 읽고 clova-general.ts 파서로 네 필드를 뽑는다.
//   2단계 파서가 확신하지 못한 필드(weak)가 있거나 1단계가 통째로 실패했고
//        GEMINI_API_KEY 가 있으면 Gemini 를 부른다. 부를지 말지는 merge.ts 의 resolve 가 정한다.
// 두 제공자 모두 남은 무료 한도를 물어볼 수 있는 API 가 없으므로 우리가 직접 센다(0005 마이그레이션).
//   부르기 직전에 ocr_quota_consume 으로 1건을 선차감하고, 제공자가 한도 초과를 알려 오면 ocr_quota_exhaust 로 기간을 닫는다.
//   모델이 일을 하나도 하지 않은 실패(Gemini 5xx·시간 초과)로 끝나면 ocr_quota_refund 로 선차감분을 되돌린다(0010 마이그레이션).
// 실행 시간 예산: 무료 요금제의 Edge Function 은 wall clock 150초를 넘기면 함수가 통째로 끊긴다
//   (Supabase Functions Limits, Free 150s / Paid 400s — https://supabase.com/docs/guides/functions/limits).
//   끊기면 사용자는 504 만 받고 선차감한 한도를 되돌릴 기회(ocr_quota_refund)조차 사라지므로, 호출마다 상한을 건다:
//   CLOVA 20초 + Gemini 25초 × 3회 + 재시도 대기 (1+3)초 = 최악 99초. 남은 51초가 인증·한도 RPC 와 응답 몫이다.
//   재시도 횟수나 상한을 늘리려면 이 합이 150초 안에 남는지 먼저 계산해라.
// config.toml 의 [functions.ocr] verify_jwt = false 이므로 JWT 는 여기서 직접 검증한다.
// 이 파일은 Deno 전용이라 tsconfig 의 typecheck 대상에서 제외되어 있다(exclude).
import { createClient } from "npm:@supabase/supabase-js@2";
// 허용 헤더는 손으로 적지 않고 SDK 가 내놓는 목록을 쓴다. 손 목록이 SDK 를 못 따라가
// x-retry-count 가 빠졌고, 프리플라이트가 막혀 POST 자체가 나가지 않은 적이 있다.
// ./cors 하위 경로는 @supabase/supabase-js 2.116.0 의 package.json exports 에 있다.
import { corsHeaders as sdkCors } from "npm:@supabase/supabase-js@2/cors";
import { extract, type OcrField } from "./clova-general.ts";
import {
  buildRequest,
  type GeminiResult,
  modelChain,
  parseResponse,
  RETRY_DELAYS_MS,
  shouldRetry,
  TIMEOUT_MS as GEMINI_TIMEOUT_MS,
} from "./gemini.ts";
import { type ClovaOutcome, merge, resolve } from "./merge.ts";
import { decideProviders, isQuotaExceeded, type OcrQuota } from "./quota.ts";
import { receipt1Fields } from "./clova-general.fixtures.ts";

// SDK 목록에 없는 것들. x-region 은 functions.invoke 의 region 옵션을 쓸 때 붙는다.
const OUR_HEADERS = ["authorization", "apikey", "content-type", "x-client-info", "x-region"];
// SDK 목록과 합집합으로 둔다. 가져온 값이 비어 있거나 모양이 달라도 우리 목록만으로 돌아간다 —
// 헤더가 좀 넓은 것보다 프리플라이트가 막혀 함수가 통째로 못 쓰이는 쪽이 나쁘다.
const ALLOW_HEADERS = [...new Set([
  ...String(sdkCors?.["Access-Control-Allow-Headers"] ?? "").split(",").map((h) => h.trim()).filter(Boolean),
  ...OUR_HEADERS,
])].join(", ");

const CORS_HEADERS = {
  // 출처는 * 그대로 둔다: 이 함수는 쿠키를 쓰지 않고 Bearer 토큰만 보며 Allow-Credentials 도 없어서
  // 제3 사이트가 사용자 세션을 자동으로 실어 보낼 수 없다. CORS 는 애초에 브라우저 밖 호출을 막지
  // 못하므로 출처를 좁혀도 실질 이득이 없다.
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": ALLOW_HEADERS,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MAX_IMAGE_BASE64 = 5 * 1024 * 1024; // 5MB (base64 문자열 기준)
// 1단계 호출 하나의 상한(ms). 위 실행 시간 예산에서 나온 값이다. Gemini 몫은 gemini.ts 의 TIMEOUT_MS 다.
// AbortSignal.timeout 은 Deno 가 표준대로 지원한다 (https://docs.deno.com/api/web/~/AbortSignal).
const CLOVA_TIMEOUT_MS = 20_000;
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

/** 선차감을 되돌린다. 모델이 일을 하나도 하지 않은 실패(503 등)에만 쓴다(0010 마이그레이션). */
async function refund(db: Db, provider: string): Promise<void> {
  await db.rpc("ocr_quota_refund", { p_provider: provider });
}

/** 2단계. 실패는 오류로 만들지 않는다(보조일 뿐이다). 한도 초과 응답만 따로 알린다.
 *  5xx 는 모델 과부하라 잠깐 기다렸다 다음 모델로 다시 부른다(총 RETRY_DELAYS_MS.length + 1 회).
 *  GEMINI_TIMEOUT_MS 를 넘겨 우리가 끊은 호출도 같은 갈래다 — 답을 못 받았으니 게이트웨이 시간 초과(504)와 다르지 않다.
 *  끝까지 그것뿐이었으면 transient 가 true 다 — 모델이 일을 하나도 안 했으니 선차감을 되돌려도 된다.
 *  그 밖의 네트워크 오류는 응답만 유실됐을 수 있어 되돌리지 않는다(선차감의 존재 이유다). */
async function askGemini(
  apiKey: string,
  image: string,
  format: string,
  onQuotaExceeded: () => Promise<void>,
): Promise<{ result: GeminiResult | null; transient: boolean }> {
  const chain = modelChain(Deno.env.get("GEMINI_MODEL"));
  const mimeType = format === "png" ? "image/png" : "image/jpeg";
  const body = JSON.stringify(buildRequest(image, mimeType));

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt - 1]));
    const model = chain[attempt] ?? chain[chain.length - 1]; // 목록이 짧으면 마지막 모델을 다시 부른다
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
          body,
          signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
        },
      );
      if (res.ok) return { result: parseResponse(await res.json()), transient: false };
      if (shouldRetry(res.status)) {
        await res.body?.cancel(); // 읽지 않은 본문은 닫는다(Deno 리소스 누수 경고)
        continue;
      }
      if (isQuotaExceeded(res.status, await res.json().catch(() => null))) await onQuotaExceeded();
      return { result: null, transient: false };
    } catch (err) {
      // 시간 초과로 우리가 끊은 것은 504 와 같이 본다: 다음 모델로 다시 부르고, 끝까지 그것뿐이면 transient 로 끝난다.
      const name = (err as Error)?.name;
      if (name === "TimeoutError" || name === "AbortError") continue;
      return { result: null, transient: false };
    }
  }
  return { result: null, transient: true };
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
        signal: AbortSignal.timeout(CLOVA_TIMEOUT_MS),
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
      // 네트워크 오류도, CLOVA_TIMEOUT_MS 를 넘겨 우리가 끊은 것도 1단계 실패로 본다.
      // 선차감은 되돌리지 않는다: CLOVA 는 Gemini 의 503 처럼 "아무 일도 안 했다"고 알려 준 적이 없고,
      // 우리가 기다리다 끊었을 뿐이라 그쪽에서 이미 읽고 1건을 셌을 수 있다.
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
    const { result, transient } = await askGemini(geminiKey, image, format, async () => {
      geminiBlocked = true;
      await exhaust(supabase, "gemini");
    });
    //    재시도와 모델 교체를 다 쓰고도 503 뿐이었으면 무료 한도를 쓴 것이 아니다. 선차감분을 돌려준다.
    if (transient) await refund(supabase, "gemini");
    return result;
  };

  const result = await resolve(clova, askGeminiOnce);
  if (result) return json(200, result);
  //    도중에 소진돼 둘 다 부를 수 없게 된 경우도 429 로 끝낸다.
  return clovaBlocked && geminiBlocked
    ? json(429, { error: "ocr_quota_exceeded" })
    : json(502, { error: "ocr_failed" });
});
