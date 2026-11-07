import { formatNumber, translate } from '@nopsidian/i18n';
import { countPlain, type TextStats } from '@nopsidian/core';

/** 글자수 상태줄 문구(한국어는 글자수만, 영어는 글자수+단어수). 좁은 창에서는 한국어 기준을 줄인다. */
export function writerCountsText(opts: { locale: 'ko' | 'en'; spacing: 'include' | 'exclude'; stats: TextStats; narrow: boolean }): string {
  const { locale, spacing, stats, narrow } = opts;
  const count = formatNumber(spacing === 'include' ? stats.chars : stats.charsNoSpace, locale);
  const key =
    narrow && locale === 'ko'
      ? spacing === 'include'
        ? 'writer.charsShort'
        : 'writer.charsNoSpaceShort'
      : spacing === 'include'
        ? 'writer.chars'
        : 'writer.charsNoSpace';
  const head = translate(locale, key, { count });
  // 영어만 단어 수를 덧붙인다(한국어는 글자수 기준).
  return locale === 'en' ? `${head} · ${translate(locale, 'writer.words', { words: formatNumber(stats.words, locale) })}` : head;
}

/** 글자수 계산을 미루는 시간 — 문서가 크면 더 모아서(입력 지연 방지) idle 에서 계산한다. */
export function writerDelay(chars: number): number {
  return Math.min(1000, Math.max(150, Math.round(chars / 150)));
}

/**
 * 에디터 모드 선택 글자수 — 블록 구분자(`\n`)만 넣은 선택 텍스트를 세고,
 * 전체(파서 값 기준)보다 커지지 않게 클램프한다(표 탭·수식·각주 렌더 텍스트 차이 방어).
 */
export function editorSelectionStats(text: string, total: TextStats | null): TextStats | null {
  if (text.trim() === '') return null;
  const part = countPlain(text);
  if (!total) return part;
  return {
    chars: Math.min(part.chars, total.chars),
    charsNoSpace: Math.min(part.charsNoSpace, total.charsNoSpace),
    words: part.words,
  };
}

/** 아직 계산 중일 때 보여 주는 표시(0 으로 보이지 않게). */
export const WRITER_PENDING = '…';

/** 선택 영역이 있을 때는 선택/전체만 보여 준다(글자수 줄은 숨긴다). */
export function writerSelectionText(opts: {
  locale: 'ko' | 'en';
  spacing: 'include' | 'exclude';
  stats: TextStats;
  selected: TextStats;
}): string {
  const pick = (s: TextStats) => formatNumber(opts.spacing === 'include' ? s.chars : s.charsNoSpace, opts.locale);
  return translate(opts.locale, 'writer.selection', { selected: pick(opts.selected), total: pick(opts.stats) });
}
