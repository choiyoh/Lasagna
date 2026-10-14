import { describe, expect, it } from 'vitest';
import { addMonths, fromDateValue, monthGrid, pickRange, sameDay, toDateValue } from './date-picker-math';
import { ymd } from './date-util';

/** 로컬 자정 Date */
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d);

describe('monthGrid', () => {
  it('월요일로 시작하는 42칸 격자를 만든다', () => {
    const g = monthGrid(day(2026, 10, 15));
    expect(g).toHaveLength(42);
    expect(g[0]!.getDay()).toBe(1);
    expect(ymd(g[0]!)).toBe('2026-09-28');
    expect(ymd(g[41]!)).toBe('2026-11-08');
  });

  it('칸은 하루씩 이어지는 로컬 자정 Date 다', () => {
    const g = monthGrid(day(2026, 10, 15));
    for (let i = 0; i < g.length; i++) {
      expect(g[i]!.getHours()).toBe(0);
      if (i > 0) expect(g[i]!.getTime() - g[i - 1]!.getTime()).toBe(86400000);
    }
  });

  it('해당 달 1일을 포함한다', () => {
    const g = monthGrid(day(2026, 10, 15));
    expect(g.some((d) => ymd(d) === '2026-10-01')).toBe(true);
  });

  it('1일이 월요일이면 첫 칸이 그 달 1일이다', () => {
    // 2026-06-01 은 월요일
    const g = monthGrid(day(2026, 6, 1));
    expect(ymd(g[0]!)).toBe('2026-06-01');
  });

  it('윤년 2월의 29일을 포함한다', () => {
    const g = monthGrid(day(2024, 2, 10));
    expect(g.some((d) => ymd(d) === '2024-02-29')).toBe(true);
  });

  it('1월 격자는 지난해 12월로 넘어간다', () => {
    const g = monthGrid(day(2026, 1, 15));
    expect(ymd(g[0]!)).toBe('2025-12-29');
    expect(g.some((d) => ymd(d) === '2026-01-01')).toBe(true);
  });

  it('12월 격자는 다음 해 1월로 넘어간다', () => {
    const g = monthGrid(day(2026, 12, 15));
    expect(ymd(g[0]!)).toBe('2026-11-30');
    expect(ymd(g[41]!)).toBe('2027-01-10');
  });
});

describe('sameDay', () => {
  it('같은 날이면 시각이 달라도 true 다', () => {
    expect(sameDay(new Date(2026, 9, 15, 0, 0), new Date(2026, 9, 15, 23, 59))).toBe(true);
  });

  it('다른 날·달·해면 false 다', () => {
    expect(sameDay(day(2026, 10, 15), day(2026, 10, 16))).toBe(false);
    expect(sameDay(day(2026, 10, 15), day(2026, 11, 15))).toBe(false);
    expect(sameDay(day(2026, 10, 15), day(2025, 10, 15))).toBe(false);
  });
});

describe('pickRange', () => {
  it('첫 클릭은 시작만 정한다', () => {
    const r = pickRange({ start: null, end: null }, day(2026, 10, 15));
    expect([ymd(r.start), r.end]).toEqual(['2026-10-15', null]);
  });

  it('두 번째 클릭이 뒤면 끝이 된다', () => {
    const r = pickRange({ start: day(2026, 10, 15), end: null }, day(2026, 10, 20));
    expect([ymd(r.start), ymd(r.end!)]).toEqual(['2026-10-15', '2026-10-20']);
  });

  it('두 번째 클릭이 앞이면 둘을 바꾼다', () => {
    const r = pickRange({ start: day(2026, 10, 15), end: null }, day(2026, 10, 10));
    expect([ymd(r.start), ymd(r.end!)]).toEqual(['2026-10-10', '2026-10-15']);
  });

  it('같은 날을 두 번 누르면 시작=끝이다', () => {
    const r = pickRange({ start: day(2026, 10, 15), end: null }, day(2026, 10, 15));
    expect([ymd(r.start), ymd(r.end!)]).toEqual(['2026-10-15', '2026-10-15']);
  });

  it('이미 시작·끝이 다 있으면 새로 시작한다', () => {
    const r = pickRange({ start: day(2026, 10, 15), end: day(2026, 10, 20) }, day(2026, 11, 1));
    expect([ymd(r.start), r.end]).toEqual(['2026-11-01', null]);
  });
});

describe('toDateValue', () => {
  it('끝이 없으면 시작만 만든다', () => {
    expect(toDateValue(day(2026, 10, 15), null, null)).toEqual({ start: '2026-10-15' });
  });

  it('시작=끝이면 끝을 생략한다', () => {
    expect(toDateValue(day(2026, 10, 15), day(2026, 10, 15), null)).toEqual({ start: '2026-10-15' });
  });

  it('여러 날이면 끝을 붙인다', () => {
    expect(toDateValue(day(2026, 10, 15), day(2026, 10, 20), null)).toEqual({ start: '2026-10-15', end: '2026-10-20' });
  });

  it('시각이 있으면 시작·끝 모두에 붙인다', () => {
    expect(toDateValue(day(2026, 10, 15), day(2026, 10, 20), '09:30')).toEqual({ start: '2026-10-15T09:30', end: '2026-10-20T09:30' });
  });

  it('하루짜리도 시각을 유지한다', () => {
    expect(toDateValue(day(2026, 10, 15), null, '09:30')).toEqual({ start: '2026-10-15T09:30' });
  });
});

describe('fromDateValue', () => {
  it('문자열 하루를 읽는다', () => {
    const r = fromDateValue('2026-10-15');
    expect([r.start && ymd(r.start), r.end, r.time]).toEqual(['2026-10-15', null, null]);
  });

  it('시각이 있는 문자열에서 시각을 뽑는다', () => {
    const r = fromDateValue('2026-10-15T09:30');
    expect([r.start && ymd(r.start), r.end, r.time]).toEqual(['2026-10-15', null, '09:30']);
  });

  it('객체 기간을 읽는다', () => {
    const r = fromDateValue({ start: '2026-10-15', end: '2026-10-20' });
    expect([r.start && ymd(r.start), r.end && ymd(r.end), r.time]).toEqual(['2026-10-15', '2026-10-20', null]);
  });

  it('끝이 시작보다 앞이면 시작으로 맞춘다', () => {
    const r = fromDateValue({ start: '2026-10-20', end: '2026-10-15' });
    expect([r.start && ymd(r.start), r.end && ymd(r.end)]).toEqual(['2026-10-20', '2026-10-20']);
  });

  it.each([null, undefined, 42, true, [], {}, '', 'nope', { start: 'nope' }, { start: '2026-10-15', end: 'nope' }, { end: '2026-10-20' }])('잘못된 값 %p 은 모두 null 이다', (v) => {
    expect(fromDateValue(v)).toEqual({ start: null, end: null, time: null });
  });
});

describe('addMonths', () => {
  it('앞뒤 달로 이동하고 항상 그 달 1일이다', () => {
    expect(ymd(addMonths(day(2026, 10, 15), 1))).toBe('2026-11-01');
    expect(ymd(addMonths(day(2026, 10, 15), -1))).toBe('2026-09-01');
    expect(ymd(addMonths(day(2026, 10, 15), 0))).toBe('2026-10-01');
  });

  it('연도 경계를 넘는다', () => {
    expect(ymd(addMonths(day(2026, 12, 15), 1))).toBe('2027-01-01');
    expect(ymd(addMonths(day(2026, 1, 15), -1))).toBe('2025-12-01');
  });

  it('여러 달도 한 번에 넘긴다', () => {
    expect(ymd(addMonths(day(2026, 1, 31), 14))).toBe('2027-03-01');
  });
});
