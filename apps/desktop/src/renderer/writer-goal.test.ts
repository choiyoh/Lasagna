import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '@nopsidian/i18n';
import { basisChars, goalProgress, goalText, todayText } from './writer-goal';

afterEach(() => setLocale('ko'));

describe('목표 진행·오늘 쓴 글자수 문구', () => {
  it('진행률은 0~1 로 자르고 초과 분량을 따로 준다', () => {
    expect(goalProgress(1600, 5000)).toEqual({ ratio: 0.32, over: 0 });
    expect(goalProgress(5000, 5000)).toEqual({ ratio: 1, over: 0 });
    expect(goalProgress(5240, 5000).ratio).toBe(1);
    expect(goalProgress(5240, 5000).over).toBe(240);
    expect(goalProgress(1200, null)).toEqual({ ratio: 0, over: 0 });
    expect(goalProgress(1200, 0)).toEqual({ ratio: 0, over: 0 });
  });

  it('한국어·영어 진행 표기(920px 이하는 단위 없이)', () => {
    expect(goalText({ locale: 'ko', chars: 3200, goal: 5000 })).toBe('3,200/5,000자');
    expect(goalText({ locale: 'en', chars: 3200, goal: 5000 })).toBe('3,200/5,000 characters');
    expect(goalText({ locale: 'ko', chars: 3200, goal: 5000, narrow: true })).toBe('3,200/5,000');
    expect(goalText({ locale: 'en', chars: 3200, goal: 5000, narrow: true })).toBe('3,200/5,000');
  });

  it('오늘 표기: 목표가 있으면 /목표, 없으면 글자수만', () => {
    expect(todayText({ locale: 'ko', today: 1200, goal: 3000 })).toBe('오늘 1,200/3,000자');
    expect(todayText({ locale: 'ko', today: 1200, goal: null })).toBe('오늘 1,200자');
    expect(todayText({ locale: 'en', today: 1200, goal: 3000 })).toBe('Today 1,200/3,000 characters');
    expect(todayText({ locale: 'en', today: 1200, goal: null })).toBe('Today 1,200 characters');
  });

  it('글자수 기준에 맞는 값을 쓴다', () => {
    const stats = { chars: 12340, charsNoSpace: 10982, words: 2010 };
    expect(basisChars(stats, 'include')).toBe(12340);
    expect(basisChars(stats, 'exclude')).toBe(10982);
  });
});
