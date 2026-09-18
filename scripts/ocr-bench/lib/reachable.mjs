// 도달 가능 판정: 정답이 visible_lines 안에 글자로 실제 있는가.
// 없으면(로고로만 찍혔거나 그 크롭에 안 나온 경우) 어떤 파서 규칙으로도 못 맞힌다 —
// 2단계 Gemini 몫이다. 이 판정으로 분모를 갈라야 "규칙으로 닿을 수 있는 최대치"가 나온다.
//
// 필드마다 표기가 달라 아래처럼 정규화한 뒤 줄 단위로 포함 여부를 본다. 줄을 넘나드는
// 비교는 하지 않는다 — 정답이 두 줄에 걸치면 도달 불가 쪽으로 보수적으로 센다.
//   merchant   : 공백만 지우고 비교. 채점의 compare() 와 같은 잣대다.
//   amount     : 숫자만 남겨 비교. 21000 과 "합계 21,000원"(→"21000")이 같아진다.
//                자릿수가 칸으로 쪼개진 "4 4 0 0" 도 이어붙으면 잡히므로 도달 가능으로 센다.
//   cardNumber : compare() 와 같은 cardDigits() 로 마스킹 문자를 * 로 통일해 비교.
//   paidAt     : 날짜만 본다. 시각은 보지 않는다 — 채점이 날짜만 맞아도 부분 정답을 주기 때문이다.
//                "2021-04-19"·"2021년 4월 19일"·"21.04.19"·"20210419" 를 모두 같게 보려고
//                연(네 자리/두 자리)·월·일을 0 없는 형태까지 허용하는 정규식으로 맞춘다.
//
// 숫자를 이어붙이는 비교는 애매한 경우를 도달 가능 쪽으로 넉넉히 센다. 그러면 도달 가능
// 분모가 커져 정답률이 낮게 나오므로, 틀려도 "규칙으로 닿는 최대치"를 부풀리지 않는다.

export const squash = (v) => String(v).replace(/\s+/g, '');

// 마스킹 문자를 * 로 통일하고 숫자 자리만 남긴다. 구분자(-, 공백)는 버린다.
export const cardDigits = (v) => String(v).replace(/[xX×✕✱＊·•●]/g, '*').replace(/[^0-9*]/g, '');

export const digits = (v) => String(v).replace(/[^0-9]/g, '');

function normalizer(field) {
  if (field === 'merchant') return squash;
  if (field === 'cardNumber') return cardDigits;
  return digits;
}

function dateSeen(want, lines) {
  const [y, m, d] = String(want).slice(0, 10).split('-');
  if (!y || !m || !d || !/^\d{4}$/.test(y) || !Number(m) || !Number(d)) return false;
  const re = new RegExp(`(?<!\\d)(?:${y}|${y.slice(2)})\\D{0,2}0?${Number(m)}\\D{0,3}0?${Number(d)}(?!\\d)`);
  return lines.some((l) => re.test(l));
}

/** truth 가 visible_lines 안에 글자로 존재하는가. */
export function isReachable(field, want, lines) {
  if (field === 'paidAt') return dateSeen(want, lines);
  const needle = normalizer(field)(want);
  if (!needle) return false;
  return lines.some((l) => normalizer(field)(l).includes(needle));
}
