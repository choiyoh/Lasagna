import { formatNumber, translate } from '@nopsidian/i18n';
import type { TextStats } from '@nopsidian/core';

/** 진행률(0~1)과 초과 분량. 목표가 없거나 0 이하면 진행률 0. */
export function goalProgress(chars: number, goal: number | null): { ratio: number; over: number } {
  if (goal === null || !Number.isFinite(goal) || goal <= 0) return { ratio: 0, over: 0 };
  return { ratio: Math.min(1, Math.max(0, chars / goal)), over: Math.max(0, chars - goal) };
}

/** 상태줄 진행 표기: ko `3,200/5,000자`, en `3,200/5,000 characters`. */
export function goalText(opts: { locale: 'ko' | 'en'; chars: number; goal: number; narrow?: boolean }): string {
  const count = formatNumber(opts.chars, opts.locale);
  const goal = formatNumber(opts.goal, opts.locale);
  // 920px 이하에서는 시안대로 단위를 뺀 `n/목표` 만 보여 준다.
  if (opts.narrow) return translate(opts.locale, 'writer.goalProgressShort', { count, goal });
  return translate(opts.locale, 'writer.goalProgress', { count, goal });
}

/** 오늘 쓴 글자수 표기: 목표가 있으면 `오늘 1,200/3,000자`, 없으면 `오늘 1,200자`. */
export function todayText(opts: { locale: 'ko' | 'en'; today: number; goal: number | null }): string {
  const today = formatNumber(opts.today, opts.locale);
  if (opts.goal === null || opts.goal <= 0) return translate(opts.locale, 'writer.today', { count: today });
  return translate(opts.locale, 'writer.todayGoal', { count: today, goal: formatNumber(opts.goal, opts.locale) });
}

/** 글자수 기준(공백 포함/제외)에 맞는 값 — 진행·오늘 합계 모두 같은 기준을 쓴다. */
export function basisChars(stats: TextStats, spacing: 'include' | 'exclude'): number {
  return spacing === 'include' ? stats.chars : stats.charsNoSpace;
}
