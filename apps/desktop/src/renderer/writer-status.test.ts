import { setLocale } from '@nopsidian/i18n';
import { afterEach, describe, expect, it } from 'vitest';
import { editorSelectionStats, WRITER_PENDING, writerCountsText, writerDelay, writerSelectionText } from './writer-status';

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

describe('에디터 선택 클램프(퍼징)', () => {
  it('탭·공백이 섞인 선택도 전체를 넘지 않는다', () => {
    const docs = ['| a | b |\n|---|---|\n| 1 | 2 |', '수식 $x^2$ 와 각주[^1]\n\n[^1]: 각주', '> [!note] 제목\n> 내용', ':::columns\n가\n:::'];
    const totals = [
      { chars: 4, charsNoSpace: 4, words: 4 },
      { chars: 9, charsNoSpace: 7, words: 4 },
      { chars: 4, charsNoSpace: 4, words: 2 },
      { chars: 1, charsNoSpace: 1, words: 1 },
    ];
    for (const [i, doc] of docs.entries()) {
      const total = totals[i]!;
      for (let from = 0; from <= doc.length; from += 1) {
        for (let to = from; to <= doc.length; to += 2) {
          const part = editorSelectionStats(doc.slice(from, to), total);
          if (!part) continue;
          expect(part.chars).toBeLessThanOrEqual(total.chars);
          expect(part.charsNoSpace).toBeLessThanOrEqual(total.charsNoSpace);
        }
      }
    }
  });

  it('빈 선택은 null', () => {
    expect(editorSelectionStats('   \n', { chars: 5, charsNoSpace: 5, words: 1 })).toBeNull();
  });
});
