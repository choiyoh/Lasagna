import { formatNumber, pluralCategory, translate } from '@nopsidian/i18n';
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
  // 영어는 목표 숫자가 1 일 때 단수(1 character).
  return translate(opts.locale, `writer.goalProgress.${pluralCategory(opts.locale, opts.goal)}`, { count, goal });
}

/** 오늘 쓴 글자수 표기: 목표가 있으면 `오늘 1,200/3,000자`, 없으면 `오늘 1,200자`. */
export function todayText(opts: { locale: 'ko' | 'en'; today: number; goal: number | null }): string {
  const today = formatNumber(opts.today, opts.locale);
  if (opts.goal === null || opts.goal <= 0) {
    return translate(opts.locale, `writer.today.${pluralCategory(opts.locale, opts.today)}`, { count: today });
  }
  return translate(opts.locale, `writer.todayGoal.${pluralCategory(opts.locale, opts.goal)}`, {
    count: today,
    goal: formatNumber(opts.goal, opts.locale),
  });
}

/**
 * 프리셋 안내 — 프리셋의 기준이 현재 글자수 기준과 다를 때만 **그 프리셋의 기준**을 알려 준다.
 * 같으면 null(안내 없음). 설정은 바꾸지 않는다.
 */
export function presetHintBasis(basis: 'include' | 'exclude', spacing: 'include' | 'exclude'): 'include' | 'exclude' | null {
  return basis === spacing ? null : basis;
}

/** 글자수 기준(공백 포함/제외)에 맞는 값 — 진행·오늘 합계 모두 같은 기준을 쓴다. */
export function basisChars(stats: TextStats, spacing: 'include' | 'exclude'): number {
  return spacing === 'include' ? stats.chars : stats.charsNoSpace;
}
