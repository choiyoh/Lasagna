import { formatNumber, pluralCategory, translate } from '@nopsidian/i18n';
import { paperSheets, type TextStats } from '@nopsidian/core';

/** 소수 첫째 자리 고정 표기(12,340 → '25.0'). */
function formatSheets(value: number, locale: 'ko' | 'en'): string {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);
}

/**
 * 원고지 매수 문구 — 전체 글자수 뒤에 붙인다. 좁은 창에서는 '원고지' 라벨만 줄인다.
 * 영어는 폭이 넓어도 긴 'manuscript pages' 가 상태줄을 두 줄로 접히게 하므로 짧은 문구만 쓴다
 * (1.0 도 pages — 소수라 단수 처리를 하지 않는다). 한국어·꺼진 상태의 표시는 그대로다.
 */
export function paperText(opts: { locale: 'ko' | 'en'; chars: number; narrow: boolean }): string {
  const { locale, chars, narrow } = opts;
  const count = formatSheets(paperSheets(chars), locale);
  return translate(locale, narrow || locale === 'en' ? 'writer.paperShort' : 'writer.paper', { count });
}

/** 글자수 상태줄 문구(한국어는 글자수만, 영어는 글자수+단어수). 좁은 창에서는 한국어 기준을 줄인다. */
export function writerCountsText(opts: { locale: 'ko' | 'en'; spacing: 'include' | 'exclude'; stats: TextStats; narrow: boolean }): string {
  const { locale, spacing, stats, narrow } = opts;
  const count = formatNumber(spacing === 'include' ? stats.chars : stats.charsNoSpace, locale);
  const key =
    narrow && locale === 'ko'
      ? spacing === 'include'
        ? 'writer.charsShort'
        : 'writer.charsNoSpaceShort'
      : `${spacing === 'include' ? 'writer.chars' : 'writer.charsNoSpace'}.${pluralCategory(locale, spacing === 'include' ? stats.chars : stats.charsNoSpace)}`;
  const head = translate(locale, key, { count });
  // 영어만 단어 수를 덧붙인다(한국어는 글자수 기준). 영어는 1 일 때 단수.
  if (locale !== 'en') return head;
  const words = translate(locale, `writer.words.${pluralCategory(locale, stats.words)}`, { words: formatNumber(stats.words, locale) });
  return `${head} · ${words}`;
}

/** 글자수 계산을 미루는 시간 — 문서가 크면 더 모아서(입력 지연 방지) idle 에서 계산한다. */
export function writerDelay(chars: number): number {
  return Math.min(1000, Math.max(150, Math.round(chars / 150)));
}

/** 아직 계산 중일 때 보여 주는 표시(0 으로 보이지 않게). */
export const WRITER_PENDING = '…';
