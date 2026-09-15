// 공개 가입 차단. Management API PATCH /v1/projects/{ref}/config/auth { disable_signup: true } 를
// 개인 액세스 토큰(SUPABASE_ACCESS_TOKEN)으로 호출한 뒤, anon 키로 /auth/v1/signup 을 시도해
// 오류가 오는지 확인한다. 결과(상태 코드)만 출력하고 키·토큰은 출력하지 않는다.
// fetch 직후 process.exit() 를 부르면 Windows 에서 libuv 단언 오류가 나므로 exitCode 만 정한다.
process.loadEnvFile(".env.local");

function need(key) {
  const value = process.env[key];
  if (!value) {
    console.error(`.env.local 에 ${key} 가 없습니다`);
    process.exit(1);
  }
  return value;
}

const accessToken = need("SUPABASE_ACCESS_TOKEN");
const projectRef = need("SUPABASE_PROJECT_REF");
const supabaseUrl = need("VITE_SUPABASE_URL");
const anonKey = need("VITE_SUPABASE_ANON_KEY");

const patch = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/config/auth`, {
  method: "PATCH",
  headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
  body: JSON.stringify({ disable_signup: true }),
});
if (!patch.ok) {
  console.error(`가입 차단 설정 실패: HTTP ${patch.status}`);
  process.exitCode = 1;
} else {
  const config = await patch.json();
  console.log(`가입 차단 설정 완료: disable_signup=${config.disable_signup}`);

  // 확인: anon 키로 signup 시도 → 422 signup_disabled 가 와야 한다.
  // (.invalid 같은 예약 도메인은 형식 검사(400 email_address_invalid)에 먼저 걸려 차단 증거가 되지 않는다)
  const probe = await fetch(`${supabaseUrl}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email: `signup-probe-${Date.now()}@example.com`, password: crypto.randomUUID() }),
  });
  const probeBody = await probe.json().catch(() => ({}));
  const blocked = probeBody.error_code === "signup_disabled" || /not allowed/i.test(probeBody.msg ?? "");
  console.log(`signup 시도: HTTP ${probe.status} ${probeBody.error_code ?? probeBody.msg ?? ""} → ${blocked ? "차단됨" : "차단 안 됨"}`);
  if (!blocked) process.exitCode = 1;
}
