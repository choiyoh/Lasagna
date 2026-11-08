import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '@nopsidian/i18n';
import { workMetaText } from './WorkSection';

afterEach(() => setLocale('ko'));

describe('작품 카드 meta', () => {
  it('회차 수와 현재 글자수 기준을 반영한다(ko/en)', () => {
    const work = { episodes: 12, chars: 84200, charsNoSpace: 80100 };
    expect(workMetaText('ko', work, 'include')).toBe('12회차 · 84,200자');
    expect(workMetaText('ko', work, 'exclude')).toBe('12회차 · 80,100자');
    expect(workMetaText('en', work, 'include')).toBe('12 episodes · 84,200 characters');
  });
});
