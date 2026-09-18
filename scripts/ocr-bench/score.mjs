// 영수증 카탈로그로 파서 인식률을 재는 채점기.
// 카탈로그의 visible_lines 를 합성 fields[] 로 바꿔 extract() 에 넣고 truth 와 맞춰 본다.
// CLOVA·Gemini API 는 한 번도 부르지 않는다. 이미지 파일도 읽지 않는다.
//
// 사용법: node scripts/ocr-bench/score.mjs [--json]
//   카탈로그 위치는 RECEIPT_CORPUS_DIR 로 바꿀 수 있다(기본 .local/receipt-corpus).
//
// 채점기 자체의 단위 테스트: node --test "scripts/ocr-bench/lib/*.test.mjs"
//   글로브를 따옴표로 묶어 Node 가 직접 펼치게 해라. Node 24 는
//   `node --test scripts/ocr-bench/lib/` 처럼 디렉터리를 주면 그 디렉터리를 테스트 모듈로
//   읽으려다 'test failed' 로 끝난다(v24.14.0 확인).
//
// 합성 입력의 한계는 lib/synth-fields.mjs 맨 위 주석 참고. 여기서 나오는 숫자는
// "파서 규칙이 이 판형을 다루는가"이지 "실제 사진으로 얼마나 맞히는가"가 아니다.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extract } from './lib/clova-general-extract.mjs';
import { linesToFields } from './lib/synth-fields.mjs';

const DIR = process.env.RECEIPT_CORPUS_DIR ?? '.local/receipt-corpus';
const CATALOG = join(DIR, 'catalog.json');
const FIELDS = ['merchant', 'paidAt', 'amount', 'cardNumber'];

if (!existsSync(CATALOG)) {
  console.error(`카탈로그가 없다: ${CATALOG}`);
  console.error('개인정보가 담긴 사진이라 저장소에 넣지 않는다. 수집본을 가진 워크트리의 경로를');
  console.error('RECEIPT_CORPUS_DIR 에 넣고 다시 실행해라.');
  console.error('  예: RECEIPT_CORPUS_DIR=../wolfeel/.local/receipt-corpus node scripts/ocr-bench/score.mjs');
  process.exit(2);
}

const squash = (v) => String(v).replace(/\s+/g, '');
// 마스킹 문자를 * 로 통일하고 숫자 자리만 남긴다. 구분자(-, 공백)는 버린다.
const cardDigits = (v) => String(v).replace(/[xX×✕✱＊·•●]/g, '*').replace(/[^0-9*]/g, '');

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

const catalog = JSON.parse(readFileSync(CATALOG, 'utf8'));
const tally = Object.fromEntries(
  FIELDS.map((f) => [f, { total: 0, correct: 0, partial: 0, wrongFlagged: 0, wrongSilent: 0 }]),
);
const misses = [];
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
    graded[field] = { want, got: got[field] ?? null, verdict, flagged };

    const t = tally[field];
    t.total += 1;
    if (verdict === 'correct') t.correct += 1;
    else if (verdict === 'partial') t.partial += 1;
    if (verdict !== 'correct') {
      if (flagged) t.wrongFlagged += 1;
      else t.wrongSilent += 1;
      misses.push({ id: item.id, field, want, got: got[field] ?? null, verdict, flagged, notes: item.layout_notes });
    }
  }
  perItem.push({ id: item.id, file: item.file, category: item.category, weak: got.weak, graded });
}

const overall = FIELDS.reduce(
  (a, f) => ({
    total: a.total + tally[f].total,
    correct: a.correct + tally[f].correct,
    partial: a.partial + tally[f].partial,
    wrongFlagged: a.wrongFlagged + tally[f].wrongFlagged,
    wrongSilent: a.wrongSilent + tally[f].wrongSilent,
  }),
  { total: 0, correct: 0, partial: 0, wrongFlagged: 0, wrongSilent: 0 },
);

const pct = (n, d) => (d === 0 ? '   -  ' : `${((n / d) * 100).toFixed(1).padStart(5)}%`);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ corpus: DIR, items: catalog.length, scored: perItem.length, skipped, tally, overall, misses, perItem }, null, 2));
  process.exit(0);
}

console.log(`카탈로그: ${CATALOG}  (${catalog.length}장 중 ${perItem.length}장 채점, ${skipped.length}장 제외)`);
for (const s of skipped) console.log(`  제외 ${s.id}: ${s.why}`);

console.log('\n=== 필드별 정답률 ===');
console.log('필드          정답/분모   정답률   부분정답  오답(표시됨)  오답(조용)');
for (const f of FIELDS) {
  const t = tally[f];
  console.log(
    f.padEnd(14) +
      `${t.correct}/${t.total}`.padStart(9) +
      '  ' + pct(t.correct, t.total) +
      String(t.partial).padStart(10) +
      String(t.wrongFlagged).padStart(14) +
      String(t.wrongSilent).padStart(12),
  );
}
console.log(
  '전체'.padEnd(13) +
    `${overall.correct}/${overall.total}`.padStart(9) +
    '  ' + pct(overall.correct, overall.total) +
    String(overall.partial).padStart(10) +
    String(overall.wrongFlagged).padStart(14) +
    String(overall.wrongSilent).padStart(12),
);

console.log(`\n=== 틀린 항목 (${misses.length}건) ===`);
for (const m of misses) {
  const mark = m.verdict === 'partial' ? '부분' : '오답';
  console.log(`\n[${m.id}] ${m.field} ${mark}${m.flagged ? ' (weak 표시됨)' : ' (조용히 틀림)'}`);
  console.log(`  기대: ${JSON.stringify(m.want)}`);
  console.log(`  실제: ${JSON.stringify(m.got)}`);
  console.log(`  판형: ${m.notes ?? '(없음)'}`);
}
