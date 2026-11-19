import { describe, expect, it } from 'vitest';
import {
  STATS_SCALE_MAX,
  StatsSeries,
  addDays,
  barPercent,
  calendarCells,
  dateKey,
  daysBetween,
  daysInMonth,
  endOfMonth,
  heatLevel,
  startOfMonth,
  startOfWeek,
  summarize,
  type StatsHistory,
} from './writer-stats.js';

const TODAY = '2026-11-19'; // 목요일

/** 날짜별 기록을 만든다. 값이 0 이면 그 날짜 키를 넣지 않는다(기록 없음과 같게). */
function history(entries: Record<string, number | { total?: number; works?: Record<string, number>; goal?: number }>): StatsHistory {
  const out: StatsHistory = {};
  for (const [date, value] of Object.entries(entries)) {
    if (typeof value === 'number') out[date] = { total: value };
    else out[date] = { total: value.total ?? 0, ...(value.works ? { works: value.works } : {}), ...(value.goal ? { goal: value.goal } : {}) };
  }
  return out;
}

describe('쓰기 통계 — 날짜 계산', () => {
  it('로컬 날짜 키와 일수 더하기', () => {
    expect(dateKey(new Date(2026, 10, 19, 23, 59))).toBe('2026-11-19');
    expect(addDays('2026-11-19', 1)).toBe('2026-11-20');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
  });

  it('주는 월요일에 시작한다', () => {
    expect(startOfWeek('2026-11-19')).toBe('2026-11-16'); // 목 → 월
    expect(startOfWeek('2026-11-16')).toBe('2026-11-16'); // 월
    expect(startOfWeek('2026-11-22')).toBe('2026-11-16'); // 일
  });

  it('달 경계와 일수', () => {
    expect(startOfMonth('2026-11-19')).toBe('2026-11-01');
    expect(endOfMonth('2026-11-19')).toBe('2026-11-30');
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28');
    expect(endOfMonth('2024-02-10')).toBe('2024-02-29');
    expect(daysInMonth('2024-02-10')).toBe(29);
    expect(daysBetween('2026-11-01', '2026-11-19')).toBe(19);
    expect(daysBetween('2026-11-19', '2026-11-01')).toBe(0);
  });

  it('달력은 42칸이고 월요일부터 채운다', () => {
    const cells = calendarCells('2026-11-19');
    expect(cells).toHaveLength(42);
    // 2026-11-01 은 일요일 → 첫 6칸이 빈 칸, 7번째가 1일
    expect(cells.slice(0, 6)).toEqual([null, null, null, null, null, null]);
    expect(cells[6]).toBe('2026-11-01');
    expect(cells[35]).toBe('2026-11-30');
    expect(cells[36]).toBeNull();
  });

  it('농도 4단계는 절대값이다', () => {
    expect(heatLevel(0)).toBe(0);
    expect(heatLevel(1)).toBe(1);
    expect(heatLevel(999)).toBe(1);
    expect(heatLevel(1000)).toBe(2);
    expect(heatLevel(2000)).toBe(3);
    expect(heatLevel(2999)).toBe(3);
    expect(heatLevel(3000)).toBe(4);
    expect(heatLevel(50_000)).toBe(4);
  });

  it('막대 채움은 눈금에서 멈춘다', () => {
    expect(barPercent(0)).toBe(0);
    expect(barPercent(2000)).toBe(50);
    expect(barPercent(STATS_SCALE_MAX)).toBe(100);
    expect(barPercent(STATS_SCALE_MAX * 3)).toBe(100);
  });
});

describe('쓰기 통계 — 날짜별 값', () => {
  it('기록 시작 전·오늘 이후·그날 목표 달성을 구분한다', () => {
    const series = new StatsSeries(history({ '2026-11-10': { total: 500, goal: 1000 }, '2026-11-12': 1500 }), null, TODAY);
    expect(series.firstDate).toBe('2026-11-10');
    expect(series.day('2026-11-09')).toMatchObject({ chars: 0, recorded: false });
    expect(series.day('2026-11-10')).toMatchObject({ chars: 500, goal: 1000, recorded: true, goalMet: false });
    expect(series.day('2026-11-12')).toMatchObject({ chars: 1500, goal: null, goalMet: false });
    expect(series.day('2026-11-20')).toMatchObject({ chars: 0, future: true });
  });

  it('작품 범위는 그 작품 값만 센다(기록 시작일도 그 작품 기준)', () => {
    const data = history({
      '2026-11-10': { total: 900, works: { 달빛: 700, 별빛: 200 } },
      '2026-11-11': { total: 300, works: { 별빛: 300 } },
    });
    const work = new StatsSeries(data, '달빛', TODAY);
    expect(work.firstDate).toBe('2026-11-10');
    expect(work.day('2026-11-10').chars).toBe(700);
    expect(new StatsSeries(data, '별빛', TODAY).day('2026-11-11').chars).toBe(300);
    expect(new StatsSeries(data, '없는작품', TODAY).firstDate).toBeNull();
  });

  it('최근 30일은 오늘을 포함한다', () => {
    const days = new StatsSeries(history({}), null, TODAY).last30();
    expect(days).toHaveLength(30);
    expect(days[0]?.date).toBe('2026-10-21');
    expect(days[29]?.date).toBe(TODAY);
  });
});

describe('쓰기 통계 — 요약', () => {
  const week: StatsHistory = history({
    '2026-11-15': 500, // 지난주 일요일 — 이번 주가 아니다
    '2026-11-16': 1000, // 월
    '2026-11-18': 2000,
    '2026-11-19': 3000,
  });

  it('이번 주는 월요일부터 오늘까지다', () => {
    const summary = summarize(new StatsSeries(week, null, TODAY), TODAY);
    expect(summary.weekTotal).toBe(6000);
  });

  it('이번 달 합계·지난 일수·쓴 날·평균 두 가지', () => {
    const data = history({ '2026-11-01': 1000, '2026-11-05': 1000, '2026-11-05 ': 0, '2026-11-16': 1000, '2026-11-19': 1000 });
    const summary = summarize(new StatsSeries(data, null, TODAY), TODAY);
    expect(summary.monthTotal).toBe(4000);
    expect(summary.monthElapsedDays).toBe(19);
    expect(summary.monthWrittenDays).toBe(4);
    expect(summary.writtenDayAverage).toBe(1000); // 쓴 날만 (4000 / 4)
    expect(summary.monthAverage).toBe(211); // 19일 전체 (4000 / 19)
  });

  it('기록 시작 전 날짜는 이번 달 지난 일수에서 뺀다', () => {
    const data = history({ '2026-11-16': 1000, '2026-11-17': 1000 });
    const summary = summarize(new StatsSeries(data, null, TODAY), TODAY);
    expect(summary.monthElapsedDays).toBe(4); // 16~19
    expect(summary.monthAverage).toBe(500);
    expect(summary.monthWrittenDays).toBe(2);
    expect(summary.writtenDayAverage).toBe(1000);
  });

  it('연속 집필: 오늘 0자면 어제까지의 연속을 유지한다', () => {
    const data = history({ '2026-11-16': 100, '2026-11-17': 100, '2026-11-18': 100 });
    expect(summarize(new StatsSeries(data, null, TODAY), TODAY).streak).toBe(3);
    const withToday = history({ ...data, '2026-11-19': 100 });
    expect(summarize(new StatsSeries(withToday, null, TODAY), TODAY).streak).toBe(4);
    // 하루 빠지면 끊긴다
    const broken = history({ '2026-11-16': 100, '2026-11-18': 100 });
    expect(summarize(new StatsSeries(broken, null, TODAY), TODAY).streak).toBe(1);
    expect(summarize(new StatsSeries(history({}), null, TODAY), TODAY).streak).toBe(0);
  });

  it('최장 연속은 기록 전체에서 고른다', () => {
    const data = history({
      '2026-10-01': 10,
      '2026-10-02': 10,
      '2026-10-03': 10,
      '2026-10-10': 10,
      '2026-11-18': 10,
      '2026-11-19': 10,
    });
    const summary = summarize(new StatsSeries(data, null, TODAY), TODAY);
    expect(summary.streak).toBe(2);
    expect(summary.longestStreak).toBe(3);
  });

  it('목표 달성일은 그날의 목표로 판정한다', () => {
    const data = history({
      '2026-11-10': { total: 1200, goal: 1000 }, // 달성
      '2026-11-11': { total: 900, goal: 1000 }, // 미달
      '2026-11-12': { total: 5000, goal: 3000 }, // 달성
      '2026-11-13': { total: 900 }, // 목표 없음
    });
    const summary = summarize(new StatsSeries(data, null, TODAY), TODAY);
    expect(summary.goalDays).toBe(2);
    // 지난 달을 보면 그 달 기준으로 센다
    const october = history({ '2026-10-05': { total: 1000, goal: 1000 }, '2026-11-10': { total: 1200, goal: 1000 } });
    expect(summarize(new StatsSeries(october, null, TODAY), TODAY, '2026-10-15').goalDays).toBe(1);
  });

  it('작품 범위의 요약은 그 작품 값만 센다(목표선은 볼트 하루 목표)', () => {
    const data = history({
      '2026-11-18': { total: 3000, works: { 달빛: 1000, 별빛: 2000 }, goal: 1500 },
      '2026-11-19': { total: 2000, works: { 달빛: 2000 }, goal: 1500 },
    });
    const summary = summarize(new StatsSeries(data, '달빛', TODAY), TODAY);
    expect(summary.weekTotal).toBe(3000);
    expect(summary.monthTotal).toBe(3000);
    expect(summary.goalDays).toBe(1); // 11-19 만 달빛 2000 ≥ 1500
  });
});
