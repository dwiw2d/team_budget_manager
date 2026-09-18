// 글자 줄 배열 -> CLOVA General OCR 응답의 fields[] 모양. 순수 함수, 네트워크·파일 접근 없음.
// 파서(clova-general.ts)가 보는 것은 inferText / boundingPoly.vertices / lineBreak 셋뿐이라 그 셋만 만든다.
//
// 한계 — 이 파일이 만드는 좌표는 지어낸 것이다.
//   검증되는 것: 줄 재구성 규칙, 좌우 단 분리("오른쪽 끝 토막") 규칙, 라벨·정규식 규칙.
//   검증되지 않는 것: 실제 OCR 의 기울어진 사각형, 글자 오인식, lineBreak 묶음이 위->아래 순서가
//   아니게 뒤섞여 나오는 현상, 줄 사이 간격이 들쭉날쭉한 실사 영수증.
//   줄 재구성의 진짜 기준은 실제 응답 픽스처 3장(receipt-1/2/3)이고, 이 합성 입력은 그 위에
//   얹는 보조 자다. 여기서 100% 가 나와도 실제 인식률이 100% 라는 뜻이 아니다.

const DEFAULTS = {
  height: 26, // 글자 높이
  lineGap: 30, // 줄 간격(윗변 기준). height 보다 커야 파서가 두 줄로 본다.
  charWidth: 13, // 고정폭 가정
  startX: 0,
  startY: 0,
};

/**
 * @param {string[]} lines 위에서부터 본 글자 줄. 넓은 공백(2칸 이상)은 좌우 단 분리로 본다.
 * @param {Partial<typeof DEFAULTS> & {columnGap?: number}} [opts]
 * @returns {Array<{inferText: string, lineBreak: boolean, boundingPoly: {vertices: Array<{x: number, y: number}>}}>}
 */
export function linesToFields(lines, opts = {}) {
  const { height, lineGap, charWidth, startX, startY } = { ...DEFAULTS, ...opts };
  // 좌우 단 사이는 최소 이만큼 띄운다. 파서는 "빈칸이 글자 높이의 2배 이상"일 때만
  // 오른쪽 단으로 보므로(clova-general.ts findMerchant (b)) 그 문턱을 넘겨야 한다.
  const columnGap = opts.columnGap ?? height * 2.5;

  const fields = [];
  lines.forEach((line, row) => {
    const top = startY + row * lineGap;
    const bottom = top + height;
    let x = startX;
    let lastOfRow = null;

    for (const part of String(line).split(/(\s+)/)) {
      if (part === '') continue;
      if (/^\s+$/.test(part)) {
        x += part.length >= 2 ? Math.max(part.length * charWidth, columnGap) : charWidth;
        continue;
      }
      const left = x;
      const right = x + part.length * charWidth;
      lastOfRow = {
        inferText: part,
        lineBreak: false,
        boundingPoly: {
          vertices: [
            { x: left, y: top },
            { x: right, y: top },
            { x: right, y: bottom },
            { x: left, y: bottom },
          ],
        },
      };
      fields.push(lastOfRow);
      x = right;
    }

    if (lastOfRow) lastOfRow.lineBreak = true; // 줄의 마지막 토막에만 true
  });

  return fields;
}
