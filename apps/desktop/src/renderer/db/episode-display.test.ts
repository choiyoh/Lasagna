import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '@nopsidian/i18n';
import { formatUpdatedAt, goalMetState, isGoalMetFormula } from './episode-display';

afterEach(() => setLocale('ko'));

describe('회차 DB 수정일 표시', () => {
  it('ISO 를 기기 로컬 YYYY-MM-DD HH:mm 으로 바꾼다', () => {
    const iso = new Date(2026, 10, 13, 14, 5, 9).toISOString(); // 로컬 2026-11-13 14:05
    expect(formatUpdatedAt(iso)).toBe('2026-11-13 14:05');
    expect(formatUpdatedAt(new Date(2026, 0, 2, 0, 0).toISOString())).toBe('2026-01-02 00:00');
  });

  it('날짜가 아니면 원문을 그대로 둔다', () => {
    expect(formatUpdatedAt('어제')).toBe('어제');
    expect(formatUpdatedAt('')).toBe('');
  });
});

describe('goal_met 3상태', () => {
  it('목표 없음(null)·미달(false)·달성(true)을 구분한다', () => {
    expect(goalMetState(null)).toBe('none');
    expect(goalMetState(false)).toBe('miss');
    expect(goalMetState(true)).toBe('met');
  });

  it('goal_met() 수식만 대상으로 삼는다', () => {
    expect(isGoalMetFormula('goal_met()')).toBe(true);
    expect(isGoalMetFormula(' goal_met( ) ')).toBe(true);
    expect(isGoalMetFormula('note_chars() > 3000')).toBe(false);
    expect(isGoalMetFormula(undefined)).toBe(false);
  });
});
