import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '@nopsidian/i18n';
import { chipText, workMetaText } from './WorkSection';

afterEach(() => setLocale('ko'));

describe('작품 카드 meta', () => {
  it('회차 수와 현재 글자수 기준을 반영한다(ko/en)', () => {
    const work = { episodes: 12, chars: 84200, charsNoSpace: 80100 };
    expect(workMetaText('ko', work, 'include')).toBe('12회차 · 84,200자');
    expect(workMetaText('ko', work, 'exclude')).toBe('12회차 · 80,100자');
    expect(workMetaText('en', work, 'include')).toBe('12 episodes · 84,200 characters');
  });
});

describe('작품 칩 문구', () => {
  it('1440 은 숫자, 920 이하는 숫자 없이 축약(작가 모드 전용)', () => {
    expect(chipText('ko', 'characters', 8, false)).toBe('캐릭터 8');
    expect(chipText('ko', 'characters', 8, true)).toBe('캐릭터');
    expect(chipText('ko', 'storyBible', 5, true)).toBe('설정집');
    expect(chipText('en', 'characters', 1, false)).toBe('1 character');
    expect(chipText('en', 'storyBible', 2, true)).toBe('Story bible');
  });
});

describe('영어 단수/복수', () => {
  it('1/0/2 회차·캐릭터', () => {
    expect(workMetaText('en', { episodes: 1, chars: 1, charsNoSpace: 1 }, 'include')).toBe('1 episode · 1 character');
    expect(workMetaText('en', { episodes: 1, chars: 10, charsNoSpace: 10 }, 'include')).toBe('1 episode · 10 characters');
    expect(workMetaText('en', { episodes: 2, chars: 10, charsNoSpace: 10 }, 'include')).toBe('2 episodes · 10 characters');
    expect(chipText('en', 'characters', 1, false)).toBe('1 character');
    expect(chipText('en', 'characters', 0, false)).toBe('0 characters');
    expect(chipText('en', 'characters', 2, false)).toBe('2 characters');
    expect(chipText('ko', 'characters', 1, false)).toBe('캐릭터 1');
  });
});
