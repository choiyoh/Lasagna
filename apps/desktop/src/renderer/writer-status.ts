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

/** 글자수 계산을 미루는 시간 — 문서가 크면 더 모아서(입력 지연 방지) idle 에서 계산한다. */
export function writerDelay(chars: number): number {
  return Math.min(1000, Math.max(150, Math.round(chars / 150)));
}

/**
 * 선택 표시 갱신기 — **leading + trailing**: 첫 이벤트는 즉시, 이후 연속 이벤트는 delay 간격으로 마지막 값을 반영한다.
 * (드래그·Shift 확장 중에도 100ms 안에 갱신되고, 마지막 선택은 반드시 반영된다.)
 */
export function createSelectionReader<T>(read: () => T, onChange: (value: T) => void, delay = 100) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last: string | undefined;
  let lastRunAt = 0;
  const run = () => {
    timer = undefined;
    lastRunAt = Date.now();
    const value = read();
    const key = JSON.stringify(value);
    if (key === last) return; // 선택이 그대로면 다시 그리지 않는다
    last = key;
    onChange(value);
  };
  return {
    /** 첫 이벤트는 즉시, 이후에는 delay 간격으로 마지막 값을 반영 */
    schedule() {
      const wait = delay - (Date.now() - lastRunAt);
      if (timer === undefined && wait <= 0) return run();
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(run, Math.max(0, wait));
    },
    /** 마우스 업·키 업·총계 준비: 대기 중인 마지막 선택을 즉시 반영 */
    flush() {
      if (timer !== undefined) clearTimeout(timer);
      run();
    },
    cancel() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
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
