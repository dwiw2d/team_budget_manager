import test from 'node:test';
import assert from 'node:assert/strict';
import { linesToFields } from './synth-fields.mjs';
import { linesFromFields } from './clova-general-extract.mjs';

test('두 줄이 파서에서 다시 두 줄로 재구성된다', () => {
  const lines = ['상호: 동남집', '합계 59,000'];
  const got = linesFromFields(linesToFields(lines));

  assert.equal(got.length, 2);
  assert.deepEqual(got.map((l) => l.text), lines);
});

test('lineBreak 는 줄의 마지막 토막에만 붙는다', () => {
  const fields = linesToFields(['상호: 동남집', '합계 59,000']);

  assert.deepEqual(fields.map((f) => f.inferText), ['상호:', '동남집', '합계', '59,000']);
  assert.deepEqual(fields.map((f) => f.lineBreak), [false, true, false, true]);
});

test('넓은 공백은 좌우 단으로 갈라져 파서의 "오른쪽 끝 토막" 문턱을 넘는다', () => {
  const [line] = linesFromFields(linesToFields(['홍길동 (TEL:02-123-4567)        동남집']));

  const last = line.words[line.words.length - 1];
  const prev = line.words[line.words.length - 2];
  assert.equal(last.text, '동남집');
  assert.ok(last.left - prev.right >= last.height * 2, `단 간격 ${last.left - prev.right}px 이 너무 좁다`);
});

test('한 칸 공백은 같은 단으로 남는다', () => {
  const [line] = linesFromFields(linesToFields(['합계 59,000']));

  const [first, second] = line.words;
  assert.ok(second.left - first.right < second.height * 2);
});

test('빈 줄은 좌표만 차지하고 토막을 만들지 않는다', () => {
  const got = linesFromFields(linesToFields(['첫 줄', '', '셋째 줄']));

  assert.deepEqual(got.map((l) => l.text), ['첫 줄', '셋째 줄']);
});
