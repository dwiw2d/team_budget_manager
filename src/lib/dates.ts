/** KST(+09:00 고정, DST 없음) 기준 날짜 유틸. 브라우저 로컬 시간대에 의존하지 않는다. */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

const pad = (n: number) => String(n).padStart(2, "0");

/** ISO 시각을 KST 벽시계 성분으로 분해한다. month 는 1~12. */
function kstParts(iso: string | Date) {
  const t = new Date(new Date(iso).getTime() + KST_OFFSET_MS);
  return {
    y: t.getUTCFullYear(),
    m: t.getUTCMonth() + 1,
    d: t.getUTCDate(),
    hh: t.getUTCHours(),
    mm: t.getUTCMinutes(),
  };
}

/** 그 달 1일 00:00+09:00 부터 다음 달 1일 00:00+09:00 까지. paid_at gte/lt 조회용. */
export function monthRange(year: number, month: number) {
  const next = addMonths(year, month, 1);
  return {
    startIso: `${year}-${pad(month)}-01T00:00:00+09:00`,
    endIso: `${next.year}-${pad(next.month)}-01T00:00:00+09:00`,
  };
}

/** 월을 delta 만큼 이동한다(12월 → 다음 해 1월). */
export function addMonths(year: number, month: number, delta: number) {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

/** 오늘 날짜(KST) "YYYY-MM-DD". date input 기본값용. */
export function todayKst(now: Date = new Date()): string {
  const p = kstParts(now);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

/** ISO 시각 → datetime-local input 값 "YYYY-MM-DDTHH:mm"(KST). */
export function toDatetimeLocal(iso: string | Date): string {
  const p = kstParts(iso);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.hh)}:${pad(p.mm)}`;
}

/** datetime-local input 값 "YYYY-MM-DDTHH:mm" → ISO(+09:00). */
export function fromDatetimeLocal(local: string): string {
  return `${local.length === 16 ? `${local}:00` : local}+09:00`;
}

/** ISO 시각 → "9월 16일 14:05" (KST). */
export function formatKst(iso: string): string {
  const p = kstParts(iso);
  return `${p.m}월 ${p.d}일 ${pad(p.hh)}:${pad(p.mm)}`;
}

/** "2026년 9월" */
export function monthLabel(year: number, month: number): string {
  return `${year}년 ${month}월`;
}
