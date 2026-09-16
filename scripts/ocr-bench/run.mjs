// OCR 방식 비교 실행기.
// 각 방식은 scripts/ocr-bench/<provider>.mjs 로 들어오며, 계약은 다음 하나뿐이다.
//   node scripts/ocr-bench/<provider>.mjs <이미지경로>
//   → stdout 에 JSON 한 줄: {"merchant":..,"paidAt":..,"amount":..,"cardNumber":..}
//   → 키가 없으면 exit 2 와 필요한 환경 변수 이름을 stderr 에 출력
// 사용법: node scripts/ocr-bench/run.mjs [provider ...]   (생략하면 있는 것 모두)
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

process.loadEnvFile(".env.local");

const DIR = "scripts/ocr-bench";
const IMAGES = ".local/receipts";
const truth = JSON.parse(readFileSync(join(DIR, "truth.json"), "utf8"));

const providers = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(DIR)
      .filter((f) => f.endsWith(".mjs") && f !== "run.mjs")
      .map((f) => f.replace(/\.mjs$/, ""));

const digits = (v) => String(v ?? "").replace(/\D/g, "");
const norm = (v) => String(v ?? "").replace(/\s+/g, "");

/** 필드별 채점. 정답과 다르면 X, 비어 있으면 -(빈칸). */
function grade(field, got, row) {
  if (got === null || got === undefined || got === "") return { mark: "-", got: "(없음)" };
  if (field === "amount") return { mark: Number(got) === row.amount ? "O" : "X", got: String(got) };
  if (field === "merchant") {
    const a = norm(got);
    const b = norm(row.merchant);
    return { mark: a === b || a.includes(b) || b.includes(a) ? "O" : "X", got: String(got) };
  }
  if (field === "paidAt") {
    const t = Date.parse(got);
    const want = Date.parse(row.paidAt);
    if (Number.isNaN(t)) return { mark: "X", got: String(got) };
    // 판매시간과 승인일시가 몇 초 차이 나는 영수증이 있어 5분까지 같은 것으로 본다.
    return { mark: Math.abs(t - want) <= 5 * 60 * 1000 ? "O" : "X", got: new Date(t).toISOString() };
  }
  if (field === "cardNumber") {
    // 마스킹 위치가 서비스마다 달라, 보이는 앞자리 숫자가 일치하면 맞은 것으로 본다.
    const d = digits(got);
    return { mark: d.startsWith(row.cardDigits) || row.cardDigits.startsWith(d) ? "O" : "X", got: String(got) };
  }
  return { mark: "?", got: String(got) };
}

const results = [];
for (const p of providers) {
  const script = join(DIR, `${p}.mjs`);
  if (!existsSync(script)) {
    console.error(`건너뜀: ${script} 없음`);
    continue;
  }
  for (const row of truth) {
    const image = join(IMAGES, row.file);
    if (!existsSync(image)) {
      console.error(`건너뜀: ${image} 없음`);
      continue;
    }
    const started = Date.now();
    const r = spawnSync(process.execPath, [script, image], { encoding: "utf8", env: process.env });
    const ms = Date.now() - started;
    if (r.status === 2) {
      results.push({ provider: p, file: row.file, skipped: (r.stderr || "").trim().split("\n")[0] });
      continue;
    }
    if (r.status !== 0) {
      results.push({ provider: p, file: row.file, error: (r.stderr || r.stdout || "").trim().slice(0, 200) });
      continue;
    }
    let out;
    try {
      out = JSON.parse((r.stdout || "").trim().split("\n").filter(Boolean).pop());
    } catch {
      results.push({ provider: p, file: row.file, error: "JSON 파싱 실패: " + (r.stdout || "").slice(0, 120) });
      continue;
    }
    const fields = ["merchant", "paidAt", "amount", "cardNumber"];
    results.push({ provider: p, file: row.file, ms, graded: Object.fromEntries(fields.map((f) => [f, grade(f, out[f], row)])) });
  }
}

// 표 출력
const pad = (s, n) => String(s).padEnd(n - [...String(s)].filter((c) => /[가-힣]/.test(c)).length);
console.log("\n=== 영수증별 결과 ===");
for (const row of truth) {
  console.log(`\n[${row.file}] 정답: ${row.merchant} / ${row.paidAt} / ${row.amount}원 / ${row.cardNumber}`);
  console.log(pad("방식", 22) + pad("가맹점", 20) + pad("일시", 26) + pad("금액", 12) + pad("카드번호", 24) + "시간");
  for (const r of results.filter((x) => x.file === row.file)) {
    if (r.skipped) { console.log(pad(r.provider, 22) + "건너뜀: " + r.skipped); continue; }
    if (r.error) { console.log(pad(r.provider, 22) + "오류: " + r.error); continue; }
    const g = r.graded;
    console.log(
      pad(r.provider, 22) +
        pad(`${g.merchant.mark} ${g.merchant.got}`, 20) +
        pad(`${g.paidAt.mark} ${g.paidAt.got}`, 26) +
        pad(`${g.amount.mark} ${g.amount.got}`, 12) +
        pad(`${g.cardNumber.mark} ${g.cardNumber.got}`, 24) +
        `${r.ms}ms`,
    );
  }
}

console.log("\n=== 합계 (O 개수 / 전체 8) ===");
for (const p of providers) {
  const rows = results.filter((x) => x.provider === p && x.graded);
  if (!rows.length) {
    const why = results.find((x) => x.provider === p)?.skipped ?? results.find((x) => x.provider === p)?.error ?? "결과 없음";
    console.log(pad(p, 22) + why);
    continue;
  }
  const marks = rows.flatMap((r) => Object.values(r.graded).map((v) => v.mark));
  const ok = marks.filter((m) => m === "O").length;
  const avg = Math.round(rows.reduce((s, r) => s + r.ms, 0) / rows.length);
  console.log(pad(p, 22) + `${ok}/8   평균 ${avg}ms`);
}
