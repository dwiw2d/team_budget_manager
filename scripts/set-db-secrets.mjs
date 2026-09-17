// DB 가 쓰는 두 값을 Supabase Vault 에 넣는다 (설계 스펙 §4).
// 결제가 지워질 때 저장소 사진을 지우는 트리거(0008)가 이 값들로 저장소 REST API 를 부른다.
// 이름은 app_project_url, app_service_role_key 로 고정이다(마이그레이션이 이 이름으로 읽는다).
// service_role 키는 `supabase projects api-keys` 로 그때그때 얻고 파일에 저장하지 않는다.
// 출력은 이름과 성공/실패뿐이다. 값은 절대 출력하지 않는다.
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

const accessToken = need("SUPABASE_ACCESS_TOKEN");
const projectRef = need("SUPABASE_PROJECT_REF");
const projectUrl = need("VITE_SUPABASE_URL");

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

/** SQL 문자열 리터럴. Management API 는 파라미터를 받지 않아 직접 감싼다. */
const lit = (v) => `'${v.replaceAll("'", "''")}'`;

// 같은 이름이 이미 있으면 갱신하고, 없으면 새로 만든다.
const SQL = `
do $$
declare
  sid uuid;
begin
  select id into sid from vault.secrets where name = 'app_project_url';
  if sid is null then
    perform vault.create_secret(${lit(projectUrl)}, 'app_project_url');
  else
    perform vault.update_secret(sid, ${lit(projectUrl)});
  end if;

  select id into sid from vault.secrets where name = 'app_service_role_key';
  if sid is null then
    perform vault.create_secret(${lit(serviceRole)}, 'app_service_role_key');
  else
    perform vault.update_secret(sid, ${lit(serviceRole)});
  end if;
end
$$;
`;

// fetch 직후 process.exit() 를 부르면 Windows 에서 libuv 단언 오류가 나므로 exitCode 만 정한다.
const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: SQL }),
});

if (res.ok) {
  console.log("Vault 에 넣었습니다: app_project_url app_service_role_key"); // 이름만.
} else {
  // 오류 본문에 값이 실려 나올 수 있으므로 상태 코드만 알린다.
  console.error(`Vault 저장 실패: HTTP ${res.status}`);
  process.exitCode = 1;
}
