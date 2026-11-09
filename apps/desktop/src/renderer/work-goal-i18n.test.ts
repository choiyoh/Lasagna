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
