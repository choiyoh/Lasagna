import { addDays, parseYmd, startOfWeek, ymd } from './date-util';

const isPlainObject = (v: unknown): v is { start?: unknown; end?: unknown } => v !== null && typeof v === 'object' && !Array.isArray(v);

/** `month`(그 달 아무 날)의 달력 격자: 월요일 시작, 6주 × 7일 = 42칸. 각 칸은 로컬 자정 Date. */
export function monthGrid(month: Date): Date[] {
  const first = startOfWeek(new Date(month.getFullYear(), month.getMonth(), 1));
  return Array.from({ length: 42 }, (_, i) => addDays(first, i));
}

/** 같은 날인가(로컬 날짜 기준) */
export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * 기간 고르기 클릭 처리.
 * 첫 클릭 = 시작(끝 없음), 두 번째 클릭 = 끝(시작보다 앞이면 둘을 바꾼다).
 * 이미 시작·끝이 다 있으면 그 클릭이 새 시작이 된다.
 */
export function pickRange(cur: { start: Date | null; end: Date | null }, clicked: Date): { start: Date; end: Date | null } {
  if (!cur.start || cur.end) return { start: clicked, end: null };
  return clicked.getTime() < cur.start.getTime() ? { start: clicked, end: cur.start } : { start: cur.start, end: clicked };
}

/**
 * 셀 값으로: 시각(`HH:mm`, 없으면 null)을 붙여 `{ start }` 또는 `{ start, end }`.
 * 시작=끝(또는 끝 없음)이면 end 를 생략한다. 날짜 형식은 `YYYY-MM-DD` 또는 `YYYY-MM-DDTHH:mm`.
 */
export function toDateValue(start: Date, end: Date | null, time: string | null): { start: string; end?: string } {
  const t = time ? `T${time}` : '';
  const s = ymd(start) + t;
  if (!end || sameDay(start, end)) return { start: s };
  return { start: s, end: ymd(end) + t };
}

/** 셀 값에서 읽기: string 또는 {start,end?} → { start, end, time }. 잘못된 값이면 모두 null. */
export function fromDateValue(v: unknown): { start: Date | null; end: Date | null; time: string | null } {
  const raw = typeof v === 'string' ? { start: v } : isPlainObject(v) ? v : null;
  if (!raw || typeof raw.start !== 'string') return { start: null, end: null, time: null };
  const start = parseYmd(raw.start);
  if (!start) return { start: null, end: null, time: null };
  const endRaw = typeof raw.end === 'string' ? raw.end : null;
  const end = endRaw ? parseYmd(endRaw) : null;
  if (endRaw && !end) return { start: null, end: null, time: null };
  const t = /T(\d{2}:\d{2})/.exec(raw.start);
  return { start, end: end && end.getTime() < start.getTime() ? start : end, time: t ? t[1]! : null };
}

/** 달 이동(연도 넘김 처리), 결과는 그 달 1일 */
export function addMonths(month: Date, n: number): Date {
  return new Date(month.getFullYear(), month.getMonth() + n, 1);
}
