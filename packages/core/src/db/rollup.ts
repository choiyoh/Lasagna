import type { CellValue, DateValue } from './values.js';
import { isEmptyCell } from './values.js';

/**
 * 롤업 속성 = 관계로 이어진 대상 노트들의 어떤 속성 값을 모아 하나의 값으로 집계한다.
 * 입력은 대상 노트 하나당 값 하나(비어 있으면 null)인 `CellValue[]` 이고, `total` 은 그 길이(연결된 대상 수)다.
 * 집계할 값이 없으면 null 을 돌려준다.
 */

/** 롤업 집계 함수(스키마 `fn`). */
export const ROLLUP_FNS = [
  'show_original',
  'count',
  'count_values',
  'count_unique',
  'count_empty',
  'percent_empty',
  'percent_not_empty',
  'sum',
  'avg',
  'median',
  'min',
  'max',
  'range',
  'earliest',
  'latest',
  'date_range',
  'checked',
  'unchecked',
  'percent_checked',
  'percent_unchecked',
] as const;

export type RollupFn = (typeof ROLLUP_FNS)[number];

/** 문자열이 롤업 집계 함수인지 */
export function isRollupFn(s: string): s is RollupFn {
  return (ROLLUP_FNS as readonly string[]).includes(s);
}

// ── 값 해석 ──────────────────────────────────────────────────────
const DATE_LIKE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/** 날짜를 화면 문자열로: 한 날짜는 `YYYY-MM-DD`, 기간은 `시작 → 끝` */
function dateText(d: DateValue): string {
  return d.end ? `${d.start} → ${d.end}` : d.start;
}

/** 셀 값을 날짜로 해석한다. 날짜가 아니면 null. */
function asDate(v: CellValue): DateValue | null {
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
    return DATE_LIKE.test(v.start) ? (v.end ? { start: v.start, end: v.end } : { start: v.start }) : null;
  }
  if (typeof v === 'string' && DATE_LIKE.test(v)) return { start: v.replace(' ', 'T') };
  return null;
}

/** 숫자로 해석 가능한 값만(문자열 숫자는 변환). 불리언·배열·날짜·null 은 제외한다. */
function asNumber(v: CellValue): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const s = v.trim().replace(/[,\s]/g, '').replace(/%$/, '');
    if (s === '') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** 숫자로 볼 수 있는 값만 모은다 */
function numericValues(values: CellValue[]): number[] {
  const out: number[] = [];
  for (const v of values) {
    const n = asNumber(v);
    if (n !== null) out.push(n);
  }
  return out;
}

/** 고유 값 판정용 키 — 배열은 항목 단위로 펼치고, 날짜는 시작~끝 문자열로. 빈 값은 키가 없다. */
function uniqueKeys(value: CellValue): string[] {
  if (isEmptyCell(value)) return [];
  if (Array.isArray(value)) return value;
  if (value !== null && typeof value === 'object') return [dateText(value)];
  return [String(value)];
}

/** `show_original` 용 문자열 */
function toText(v: CellValue): string {
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) return dateText(v);
  return String(v);
}

/** 대상 수가 0이면 null, 아니면 `part/total` 을 0~100 으로 반올림(둘째 자리) */
function percent(part: number, total: number): CellValue {
  return total === 0 ? null : Math.round((part / total) * 10000) / 100;
}

/** 빈 값(빈 셀·null) 개수 */
function countEmpty(values: CellValue[]): number {
  let n = 0;
  for (const v of values) if (isEmptyCell(v)) n += 1;
  return n;
}

/** 시작일의 최소·최대 */
function dateStarts(values: CellValue[]): { min: string; max: string } | null {
  let min: string | null = null;
  let max: string | null = null;
  for (const v of values) {
    const d = asDate(v);
    if (!d) continue;
    if (min === null || d.start < min) min = d.start;
    if (max === null || d.start > max) max = d.start;
  }
  return min === null || max === null ? null : { min, max };
}

/** 가장 이른 시작 ~ 가장 늦은 끝(끝이 없으면 그 값의 시작) */
function dateBounds(values: CellValue[]): { start: string; end: string } | null {
  let start: string | null = null;
  let end: string | null = null;
  for (const v of values) {
    const d = asDate(v);
    if (!d) continue;
    if (start === null || d.start < start) start = d.start;
    const e = d.end ?? d.start;
    if (end === null || e > end) end = e;
  }
  return start === null || end === null ? null : { start, end };
}

// ── 집계 ─────────────────────────────────────────────────────────
/** 집계. `values` 는 대상 노트마다 하나(빈 값은 null). `total` 은 연결된 대상 노트 수 = values.length. 결과가 없으면 null. */
export function rollupValues(fn: RollupFn, values: CellValue[]): CellValue {
  const total = values.length;
  switch (fn) {
    case 'show_original': {
      const out: string[] = [];
      for (const v of values) {
        if (v === null) continue;
        if (Array.isArray(v)) out.push(...v);
        else out.push(toText(v));
      }
      return out.length ? out : null;
    }
    case 'count':
      return total;
    case 'count_values':
      return total - countEmpty(values);
    case 'count_empty':
      return countEmpty(values);
    case 'count_unique': {
      const seen = new Set<string>();
      for (const v of values) for (const key of uniqueKeys(v)) seen.add(key);
      return seen.size;
    }
    case 'percent_empty':
      return percent(countEmpty(values), total);
    case 'percent_not_empty':
      return percent(total - countEmpty(values), total);
    case 'sum':
    case 'avg':
    case 'median':
    case 'min':
    case 'max':
    case 'range': {
      const nums = numericValues(values);
      if (fn === 'sum') return nums.reduce((a, b) => a + b, 0);
      if (nums.length === 0) return null;
      if (fn === 'avg') return nums.reduce((a, b) => a + b, 0) / nums.length;
      if (fn === 'median') {
        const sorted = [...nums].sort((a, b) => a - b);
        const mid = sorted.length >> 1;
        return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
      }
      let min = nums[0]!;
      let max = nums[0]!;
      for (const n of nums) {
        if (n < min) min = n;
        if (n > max) max = n;
      }
      if (fn === 'min') return min;
      if (fn === 'max') return max;
      return max - min; // range
    }
    case 'earliest': {
      const s = dateStarts(values);
      return s ? { start: s.min } : null;
    }
    case 'latest': {
      const s = dateStarts(values);
      return s ? { start: s.max } : null;
    }
    case 'date_range': {
      const b = dateBounds(values);
      if (!b) return null;
      return b.start === b.end ? { start: b.start } : { start: b.start, end: b.end };
    }
    case 'checked': {
      let n = 0;
      for (const v of values) if (v === true) n += 1;
      return n;
    }
    case 'unchecked': {
      let n = 0;
      for (const v of values) if (v === false) n += 1;
      return n;
    }
    case 'percent_checked': {
      let n = 0;
      for (const v of values) if (v === true) n += 1;
      return percent(n, total);
    }
    case 'percent_unchecked': {
      let n = 0;
      for (const v of values) if (v === false) n += 1;
      return percent(n, total);
    }
  }
}
