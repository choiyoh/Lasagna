import { describe, expect, it } from 'vitest';
import { translate } from '@nopsidian/i18n';

describe('작품 목표 영어 복수형', () => {
  it('1 vs 여러 개(remaining·remainingChars)', () => {
    expect(translate('en', 'workGoal.remaining.one', { episodes: '1' })).toBe('1 episode left');
    expect(translate('en', 'workGoal.remaining.other', { episodes: '2' })).toBe('2 episodes left');
    expect(translate('en', 'workGoal.remainingChars.one', { chars: '1' })).toBe('1 character left');
    expect(translate('en', 'workGoal.remainingChars.other', { chars: '250' })).toBe('250 characters left');
    // 한국어는 그대로
    expect(translate('ko', 'workGoal.remaining.other', { episodes: '1' })).toBe('남은 회차 1');
  });
});

describe('새 영어 숫자 문구 복수형', () => {
  it('today·deadlineTitle 1/0/2', () => {
    expect(translate('en', 'workGoal.today.one', { today: '1', percent: '50' })).toBe('1 character today · 50% of the needed amount');
    expect(translate('en', 'workGoal.today.other', { today: '0', percent: '0' })).toBe('0 characters today · 0% of the needed amount');
    expect(translate('en', 'workGoal.today.other', { today: '2', percent: '10' })).toBe('2 characters today · 10% of the needed amount');
    expect(translate('en', 'workGoal.deadlineTitle.one', { date: 'Dec 1', days: '1' })).toBe('Due Dec 1 · 1 day left');
    expect(translate('en', 'workGoal.deadlineTitle.other', { date: 'Dec 1', days: '2' })).toBe('Due Dec 1 · 2 days left');
  });
});
