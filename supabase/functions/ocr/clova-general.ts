// CLOVA General OCR 응답 -> { merchant, paidAt, amount, cardNumber, weak } 순수 변환.
// 네트워크·Deno 의존성 없음. 입력은 응답의 images[0].fields 배열.
// Edge Function(index.ts), Vitest(clova-general.test.ts), 벤치 스크립트가 모두 이 파일을 쓴다.
//
// 확인한 응답 규격 (2026-09-16 실제 응답으로 확인):
//   https://api.ncloud-docs.com/docs/ai-application-service-ocr-ocr
//   fields[].inferText        인식한 글자
//   fields[].inferConfidence  0~1
//   fields[].type             NORMAL | MULTI_BOX | CHECKBOX
//   fields[].lineBreak        이 조각이 한 줄의 마지막이면 true
//   fields[].boundingPoly.vertices  [{x,y} x4] — 기울어진 사각형이라 축 정렬이 아니다
//
// 실제 응답에서 배운 것: lineBreak 는 "사람이 보는 한 줄"이 아니라 CLOVA 가 한 번에 읽은
// 조각 묶음이다. 영수증처럼 좌우로 나뉜 표는 라벨("합계:")과 값("59,000원")이 서로 다른
// lineBreak 묶음으로 떨어져 나오고, 묶음이 나오는 순서도 위->아래가 아니다.
// 그래서 lineBreak 묶음을 세로 중심으로 다시 정렬해 겹치는 것끼리 한 줄로 합친다.

export interface OcrField {
  inferText?: string;
  lineBreak?: boolean;
  boundingPoly?: { vertices?: Array<{ x: number; y: number }> };
}

interface Word {
  text: string;
  left: number;
  right: number;
  top: number;
  height: number;
  mid: number;
}

export interface Line {
  text: string;
  words: Word[];
  top: number;
  height: number;
}

export interface Extracted {
  merchant: string | null;
  /** YYYY-MM-DDTHH:mm:ss+09:00. 날짜를 못 읽으면 null. */
  paidAt: string | null;
  amount: number | null;
  cardNumber: string | null;
  /** 파서가 확신하지 못한 필드 이름들. Gemini 보완 대상이다(cardNumber 는 넣지 않는다). */
  weak: string[];
}

const KRW = /\d{1,3}(?:,\d{3})+|\d+/g;

// 금액 줄로 인정하는 낱말 (공백 제거 후 비교)
const AMOUNT_YES = ['합계', '총액', '받을금액', '결제금액', '판매금액', '카드매출', '총금액'];
// 금액 줄에서 빼는 낱말. YES 를 먼저 보므로 "결제금액" 이 "금액" 때문에 빠지지 않는다.
const AMOUNT_NO = ['부가세', '공급가', '단가', '금액', '과세물품', '면세', '봉사료', '거스름'];

const DATE_LABELS = ['거래일시', '승인일시', '판매시간', '거래일자', '승인일자', '결제일시'];

// 카드번호를 찾으면 안 되는 줄
const NOT_CARD = /사업자|TEL|전화|승인번호|VANKEY|가맹점번호|영수번호|일련번호/i;

// 상호가 될 수 없는 줄. 실제 영수증 두 장에서 파서를 속인 말들이 앞쪽에 있다.
//   - VAN사 안내 문구: "가맹점명/주소가 실제와 다른경우 신고안내(포상금 10만원 지급)"
//   - POS 표 머리글: "테이블명: 1T", "상품 단가 수량 금액"
const MERCHANT_BAD = new RegExp([
  '신고안내', '포상금', '여신금융협회', '가맹점명\\s*/', '주소가', '실제와\\s*다른',
  'KIS정보통신', '한국정보통신', '나이스', 'NICE', 'KICC', 'KSNET', 'KOVAN', '스마트로', '키스',
  '국민카드', '신한카드', '삼성카드', '현대카드', '롯데카드', '하나카드', 'BC카드', '비씨카드',
  '농협카드', '우리카드', '카카오뱅크',
  '테이블명', '판매사원', '영수번호', '상품', '단가', '수량', '금액', '품명',
  '사업자', '대표자', 'TEL', '전화', '주소', '합계', '부가세', '공급가', '카드', '할부', 'TID',
  'VANKEY', '일시', '시간', 'POS', '승인', '매출', '영수증', '전표', '고객용', '회원용', '알림',
].join('|'), 'i');
const ADDRESS = /^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)/;

const squash = (s: string): string => s.replace(/\s+/g, '');
const pad = (n: number): string => String(n).padStart(2, '0');

function box(field: OcrField) {
  const vs = field.boundingPoly?.vertices ?? [];
  const xs = vs.map((v) => v.x);
  const ys = vs.map((v) => v.y);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  return { left: Math.min(...xs), right: Math.max(...xs), top, height: bottom - top, mid: (top + bottom) / 2 };
}

/** 글자 조각 배열을 사람이 읽는 줄로 복원한다. */
export function linesFromFields(fields: OcrField[]): Line[] {
  // 1) lineBreak 묶음 = CLOVA 가 한 번에 읽은 조각들. 이건 쪼개지 않는다.
  const chunks: Word[][] = [];
  let cur: Word[] = [];
  for (const f of fields ?? []) {
    cur.push({ text: f.inferText ?? '', ...box(f) });
    if (f.lineBreak) {
      chunks.push(cur);
      cur = [];
    }
  }
  if (cur.length) chunks.push(cur);

  // 2) 묶음을 세로 중심으로 정렬해, 중심이 글자 높이 절반 안에 드는 것끼리 한 줄로 합친다.
  const sorted = chunks
    .map((ws) => ({
      words: ws,
      mid: ws.reduce((s, w) => s + w.mid, 0) / ws.length,
      height: Math.max(...ws.map((w) => w.height)),
    }))
    .sort((a, b) => a.mid - b.mid);

  const rows: Array<{ words: Word[]; mid: number; height: number }> = [];
  for (const chunk of sorted) {
    const row = rows[rows.length - 1];
    if (row && chunk.mid - row.mid <= Math.max(row.height, chunk.height) * 0.45) {
      row.words.push(...chunk.words);
      row.height = Math.max(row.height, chunk.height);
    } else {
      rows.push({ words: [...chunk.words], mid: chunk.mid, height: chunk.height });
    }
  }

  return rows.map((r) => {
    const words = r.words.sort((a, b) => a.left - b.left);
    return {
      text: words.map((w) => w.text).join(' '),
      words,
      top: Math.min(...words.map((w) => w.top)),
      height: r.height,
    };
  });
}

function lastNumber(text: string): number | null {
  const hits = text.match(KRW);
  if (!hits) return null;
  const n = Number(hits[hits.length - 1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** keyed=false 면 "합계" 같은 낱말 없이 "가장 큰 숫자" 규칙으로 고른 값이라 확신이 없다. */
function findAmount(lines: Line[]): { value: number | null; keyed: boolean } {
  const keyed: number[] = [];
  for (const l of lines) {
    const s = squash(l.text);
    if (!AMOUNT_YES.some((k) => s.includes(k))) continue; // YES 가 NO 보다 세다 ("합계금액(부가세포함)")
    const n = lastNumber(l.text);
    if (n !== null && n > 0) keyed.push(n);
  }
  if (keyed.length) {
    // 같은 값이 여러 번이면 그 값, 아니면 가장 많이 나온 값.
    const tally = new Map<number, number>();
    for (const n of keyed) tally.set(n, (tally.get(n) ?? 0) + 1);
    return { value: [...tally].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0], keyed: true };
  }

  // 키워드 줄이 없을 때: 날짜/전화/사업자/승인/카드번호처럼 보이는 줄을 걸러내고 남은 금액 중 최댓값.
  let best: number | null = null;
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
  return { value: best, keyed: false };
}

/** 줄에서 날짜만 찾아 YYYY-MM-DD 로. 시각은 따로 찾는다(다른 조각으로 쪼개져 나오기 때문). */
function parseDate(text: string): string | null {
  const forms = [
    /(?<!\d)(\d{4})[-.\/](\d{1,2})[-.\/](\d{1,2})(?!\d)/, // 2026-09-15
    /(?<!\d)(\d{4})(\d{2})(\d{2})(?!\d)/, // 20260915
    /(?<!\d)(\d{2})[-.\/](\d{2})[-.\/](\d{2})(?!\d)/, // 26/09/04
  ];
  for (const re of forms) {
    const m = text.match(re);
    if (!m) continue;
    const [, y, mo, d] = m;
    if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31) continue;
    return `${y.length === 2 ? 2000 + Number(y) : Number(y)}-${pad(Number(mo))}-${pad(Number(d))}`;
  }
  return null;
}

// "12:38:31" 도 "12:38: 27" 도 받는다. 뒤쪽은 "12:38:" 과 "27" 이 다른 조각으로 나뉜 경우다.
const TIME = /(?<!\d)([01]?\d|2[0-3])\s*:\s*([0-5]\d)(?:\s*:\s*([0-5]\d))?(?!\d)/;

function parseTime(text: string | undefined): string | null {
  const m = text?.match(TIME);
  return m ? `${pad(Number(m[1]))}:${m[2]}:${m[3] ?? '00'}` : null;
}

/** hasTime=false 면 시각을 못 찾아 00:00:00 으로 채운 것이라 확신이 없다. */
function findPaidAt(lines: Line[]): { value: string | null; hasTime: boolean } {
  const labelled: number[] = [];
  const rest: number[] = [];
  lines.forEach((l, i) => (DATE_LABELS.some((k) => squash(l.text).includes(k)) ? labelled : rest).push(i));

  for (const i of [...labelled, ...rest]) {
    const date = parseDate(lines[i].text);
    if (!date) continue;
    // 날짜를 찾은 줄에 시각이 없으면 이웃 줄까지 본다. 그래도 없을 때만 자정으로 둔다.
    const time = parseTime(lines[i].text) ?? parseTime(lines[i + 1]?.text) ?? parseTime(lines[i - 1]?.text);
    return { value: `${date}T${time ?? '00:00:00'}+09:00`, hasTime: time !== null };
  }
  return { value: null, hasTime: false };
}

function findCardNumber(lines: Line[]): string | null {
  let best: string | null = null;
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

/** 상호로 쓸 만한 글자인지. 아니면 비워 두는 편이 낫다. */
function merchantOk(text: string): boolean {
  const v = text.trim();
  if (v.length < 2 || v.length > 20) return false;
  if (/[[\]]/.test(v)) return false; // "[고객용]" 같은 말머리
  if (/\d{3}/.test(v)) return false; // 번호·금액이 섞인 줄
  if ((v.match(/[가-힣A-Za-z]/g) ?? []).length < 2) return false;
  return !ADDRESS.test(v) && !MERCHANT_BAD.test(v);
}

function findMerchant(lines: Line[]): string | null {
  // (a) "상호:" / "가맹점명:" 라벨 값. 콜론이 있어야 한다 — 콜론을 안 따지면 VAN 안내 문구
  //     "가맹점명/주소가 실제와 다른경우" 가 통째로 상호로 잡힌다.
  for (const l of lines) {
    const m = l.text.match(/(?:가맹점\s*명|상\s*호)\s*[:：]\s*(.+)$/);
    if (m && merchantOk(m[1])) return m[1].trim();
  }

  // (b) 대표자/TEL 이 있는 줄의 오른쪽 끝 토막. 위쪽이 VAN 안내 문구로 덮인 카드 승인전표는
  //     상호가 "홍길동 (TEL:...)        동남집" 처럼 여기에만 찍힌다.
  //     가로로 확 떨어져 있어야(빈칸 두 글자 이상) 오른쪽 단으로 본다.
  for (const l of lines) {
    if (!/대표자|TEL|전화/i.test(l.text)) continue;
    const last = l.words[l.words.length - 1];
    const prev = l.words[l.words.length - 2];
    if (!last || !prev || last.left - prev.right < last.height * 2) continue;
    if (last.text === l.text.match(/대표자\s*[:：]?\s*(\S+)/)?.[1]) continue; // 대표자 이름은 상호가 아니다
    if (merchantOk(last.text)) return last.text.trim();
  }

  // (c) 사업자번호 줄 바로 위 줄. POS 영수증은 제목 / 상호 / 사업자번호 순서로 찍힌다.
  const i = lines.findIndex((l) => squash(l.text).includes('사업자번호'));
  if (i > 0 && merchantOk(lines[i - 1].text)) return lines[i - 1].text.trim();

  return null; // 확신이 없으면 비워 둔다. Gemini 나 사용자가 채운다.
}

/** fields -> 네 필드 + weak. 확신 없으면 그 항목만 null 이고, 이름이 weak 에 들어간다. */
export function extract(fields: OcrField[]): Extracted {
  const lines = linesFromFields(fields);
  const merchant = findMerchant(lines);
  const amount = findAmount(lines);
  const paidAt = findPaidAt(lines);

  const weak: string[] = [];
  if (merchant === null) weak.push('merchant');
  if (amount.value === null || !amount.keyed) weak.push('amount');
  if (paidAt.value === null || !paidAt.hasTime) weak.push('paidAt');

  return {
    merchant,
    paidAt: paidAt.value,
    amount: amount.value,
    cardNumber: findCardNumber(lines), // 영수증에 원래 없는 경우가 많아 weak 에 넣지 않는다
    weak,
  };
}
