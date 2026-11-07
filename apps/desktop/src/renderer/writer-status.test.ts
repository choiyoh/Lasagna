import { setLocale } from '@nopsidian/i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSelectionReader, WRITER_PENDING, writerCountsText, writerDelay, writerSelectionText } from './writer-status';

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

describe('선택 표시 갱신기(디바운스 trailing)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('연속 이벤트(드래그·Shift+화살표)는 마지막 값만 반영한다', () => {
    const values = [1, 2, 3, 4, 5];
    let i = 0;
    const seen: (number | null)[] = [];
    const reader = createSelectionReader(() => ({ chars: values[Math.min(i, values.length - 1)] }), (v) => seen.push(v.chars));
    for (let step = 0; step < values.length; step += 1) {
      reader.schedule();
      vi.advanceTimersByTime(30); // 디바운스(100ms) 안에서 계속 바뀐다
      i += 1;
    }
    expect(seen).toEqual([]);
    vi.advanceTimersByTime(100);
    expect(seen).toEqual([5]); // 마지막 선택이 반영
  });

  it('선택이 끝나면(flush) 대기 없이 즉시 마지막 값을 반영한다', () => {
    let chars = 3;
    const seen: (number | null)[] = [];
    const reader = createSelectionReader(() => ({ chars }), (v) => seen.push(v.chars));
    reader.schedule();
    chars = 5; // 마지막 selectionchange 이후 값
    reader.flush();
    expect(seen).toEqual([5]);
    vi.advanceTimersByTime(200);
    expect(seen).toEqual([5]); // 중복 반영 없음
  });

  it('선택이 그대로면 다시 그리지 않는다', () => {
    const seen: (number | null)[] = [];
    const reader = createSelectionReader(() => ({ chars: 4 }), (v) => seen.push(v.chars));
    reader.flush();
    reader.flush();
    expect(seen).toEqual([4]);
  });

  it('선택 없음(null)은 숨김 상태로 반영한다', () => {
    const seen: (number | null)[] = [];
    const reader = createSelectionReader<{ chars: number } | null>(() => null, (v) => seen.push(v === null ? null : v.chars));
    reader.flush();
    expect(seen).toEqual([null]);
  });
});
