import { translate } from '@nopsidian/i18n';

/**
 * 작품 목표·마감 계산(순수 함수). 목표는 앱 데이터에만 저장하고 볼트·노트에는 쓰지 않는다.
 * 하루 필요량은 **오늘을 제외한** 남은 일수로 나눈다(마감일 다음 날부터 센다).
 */

export type WorkGoalBasis = 'include' | 'exclude';
export type WorkGoalPreset = 'naver' | 'kakao' | 'ridi' | 'custom';

export interface WorkGoal {
  /** 완결 회차 */
  episodes: number;
  /** 회당 글자수 */
  perEpisode: number;
  basis: WorkGoalBasis;
  /** 마감일(YYYY-MM-DD, 기기 로컬). 없으면 null */
  deadline: string | null;
  preset: WorkGoalPreset;
  /** 카카오 장르(선택) — 힌트에만 쓴다 */
  genre?: string | null;
}

/** 확인된 플랫폼 값만 프리셋으로 둔다(추정값 금지). */
export const WORK_GOAL_PRESETS = {
  naver: { perEpisode: 4000, basis: 'include' as WorkGoalBasis },
  kakao: { perEpisode: 4500, basis: 'include' as WorkGoalBasis },
  ridi: { perEpisode: 4500, basis: 'exclude' as WorkGoalBasis },
} as const;

/** 카카오 장르별 권장 완결 회차(힌트 전용). */
export const KAKAO_EPISODE_HINTS: Record<string, string> = {
  romanceFantasy: '~200',
  romance: '~80',
  fantasy: '200+',
  martial: '~300',
};

export interface GoalCurrent {
  episodes: number;
  chars: number;
  charsNoSpace: number;
}

export type GoalStatus = 'none' | 'ok' | 'dueToday' | 'overdue' | 'done';

export interface GoalProgress {
  status: GoalStatus;
  remainingEpisodes: number;
  totalTarget: number;
  remainingChars: number;
  /** 오늘을 뺀 남은 일수(마감일 없으면 null) */
  daysLeft: number | null;
  /** 하루 필요 글자수(마감 없음·지남·완결이면 null) */
  perDay: number | null;
}

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** YYYY-MM-DD(로컬) → 그 날 0시. 형식이 틀리면 null. */
export function parseLocalDay(value: string | null | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parts = value.split('-').map(Number);
  const y = parts[0] ?? 0;
  const m = parts[1] ?? 0;
  const d = parts[2] ?? 0;
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : null;
}

/** 저장된 목표의 마감일이 유효한 `YYYY-MM-DD` 가 아니면 '마감일 없음'으로 정리한다(나머지 필드는 유지). */
export function sanitizeWorkGoal(goal: WorkGoal): WorkGoal {
  return parseLocalDay(goal.deadline) ? goal : { ...goal, deadline: null };
}

/** 오늘(로컬)과 마감일(로컬)로 남은 일수. 마감일이 오늘이면 0, 지났으면 음수. */
export function daysUntil(deadline: string | null, today: Date): number | null {
  const day = parseLocalDay(deadline);
  if (!day) return null;
  return Math.round((dayStart(day) - dayStart(today)) / 86_400_000);
}

export function calcWorkGoal(goal: WorkGoal, current: GoalCurrent, today: Date): GoalProgress {
  const target = Math.max(0, Math.trunc(goal.episodes));
  const per = Math.max(0, Math.trunc(goal.perEpisode));
  const totalTarget = target * per;
  const currentChars = goal.basis === 'include' ? current.chars : current.charsNoSpace;
  const remainingEpisodes = Math.max(0, target - current.episodes);
  const remainingChars = Math.max(0, totalTarget - currentChars);
  const left = daysUntil(goal.deadline, today);
  const done = target > 0 && current.episodes >= target;
  let status: GoalStatus = 'ok';
  if (target === 0 || per === 0) status = 'none';
  else if (done) status = 'done';
  else if (left !== null && left < 0) status = 'overdue';
  else if (left === 0) status = 'dueToday';
  const daysLeft = left === null ? null : Math.max(0, left);
  const perDay = !done && status !== 'none' && daysLeft !== null && daysLeft > 0 ? Math.ceil(remainingChars / daysLeft) : null;
  return { status, remainingEpisodes, totalTarget, remainingChars, daysLeft, perDay };
}

/**
 * 카드 목표선 툴팁 문구. 마감 오늘/지남은 남은 일수 대신 상태를 보여 준다.
 * ko: `마감 <날짜> · N일 남음` / `오늘 마감` / `마감일 지남` / `마감일 없음`
 */
export function goalTooltip(opts: { locale: 'ko' | 'en'; progress: GoalProgress; deadline: string | null; dateText: string }): string {
  const { locale, progress, deadline, dateText } = opts;
  if (progress.daysLeft === null) return translate(locale, 'workGoal.noDeadlineTitle');
  if (progress.status === 'overdue') return translate(locale, 'workGoal.overdueTitle');
  if (progress.status === 'dueToday' || progress.daysLeft === 0) return translate(locale, 'workGoal.dueTodayTitle');
  const key = `workGoal.deadlineTitle.${progress.daysLeft === 1 ? 'one' : 'other'}` as Parameters<typeof translate>[1];
  return translate(locale, key, { date: dateText || deadline || '', days: progress.daysLeft });
}
export function goalLineText(opts: { locale: 'ko' | 'en'; episodes: number; goal: number; perDay: number | null; narrow: boolean }): string {
  const f = (n: number) => new Intl.NumberFormat(opts.locale).format(n);
  const params = { episodes: f(opts.episodes), goal: f(opts.goal), perDay: opts.perDay === null ? '' : f(opts.perDay) };
  if (opts.perDay === null) return translate(opts.locale, 'work.goalLine.head', params);
  return translate(opts.locale, opts.narrow ? 'work.goalLine.short' : 'work.goalLine', params);
}
