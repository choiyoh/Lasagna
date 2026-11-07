import { setLocale } from '@nopsidian/i18n';
import { afterEach, describe, expect, it } from 'vitest';
import { writerCountsText, writerSelectionText } from './writer-status';

const stats = { chars: 12340, charsNoSpace: 10982, words: 2010 };
const selected = { chars: 120, charsNoSpace: 100, words: 20 };
afterEach(() => setLocale('ko'));

describe('작가 모드 상태줄 문구', () => {
  it('한국어는 글자수만, 영어는 글자수+단어수', () => {
    expect(writerCountsText({ locale: 'ko', spacing: 'include', stats, narrow: false })).toBe('12,340자 · 공백 포함');
    expect(writerCountsText({ locale: 'ko', spacing: 'exclude', stats, narrow: false })).toBe('10,982자 · 공백 제외');
    expect(writerCountsText({ locale: 'en', spacing: 'include', stats, narrow: false })).toBe('12,340 characters · 2,010 words');
    expect(writerCountsText({ locale: 'en', spacing: 'exclude', stats, narrow: false })).toBe('10,982 characters (no spaces) · 2,010 words');
  });

  it('좁은 창에서는 한국어 기준 표기를 줄인다(영어는 그대로)', () => {
    expect(writerCountsText({ locale: 'ko', spacing: 'include', stats, narrow: true })).toBe('12,340자 · 포함');
    expect(writerCountsText({ locale: 'ko', spacing: 'exclude', stats, narrow: true })).toBe('10,982자 · 제외');
    expect(writerCountsText({ locale: 'en', spacing: 'include', stats, narrow: true })).toBe('12,340 characters · 2,010 words');
  });

  it('선택 중에는 선택/전체만 보여 주고 공백 기준을 따른다', () => {
    expect(writerSelectionText({ locale: 'ko', spacing: 'include', stats, selected })).toBe('선택 120 / 전체 12,340');
    expect(writerSelectionText({ locale: 'ko', spacing: 'exclude', stats, selected })).toBe('선택 100 / 전체 10,982');
    expect(writerSelectionText({ locale: 'en', spacing: 'include', stats, selected })).toBe('120 / 12,340 selected');
  });
});
