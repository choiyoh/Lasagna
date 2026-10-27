/**
 * 표가 쓸 수 있는 폭에 맞춰 열 폭을 정한다.
 *
 * 예전에는 속성 열을 180px 로 고정해서, 도크가 열린 1,440px 창(표 영역 880px)에서
 * 6번째 열이 0px 로 밀려나고도 스크롤바가 보이지 않았다(macOS 오버레이 스크롤바).
 * 가용 폭을 먼저 나누고, 남는 폭은 제목 열이 먹는다. 그래도 모자라면 가로로 스크롤한다.
 */
export const TITLE_BASE = 260;
export const COL_MIN = 128;
export const COL_MAX = 220;
/** 표 오른쪽에 남기는 여유(기존 합계의 +40). 마지막 열이 스크롤 가장자리에 붙지 않게 한다 */
export const ADD_COL_W = 40;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function columnWidths(
  available: number,
  columns: string[],
  title: string,
  explicit: Record<string, number> = {},
): { widths: Record<string, number>; total: number } {
  const avail = Number.isFinite(available) && available > 0 ? available : 0;
  const others = columns.filter((c) => c !== title);
  // 제목 열과 오른쪽 여유까지 빼고 나눈다. 128px 아래로는 줄이지 않고 가로 스크롤을 낸다.
  const base = others.length > 0 ? Math.round(clamp((avail - TITLE_BASE - ADD_COL_W) / others.length, COL_MIN, COL_MAX)) : COL_MIN;

  const widths: Record<string, number> = {};
  for (const c of columns) {
    const set = explicit[c];
    widths[c] = typeof set === 'number' && Number.isFinite(set) && set > 0 ? set : c === title ? TITLE_BASE : base;
  }

  const sumOf = () => Object.values(widths).reduce((n, w) => n + w, 0) + ADD_COL_W;
  // 사용자가 제목 열 폭을 직접 끌었으면 그 값을 존중한다.
  const titleIsSet = typeof explicit[title] === 'number' && Number.isFinite(explicit[title]) && explicit[title]! > 0;
  if (avail > sumOf()) {
    if (!titleIsSet && columns.includes(title)) {
      // 자동 제목 폭이면 남는 폭을 제목이 먹는다(빈 오른쪽 방지)
      const sumOthers = others.reduce((n, c) => n + widths[c]!, 0);
      widths[title] = Math.max(widths[title]!, avail - ADD_COL_W - sumOthers);
    } else {
      // 제목을 직접 좁혔으면 남는 폭을 자동 속성 열에 COL_MAX까지 나눈다(마지막 열부터).
      // 사용자가 끈 열 폭은 그대로 두고, 모든 열이 명시/상한이면 빈 여백을 남긴다.
      let left = avail - sumOf();
      for (let i = others.length - 1; i >= 0 && left > 0; i--) {
        const c = others[i]!;
        const set = explicit[c];
        if (typeof set === 'number' && Number.isFinite(set) && set > 0) continue;
        const room = COL_MAX - widths[c]!;
        if (room <= 0) continue;
        const add = Math.min(room, left);
        widths[c]! += add;
        left -= add;
      }
    }
  }
  const total = Math.max(avail, sumOf());
  return { widths, total };
}
