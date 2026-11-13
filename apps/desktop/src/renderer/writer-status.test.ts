import { setLocale } from '@nopsidian/i18n';
import { afterEach, describe, expect, it } from 'vitest';
import { WRITER_PENDING, paperText, writerCountsText, writerDelay } from './writer-status';

const stats = { chars: 12340, charsNoSpace: 10982, words: 2010 };
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
  });
});

describe('원고지 매수 문구', () => {
  it('전체 글자수를 200자 1매로 환산해 소수 첫째 자리로 보여 준다', () => {
    expect(paperText({ locale: 'ko', chars: 5000, narrow: false })).toBe('원고지 25.0매');
    expect(paperText({ locale: 'ko', chars: 4321, narrow: false })).toBe('원고지 21.6매');
    expect(paperText({ locale: 'ko', chars: 0, narrow: false })).toBe('원고지 0.0매');
  });

  it('좁은 창에서는 라벨을 줄이고, 영어는 폭과 무관하게 짧은 pages 문구', () => {
    expect(paperText({ locale: 'ko', chars: 5000, narrow: true })).toBe('25.0매');
    expect(paperText({ locale: 'en', chars: 5000, narrow: false })).toBe('25.0 pages');
    expect(paperText({ locale: 'en', chars: 200, narrow: false })).toBe('1.0 pages');
    expect(paperText({ locale: 'en', chars: 5000, narrow: true })).toBe('25.0 pages');
    expect(paperText({ locale: 'en', chars: 1234, narrow: false })).toBe('6.2 pages');
  });
});

describe('계산 지연·로딩 표시', () => {
  it('문서가 크면 지연을 키우고(최대 1초), 작은 문서는 150ms', () => {
    expect(writerDelay(0)).toBe(150);
    expect(writerDelay(10_000)).toBe(150);
    expect(writerDelay(60_000)).toBe(400);
    expect(writerDelay(120_000)).toBe(800);
    expect(writerDelay(500_000)).toBe(1000);
  });

  it('계산 중에는 0 대신 … 을 보여 준다', () => {
    expect(WRITER_PENDING).toBe('…');
  });
});
