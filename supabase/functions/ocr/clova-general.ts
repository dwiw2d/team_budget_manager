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

// 금액 줄로 인정하는 낱말 (공백 제거 후 비교). 세 등급으로 나눈다 — 등급이 높은 쪽만 쓴다.
// 진료비·약제비 영수증은 한 표 안에 총액·공단부담·본인부담이 나란히 있어서, 등급 없이
// 다수결만 하면 '사용자가 낸 돈'이 아니라 '총액'이 뽑힌다. 그 값을 저장하면 카드 잔액이 틀어진다.
//
// 2등급 — 사용자가 실제로 낸 돈을 가리키는 라벨.
const AMOUNT_PAID = ['본인부담', '납부할금액', '수납금액', '받을금액', '받은금액', '결제금액', '결제요금', '결제액'];
// 1등급 — 어느 쪽인지 알 수 없는 총계 낱말.
const AMOUNT_SUM = ['합계', '카드매출', '총금액', '주문금액', '티켓정보', 'TOTAL'];
// 0등급 — 사용자가 낸 돈이 아닌 금액. 후보에서 빼지는 않는다(이것밖에 없는 영수증이 있다 —
// receipt-3 은 '판매금액' 으로만 21,000 을 적는다). '판매금액' 은 부가세를 뺀 공급가라
// 두 번 나오면 다수결로 이기므로 여기 둔다.
const AMOUNT_OTHER = ['총액', '공단부담', '보험자부담', '비급여', '급여', '판매금액'];
const AMOUNT_TIERS = [AMOUNT_OTHER, AMOUNT_SUM, AMOUNT_PAID];
// 금액 줄에서 빼는 낱말. 위 세 등급을 먼저 보므로 "결제금액" 이 "금액" 때문에 빠지지 않는다.
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
  '사업자', 'TEL', '전화', '주소', '합계', '부가세', '공급가', '카드', '할부', 'TID',
  // '대표자' 는 합성어라 상호에 거의 안 나오므로 낱말 째로 거른다.
  // '대표'/'사장'/'점장'/'담당'/'계산원' 은 상호 안에 박히는 일이 흔해(대표과일, 김사장네 곱창)
  // 여기 두면 멀쩡한 상호를 버린다. 아래 MERCHANT_ROLE 에서 따로 본다.
  '대표자',
  'VANKEY', '일시', '시간', 'POS', '승인', '매출', '영수증', '전표', '고객용', '회원용', '알림',
  // 배달앱 주문내역 화면. 상호 자리에 UI 버튼과 안내 문구가 올라온다.
  '가게보기', '지도보기', '주문내역', '완료',
].join('|'), 'i');
// 사업자등록번호 모양. 라벨 없이 번호만 찍는 영수증이 많다.
const BIZNO = /\b\d{3}-\d{2}-\d{5}\b/;
// 번호 모양이 아니어도 라벨만으로 자리를 알 수 있다("사업자등록번호:7436000775").
const BIZNO_LABEL = /사업자(등록)?번호/;
// 토막에 라벨과 번호 말고 다른 것이 섞였는지 볼 때 쓴다(onlyBiznoLine).
const BIZNO_G = new RegExp(BIZNO.source, 'g');
const BIZNO_LABEL_ONLY = /^사업자(등록)?번호[:：]?$/;
// 시/도 이름으로 '시작'하는 주소. 이름 뒤에 행정 접미사나 공백이 와야 주소로 본다 —
// 그냥 접두어로만 보면 '서울법인115'·'강원대학교병원'·'제주도횟집' 같은 진짜 상호를 버린다.
const ADDRESS =
  /^(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)(?:특별자치시|특별자치도|특별시|광역시|시|도)?(?=\s|$|\d)/;
// ADDRESS 는 시/도 이름으로 '시작'하는 주소만 거른다. "성남시 분당구 황새울로" 처럼 시/도가 빠진
// 주소도 상호 자리에 올라오므로 하나 더 본다. 단 '…동/…로/…길' 로 끝나는 토막은 세지 않는다 —
// 한국 상호는 동네 이름으로 끝나는 일이 흔하고('정성스시 방배동'), 무엇보다 '시' 가 '스시' 를 잡는다.
// 대신 주소에만 나오는 차례, 곧 '…시/군' 다음에 '…구/군/읍/면' 이 오는 꼴만 주소로 본다.
// 첫 토막에서 '…스시'·'…장군' 은 뺀다. 한국 상호에 흔해('회전스시 서면', '이순신장군 냉면')
// 지명의 '시/군' 으로 오인되지만, 그렇게 끝나는 시·군 이름은 없어 진짜 주소는 그대로 걸린다.
const ADDRESS_FULL = /(^|\s)[가-힣]{2,}((?<!스)시|(?<!장)군)\s+\S+(구|군|읍|면)(\s|$)/;
const looksAddress = (v: string): boolean => ADDRESS.test(v) || ADDRESS_FULL.test(v);

// 영수증 위아래에 찍히는 인사말·안내 문구. 상호가 아닌데 merchantOk 를 통과해
// 앵커 없는 (d) 경로에서 상호 자리로 올라온다. 두 갈래로 나눠 본다.
// (1) 존댓말 종결어미와 안내 낱말은 상호에 안 쓰이므로 어디에 있든 거른다
//     ('…니다'/'…세요' 는 '사장님이미쳤어요' 같은 진짜 상호를 건드리지 않는다).
const NOTICE = /니다|세요|교환|환불|적립|반품/;
// (2) '감사'·'고객' 은 상호에도 쓰인다(감사식당, 고객만족센터). 그 말뿐인 단독 문장일 때만 거른다.
const NOTICE_ALONE = /^(?:감사|고객|고객님|안내)[.!]?$/;

// 사람 역할을 가리키는 말. 사업자번호 줄 위아래에 상호 대신 "대표 홍길동" 이 오는 영수증이 있다.
// 한글에는 \b 가 없어 부분 문자열로 걸면 '대표과일'·'계산원조갈비'까지 버린다. 그래서
// (1) 역할어 앞이 줄머리나 공백이고 (2) 뒤에 공백이나 콜론으로 떨어진 사람 이름이 올 때만 건다.
const MERCHANT_ROLE = /(^|\s)(대표|사장|점장|담당|계산원)(\s*[:：]\s*|\s+)[가-힣]{2,5}(\s|$)/;
// 칸이 갈라져 역할어만 남은 것. 이름은 오른쪽 칸에 있어 MERCHANT_ROLE 이 못 본다.
const ROLE_ONLY = /^(?:대표|사장|점장|담당|계산원)[:：]?$/;

const squash = (s: string): string => s.replace(/\s+/g, '');
// "대 표 자 명" 처럼 한 글자씩 벌려 찍은 자간 공백을 도로 붙인다. 안 붙이면 MERCHANT_BAD 의
// '대표자'·'상품' 같은 낱말이 통째로 빗나가 안내문·표 머리글이 상호로 올라온다.
// 한 글자짜리 토막이 셋 이상 이어질 때만 붙이므로 '김사장네 곱창' 같은 상호는 그대로 둔다.
const deKern = (v: string): string =>
  v.replace(/(^|\s)(\S(?: \S){2,})/g, (_m, head: string, run: string) => head + run.replace(/ /g, ''));
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

/**
 * 라벨 등급. 라벨이 없으면 -1. 여러 등급이 섞인 줄은 높은 쪽을 따른다.
 * 입력은 공백을 지운 뒤 대문자로 올린 글자다 — '결 제 액' 같은 자간 공백도,
 * 소문자 'Total' 도 같은 라벨로 읽힌다.
 */
function amountTier(squashed: string): number {
  for (let t = AMOUNT_TIERS.length - 1; t >= 0; t -= 1) {
    if (AMOUNT_TIERS[t].some((k) => squashed.includes(k))) return t;
  }
  return -1;
}

/** keyed=false 면 "합계" 같은 낱말 없이 "가장 큰 숫자" 규칙으로 고른 값이라 확신이 없다. */
function findAmount(lines: Line[]): { value: number | null; keyed: boolean } {
  const keyed: Array<{ tier: number; value: number }> = [];
  for (const l of lines) {
    const tier = amountTier(squash(l.text).toUpperCase()); // 등급이 NO 보다 세다 ("합계금액(부가세포함)")
    if (tier < 0) continue;
    const n = lastNumber(l.text);
    if (n !== null && n > 0) keyed.push({ tier, value: n });
  }
  if (keyed.length) {
    // 가장 높은 등급만 남기고 그 안에서 다수결. 같은 표수면 큰 값 — 등급으로 이미 갈랐으므로
    // 여기 남은 것들은 같은 뜻의 금액이고, 큰 쪽이 부분합이 아닌 총계일 때가 많다.
    const top = Math.max(...keyed.map((k) => k.tier));
    const tally = new Map<number, number>();
    for (const k of keyed) if (k.tier === top) tally.set(k.value, (tally.get(k.value) ?? 0) + 1);
    return { value: [...tally].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0], keyed: true };
  }

  // 키워드 줄이 없을 때: 날짜/전화/사업자/승인/카드번호처럼 보이는 줄을 걸러내고 남은 금액 중 최댓값.
  // 천 단위 쉼표가 찍힌 숫자가 하나라도 있으면 그것만 본다. 영수증의 금액은 쉼표를 달고
  // 나오지만 사업자번호·전화번호·연도·수량·요금표는 달지 않는다. 최댓값을 고르기 전에
  // 금액이 될 수 없는 것을 이 한 가지로 걸러 낸다.
  const loose: number[] = [];
  const comma: number[] = [];
  for (const l of lines) {
    const s = squash(l.text);
    if (AMOUNT_NO.some((k) => s.includes(k))) continue;
    if (NOT_CARD.test(l.text) || DATE_LABELS.some((k) => s.includes(k))) continue;
    for (const raw of l.text.match(KRW) ?? []) {
      if (!raw.includes(',') && raw.length > 6) continue; // 승인번호·영수번호 같은 긴 맨숫자
      const n = Number(raw.replace(/,/g, ''));
      if (n >= 100) (raw.includes(',') ? comma : loose).push(n);
    }
  }
  const pool = comma.length ? comma : loose;
  return { value: pool.length ? Math.max(...pool) : null, keyed: false };
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

// 줄에서 상호 토막만 떼어내는 데 쓰는 것들.
// 영수증 한 줄은 로고 / 상호 / 전화번호처럼 가로로 여러 칸이 붙어 있는 일이 흔하다.
// 줄을 통째로 상호 후보로 쓰면 길이·숫자 조건에 걸려 멀쩡한 상호까지 버려진다.

/** 괄호로 묶은 번호. "CGV 광양(104-81-45690)" 의 꼬리를 뗀다. */
const PAREN_NUMBER = /\(\s*[\d\s*.-]{3,}\)/g;
// 토막 안에서 상호가 아닌 낱말: 대괄호 말머리·마스킹, 전화 접두, 기호뿐인 낱말.
// 기호뿐인 낱말에서 숫자는 뺀다 — 숫자를 여기서 버리면 "No 001-22-33444" 가 "No" 로 줄어
// 영수번호 줄이 상호로 통과한다. 숫자는 아래 NOT_MERCHANT_WORD 에서만 버린다.
const NOT_MERCHANT_PLAIN = /^\[[^\]]*\]$|^\(?(?:TEL|Tel|T)[.:)]|^[^가-힣A-Za-z0-9]+$/;
// 숫자 3자리 이상인 낱말: 전화번호·사업자번호·바코드.
const NOT_MERCHANT_NUMBER = /(?:\d[^\d]*){3}/;
const hasHangul = (s: string): boolean => /[가-힣]/.test(s);

/**
 * 낱말마다 몇 번째 토막에 드는지. 가로로 글자 높이의 2배 넘게 벌어지면 다음 토막으로 본다.
 * 기준은 findMerchant (b) 와 같아야 한다 — 두 곳이 어긋나면 안 된다.
 */
function segmentIndex(line: Line): number[] {
  let n = 0;
  return line.words.map((w, i) => {
    const prev = line.words[i - 1];
    if (prev && w.left - prev.right >= Math.max(prev.height, w.height) * 2) n += 1;
    return n;
  });
}

/** 한 줄을 가로로 벌어진 자리에서 토막 낸다. */
function segments(line: Line): string[] {
  const seg = segmentIndex(line);
  const out: string[] = [];
  line.words.forEach((w, i) => {
    if (i > 0 && seg[i] === seg[i - 1]) out[out.length - 1] += ' ' + w.text;
    else out.push(w.text);
  });
  return out;
}

/**
 * 토막에서 상호가 아닌 낱말을 지운다. 남는 것이 없으면 빈 문자열.
 * dropNumbers 는 '숫자 3자리 이상인 낱말'까지 버릴지다. 줄이 한 칸뿐이면 끄고 부른다 —
 * 켜 두면 "강남구 압구정로 165" 에서 번지만 빠져 주소가 상호로 통과한다.
 */
function cleanMerchant(seg: string, dropNumbers: boolean): string {
  return seg
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.replace(PAREN_NUMBER, ''))
    .filter((w) => w && !NOT_MERCHANT_PLAIN.test(w) && !(dropNumbers && NOT_MERCHANT_NUMBER.test(w)))
    .join(' ');
}

/**
 * 한 줄에서 상호로 쓸 토막을 고른다. 없으면 null.
 * 한글이 든 토막이 하나라도 있으면 한글 없는 토막(순수 영문 로고, 번호 칸)은 버린다 —
 * "emart   이마트 신촌점 (02)-116-1219" 의 'emart' 가 상호로 뽑히는 것을 막는다.
 * (테스트에서 직접 부른다)
 */
export function merchantFromLine(line: Line): string | null {
  // 줄 통째로도 상호로 쓸 만하면 그대로 쓴다. 넓게 띄어 쓴 상호("롯데쇼핑(주)      잠실 점")를
  // 토막으로 갈라 앞부분만 집는 것을 막는다.
  // 도장·기호처럼 한 글자만 찍힌 칸은 빼고 본다(영수증 오른쪽 끝의 '송').
  const segs = segments(line);
  const whole = segs.filter((x) => squash(x).length > 1).join(' ');
  if (whole && merchantOk(whole)) return whole.trim();

  const korean = segs.some(hasHangul);
  for (let i = 0; i < segs.length; i += 1) {
    const seg = segs[i];
    if (korean && !hasHangul(seg)) continue;
    // 토막 하나가 통째로 라벨이나 역할어면 상호가 아니다("대표     김유나" 의 왼쪽 칸).
    // 게다가 그 오른쪽 칸은 그 라벨의 값이다 — 사람 이름·주소·번호지 상호가 아니다.
    const sq = squash(seg);
    if (MERCHANT_LABEL.test(sq)) continue;
    if (NEXT_LABEL.test(sq) || ROLE_ONLY.test(sq)) {
      i += 1;
      continue;
    }
    const v = cleanMerchant(seg, segs.length > 1);
    if (v && merchantOk(v)) return v.trim();
  }
  return null;
}

/**
 * 사업자번호가 상호와 같은 줄일 때, 그 번호가 든 칸의 왼쪽을 상호로 본다.
 * "이마트 탄현점 128-85-48537 대표: 최병훈" -> "이마트 탄현점".
 * 번호가 제 칸의 맨 앞이면(= 왼쪽이 비었으면) 아무것도 돌려주지 않는다 —
 * "손은주   669-56-00790" 의 대표자 이름을 상호로 집는 것을 막는다.
 */
function merchantBeforeBizno(line: Line): string | null {
  const at = line.words.findIndex((w) => BIZNO.test(w.text));
  if (at < 0) return null;
  const seg = segmentIndex(line);
  let from = at;
  while (from > 0 && seg[from - 1] === seg[at]) from -= 1;
  if (from === at) return null; // 번호가 제 칸의 맨 앞이다
  const text = line.words
    .slice(from, at + 1)
    .map((w) => w.text)
    .join(' ')
    .replace(PAREN_NUMBER, '')
    .replace(new RegExp(BIZNO.source, 'g'), '');
  const v = cleanMerchant(text, false);
  return v && merchantOk(v) ? v.trim() : null;
}

// 상호를 가리키는 라벨. 자간 공백을 지운 뒤 비교하므로 '상  호'·'가 맹 점 명' 도 걸린다.
// 낱말 하나가 통째로 라벨일 때만 인정한다 — 뒤에 다른 글자가 붙으면 라벨이 아니다.
// 그래야 VAN 안내 문구 "가맹점명/주소가 실제와 다른경우" 가 라벨로 읽히지 않는다.
const MERCHANT_LABEL =
  /^(?:가맹점명|가맹점|상호|매장|점명|영화관|주문매장|판매자상호|공급자상호|법인명)(?:\(.*\))?[:：]?$/;
// 값을 어디서 끊을지. 다음 라벨이 시작되면 거기까지가 상호다.
const NEXT_LABEL = new RegExp(
  '^(?:성명|대표자명|대표자|사업자등록번호|사업자번호|사업자|사업장소재지|사업장|소재지|' +
    '전화번호|전화|주소|업태|종목|발행일|승인번호|거래일시)(?:\(.*\))?[:：]?$',
);

/**
 * 낱말 i 부터 라벨 하나를 읽는다. 읽었으면 값이 시작하는 자리를, 아니면 -1.
 * 가장 길게 걸리는 쪽을 쓴다 — '가 맹 점 명:' 이 '가맹점' 에서 멈추면 값이 '명: …' 이 된다.
 */
function labelEnd(words: string[], i: number, re: RegExp): number {
  let acc = '';
  let end = -1;
  for (let j = i; j < words.length && j < i + 4; j++) {
    acc += squash(words[j]);
    if (re.test(acc)) end = j + 1;
  }
  return end;
}

/**
 * 상호로 쓸 만한 글자인지. 아니면 비워 두는 편이 낫다. (테스트에서 직접 부른다)
 * labelled=true 는 "상호:" 같은 라벨이 직접 가리킨 값이라는 뜻이다. 자리가 확실하니
 * 숫자 세 자리 규칙을 면제한다 — '서울법인115'·'153구포국수(선릉역점)' 같은 진짜 상호가 있다.
 */
export function merchantOk(text: string, labelled = false): boolean {
  const v = text.trim();
  // 상한은 실제로 본 가장 긴 상호('(유)아웃백스테이크하우스코리아 신대방점' 21자)보다 넉넉히 둔다.
  if (v.length < 2 || v.length > 25) return false;
  // 두 글자짜리 영문 토막은 상호가 아니라 말머리다. "No 001-22-33444" 의 'No' 가 그래서
  // 영수번호 줄을 상호로 통과시켰다. 한글이 든 두 글자('1호'·'본점')는 그대로 둔다.
  // 라벨이 가리킨 값은 면제한다 — 'CU'·'KT' 처럼 두 글자인 진짜 브랜드가 있다.
  if (!labelled && v.length === 2 && !hasHangul(v)) return false;
  if (/[[\]]/.test(v)) return false; // "[고객용]" 같은 말머리
  if (!labelled && /\d{3}/.test(v)) return false; // 번호·금액이 섞인 줄
  if ((v.match(/[가-힣A-Za-z]/g) ?? []).length < 2) return false;
  // 인사말·안내 문구 거름망은 앵커가 없어 자리로 추측할 때 쓰라고 만든 것이다. 라벨은 사람이
  // "여기가 상호다" 라고 명시한 것이므로 그 위에서 또 거르면 '또오세요분식' 같은 상호를 버린다.
  if (!labelled && NOTICE_ALONE.test(squash(v))) return false;
  // 자간 공백을 붙인 꼴로도 한 번 더 본다.
  return [v, deKern(v)].every(
    (x) =>
      !looksAddress(x) &&
      !MERCHANT_BAD.test(x) &&
      !MERCHANT_ROLE.test(x) &&
      (labelled || !NOTICE.test(x)),
  );
}

/** 라벨이 가리키는 상호를 뽑는다. 없으면 null. */
function labelledMerchant(line: Line): string | null {
  // 콜론에서 한 번 더 쪼갠다. "상호:동대문마트" 처럼 라벨과 값이 한 낱말로 붙어 나오기 때문이다.
  const words: string[] = [];
  const seg: number[] = [];
  const idx = segmentIndex(line);
  line.words.forEach((w, i) =>
    w.text.split(/([:：])/).forEach((part) => {
      if (part === '') return;
      words.push(part);
      seg.push(idx[i]);
    }),
  );

  for (let i = 0; i < words.length; i++) {
    const end = labelEnd(words, i, MERCHANT_LABEL);
    if (end < 0 || end >= words.length) continue;

    // 콜론은 라벨 낱말 끝에 붙거나 값 앞에 따로 찍힌다("상  호 : 값").
    const colon = /[:：]/.test(words.slice(i, end).join('')) || /^[:：]$/.test(words[end]);
    let v = end;
    if (/^[:：]$/.test(words[v])) v += 1; // 콜론만 따로 떨어진 낱말
    if (v >= words.length) continue;
    if (!colon && seg[v] === seg[end - 1]) continue; // 콜론이 없으면 가로로 떨어져 있어야 한다

    // 값은 줄 끝까지가 아니라 다음 라벨이나 다음 토막 앞까지다.
    const take: string[] = [];
    for (let j = v; j < words.length && seg[j] === seg[v]; j++) {
      if (j > v && labelEnd(words, j, NEXT_LABEL) > 0) break;
      take.push(words[j]);
    }
    const value = take.join(' ').trim();
    if (value && merchantOk(value, true)) return value;
  }
  return null;
}

/**
 * 앵커 줄이 라벨과 사업자등록번호'만'으로 이루어진 깨끗한 줄인지. 토막 기준으로 본다.
 * 라벨은 그 줄이 사업자번호 줄임을 말할 뿐, 윗줄이 상호임을 보장하지 않는다.
 * 그래서 확신은 라벨의 유무가 아니라 앵커 줄에 다른 것이 섞였는지로 가른다.
 */
function onlyBiznoLine(line: Line): boolean {
  return segments(line).every((seg) => {
    const rest = squash(seg).replace(BIZNO_G, '');
    return rest === '' || BIZNO_LABEL_ONLY.test(rest);
  });
}

/**
 * sure=false 면 라벨이 가리킨 값이 아니라 자리만 보고 고른 값이라 확신이 없다 —
 * 깨끗하지 않은 사업자번호 줄 언저리(c), 위로 더 올라간 줄(c2), 앵커 없이 맨 위 줄(d)이 그렇다.
 */
function findMerchant(lines: Line[]): { value: string | null; sure: boolean } {
  // (a) "상호:" / "가맹점명:" 같은 라벨의 값.
  //     콜론은 선택이다 — 표 칸이라 "상  호   열매약국" 처럼 공백으로만 떨어진 영수증이 많다.
  //     다만 콜론이 없으면 라벨 토막과 값 토막이 가로로 떨어져 있을 때만 인정한다.
  //     값은 줄 끝까지가 아니라 다음 라벨이나 다음 토막 앞까지만 자른다
  //     ("상호: 두리이비인후과    대표자: 홍정주" 에서 '두리이비인후과' 만).
  for (const l of lines) {
    const v = labelledMerchant(l);
    if (v) return { value: v, sure: true };
  }

  // (c) 사업자번호 줄 바로 위 줄. POS 영수증은 제목 / 상호 / 사업자번호 순서로 찍힌다.
  //     (b) 보다 먼저 본다 — 상호가 제 줄에 따로 있는데도 사업자번호 줄 오른쪽 끝의
  //     대표자 이름을 집어가는 일이 있다("321-98-76543 TEL)... 박민수").
  //     라벨 없이 번호만 찍는 영수증이 있어 '사업자번호' 글자와 번호 모양을 둘 다 본다.
  //     확신도는 라벨의 유무가 아니라 '앵커 줄에 다른 것이 섞였는지'로 가른다. 라벨은 그 줄이
  //     사업자번호 줄임을 말할 뿐, 윗줄이 상호임을 보장하지 않는다. 라벨과 번호뿐인 깨끗한 줄은
  //     POS 가 찍은 머리글이라 제목 / 상호 / 사업자번호 차례가 거의 지켜지지만, 다른 것이 섞인
  //     줄은 표 머리글이거나("사업자등록번호 가맹점 전화번호") 상호 칸이 더 붙은 줄이라
  //     ("사업자등록번호 895-38-00624 상 호") 윗줄이 안내문·표어인 일이 많다. 라벨 없이 3-2-5
  //     숫자 모양만 보고 찾은 줄도 마찬가지다 — 영수번호일 수 있다("No 001-22-33444").
  //     그래서 깨끗한 줄이 아니면 확신하지 않는다(sure=false) — 2단계 Gemini 가 교차 확인하고
  //     화면에도 "확인해 주세요" 가 뜬다.
  const i = lines.findIndex((l) => BIZNO_LABEL.test(squash(l.text)) || BIZNO.test(l.text));
  if (i >= 0) {
    const sure = BIZNO_LABEL.test(squash(lines[i].text)) && onlyBiznoLine(lines[i]);
    // 사업자번호가 상호와 같은 줄일 수도 있다. 윗줄보다 먼저 본다.
    const same = merchantBeforeBizno(lines[i]);
    if (same) return { value: same, sure };
    if (i > 0) {
      const above = merchantFromLine(lines[i - 1]);
      if (above) return { value: above, sure };
    }
  }

  // (b) 대표자/TEL 이 있는 줄의 오른쪽 끝 토막. 위쪽이 VAN 안내 문구로 덮인 카드 승인전표는
  //     상호가 "홍길동 (TEL:...)        동남집" 처럼 여기에만 찍힌다.
  //     가로로 확 떨어져 있어야(빈칸 두 글자 이상) 오른쪽 단으로 본다.
  for (const l of lines) {
    if (!/대표자|TEL|전화/i.test(l.text)) continue;
    const segs = segments(l);
    if (segs.length < 2) continue; // 가로로 확 떨어져 있어야 오른쪽 단으로 본다
    const last = segs[segs.length - 1];
    if (last === l.text.match(/대표자\s*[:：]?\s*(\S+)/)?.[1]) continue; // 대표자 이름은 상호가 아니다
    const v = cleanMerchant(last, true);
    if (v && merchantOk(v)) return { value: v.trim(), sure: true };
  }

  // (c2) 사업자번호 줄과 상호 사이에 로고·주소·전화가 끼어 있는 영수증. 위로 더 올라가 본다.
  //      상한을 두지 않으면 엉뚱한 줄까지 올라가 오탐이 난다. 자리만 보고 고른 값이라 확신하지 않는다.
  for (let up = 2; up <= 3 && i - up >= 0; up += 1) {
    const v = merchantFromLine(lines[i - up]);
    if (v) return { value: v, sure: false };
  }

  // (d) 라벨도 사업자번호도 없는 간이 영수증(배달앱 화면, 모바일 영수증). 맨 위 몇 줄에서 찾는다.
  //     한글이 든 후보를 먼저 쓴다 — 맨 윗줄은 'PARIS BAGUETTE' 같은 영문 로고인 일이 잦고
  //     한글 상호는 그 아래 줄에 따로 찍힌다. 줄 안에서 로고 토막을 버리는 규칙과 같은 뜻이다.
  //     확신은 못 하지만 비워 두는 것보다 낫다 — 2단계 Gemini 가 교차 확인하고 화면에도 표시된다.
  const top = lines.slice(0, 4).map(merchantFromLine).filter((v): v is string => v !== null);
  const pick = top.find(hasHangul) ?? top[0];
  if (pick) return { value: pick, sure: false };

  return { value: null, sure: false }; // 확신이 없으면 비워 둔다. Gemini 나 사용자가 채운다.
}

/** fields -> 네 필드 + weak. 확신 없으면 그 항목만 null 이고, 이름이 weak 에 들어간다. */
export function extract(fields: OcrField[]): Extracted {
  const lines = linesFromFields(fields);
  const merchant = findMerchant(lines);
  const amount = findAmount(lines);
  const paidAt = findPaidAt(lines);

  const weak: string[] = [];
  if (merchant.value === null || !merchant.sure) weak.push('merchant');
  if (amount.value === null || !amount.keyed) weak.push('amount');
  if (paidAt.value === null || !paidAt.hasTime) weak.push('paidAt');

  return {
    merchant: merchant.value,
    paidAt: paidAt.value,
    amount: amount.value,
    cardNumber: findCardNumber(lines), // 영수증에 원래 없는 경우가 많아 weak 에 넣지 않는다
    weak,
  };
}
