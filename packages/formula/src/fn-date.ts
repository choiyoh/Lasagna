import type { FunctionDef } from './registry.js';
import { formulaError, isDate, typeParam, type FDate, type FValue } from './value.js';

/**
 * 함수 라이브러리(date) — 날짜 값 만들기·산술·서식.
 *
 * 달력 연산(년·월·일·요일·시·분)은 모두 **로컬 시간대**(`Date` 의 get/set 메서드)로 한다.
 * 날짜만 값(`hasTime:false`)은 로컬 자정으로 둔다. 시·분·초를 더하면 시각 포함으로 승격한다.
 */

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

const SECOND_MS = 1_000;
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** 날짜 값 만들기. `endMs` 가 있으면 기간. */
const mkDate = (ms: number, hasTime: boolean, endMs?: number): FDate =>
  endMs === undefined ? { kind: 'date', ms, hasTime } : { kind: 'date', ms, hasTime, endMs };

/** 날짜 인자를 꺼낸다(null 은 호출 쪽에서 먼저 걸러 낸다). */
function asDate(v: FValue, fn: string): FDate {
  if (!isDate(v)) throw formulaError('formula.err.needsDate', { fn, type: typeParam(v) });
  return v;
}

type Unit = 'year' | 'quarter' | 'month' | 'week' | 'day' | 'hour' | 'minute' | 'second';

const UNITS: Record<string, Unit> = {
  year: 'year',
  quarter: 'quarter',
  month: 'month',
  week: 'week',
  day: 'day',
  hour: 'hour',
  minute: 'minute',
  second: 'second',
};

/** 단위 문자열(단수·복수)을 정규화한다. 모르는 단위는 FormulaError. */
function unitOf(v: FValue, fn: string): Unit {
  if (typeof v !== 'string') throw formulaError('formula.err.unitString', { fn });
  const key = v.trim().toLowerCase().replace(/s$/, '');
  const u = UNITS[key];
  if (!u) throw formulaError('formula.err.unknownUnit', { unit: String(v) });
  return u;
}

/** 수량은 정수. 빈 값은 0, 소수는 FormulaError. */
function amountOf(v: FValue, fn: string): number {
  if (v === null) return 0;
  if (typeof v !== 'number' || !Number.isInteger(v)) throw formulaError('formula.err.quantityInteger', { fn });
  return v;
}

const daysInMonth = (year: number, month0: number) => new Date(year, month0 + 1, 0).getDate();

/** 로컬 달력 기준으로 한 시점을 옮긴다. 시·분·초는 정확한 경과 시간이다. */
function shift(ms: number, amount: number, unit: Unit, hasTime: boolean): { ms: number; hasTime: boolean } {
  const t = new Date(ms);
  switch (unit) {
    case 'year':
    case 'quarter':
    case 'month': {
      // 월 단위는 월말 보정: 1월 31일 + 1개월 = 2월 28/29일
      const months = unit === 'year' ? amount * 12 : unit === 'quarter' ? amount * 3 : amount;
      const day = t.getDate();
      t.setDate(1);
      t.setMonth(t.getMonth() + months);
      t.setDate(Math.min(day, daysInMonth(t.getFullYear(), t.getMonth())));
      return { ms: t.getTime(), hasTime };
    }
    case 'week':
      t.setDate(t.getDate() + amount * 7);
      return { ms: t.getTime(), hasTime };
    case 'day':
      // 달력 일: 서머타임을 걸쳐도 같은 시각을 유지한다
      t.setDate(t.getDate() + amount);
      return { ms: t.getTime(), hasTime };
    case 'hour':
      return { ms: ms + amount * HOUR_MS, hasTime: true };
    case 'minute':
      return { ms: ms + amount * MINUTE_MS, hasTime: true };
    case 'second':
      return { ms: ms + amount * SECOND_MS, hasTime: true };
  }
}

function addImpl(fn: string, sign: 1 | -1, args: FValue[]): FValue {
  const v = args[0]!;
  if (v === null) return null;
  const d = asDate(v, fn);
  const amount = amountOf(args[1]!, fn) * sign;
  const unit = unitOf(args[2]!, fn);
  const start = shift(d.ms, amount, unit, d.hasTime);
  // 기간이면 양 끝 모두 이동한다
  return d.endMs === undefined
    ? mkDate(start.ms, start.hasTime)
    : mkDate(start.ms, start.hasTime, shift(d.endMs, amount, unit, d.hasTime).ms);
}

/** `YYYY-MM-DD` · `YYYY/MM/DD` · `YYYY-MM-DDTHH:mm[:ss]`(공백 구분도 허용) */
const DATE_RE = /^(\d{4})[-/](\d{2})[-/](\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

function parseDate(v: FValue): FValue {
  if (v === null) return null;
  if (isDate(v)) return v;
  if (typeof v !== 'string') throw formulaError('formula.err.parseDateArg', { type: typeParam(v) });
  const m = DATE_RE.exec(v.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hasTime = m[4] !== undefined;
  const hour = hasTime ? Number(m[4]) : 0;
  const minute = hasTime ? Number(m[5]) : 0;
  const second = m[6] !== undefined ? Number(m[6]) : 0;
  const t = new Date(year, month - 1, day, hour, minute, second);
  // 없는 날짜(2026-02-30, 25시 …)는 Date 가 굴려 버리므로 되짚어 확인한다
  if (
    t.getFullYear() !== year ||
    t.getMonth() !== month - 1 ||
    t.getDate() !== day ||
    t.getHours() !== hour ||
    t.getMinutes() !== minute ||
    t.getSeconds() !== second
  ) {
    return null;
  }
  return mkDate(t.getTime(), hasTime);
}

const dayKey = (ms: number): number => {
  const t = new Date(ms);
  return Date.UTC(t.getFullYear(), t.getMonth(), t.getDate());
};

/** a − b 를 달력 기준 개월 수로. 1월 31일 vs 2월 28일 → 0 (월말 보정 결과를 되돌리면 원래 날짜가 아니므로). */
function monthsBetween(a: number, b: number): number {
  const sign = a >= b ? 1 : -1;
  const later = new Date(Math.max(a, b));
  const earlier = new Date(Math.min(a, b));
  let months = (later.getFullYear() - earlier.getFullYear()) * 12 + (later.getMonth() - earlier.getMonth());
  if (later.getDate() < earlier.getDate()) months -= 1;
  return sign * months;
}

function betweenImpl(args: FValue[]): FValue {
  const av = args[0]!;
  const bv = args[1]!;
  if (av === null || bv === null) return null;
  const a = asDate(av, 'dateBetween').ms;
  const b = asDate(bv, 'dateBetween').ms;
  const unit = unitOf(args[2]!, 'dateBetween');
  let out: number;
  switch (unit) {
    case 'year':
      out = Math.trunc(monthsBetween(a, b) / 12);
      break;
    case 'quarter':
      out = Math.trunc(monthsBetween(a, b) / 3);
      break;
    case 'month':
      out = monthsBetween(a, b);
      break;
    case 'week':
      out = Math.trunc((dayKey(a) - dayKey(b)) / DAY_MS / 7);
      break;
    case 'day':
      out = (dayKey(a) - dayKey(b)) / DAY_MS;
      break;
    case 'hour':
      out = Math.trunc((a - b) / HOUR_MS);
      break;
    case 'minute':
      out = Math.trunc((a - b) / MINUTE_MS);
      break;
    case 'second':
      out = Math.trunc((a - b) / SECOND_MS);
      break;
  }
  // 0 쪽으로 버린 결과가 -0 이 되지 않게 한다
  return out === 0 ? 0 : out;
}

interface Parts {
  year: number;
  month: number;
  date: number;
  weekday: number;
  hour: number;
  minute: number;
  second: number;
}

const WEEKDAY_LONG = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
const WEEKDAY_SHORT = ['일', '월', '화', '수', '목', '금', '토'];
const WEEKDAY_LONG_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAY_SHORT_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_LONG_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_SHORT_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const TOKEN_FMT: Record<string, (p: Parts) => string> = {
  YYYY: (p) => pad(p.year, 4),
  YY: (p) => pad(p.year % 100, 2),
  MMMM: (p) => `${p.month}월`,
  MMM: (p) => `${p.month}월`,
  MM: (p) => pad(p.month),
  M: (p) => String(p.month),
  DD: (p) => pad(p.date),
  D: (p) => String(p.date),
  dddd: (p) => WEEKDAY_LONG[p.weekday]!,
  ddd: (p) => WEEKDAY_SHORT[p.weekday]!,
  HH: (p) => pad(p.hour),
  H: (p) => String(p.hour),
  hh: (p) => pad(p.hour % 12 || 12),
  h: (p) => String(p.hour % 12 || 12),
  mm: (p) => pad(p.minute),
  m: (p) => String(p.minute),
  ss: (p) => pad(p.second),
  s: (p) => String(p.second),
  A: (p) => (p.hour < 12 ? '오전' : '오후'),
  a: (p) => (p.hour < 12 ? 'am' : 'pm'),
};
/** 영어 형식(선택 인자 'en'). 날짜·시각 토큰은 같고 월·요일·오전/오후만 영어다. */
const TOKEN_FMT_EN: Record<string, (p: Parts) => string> = {
  ...TOKEN_FMT,
  MMMM: (p) => MONTH_LONG_EN[p.month - 1]!,
  MMM: (p) => MONTH_SHORT_EN[p.month - 1]!,
  dddd: (p) => WEEKDAY_LONG_EN[p.weekday]!,
  ddd: (p) => WEEKDAY_SHORT_EN[p.weekday]!,
  A: (p) => (p.hour < 12 ? 'AM' : 'PM'),
};
/** 긴 토큰이 먼저 매칭되게 길이 내림차순으로 둔다(YYYY → MMMM/dddd → … → M) */
const TOKEN_ORDER = Object.keys(TOKEN_FMT).sort((a, b) => b.length - a.length);

/** 표시용 raw 값의 작은따옴표를 안전한 글자로 바꾼다(문구의 따옴표와 섞이지 않게). */
const displayRaw = (value: unknown): string => String(value).replace(/'/g, '\u2019');

function formatImpl(args: FValue[]): FValue {
  const v = args[0]!;
  if (v === null) return '';
  const d = asDate(v, 'formatDate');
  const format = args[1]!;
  if (typeof format !== 'string') throw formulaError('formula.err.formatString');
  // 선택 인자: 표시 언어('en'). 생략하면 지금까지와 같은 한국어 값이다(기존 수식 결과 불변).
  const localeArg = args[2];
  if (localeArg !== undefined && localeArg !== 'en' && localeArg !== 'ko') {
    throw formulaError('formula.err.formatLocale', { value: displayRaw(localeArg) });
  }
  const fmt = localeArg === 'en' ? TOKEN_FMT_EN : TOKEN_FMT;
  const t = new Date(d.ms);
  const p: Parts = {
    year: t.getFullYear(),
    month: t.getMonth() + 1,
    date: t.getDate(),
    weekday: t.getDay(),
    // 날짜만 값이면 시각은 0 으로 본다
    hour: d.hasTime ? t.getHours() : 0,
    minute: d.hasTime ? t.getMinutes() : 0,
    second: d.hasTime ? t.getSeconds() : 0,
  };
  let out = '';
  for (let i = 0; i < format.length; ) {
    const ch = format[i]!;
    if (ch === '[') {
      // 대괄호 안은 그대로 출력한다
      const end = format.indexOf(']', i + 1);
      if (end === -1) return out + format.slice(i + 1);
      out += format.slice(i + 1, end);
      i = end + 1;
      continue;
    }
    const name = TOKEN_ORDER.find((n) => format.startsWith(n, i));
    if (name) {
      out += fmt[name]!(p);
      i += name.length;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

/** 날짜 값의 구성 요소(년·월·일·요일·시·분·초). 빈 값은 null. */
function partDef(fn: string, pick: (t: Date) => number): FunctionDef {
  return {
    min: 1,
    max: 1,
    impl: (args) => {
      const v = args[0]!;
      if (v === null) return null;
      return pick(new Date(asDate(v, fn).ms));
    },
  };
}

function startOfImpl(args: FValue[]): FValue {
  const v = args[0]!;
  if (v === null) return null;
  const d = asDate(v, 'startOf');
  const unit = unitOf(args[1]!, 'startOf');
  if (unit === 'second') throw formulaError('formula.err.startOfSecond');
  const t = new Date(d.ms);
  switch (unit) {
    case 'year':
      t.setMonth(0, 1);
      t.setHours(0, 0, 0, 0);
      break;
    case 'quarter':
      t.setMonth(Math.floor(t.getMonth() / 3) * 3, 1);
      t.setHours(0, 0, 0, 0);
      break;
    case 'month':
      t.setDate(1);
      t.setHours(0, 0, 0, 0);
      break;
    case 'week': {
      // 주 시작은 월요일
      t.setDate(t.getDate() - ((t.getDay() + 6) % 7));
      t.setHours(0, 0, 0, 0);
      break;
    }
    case 'day':
      t.setHours(0, 0, 0, 0);
      break;
    case 'hour':
      t.setMinutes(0, 0, 0);
      break;
    case 'minute':
      t.setSeconds(0, 0);
      break;
  }
  return mkDate(t.getTime(), d.hasTime, d.endMs);
}

/** 함수 라이브러리(date) — `packages/formula` 의 레지스트리에 그대로 펼쳐 넣는다. */
export const DATE_FNS: Record<string, FunctionDef> = {
  now: { min: 0, max: 0, impl: (_args, ctx) => mkDate(ctx.now.getTime(), true) },
  today: {
    min: 0,
    max: 0,
    impl: (_args, ctx) => mkDate(new Date(ctx.now.getFullYear(), ctx.now.getMonth(), ctx.now.getDate()).getTime(), false),
  },
  parseDate: { min: 1, max: 1, impl: (args) => parseDate(args[0]!) },
  dateAdd: { min: 3, max: 3, impl: (args) => addImpl('dateAdd', 1, args) },
  dateSubtract: { min: 3, max: 3, impl: (args) => addImpl('dateSubtract', -1, args) },
  dateBetween: { min: 3, max: 3, impl: (args) => betweenImpl(args) },
  formatDate: { min: 2, max: 3, impl: (args) => formatImpl(args) },
  year: partDef('year', (t) => t.getFullYear()),
  month: partDef('month', (t) => t.getMonth() + 1),
  date: partDef('date', (t) => t.getDate()),
  day: partDef('day', (t) => ((t.getDay() + 6) % 7) + 1),
  hour: partDef('hour', (t) => t.getHours()),
  minute: partDef('minute', (t) => t.getMinutes()),
  second: partDef('second', (t) => t.getSeconds()),
  timestamp: {
    min: 1,
    max: 1,
    impl: (args) => {
      const v = args[0]!;
      return v === null ? null : asDate(v, 'timestamp').ms;
    },
  },
  fromTimestamp: {
    min: 1,
    max: 1,
    impl: (args) => {
      const v = args[0]!;
      if (v === null) return null;
      if (typeof v !== 'number') throw formulaError('formula.err.fromTimestampArg', { value: displayRaw(v) });
      return mkDate(v, true);
    },
  },
  dateRange: {
    min: 2,
    max: 2,
    impl: (args) => {
      const av = args[0]!;
      const bv = args[1]!;
      if (av === null || bv === null) return null;
      const s = asDate(av, 'dateRange');
      const e = asDate(bv, 'dateRange');
      const start = s.ms;
      const end = e.endMs ?? e.ms;
      if (end < start) throw formulaError('formula.err.dateRangeOrder');
      return mkDate(start, s.hasTime || e.hasTime, end);
    },
  },
  dateStart: {
    min: 1,
    max: 1,
    impl: (args) => {
      const v = args[0]!;
      if (v === null) return null;
      const d = asDate(v, 'dateStart');
      return mkDate(d.ms, d.hasTime);
    },
  },
  dateEnd: {
    min: 1,
    max: 1,
    impl: (args) => {
      const v = args[0]!;
      if (v === null) return null;
      const d = asDate(v, 'dateEnd');
      return mkDate(d.endMs ?? d.ms, d.hasTime);
    },
  },
  startOf: { min: 2, max: 2, impl: (args) => startOfImpl(args) },
};
