import { describe, expect, it } from 'vitest';
import { DATE_FNS } from './fn-date.js';
import { FormulaError, type FDate, type FValue } from './value.js';

const ctx = { now: new Date(2026, 9, 12, 15, 30, 45) };

/** 레지스트리를 직접 부른다(평가기 없이) */
const call = (name: string, ...args: FValue[]): FValue => DATE_FNS[name]!.impl(args, ctx);

const pad = (n: number) => String(n).padStart(2, '0');
/** 로컬 시간대 기준 `YYYY-MM-DD HH:mm:ss` — 시간대에 무관하게 비교하려고 */
const fmt = (ms: number): string => {
  const t = new Date(ms);
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`;
};
const show = (v: FValue) => fmt((v as FDate).ms);
const dateOnly = (y: number, m: number, d: number): FDate => ({ kind: 'date', ms: new Date(y, m - 1, d).getTime(), hasTime: false });
const dateTime = (y: number, m: number, d: number, h: number, mi = 0, s = 0): FDate => ({
  kind: 'date',
  ms: new Date(y, m - 1, d, h, mi, s).getTime(),
  hasTime: true,
});
const boom = (f: () => unknown): FormulaError => {
  try {
    f();
  } catch (e) {
    return e as FormulaError;
  }
  throw new Error('오류가 나야 해요');
};

describe('now / today', () => {
  it('ctx.now 를 쓴다', () => {
    const n = call('now') as FDate;
    expect(n.hasTime).toBe(true);
    expect(n.ms).toBe(ctx.now.getTime());
    const t = call('today') as FDate;
    expect(t.hasTime).toBe(false);
    expect(show(t)).toBe('2026-10-12 00:00:00');
  });
});

describe('parseDate', () => {
  it('유효한 형식', () => {
    for (const s of ['2026-10-12', '2026/10/12']) {
      const r = call('parseDate', s) as FDate;
      expect(r.hasTime).toBe(false);
      expect(show(r)).toBe('2026-10-12 00:00:00');
    }
    const t1 = call('parseDate', '2026-10-12T09:05') as FDate;
    expect(t1.hasTime).toBe(true);
    expect(show(t1)).toBe('2026-10-12 09:05:00');
    expect(show(call('parseDate', '2026-10-12 09:05:30')!)).toBe('2026-10-12 09:05:30');
  });

  it('이미 날짜면 그대로', () => {
    const d = dateTime(2026, 10, 12, 9);
    expect(call('parseDate', d)).toBe(d);
  });

  it('형식이 아니거나 없는 날짜는 null', () => {
    for (const s of ['2026-02-30', '2026-13-01', '12/10/2026', '2026-10-12T25:00', '오늘', '', '2026-1-2', '2026-10-12T09:5']) {
      expect(call('parseDate', s)).toBeNull();
    }
    expect(call('parseDate', null)).toBeNull();
    expect(boom(() => call('parseDate', 5)).message).toMatch(/문자열/);
  });
});

describe('dateAdd / dateSubtract', () => {
  it('월말 보정', () => {
    expect(show(call('dateAdd', dateOnly(2026, 1, 31), 1, 'month')!)).toBe('2026-02-28 00:00:00');
    expect(show(call('dateAdd', dateOnly(2024, 1, 31), 1, 'month')!)).toBe('2024-02-29 00:00:00');
    expect(show(call('dateSubtract', dateOnly(2026, 3, 31), 1, 'month')!)).toBe('2026-02-28 00:00:00');
    expect(show(call('dateAdd', dateOnly(2024, 2, 29), 1, 'year')!)).toBe('2025-02-28 00:00:00');
    expect((call('dateAdd', dateOnly(2026, 1, 31), 1, 'month') as FDate).hasTime).toBe(false);
  });

  it('달력 일·주와 정확한 시·분·초', () => {
    expect(show(call('dateAdd', dateTime(2026, 3, 8, 12, 30), 1, 'day')!)).toBe('2026-03-09 12:30:00');
    expect(show(call('dateAdd', dateOnly(2026, 10, 12), 2, 'weeks')!)).toBe('2026-10-26 00:00:00');
    expect(show(call('dateAdd', dateTime(2026, 10, 12, 23, 30), 2, 'hours')!)).toBe('2026-10-13 01:30:00');
    expect(show(call('dateAdd', dateTime(2026, 10, 12, 9, 5, 30), 90, 'seconds')!)).toBe('2026-10-12 09:07:00');
    expect(show(call('dateSubtract', dateTime(2026, 10, 12, 0, 30), 45, 'minutes')!)).toBe('2026-10-11 23:45:00');
  });

  it('날짜만 값에 시·분·초를 더하면 시각 포함으로 승격', () => {
    const r = call('dateAdd', dateOnly(2026, 10, 12), 3, 'hours') as FDate;
    expect(r.hasTime).toBe(true);
    expect(show(r)).toBe('2026-10-12 03:00:00');
  });

  it('기간이면 양 끝 모두 이동', () => {
    const range = call('dateRange', dateOnly(2026, 10, 12), dateOnly(2026, 10, 14)) as FDate;
    const moved = call('dateAdd', range, 1, 'month') as FDate;
    expect(fmt(moved.ms)).toBe('2026-11-12 00:00:00');
    expect(fmt(moved.endMs!)).toBe('2026-11-14 00:00:00');
  });

  it('단수·복수 단위는 같고, 모르는 단위는 오류', () => {
    expect(call('dateAdd', dateOnly(2026, 10, 12), 1, 'day')).toEqual(call('dateAdd', dateOnly(2026, 10, 12), 1, 'days'));
    expect(call('dateAdd', dateOnly(2026, 10, 12), 2, 'quarters')).toEqual(call('dateAdd', dateOnly(2026, 10, 12), 6, 'months'));
    expect(boom(() => call('dateAdd', dateOnly(2026, 10, 12), 1, 'fortnights')).message).toBe('모르는 단위: fortnights');
  });

  it('소수 수량·잘못된 타입', () => {
    expect(boom(() => call('dateAdd', dateOnly(2026, 10, 12), 1.5, 'days')).message).toMatch(/정수/);
    expect(boom(() => call('dateAdd', 5, 1, 'days')).message).toMatch(/날짜/);
    expect(call('dateAdd', null, 1, 'days')).toBeNull();
  });
});

describe('dateBetween', () => {
  it('부호와 0 쪽 버림', () => {
    expect(call('dateBetween', dateOnly(2026, 10, 12), dateOnly(2026, 10, 10), 'days')).toBe(2);
    expect(call('dateBetween', dateOnly(2026, 10, 10), dateOnly(2026, 10, 12), 'days')).toBe(-2);
    expect(call('dateBetween', dateTime(2026, 10, 12, 12, 30), dateTime(2026, 10, 12, 12), 'hours')).toBe(0);
    expect(call('dateBetween', dateTime(2026, 10, 12, 14), dateTime(2026, 10, 12, 12), 'hours')).toBe(2);
    expect(call('dateBetween', dateTime(2026, 10, 12, 12), dateTime(2026, 10, 12, 14), 'hours')).toBe(-2);
    expect(call('dateBetween', dateTime(2026, 10, 12, 12, 0, 90), dateTime(2026, 10, 12, 12, 0), 'minutes')).toBe(1);
  });

  it('월·분기·년은 달력 기준', () => {
    expect(call('dateBetween', dateOnly(2026, 1, 31), dateOnly(2026, 2, 28), 'months')).toBe(0);
    expect(call('dateBetween', dateOnly(2026, 3, 31), dateOnly(2026, 2, 28), 'months')).toBe(1);
    expect(call('dateBetween', dateOnly(2027, 5, 1), dateOnly(2026, 5, 1), 'years')).toBe(1);
    expect(call('dateBetween', dateOnly(2026, 7, 1), dateOnly(2026, 1, 1), 'quarters')).toBe(2);
    expect(call('dateBetween', dateOnly(2026, 10, 26), dateOnly(2026, 10, 12), 'weeks')).toBe(2);
  });

  it('빈 값은 null, 모르는 단위는 오류', () => {
    expect(call('dateBetween', null, dateOnly(2026, 10, 12), 'days')).toBeNull();
    expect(boom(() => call('dateBetween', dateOnly(2026, 10, 12), dateOnly(2026, 10, 10), 'centuries')).message).toBe(
      '모르는 단위: centuries',
    );
  });
});

describe('formatDate', () => {
  it('토큰 전부', () => {
    expect(call('formatDate', dateTime(2026, 10, 12, 9, 5, 7), 'YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|H|hh|h|mm|m|ss|s|A|a')).toBe(
      '2026|26|10월|10월|10|10|12|12|월요일|월|09|9|09|9|05|5|07|7|오전|am',
    );
    expect(call('formatDate', dateTime(2026, 10, 12, 15, 5, 7), 'HH|H|hh|h|A|a')).toBe('15|15|03|3|오후|pm');
  });

  it('대괄호 안은 그대로', () => {
    expect(call('formatDate', dateTime(2026, 10, 12, 9, 5), '[YYYY-MM-DD] HH:mm [at] h')).toBe('YYYY-MM-DD 09:05 at 9');
    expect(call('formatDate', dateOnly(2026, 10, 12), '[미닫힘')).toBe('미닫힘');
  });

  it('토큰이 아닌 글자는 그대로', () => {
    expect(call('formatDate', dateOnly(2026, 10, 12), 'dd')).toBe('dd');
    expect(call('formatDate', dateOnly(2026, 10, 12), 'YYYY년 M월 D일')).toBe('2026년 10월 12일');
  });

  it('날짜만 값은 시각이 0', () => {
    expect(call('formatDate', dateOnly(2026, 10, 12), 'YYYY-MM-DD HH:mm:ss')).toBe('2026-10-12 00:00:00');
    expect(call('formatDate', null, 'YYYY')).toBe('');
  });

  it('12개월 이름', () => {
    for (let m = 1; m <= 12; m++) expect(call('formatDate', dateOnly(2026, m, 1), 'MMMM')).toBe(`${m}월`);
  });
});

describe('구성 요소 함수', () => {
  it('year/month/date/day/hour/minute/second', () => {
    const d = dateTime(2026, 10, 12, 9, 5, 7);
    expect(call('year', d)).toBe(2026);
    expect(call('month', d)).toBe(10);
    expect(call('date', d)).toBe(12);
    expect(call('hour', d)).toBe(9);
    expect(call('minute', d)).toBe(5);
    expect(call('second', d)).toBe(7);
    expect(call('day', dateOnly(2026, 10, 12))).toBe(1); // 월요일 = 1
    expect(call('day', dateOnly(2026, 10, 11))).toBe(7); // 일요일 = 7
    expect(call('day', dateOnly(2026, 10, 17))).toBe(6); // 토요일 = 6
    for (const f of ['year', 'month', 'date', 'day', 'hour', 'minute', 'second']) expect(call(f, null)).toBeNull();
  });
});

describe('timestamp / fromTimestamp', () => {
  it('왕복', () => {
    const ms = new Date(2026, 9, 12, 9, 5, 7).getTime();
    expect(call('timestamp', dateTime(2026, 10, 12, 9, 5, 7))).toBe(ms);
    expect((call('fromTimestamp', ms) as FDate).hasTime).toBe(true);
    expect(show(call('fromTimestamp', ms)!)).toBe('2026-10-12 09:05:07');
    expect(call('timestamp', null)).toBeNull();
    expect(boom(() => call('fromTimestamp', 'now')).message).toMatch(/숫자/);
  });
});

describe('dateRange / dateStart / dateEnd', () => {
  it('기간 만들기와 양 끝', () => {
    const r = call('dateRange', dateOnly(2026, 10, 12), dateOnly(2026, 10, 14)) as FDate;
    expect(fmt(r.ms)).toBe('2026-10-12 00:00:00');
    expect(fmt(r.endMs!)).toBe('2026-10-14 00:00:00');
    expect(r.hasTime).toBe(false);
    const s = call('dateStart', r) as FDate;
    expect(s.endMs).toBeUndefined();
    expect(show(s)).toBe('2026-10-12 00:00:00');
    expect(show(call('dateEnd', r)!)).toBe('2026-10-14 00:00:00');
  });

  it('기간이 아니면 dateStart·dateEnd 모두 자기 자신', () => {
    const d = dateOnly(2026, 10, 12);
    expect(call('dateStart', d)).toEqual(d);
    expect(call('dateEnd', d)).toEqual(d);
  });

  it('끝이 시작보다 빠르면 오류', () => {
    expect(boom(() => call('dateRange', dateOnly(2026, 10, 14), dateOnly(2026, 10, 12))).message).toMatch(/빠를/);
    expect(call('dateRange', dateOnly(2026, 10, 12), dateOnly(2026, 10, 12))).toMatchObject({ kind: 'date' });
  });
});

describe('startOf', () => {
  it('단위의 시작(주 시작은 월요일)', () => {
    const d = dateTime(2026, 10, 14, 9, 5, 7); // 수요일
    expect(show(call('startOf', d, 'year')!)).toBe('2026-01-01 00:00:00');
    expect(show(call('startOf', d, 'quarter')!)).toBe('2026-10-01 00:00:00');
    expect(show(call('startOf', d, 'month')!)).toBe('2026-10-01 00:00:00');
    expect(show(call('startOf', d, 'week')!)).toBe('2026-10-12 00:00:00');
    expect(show(call('startOf', d, 'day')!)).toBe('2026-10-14 00:00:00');
    expect(show(call('startOf', d, 'hour')!)).toBe('2026-10-14 09:00:00');
    expect(show(call('startOf', d, 'minute')!)).toBe('2026-10-14 09:05:00');
    expect((call('startOf', d, 'day') as FDate).hasTime).toBe(true);
  });

  it('second 는 지원하지 않는다', () => {
    expect(boom(() => call('startOf', dateTime(2026, 10, 12, 9), 'second')).message).toMatch(/second/);
    expect(call('startOf', null, 'day')).toBeNull();
  });
});
