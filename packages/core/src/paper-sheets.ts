/** 원고지 1매 = 200자(20×10칸). */
export const PAPER_SHEET_CHARS = 200;

/**
 * 글자수 → 원고지 매수. 1매 = 200자이고 **소수 첫째 자리로 반올림**한다(Math.round(x*10)/10).
 * 입력은 지금 보고 있는 글자수(공백 포함/제외 설정값)를 그대로 쓴다.
 * 음수·NaN·무한대는 0매.
 */
export function paperSheets(chars: number): number {
  if (!Number.isFinite(chars) || chars <= 0) return 0;
  return Math.round((chars / PAPER_SHEET_CHARS) * 10) / 10;
}
