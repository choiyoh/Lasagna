import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '@nopsidian/i18n';
import { basisChars, goalProgress, goalText, presetHintBasis, todayText } from './writer-goal';
import { writerCountsText } from './writer-status';

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

describe('목표 프리셋 안내', () => {
  it('기준이 다를 때만 그 프리셋 기준을 알려 준다(4가지 조합)', () => {
    expect(presetHintBasis('include', 'exclude')).toBe('include'); // 네이버/카카오 + 공백 제외 설정
    expect(presetHintBasis('exclude', 'include')).toBe('exclude'); // 리디 + 공백 포함 설정
    expect(presetHintBasis('include', 'include')).toBeNull();
    expect(presetHintBasis('exclude', 'exclude')).toBeNull();
  });
});

describe('영어 단수/복수', () => {
  it('글자수·오늘·목표 문구도 1 일 때 단수', () => {
    const one = { locale: 'en' as const, spacing: 'include' as const, stats: { chars: 1, charsNoSpace: 1, words: 1 }, narrow: false };
    expect(writerCountsText(one)).toBe('1 character · 1 word');
    expect(todayText({ locale: 'en', today: 1, goal: null })).toBe('Today 1 character');
    expect(todayText({ locale: 'en', today: 2, goal: 1 })).toBe('Today 2/1 character');
    expect(goalText({ locale: 'en', chars: 1, goal: 1 })).toBe('1/1 character');
    expect(todayText({ locale: 'en', today: 2, goal: 2 })).toBe('Today 2/2 characters');
  });
});
