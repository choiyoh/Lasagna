import type { DateValue } from '@nopsidian/core/db';
import { addDays, ymd } from './date-util';

/** 끌기 종류: 막대 본체 옮기기 / 왼쪽 끝 늘이기 / 오른쪽 끝 늘이기 */
export type DragMode = 'move' | 'resize-start' | 'resize-end';

/** 픽셀 이동량(dx)을 일 단위로 바꾼다. 반올림하며, `pxPerDay` 를 나눌 수 없으면 0 */
export function dxToDays(dx: number, pxPerDay: number): number {
  if (!Number.isFinite(pxPerDay) || pxPerDay <= 0) return 0;
  return Math.round(dx / pxPerDay);
}

/**
 * 끌기 결과: 원래 기간(`start`·`end` 는 포함 날짜)과 모드, 이동 일수 → 새 기간.
 * - move: start·end 를 같은 일수만큼 옮긴다
 * - resize-start: start 만 움직이고 end 를 넘지 못한다(end 로 붙는다)
 * - resize-end: end 만 움직이고 start 아래로 내려가지 못한다
 */
export function applyDrag(span: { start: Date; end: Date }, mode: DragMode, days: number): { start: Date; end: Date } {
  if (mode === 'move') return { start: addDays(span.start, days), end: addDays(span.end, days) };
  if (mode === 'resize-start') {
    const start = addDays(span.start, days);
    return { start: start > span.end ? span.end : start, end: span.end };
  }
  const end = addDays(span.end, days);
  return { start: span.start, end: end < span.start ? span.start : end };
}

/**
 * 새 기간을 셀 값으로. `time`(`HH:mm`)이 있으면 start·end 모두 그 시각을 유지한다.
 * 하루짜리(start = end)면 `{ start }` 만, 여러 날이면 `{ start, end }`. 날짜는 `YYYY-MM-DD`.
 */
export function spanToValue(next: { start: Date; end: Date }, time: string | null): DateValue {
  const t = time ? `T${time}` : '';
  const start = ymd(next.start);
  const end = ymd(next.end);
  return start === end ? { start: start + t } : { start: start + t, end: end + t };
}
