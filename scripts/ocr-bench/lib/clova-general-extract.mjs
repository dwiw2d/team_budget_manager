// CLOVA General OCR 응답 -> { merchant, paidAt, amount, cardNumber } 순수 변환.
// 네트워크 없음. 입력은 응답의 images[0].fields 배열.
//
// 확인한 응답 규격 (2026-09-16 확인):
//   https://api.ncloud-docs.com/docs/ai-application-service-ocr-ocr
//   fields[].inferText        인식한 글자
//   fields[].inferConfidence  0~1
//   fields[].type             NORMAL | MULTI_BOX | CHECKBOX
//   fields[].lineBreak        이 조각이 한 줄의 마지막이면 true
//   fields[].boundingPoly.vertices  [{x,y} x4]
// 미확인: fields 의 정렬 순서가 항상 읽는 순서라고 보장하는 문구는 못 찾았다.
//         그래서 lineBreak 뿐 아니라 세로 중심 좌표로도 줄을 끊는다.

const KRW = /\d{1,3}(?:,\d{3})+|\d+/g;

// 금액 줄로 인정하는 낱말 (공백 제거 후 비교)
const AMOUNT_YES = ['합계', '총액', '받을금액', '결제금액', '판매금액', '카드매출', '총금액'];
// 금액 줄에서 빼는 낱말. YES 를 먼저 보므로 "결제금액" 이 "금액" 때문에 빠지지 않는다.
const AMOUNT_NO = ['부가세', '공급가', '단가', '금액', '과세물품', '면세', '봉사료', '거스름'];

const DATE_LABELS = ['거래일시', '승인일시', '판매시간', '거래일자', '승인일자', '결제일시'];

// 카드번호를 찾으면 안 되는 줄
const NOT_CARD = /사업자|TEL|전화|승인번호|VANKEY|가맹점번호|영수번호|일련번호/i;

// 가맹점이 될 수 없는 말 (VAN사 / 카드사 / 말머리)
const NOT_MERCHANT = [
  'KIS정보통신', '키스', '나이스', 'NICE', 'KICC', '스마트로', '한국정보통신', 'KSNET', 'KOVAN',
  '국민카드', '신한카드', '삼성카드', '현대카드', '롯데카드', '하나카드', 'BC카드', '비씨카드',
  '농협카드', '우리카드', '카카오뱅크', '여신금융협회',
  '승인', '영수증', '전표', '고객용', '회원용', '가맹점용', '카드판매', '매출',
];
// 가맹점 후보에서 뺄 구조적인 줄
const MERCHANT_SKIP = /사업자|대표자|TEL|전화|주소|가맹점|합계|금액|부가세|공급가|카드|할부|TID|일시|시간|POS|\d{3}/i;
const ADDRESS = /^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)/;

const squash = (s) => s.replace(/\s+/g, '');

function box(field) {
  const vs = field.boundingPoly?.vertices ?? [];
  const xs = vs.map((v) => v.x);
  const ys = vs.map((v) => v.y);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  return { left: Math.min(...xs), right: Math.max(...xs), top, height: bottom - top, mid: (top + bottom) / 2 };
}

/** 글자 조각 배열을 사람이 읽는 줄로 복원한다. */
export function linesFromFields(fields) {
  const words = (fields ?? []).map((f) => ({ text: f.inferText ?? '', lineBreak: !!f.lineBreak, ...box(f) }));
  const lines = [];
  let cur = [];
  for (const w of words) {
    const prev = cur[cur.length - 1];
    // lineBreak 가 빠졌어도 세로 중심이 글자 높이의 60% 넘게 벌어지면 새 줄로 본다.
    if (prev && Math.abs(w.mid - prev.mid) > Math.max(prev.height, w.height) * 0.6) {
      lines.push(cur);
      cur = [];
    }
    cur.push(w);
    if (w.lineBreak) {
      lines.push(cur);
      cur = [];
    }
  }
  if (cur.length) lines.push(cur);

  return lines.map((ws) => {
    const sorted = [...ws].sort((a, b) => a.left - b.left);
    return {
      text: sorted.map((w) => w.text).join(' '),
      words: sorted,
      top: Math.min(...sorted.map((w) => w.top)),
      height: Math.max(...sorted.map((w) => w.height)),
    };
  });
}

function lastNumber(text) {
  const hits = text.match(KRW);
  if (!hits) return null;
  const n = Number(hits[hits.length - 1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function findAmount(lines) {
  const keyed = [];
  for (const l of lines) {
    const s = squash(l.text);
    if (!AMOUNT_YES.some((k) => s.includes(k))) continue; // YES 가 NO 보다 세다 ("합계금액(부가세포함)")
    const n = lastNumber(l.text);
    if (n !== null && n > 0) keyed.push(n);
  }
  if (keyed.length) {
    // 같은 값이 여러 번이면 그 값, 아니면 가장 많이 나온 값.
    const tally = new Map();
    for (const n of keyed) tally.set(n, (tally.get(n) ?? 0) + 1);
    return [...tally].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
  }

  // 키워드 줄이 없을 때: 날짜/전화/사업자/승인/카드번호처럼 보이는 줄을 걸러내고 남은 금액 중 최댓값.
  let best = null;
  for (const l of lines) {
    const s = squash(l.text);
    if (AMOUNT_NO.some((k) => s.includes(k))) continue;
    if (NOT_CARD.test(l.text) || DATE_LABELS.some((k) => s.includes(k))) continue;
    for (const raw of l.text.match(KRW) ?? []) {
      if (!raw.includes(',') && raw.length > 6) continue; // 승인번호·영수번호 같은 긴 맨숫자
      const n = Number(raw.replace(/,/g, ''));
      if (n >= 100 && (best === null || n > best)) best = n;
    }
  }
  return best;
}

const pad = (n) => String(n).padStart(2, '0');

function parseDate(text) {
  const forms = [
    // YYYY-MM-DD / YYYY.MM.DD / YYYY/MM/DD
    /(\d{4})[-.\/](\d{1,2})[-.\/](\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/,
    // YYYYMMDD
    /(?<!\d)(\d{4})(\d{2})(\d{2})(?!\d)(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/,
    // YY/MM/DD / YY-MM-DD / YY.MM.DD  -> 2000 년대
    /(?<!\d)(\d{2})[-.\/](\d{2})[-.\/](\d{2})(?!\d)(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/,
  ];
  for (const re of forms) {
    const m = text.match(re);
    if (!m) continue;
    let [, y, mo, d, hh = '0', mm = '0', ss = '0'] = m;
    const year = y.length === 2 ? 2000 + Number(y) : Number(y);
    if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31) continue;
    if (Number(hh) > 23 || Number(mm) > 59 || Number(ss) > 59) continue;
    return `${year}-${pad(Number(mo))}-${pad(Number(d))}T${pad(Number(hh))}:${pad(Number(mm))}:${pad(Number(ss))}+09:00`;
  }
  return null;
}

function findPaidAt(lines) {
  const labelled = lines.filter((l) => DATE_LABELS.some((k) => squash(l.text).includes(k)));
  for (const l of [...labelled, ...lines]) {
    const hit = parseDate(l.text);
    if (hit) return hit;
  }
  return null;
}

function findCardNumber(lines) {
  let best = null;
  let bestScore = 0;
  for (const l of lines) {
    if (NOT_CARD.test(l.text)) continue;
    for (const raw of l.text.match(/[0-9*][0-9*\-]{10,}[0-9*]/g) ?? []) {
      const digits = raw.replace(/[^0-9*]/g, '').length;
      const score = raw.includes('*') ? 2 : digits === 16 ? 1 : 0;
      if (score > bestScore) {
        best = raw;
        bestScore = score;
      }
    }
  }
  return best;
}

function findMerchant(lines) {
  // (a) "가맹점명" / "상호" 라벨 뒤 값
  for (const l of lines) {
    const m = l.text.match(/(?:가맹점명|상\s*호)\s*[:：]?\s*(.+)$/);
    if (!m) continue;
    const v = m[1].trim().replace(/^[\/:：]+/, '').trim();
    if (v && v.length <= 20 && !NOT_MERCHANT.some((k) => v.includes(k))) return v;
  }

  // (b) 상단 1/3 안에서 본문보다 글자가 큰 줄
  const tops = lines.map((l) => l.top);
  const cut = Math.min(...tops) + (Math.max(...tops) - Math.min(...tops)) / 3;
  const heights = [...lines.map((l) => l.height)].sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)];
  const big = lines
    .filter((l) => l.top <= cut && l.height > median)
    .filter((l) => !MERCHANT_SKIP.test(l.text) && !ADDRESS.test(l.text.trim()))
    .filter((l) => !NOT_MERCHANT.some((k) => l.text.includes(k)))
    .sort((a, b) => b.height - a.height);
  if (big.length) return big[0].text.trim();

  // (c) 대표자/TEL 줄의 오른쪽 끝 토막 (receipt-1 의 "손석민 (TEL:...)   동남집" 배치)
  for (const l of lines) {
    if (!/대표자|TEL|전화/i.test(l.text)) continue;
    const last = l.words[l.words.length - 1]?.text?.trim();
    if (last && /^[가-힣]{2,12}$/.test(last) && !NOT_MERCHANT.some((k) => last.includes(k))) return last;
  }

  return null;
}

/** fields -> { merchant, paidAt, amount, cardNumber }. 확신 없으면 그 항목만 null. */
export function extract(fields) {
  const lines = linesFromFields(fields);
  return {
    merchant: findMerchant(lines),
    paidAt: findPaidAt(lines),
    amount: findAmount(lines),
    cardNumber: findCardNumber(lines),
  };
}
