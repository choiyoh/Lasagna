/**
 * 쓰기 통계 창의 순수 계산 — 날짜별 기록(PR 1 의 `writerHistory`)을 화면 값으로 접는다.
 *
 * - 날짜는 기기 로컬 자정 기준 `YYYY-MM-DD`(통계 파일과 같은 규칙).
 * - 주는 월요일에 시작한다. '이번 주'는 오늘까지, '이번 달'은 1일부터 오늘까지다.
 * - 하루 평균은 **쓴 날(1자 이상)만** 기준이고, 보조로 그 달 지난 일수 전체 평균을 낸다.
 * - 연속 집필은 하루 1자 이상인 날이 이어지는 일수다. 오늘 아직 0자면 어제까지의 연속을 유지한다
 *   (하루가 끝나기 전이므로 끊긴 것으로 보지 않는다).
 * - 기록 시작 전 날짜는 `yyyy` 가 아니라 '기록 없음'으로 구분한다(그 날짜 키가 없는 것과 같다).
 */

export interface WriterStatsDay {
  total: number;
  works?: Record<string, number>;
  goal?: number;
}

export type StatsHistory = Record<string, WriterStatsDay>;

export interface StatsDayValue {
  /** YYYY-MM-DD (기기 로컬) */
  date: string;
  /** 그 범위의 글자수(작품 범위면 그 작품 값) */
  chars: number;
  /** 그날의 하루 목표(없으면 null) */
  goal: number | null;
  /** 기록이 시작되기 전 날짜면 false(빗금) */
  recorded: boolean;
  /** 오늘 이후 날짜(달력에서 흐리게) */
  future: boolean;
  /** 그날 목표를 채웠는지(그날 목표 기준) */
  goalMet: boolean;
}

/** 최근 30일 막대의 고정 눈금 상한(설계 시안). 범위를 바꿔도 눈금이 그대로라 날끼리 비교가 흔들리지 않는다. */
export const STATS_SCALE_MAX = 4000;

/** 달력·범례의 농도 단계(절대값 — 목표를 바꿔도 과거 색이 변하지 않는다). */
export function heatLevel(chars: number): 0 | 1 | 2 | 3 | 4 {
  if (chars <= 0) return 0;
  if (chars < 1000) return 1;
  if (chars < 2000) return 2;
  if (chars < 3000) return 3;
  return 4;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n: number) => String(n).padStart(2, '0');

export function dateKey(at: Date): string {
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** `YYYY-MM-DD` → 그날 정오(로컬). 형식·날짜가 틀리면 null(정오라 DST 에도 날짜가 밀리지 않는다). */
export function parseDateKey(value: string): Date | null {
  if (!DAY.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  const at = new Date(y ?? 0, (m ?? 1) - 1, d ?? 0, 12);
  return dateKey(at) === value ? at : null;
}

/** 날짜에 일수를 더한다. 잘못된 날짜는 그대로 돌려준다. */
export function addDays(value: string, days: number): string {
  const at = parseDateKey(value);
  if (!at) return value;
  at.setDate(at.getDate() + days);
  return dateKey(at);
}

/** 그 주 월요일. */
export function startOfWeek(value: string): string {
  const at = parseDateKey(value);
  if (!at) return value;
  const shift = (at.getDay() + 6) % 7; // 월=0 … 일=6
  return addDays(value, -shift);
}

/** 그 달 1일 / 마지막 날. */
export function startOfMonth(value: string): string {
  const at = parseDateKey(value);
  return at ? dateKey(new Date(at.getFullYear(), at.getMonth(), 1, 12)) : value;
}

export function endOfMonth(value: string): string {
  const at = parseDateKey(value);
  return at ? dateKey(new Date(at.getFullYear(), at.getMonth() + 1, 0, 12)) : value;
}

/** 그 달 일수. */
export function daysInMonth(value: string): number {
  const at = parseDateKey(value);
  return at ? new Date(at.getFullYear(), at.getMonth() + 1, 0, 12).getDate() : 0;
}

/** a~b(포함) 일수. b 가 a 보다 앞이면 0. */
export function daysBetween(a: string, b: string): number {
  const from = parseDateKey(a);
  const to = parseDateKey(b);
  if (!from || !to) return 0;
  const diff = Math.round((to.getTime() - from.getTime()) / 86_400_000);
  return diff < 0 ? 0 : diff + 1;
}

/** 달력 42칸(월요일 시작, 6주 고정). 빈 칸은 null. */
export function calendarCells(month: string): (string | null)[] {
  const first = startOfMonth(month);
  const at = parseDateKey(first);
  if (!at) return Array.from({ length: 42 }, () => null);
  const offset = (at.getDay() + 6) % 7;
  const total = daysInMonth(first);
  return Array.from({ length: 42 }, (_, i) => {
    const day = i - offset + 1;
    return day >= 1 && day <= total ? addDays(first, day - 1) : null;
  });
}

/**
 * 날짜별 값을 만든다. `work` 가 null 이면 볼트 전체, 아니면 그 작품의 값만 센다.
 * 기록 시작일은 **지금 범위**에서 처음 값이 잡힌 날이다(작품 범위면 그 작품을 처음 쓴 날).
 */
export class StatsSeries {
  readonly firstDate: string | null;
  private readonly history: StatsHistory;
  private readonly work: string | null;
  private readonly today: string;
  /**
   * 지금 설정된 하루 목표. 오늘은 아직 '닫힌 날'이 아니라 기록에 goal 이 없으므로
   * (PR 1 은 하루를 닫을 때만 goal 을 남긴다) 오늘 값에만 이 목표를 붙인다.
   * 저장된 오늘 goal 이 있으면 그것이 우선한다.
   */
  private readonly todayGoal: number | null;

  constructor(history: StatsHistory, work: string | null, today: string, todayGoal: number | null = null) {
    this.history = history;
    this.work = work;
    this.today = today;
    this.todayGoal = typeof todayGoal === 'number' && Number.isFinite(todayGoal) && todayGoal > 0 ? Math.trunc(todayGoal) : null;
    const dates = Object.keys(history)
      .filter((date) => this.charsOf(history[date]!) > 0)
      .sort();
    this.firstDate = dates[0] ?? null;
  }

  private charsOf(day: WriterStatsDay): number {
    if (!this.work) return Math.max(0, Math.trunc(day.total));
    return Math.max(0, Math.trunc(day.works?.[this.work] ?? 0));
  }

  /** 그 날짜의 값. 기록이 없으면 0자·기록 전. */
  day(date: string): StatsDayValue {
    const entry = this.history[date];
    const chars = entry ? this.charsOf(entry) : 0;
    const stored = entry?.goal && entry.goal > 0 ? entry.goal : null;
    // 오늘은 기록에 goal 이 없으므로 지금 하루 목표를 쓴다(저장된 값이 있으면 그 값).
    const goal = stored ?? (date === this.today ? this.todayGoal : null);
    return {
      date,
      chars,
      goal,
      recorded: this.firstDate !== null && date >= this.firstDate,
      future: date > this.today,
      goalMet: goal !== null && chars >= goal,
    };
  }

  /** a~b(포함) 날짜 배열. */
  days(a: string, b: string): StatsDayValue[] {
    const out: StatsDayValue[] = [];
    const count = daysBetween(a, b);
    for (let i = 0; i < count; i += 1) out.push(this.day(addDays(a, i)));
    return out;
  }

  /** 최근 30일(오늘 포함). */
  last30(): StatsDayValue[] {
    return this.days(addDays(this.today, -29), this.today);
  }
}

export interface StatsSummary {
  /** 이번 주(월요일~오늘) 합계 */
  weekTotal: number;
  /** 이번 달(1일~오늘) 합계 */
  monthTotal: number;
  /** 이번 달에서 기록이 있던 지난 일수(기록 시작 전 날짜 제외) */
  monthElapsedDays: number;
  /** 그중 1자 이상 쓴 날 */
  monthWrittenDays: number;
  /** 쓴 날만 기준 하루 평균(이번 달) */
  writtenDayAverage: number;
  /** 이번 달 지난 일수 전체 평균 */
  monthAverage: number;
  /** 오늘까지 이어진 연속 집필 일수 */
  streak: number;
  /** 기록 전체의 최장 연속 집필 일수 */
  longestStreak: number;
  /** 이번 달 목표를 채운 날(그날의 목표 기준) */
  goalDays: number;
}

const average = (total: number, days: number) => (days > 0 ? Math.round(total / days) : 0);

/** 요약 4칸·달력 머리의 값. `month` 는 달력이 보여 주는 달(요약은 언제나 오늘 기준). */
export function summarize(series: StatsSeries, today: string, month: string = today): StatsSummary {
  const week = series.days(startOfWeek(today), today);
  const monthStart = startOfMonth(today);
  // 기록 시작 전 날짜는 '이번 달 지난 일수'에도 넣지 않는다(쓴 적 없는 날을 평균 분모로 쓰지 않게).
  const elapsedFrom = series.firstDate && series.firstDate > monthStart ? series.firstDate : monthStart;
  const elapsed = series.days(elapsedFrom, today);
  const monthTotal = elapsed.reduce((sum, day) => sum + day.chars, 0);
  const monthWrittenDays = elapsed.filter((day) => day.chars > 0).length;
  const monthElapsedDays = elapsed.length;

  const shownMonth = series.days(startOfMonth(month), endOfMonth(month));
  const goalDays = shownMonth.filter((day) => day.goalMet).length;

  // 연속 집필: 오늘까지(오늘 0자면 어제까지) 1자 이상이 이어진 일수.
  let streak = 0;
  let cursor = series.day(today).chars > 0 ? today : addDays(today, -1);
  while (series.day(cursor).chars > 0) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }

  let longestStreak = 0;
  let run = 0;
  if (series.firstDate) {
    // 기록 시작일부터 오늘까지 하루씩 센다(최대 10년 — 상한과 같은 범위).
    for (const day of series.days(series.firstDate, series.firstDate > today ? series.firstDate : today)) {
      run = day.chars > 0 ? run + 1 : 0;
      if (run > longestStreak) longestStreak = run;
    }
  }

  return {
    weekTotal: week.reduce((sum, day) => sum + day.chars, 0),
    monthTotal,
    monthElapsedDays,
    monthWrittenDays,
    writtenDayAverage: average(monthTotal, monthWrittenDays),
    monthAverage: average(monthTotal, monthElapsedDays),
    streak,
    longestStreak: Math.max(longestStreak, streak),
    goalDays,
  };
}

/** 달력 머리·그 달 요약: 그 달 합계·목표 달성일·쓴 날. */
export function monthTotals(series: StatsSeries, month: string): { total: number; goalDays: number; writtenDays: number } {
  const days = series.days(startOfMonth(month), endOfMonth(month));
  return {
    total: days.reduce((sum, day) => sum + day.chars, 0),
    goalDays: days.filter((day) => day.goalMet).length,
    writtenDays: days.filter((day) => day.chars > 0).length,
  };
}

/** 막대 채움 비율(0~100). 눈금을 넘으면 100 에서 멈춘다. */
export function barPercent(chars: number, max: number = STATS_SCALE_MAX): number {
  if (chars <= 0 || max <= 0) return 0;
  return Math.min(100, (chars / max) * 100);
}
