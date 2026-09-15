/** 원 단위 정수를 "1,234,567원" 형식으로. 음수는 "-1,234원". */
export function formatWon(n: number): string {
  return `${n.toLocaleString("ko-KR")}원`;
}
