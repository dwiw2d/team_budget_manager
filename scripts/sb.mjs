// Supabase CLI 래퍼. .env.local 을 읽어 SUPABASE_ACCESS_TOKEN 등을 환경에 넣고 CLI 를 실행한다.
// 사용법: node scripts/sb.mjs <link|push|functions|secrets>
// 비밀 값은 절대 출력하지 않는다.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

process.loadEnvFile(".env.local");

function need(key) {
  const value = process.env[key];
  if (!value) {
    console.error(`.env.local 에 ${key} 가 없습니다`);
    process.exit(1);
  }
  return value;
}

const commands = {
  link: () => ["link", "--project-ref", need("SUPABASE_PROJECT_REF"), "-p", need("SUPABASE_DB_PASSWORD")],
  push: () => ["db", "push", "-p", need("SUPABASE_DB_PASSWORD")],
  functions: () => ["functions", "deploy", "ocr"],
  secrets: () => [
    "secrets",
    "set",
    `NAVER_OCR_INVOKE_URL=${need("NAVER_OCR_INVOKE_URL")}`,
    `NAVER_OCR_SECRET=${need("NAVER_OCR_SECRET")}`,
  ],
};

const build = commands[process.argv[2]];
if (!build) {
  console.error("사용법: node scripts/sb.mjs <link|push|functions|secrets>");
  process.exit(1);
}

need("SUPABASE_ACCESS_TOKEN");
const args = build();

// npx supabase 와 같은 스크립트를 셸 없이 직접 실행한다(cmd.exe 인용 문제로 시크릿이 깨지지 않게).
const cli = fileURLToPath(new URL("../node_modules/supabase/dist/supabase.js", import.meta.url));
const result = spawnSync(process.execPath, [cli, ...args], { stdio: "inherit" });
process.exit(result.status ?? 1);
