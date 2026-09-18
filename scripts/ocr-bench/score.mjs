// 영수증 카탈로그로 파서 인식률을 재는 채점기.
// 카탈로그의 visible_lines 를 합성 fields[] 로 바꿔 extract() 에 넣고 truth 와 맞춰 본다.
// CLOVA·Gemini API 는 한 번도 부르지 않는다. 이미지 파일도 읽지 않는다.
//
// 사용법: node scripts/ocr-bench/score.mjs [--json]
//   카탈로그 디렉터리는 RECEIPT_CORPUS_DIR 로 바꾼다(기본 .local/receipt-corpus).
//   카탈로그 파일 자체를 직접 지정하려면 RECEIPT_CATALOG 에 경로를 넣는다.
//
// 채점기 자체의 단위 테스트: node --test "scripts/ocr-bench/lib/*.test.mjs"
//   글로브를 따옴표로 묶어 Node 가 직접 펼치게 해라. Node 24 는
//   `node --test scripts/ocr-bench/lib/` 처럼 디렉터리를 주면 그 디렉터리를 테스트 모듈로
//   읽으려다 'test failed' 로 끝난다(v24.14.0 확인).
//
// 합성 입력의 한계는 lib/synth-fields.mjs 맨 위 주석 참고. 여기서 나오는 숫자는
// "파서 규칙이 이 판형을 다루는가"이지 "실제 사진으로 얼마나 맞히는가"가 아니다.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extract } from './lib/clova-general-extract.mjs';
import { cardDigits, isReachable, squash } from './lib/reachable.mjs';
import { linesToFields } from './lib/synth-fields.mjs';

const DIR = process.env.RECEIPT_CORPUS_DIR ?? '.local/receipt-corpus';
const FIELDS = ['merchant', 'paidAt', 'amount', 'cardNumber'];

// 카탈로그를 고르는 순서. 동결본이 살아 있는 catalog.json 보다 앞선다.
// catalog.json 은 수집 작업이 도는 동안 계속 바뀌어서, 두 번 잰 숫자가 달라도
// 파서 탓인지 정답표 탓인지 구분할 수 없다. 기본값은 안 움직이는 사본이어야 한다.
const CANDIDATES = [
  process.env.RECEIPT_CATALOG && { path: process.env.RECEIPT_CATALOG, kind: 'RECEIPT_CATALOG 환경 변수' },
  { path: join(DIR, 'frozen', 'catalog-v1.json'), kind: '동결본' },
  { path: join(DIR, 'catalog.json'), kind: '살아 있는 카탈로그(수집 중 바뀔 수 있다)' },
].filter(Boolean);

const source = CANDIDATES.find((c) => existsSync(c.path));
if (!source) {
  console.error('카탈로그를 찾지 못했다. 아래 순서로 찾는다:');
  for (const c of CANDIDATES) console.error(`  ${c.kind}: ${c.path}`);
  console.error('개인정보가 담긴 사진이라 저장소에 넣지 않는다. 수집본을 가진 워크트리의 경로를');
  console.error('RECEIPT_CORPUS_DIR 에 넣고 다시 실행해라.');
  console.error('  예: RECEIPT_CORPUS_DIR=../wolfeel/.local/receipt-corpus node scripts/ocr-bench/score.mjs');
  process.exit(2);
}

const raw = readFileSync(source.path);
const sha256 = createHash('sha256').update(raw).digest('hex');
const catalog = JSON.parse(raw.toString('utf8'));

/** @returns {'correct'|'partial'|'wrong'} */
function compare(field, want, got) {
  if (got === null || got === undefined || got === '') return 'wrong';
  if (field === 'merchant') return squash(got) === squash(want) ? 'correct' : 'wrong';
  if (field === 'amount') return Number(got) === Number(want) ? 'correct' : 'wrong';
  if (field === 'cardNumber') return cardDigits(got) === cardDigits(want) ? 'correct' : 'wrong';
  // paidAt: 문자열 전체가 같아야 정답. 날짜만 맞고 시각이 틀리면 부분 정답.
  if (String(got) === String(want)) return 'correct';
  return String(got).slice(0, 10) === String(want).slice(0, 10) ? 'partial' : 'wrong';
}

const tally = Object.fromEntries(
  FIELDS.map((f) => [
    f,
    { total: 0, reachable: 0, correct: 0, correctReachable: 0, partial: 0, wrongFlagged: 0, wrongSilent: 0 },
  ]),
);
const misses = [];
const unreachable = [];
const skipped = [];
const perItem = [];

for (const item of catalog) {
  if (!item.visible_lines?.length) {
    skipped.push({ id: item.id, why: 'visible_lines 가 비었다' });
    continue;
  }
  const scorable = FIELDS.filter((f) => item.truth?.[f] !== null && item.truth?.[f] !== undefined);
  if (!scorable.length) {
    skipped.push({ id: item.id, why: 'truth 가 네 필드 모두 null(영수증에 원래 없음)' });
    continue;
  }

  const got = extract(linesToFields(item.visible_lines));
  const graded = {};
  for (const field of scorable) {
    const want = item.truth[field];
    const verdict = compare(field, want, got[field]);
    const flagged = got.weak?.includes(field) ?? false;
    const reach = isReachable(field, want, item.visible_lines);
    graded[field] = { want, got: got[field] ?? null, verdict, flagged, reachable: reach };

    const t = tally[field];
    t.total += 1;
    if (reach) t.reachable += 1;
    else unreachable.push({ id: item.id, field, want, notes: item.layout_notes });
    if (verdict === 'correct') {
      t.correct += 1;
      if (reach) t.correctReachable += 1;
    } else if (verdict === 'partial') t.partial += 1;
    if (verdict !== 'correct') {
      if (flagged) t.wrongFlagged += 1;
      else t.wrongSilent += 1;
      misses.push({
        id: item.id,
        field,
        want,
        got: got[field] ?? null,
        verdict,
        flagged,
        reachable: reach,
        notes: item.layout_notes,
      });
    }
  }
  perItem.push({ id: item.id, file: item.file, category: item.category, weak: got.weak, graded });
}

const sum = (pick) => FIELDS.reduce((a, f) => a + pick(tally[f]), 0);
const overall = {
  total: sum((t) => t.total),
  reachable: sum((t) => t.reachable),
  correct: sum((t) => t.correct),
  correctReachable: sum((t) => t.correctReachable),
  partial: sum((t) => t.partial),
  wrongFlagged: sum((t) => t.wrongFlagged),
  wrongSilent: sum((t) => t.wrongSilent),
};

const version = {
  path: source.path,
  kind: source.kind,
  sha256,
  items: catalog.length,
  scoredItems: perItem.length,
  skippedItems: skipped.length,
  scoredFields: overall.total,
  reachableFields: overall.reachable,
};

const pct = (n, d) => (d === 0 ? '   -  ' : `${((n / d) * 100).toFixed(1).padStart(5)}%`);

if (process.argv.includes('--json')) {
  console.log(
    JSON.stringify({ catalog: version, corpus: DIR, tally, overall, unreachable, misses, skipped, perItem }, null, 2),
  );
  process.exit(0);
}

console.log('=== 카탈로그 판본 ===');
console.log(`경로    : ${version.path}  (${version.kind})`);
console.log(`항목 수 : ${version.items}`);
console.log(`sha256  : ${version.sha256}`);
console.log(
  `채점    : ${version.scoredItems}장 / ${version.scoredFields}필드 ` +
    `(도달 가능 ${version.reachableFields}, 도달 불가 ${version.scoredFields - version.reachableFields})`,
);
console.log(`제외    : ${version.skippedItems}장`);
console.log('판본(항목 수·sha256)이 다르면 숫자끼리 비교하지 마라. 파서 탓인지 정답표 탓인지 갈리지 않는다.');

console.log('');
for (const s of skipped) console.log(`  제외 ${s.id}: ${s.why}`);

console.log('\n=== 필드별 정답률 ===');
console.log('도달 가능 = 정답이 visible_lines 안에 글자로 있는 필드. 규칙으로 닿을 수 있는 최대치다.');
console.log('필드          도달가능 정답/분모  정답률    전체 정답/분모  정답률   도달불가');
// 한글 라벨은 터미널에서 두 칸을 먹으므로 폭을 미리 맞춰 넘긴다.
const row = (label, t) =>
  console.log(
    label +
      `${t.correctReachable}/${t.reachable}`.padStart(13) +
      '  ' +
      pct(t.correctReachable, t.reachable) +
      `${t.correct}/${t.total}`.padStart(14) +
      '  ' +
      pct(t.correct, t.total) +
      String(t.total - t.reachable).padStart(9),
  );
for (const f of FIELDS) row(f.padEnd(14), tally[f]);
row('전체'.padEnd(12), overall);

console.log('\n=== 오답 성격 ===');
console.log('필드          부분정답  오답(표시됨)  오답(조용)');
for (const f of FIELDS) {
  const t = tally[f];
  console.log(
    f.padEnd(14) + String(t.partial).padStart(8) + String(t.wrongFlagged).padStart(14) + String(t.wrongSilent).padStart(12),
  );
}
console.log(
  '전체'.padEnd(13) +
    String(overall.partial).padStart(8) +
    String(overall.wrongFlagged).padStart(14) +
    String(overall.wrongSilent).padStart(12),
);

console.log(`\n=== 도달 불가 (${unreachable.length}건) — 파서 규칙으로는 원리상 못 맞힌다 ===`);
for (const u of unreachable) {
  console.log(`[${u.id}] ${u.field}: 기대 ${JSON.stringify(u.want)} 가 visible_lines 에 없음  (판형: ${u.notes ?? '(없음)'})`);
}

console.log(`\n=== 틀린 항목 (${misses.length}건) ===`);
for (const m of misses) {
  const mark = m.verdict === 'partial' ? '부분' : '오답';
  const reach = m.reachable ? '' : ' [도달 불가]';
  console.log(`\n[${m.id}] ${m.field} ${mark}${m.flagged ? ' (weak 표시됨)' : ' (조용히 틀림)'}${reach}`);
  console.log(`  기대: ${JSON.stringify(m.want)}`);
  console.log(`  실제: ${JSON.stringify(m.got)}`);
  console.log(`  판형: ${m.notes ?? '(없음)'}`);
}
