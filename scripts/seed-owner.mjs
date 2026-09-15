// 앱 계정(1개) 생성. .env.local 의 APP_OWNER_EMAIL / APP_OWNER_PASSWORD 로
// Supabase Auth 관리자 API(POST /auth/v1/admin/users)를 service_role 키로 호출한다.
// service_role 키는 `supabase projects api-keys` 로 그때그때 얻고 파일에 저장하지 않는다.
// 출력은 성공/실패 여부와 사용자 id 뿐이다. 이메일·비밀번호·키는 출력하지 않는다.
import { spawnSync } from "node:child_process";
import path from "node:path";

process.loadEnvFile(".env.local");

function need(key) {
  const value = process.env[key];
  if (!value) {
    console.error(`.env.local 에 ${key} 가 없습니다`);
    process.exit(1);
  }
  return value;
}

need("SUPABASE_ACCESS_TOKEN");
const projectRef = need("SUPABASE_PROJECT_REF");
const supabaseUrl = need("VITE_SUPABASE_URL");
const email = need("APP_OWNER_EMAIL");
const password = need("APP_OWNER_PASSWORD");

const cli = path.resolve("node_modules/supabase/dist/supabase.js");
const keys = spawnSync(
  process.execPath,
  [cli, "projects", "api-keys", "--project-ref", projectRef, "--output", "json"],
  { encoding: "utf8" },
);
if (keys.status !== 0) {
  console.error("service_role 키 조회 실패(supabase projects api-keys)");
  process.exit(1);
}
const serviceRole = JSON.parse(keys.stdout).find((k) => k.name === "service_role")?.api_key;
if (!serviceRole) {
  console.error("api-keys 응답에 service_role 키가 없습니다");
  process.exit(1);
}

const res = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
  method: "POST",
  headers: {
    apikey: serviceRole,
    Authorization: `Bearer ${serviceRole}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ email, password, email_confirm: true }),
});
const body = await res.json().catch(() => ({}));

// fetch 직후 process.exit() 를 부르면 Windows 에서 libuv 단언 오류가 나므로 exitCode 만 정한다.
if (res.ok) {
  console.log(`계정 생성 성공: id=${body.id}`);
} else if (res.status === 422 || body.error_code === "email_exists" || /already/i.test(body.msg ?? "")) {
  console.log("이미 존재: 계정을 새로 만들지 않았습니다");
} else {
  console.error(`계정 생성 실패: HTTP ${res.status} ${body.error_code ?? body.msg ?? ""}`);
  process.exitCode = 1;
}
