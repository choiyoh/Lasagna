import type { CellValue, DbRowDto } from './types';

const p2 = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM-DD`(로컬) */
export const ymd = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;

/** `YYYY-MM-DD` → 로컬 자정 Date (잘못된 문자열은 null) */
export function parseYmd(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  const d = new Date(+m[1]!, +m[2]! - 1, +m[3]!);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const daysBetween = (a: Date, b: Date) => Math.round((new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime() - new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime()) / 86400000);
/** 월요일 시작 주의 첫날 */
export const startOfWeek = (d: Date) => addDays(d, -((d.getDay() + 6) % 7));

export interface Span {
  start: Date;
  /** 포함하는 마지막 날 */
  end: Date;
  /** 시각이 있는 날짜인가(셀 값을 다시 쓸 때 시각을 유지하려고) */
  time: string | null;
}

/** 셀 값의 기간. 날짜가 아니면 null */
export function spanOf(v: CellValue): Span | null {
  if (v === null || typeof v === 'boolean' || typeof v === 'number' || Array.isArray(v)) {
    return typeof v === 'string' ? null : null;
  }
  const raw = typeof v === 'string' ? v : v.start;
  const start = parseYmd(raw);
  if (!start) return null;
  const endRaw = typeof v === 'object' && v.end ? v.end : null;
  const end = (endRaw && parseYmd(endRaw)) || start;
  const t = /T(\d{2}:\d{2})/.exec(raw);
  return { start, end: end < start ? start : end, time: t ? t[1]! : null };
}

/** 기간을 `shift` 일 옮긴 새 셀 값(시각·기간 길이 유지) */
export function shiftValue(v: CellValue, shift: number): CellValue {
  const s = spanOf(v);
  if (!s) return v;
  const hasEnd = typeof v === 'object' && v !== null && !Array.isArray(v) && !!v.end;
  const fmt = (d: Date) => ymd(addDays(d, shift)) + (s.time ? `T${s.time}` : '');
  return hasEnd ? { start: fmt(s.start), end: ymd(addDays(s.end, shift)) + (s.time ? `T${s.time}` : '') } : { start: fmt(s.start) };
}

export const rowSpan = (r: DbRowDto, prop: string): Span | null => spanOf((r.values[prop] ?? null) as CellValue);
