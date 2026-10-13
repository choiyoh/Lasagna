import { describe, expect, it } from 'vitest';
import { daysBetween, ymd } from './date-util';
import { applyDrag, dxToDays, spanToValue } from './timeline-math';

/** 로컬 자정 Date */
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d);
/** 기간을 `YYYY-MM-DD` 쌍으로 */
const span = (r: { start: Date; end: Date }): [string, string] => [ymd(r.start), ymd(r.end)];

describe('dxToDays', () => {
  it('픽셀 이동량을 일 단위로 반올림한다', () => {
    expect(dxToDays(0, 36)).toBe(0);
    expect(dxToDays(17, 36)).toBe(0); // 0.47일
    expect(dxToDays(18, 36)).toBe(1); // 0.5일
    expect(dxToDays(54, 36)).toBe(2);
    expect(dxToDays(60, 36)).toBe(2); // 1.67일
  });

  it('한 칸이 좁은 축(pxPerDay 가 작음)에서도 반올림한다', () => {
    expect(dxToDays(2, 4)).toBe(1); // 0.5일
    expect(dxToDays(9, 4)).toBe(2); // 2.25일
    expect(dxToDays(100, 4)).toBe(25);
  });

  it('음수 이동도 반올림한다', () => {
    expect(dxToDays(-20, 36)).toBe(-1); // -0.56일
    expect(dxToDays(-40, 36)).toBe(-1); // -1.11일
    expect(dxToDays(-54, 36)).toBe(-1); // -1.5일 (0.5는 +∞ 쪽으로 반올림)
    expect(dxToDays(-100, 4)).toBe(-25);
  });

  it('나눌 수 없는 pxPerDay 는 0일', () => {
    expect(dxToDays(50, 0)).toBe(0);
    expect(dxToDays(50, -4)).toBe(0);
    expect(dxToDays(50, Number.NaN)).toBe(0);
    expect(dxToDays(50, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('applyDrag — move', () => {
  it('start·end 를 같은 일수만큼 옮기고 기간 길이를 유지한다', () => {
    const s = { start: day(2026, 1, 15), end: day(2026, 1, 18) };
    const moved = applyDrag(s, 'move', 3);
    expect(span(moved)).toEqual(['2026-01-18', '2026-01-21']);
    expect(daysBetween(moved.start, moved.end)).toBe(daysBetween(s.start, s.end));
  });

  it('뒤로 옮기고, 0일이면 그대로다', () => {
    const s = { start: day(2026, 3, 10), end: day(2026, 3, 12) };
    expect(span(applyDrag(s, 'move', -5))).toEqual(['2026-03-05', '2026-03-07']);
    expect(span(applyDrag(s, 'move', 0))).toEqual(['2026-03-10', '2026-03-12']);
  });

  it('월 경계를 넘는다', () => {
    const s = { start: day(2026, 1, 30), end: day(2026, 1, 31) };
    expect(span(applyDrag(s, 'move', 2))).toEqual(['2026-02-01', '2026-02-02']);
  });

  it('윤년 2월을 넘는다', () => {
    const s = { start: day(2024, 2, 27), end: day(2024, 2, 28) };
    const moved = applyDrag(s, 'move', 1);
    expect(span(moved)).toEqual(['2024-02-28', '2024-02-29']);
    expect(span(applyDrag(moved, 'move', 1))).toEqual(['2024-02-29', '2024-03-01']);
  });

  it('시각이 있는 기간도 날짜만 옮긴다(시각은 값 변환에서 유지)', () => {
    const s = { start: day(2026, 1, 15), end: day(2026, 1, 18) };
    expect(spanToValue(applyDrag(s, 'move', 7), '09:30')).toEqual({ start: '2026-01-22T09:30', end: '2026-01-25T09:30' });
  });
});

describe('applyDrag — resize-start', () => {
  const s = { start: day(2026, 3, 10), end: day(2026, 3, 20) };

  it('start 만 움직이고 end 는 고정이다', () => {
    expect(span(applyDrag(s, 'resize-start', 5))).toEqual(['2026-03-15', '2026-03-20']);
  });

  it('뒤로 늘릴 수 있다', () => {
    expect(span(applyDrag(s, 'resize-start', -3))).toEqual(['2026-03-07', '2026-03-20']);
  });

  it('end 를 넘지 못한다(교차 방지)', () => {
    expect(span(applyDrag(s, 'resize-start', 20))).toEqual(['2026-03-20', '2026-03-20']);
    expect(span(applyDrag(s, 'resize-start', 500))).toEqual(['2026-03-20', '2026-03-20']);
  });

  it('월 경계를 넘어 늘어난다', () => {
    const jan = { start: day(2026, 1, 28), end: day(2026, 2, 10) };
    expect(span(applyDrag(jan, 'resize-start', 7))).toEqual(['2026-02-04', '2026-02-10']);
  });

  it('윤년 2월 경계에서도 같은 규칙이다', () => {
    const leap = { start: day(2024, 2, 27), end: day(2024, 3, 2) };
    expect(span(applyDrag(leap, 'resize-start', 3))).toEqual(['2024-03-01', '2024-03-02']);
  });
});

describe('applyDrag — resize-end', () => {
  const s = { start: day(2026, 3, 10), end: day(2026, 3, 20) };

  it('end 만 움직이고 start 는 고정이다', () => {
    expect(span(applyDrag(s, 'resize-end', 5))).toEqual(['2026-03-10', '2026-03-25']);
    expect(span(applyDrag(s, 'resize-end', -4))).toEqual(['2026-03-10', '2026-03-16']);
  });

  it('start 아래로 내려가지 못한다(교차 방지)', () => {
    expect(span(applyDrag(s, 'resize-end', -20))).toEqual(['2026-03-10', '2026-03-10']);
    expect(span(applyDrag(s, 'resize-end', -500))).toEqual(['2026-03-10', '2026-03-10']);
  });

  it('월 경계를 넘어 늘어난다', () => {
    const jan = { start: day(2026, 1, 28), end: day(2026, 1, 31) };
    expect(span(applyDrag(jan, 'resize-end', 1))).toEqual(['2026-01-28', '2026-02-01']);
  });

  it('윤년 2월 29일을 지난다', () => {
    const leap = { start: day(2024, 2, 28), end: day(2024, 2, 29) };
    expect(span(applyDrag(leap, 'resize-end', 1))).toEqual(['2024-02-28', '2024-03-01']);
  });
});

describe('spanToValue', () => {
  it('여러 날이면 start·end 를 쓴다', () => {
    expect(spanToValue({ start: day(2026, 1, 15), end: day(2026, 1, 18) }, null)).toEqual({ start: '2026-01-15', end: '2026-01-18' });
  });

  it('하루짜리면 start 만 쓴다', () => {
    const v = spanToValue({ start: day(2026, 1, 15), end: day(2026, 1, 15) }, null);
    expect(v).toEqual({ start: '2026-01-15' });
    expect(v.end).toBeUndefined();
  });

  it('시각이 있으면 start·end 모두 유지한다', () => {
    expect(spanToValue({ start: day(2026, 1, 15), end: day(2026, 1, 18) }, '09:30')).toEqual({ start: '2026-01-15T09:30', end: '2026-01-18T09:30' });
    expect(spanToValue({ start: day(2026, 1, 15), end: day(2026, 1, 15) }, '09:30')).toEqual({ start: '2026-01-15T09:30' });
  });

  it('날짜는 0을 채운다', () => {
    expect(spanToValue({ start: day(2026, 1, 5), end: day(2026, 2, 9) }, null)).toEqual({ start: '2026-01-05', end: '2026-02-09' });
    expect(spanToValue({ start: day(2024, 2, 29), end: day(2024, 2, 29) }, null)).toEqual({ start: '2024-02-29' });
  });
});
