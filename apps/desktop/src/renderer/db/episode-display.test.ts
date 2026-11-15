import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '@nopsidian/i18n';
import { episodeStatusColor, formatUpdatedAt, goalMetState, isGoalMetFormula } from './episode-display';

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

describe('회차 DB 상태 칩 색', () => {
  const prop = {
    type: 'status' as const,
    options: [
      { name: '초고', group: 'todo' as const },
      { name: '퇴고', group: 'doing' as const },
      { name: '완료', group: 'done' as const },
      { name: '직접색', group: 'todo' as const, color: 'blue' },
    ],
  };

  it('색이 없으면 그룹으로 회색·주황·초록을 고른다', () => {
    expect(episodeStatusColor(prop, '초고')).toBe('gray');
    expect(episodeStatusColor(prop, '퇴고')).toBe('orange');
    expect(episodeStatusColor(prop, '완료')).toBe('green');
  });

  it('옵션에 색이 있으면 그 색을 쓰고, 상태가 아니면 색을 만들지 않는다', () => {
    expect(episodeStatusColor(prop, '직접색')).toBe('blue');
    expect(episodeStatusColor({ type: 'select', options: [{ name: '초고', group: 'todo' }] }, '초고')).toBeUndefined();
    expect(episodeStatusColor(prop, '없는값')).toBeUndefined();
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
