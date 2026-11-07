import { formatNumber, translate } from '@nopsidian/i18n';
import type { TextStats } from '@nopsidian/core';

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
