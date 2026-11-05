import { formulaError, isDate, toDisplayString, typeParam, valuesEqual, type ErrorParam, type FValue } from './value.js';
import type { FunctionDef } from './registry.js';

/**
 * 함수 라이브러리(text) — 문자열·변환·논리.
 *
 * 규칙:
 * - 메서드 호출 `x.f(a)` 는 `f(x, a)` 와 같으므로 **첫 인자가 대상**이다.
 * - 빈 값(null)은 가능한 한 오류 대신 합리적인 결과(빈 문자열·0·null·false)로 다룬다.
 * - 타입이 틀린 인자(문자열 자리에 목록 등)는 `FormulaError` 를 던진다. 위치는 호출 쪽(평가기)이 채운다.
 * - 정규식은 문자열 패턴을 `new RegExp(pattern, flags)` 로 컴파일한다(`/…/` 리터럴 표기는 없다).
 */

/** 오류 위치는 평가기가 채운다. */
const fail = (key: Parameters<typeof formulaError>[0], params: Parameters<typeof formulaError>[1] = {}): never => {
  throw formulaError(key, params);
};

const typeName = (v: FValue) => typeParam(v);

/**
 * 문자열 인자. null 은 "" 이고, 숫자·불리언·날짜는 표기 문자열로 바꾼다.
 * 목록은 문자열이 아니므로 오류다(이어 붙이려면 `concat`·`join`·`format` 을 쓴다).
 */
function str(v: FValue, fn: string): string {
  if (v === null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return fail('formula.err.needsString', { fn, type: typeName(v) });
  return toDisplayString(v);
}

/** 목록 인자. null 은 빈 목록. */
function list(v: FValue, fn: string): FValue[] {
  if (v === null) return [];
  if (!Array.isArray(v)) return fail('formula.err.needsList', { fn, type: typeName(v) });
  return v;
}

/** 정수 인자(0~10000). null 은 0. */
function count(v: FValue, fn: string, what: ErrorParam): number {
  if (v === null) return 0;
  if (typeof v !== 'number' || !Number.isInteger(v)) return fail('formula.err.argInteger2', { fn, what });
  if (v < 0 || v > 10000) return fail('formula.err.argRange2', { fn, what });
  return v;
}

/** 숫자 인자(정수일 필요 없음). null 은 0. */
function num(v: FValue, fn: string, what: ErrorParam): number {
  if (v === null) return 0;
  if (typeof v !== 'number') return fail('formula.err.argNumber2', { fn, what });
  return v;
}

/** 정규식 컴파일. 잘못된 패턴은 FormulaError. */
function regex(pattern: string, flags: string): RegExp {
  try {
    return new RegExp(pattern, flags);
  } catch (e) {
    return fail('formula.err.regex', { message: (e as Error).message });
  }
}

/** `slice`/`substring` 의 인덱스: 음수는 끝에서부터, 범위 밖은 잘라 낸다. */
const clampIndex = (i: number, n: number): number => {
  const t = Math.trunc(i);
  return t < 0 ? Math.max(n + t, 0) : Math.min(t, n);
};

/** 코드포인트 단위 slice(JS `String#slice` 와 같다). 끝이 없거나 null 이면 문자열 끝까지. */
function cpSlice(s: string, start: FValue, end: FValue | undefined, fn: string): string {
  const cps = [...s];
  const n = cps.length;
  const a = clampIndex(num(start, fn, { key: 'formula.arg.start' }), n);
  const b = end === undefined || end === null ? n : clampIndex(num(end, fn, { key: 'formula.arg.end' }), n);
  return cps.slice(a, Math.max(a, b)).join('');
}

/** 코드포인트 길이 기준으로 채운다. 채움 문자열이 비면 JS 처럼 그대로 둔다. */
function pad(s: string, len: number, fill: string, side: 'start' | 'end'): string {
  const need = len - [...s].length;
  if (need <= 0) return s;
  const fillChars = [...fill];
  if (fillChars.length === 0) return s;
  let out = '';
  for (let i = 0; i < need; i++) out += fillChars[i % fillChars.length]!;
  return side === 'start' ? out + s : s + out;
}

/** eval.ts 의 `truthy` 와 같은 규칙(순환 import 를 피해 여기에 다시 둔다). */
const truthy = (v: FValue): boolean =>
  !(v === null || v === false || v === 0 || v === '' || (Array.isArray(v) && v.length === 0));

/** `slice` 와 별칭 `substring` 이 같은 구현을 쓴다(오류 메시지에 이름만 다르게). */
const sliceDef = (fn: string): FunctionDef => ({
  min: 2,
  max: 3,
  impl: (args) => {
    const target = args[0]!;
    if (Array.isArray(target)) {
      const n = target.length;
      const a = clampIndex(num(args[1]!, fn, { key: 'formula.arg.start' }), n);
      const b = args[2] === undefined || args[2] === null ? n : clampIndex(num(args[2]!, fn, { key: 'formula.arg.end' }), n);
      return target.slice(a, Math.max(a, b));
    }
    return cpSlice(str(target, fn), args[1]!, args[2], fn);
  },
});

export const TEXT_FNS: Record<string, FunctionDef> = {
  // ── 이어 붙이기·나누기 ───────────────────────────────────────────────
  /** `concat(…값)`: 각 값을 표기 문자열로 이어 붙인다(목록은 `toDisplayString` 그대로 → "a, b"). */
  concat: { min: 0, max: Infinity, impl: (args) => args.map((v) => toDisplayString(v)).join('') },

  /** `join(목록, 구분자)`: 항목을 표기 문자열로 바꿔 구분자로 잇는다. 목록이 null 이면 "". */
  join: {
    min: 2,
    max: 2,
    impl: (args) => list(args[0]!, 'join').map((v) => toDisplayString(v)).join(str(args[1]!, 'join')),
  },

  /** `split(문자열, 구분자)`: 구분자가 "" 이면 코드포인트 단위로 나눈다. */
  split: {
    min: 2,
    max: 2,
    impl: (args) => {
      const s = str(args[0]!, 'split');
      const sep = str(args[1]!, 'split');
      return sep === '' ? [...s] : s.split(sep);
    },
  },

  /** `repeat(문자열, 횟수)`: 횟수는 0~10000 의 정수. */
  repeat: {
    min: 2,
    max: 2,
    impl: (args) => str(args[0]!, 'repeat').repeat(count(args[1]!, 'repeat', { key: 'formula.arg.count' })),
  },

  // ── 길이·대소문자·공백 ──────────────────────────────────────────────
  /** `length(값)`: 문자열은 코드포인트 수, 목록은 항목 수, null 은 0. */
  length: {
    min: 1,
    max: 1,
    impl: (args) => {
      const v = args[0]!;
      if (v === null) return 0;
      if (typeof v === 'string') return [...v].length;
      if (Array.isArray(v)) return v.length;
      return fail('formula.err.needsStringOrList', { fn: 'length', type: typeName(v) });
    },
  },

  lower: { min: 1, max: 1, impl: (args) => str(args[0]!, 'lower').toLowerCase() },
  upper: { min: 1, max: 1, impl: (args) => str(args[0]!, 'upper').toUpperCase() },
  trim: { min: 1, max: 1, impl: (args) => str(args[0]!, 'trim').trim() },

  /** `padStart(문자열, 길이, 채움?)`: 코드포인트 길이 기준, 채움 기본 " ". */
  padStart: {
    min: 2,
    max: 3,
    impl: (args) =>
      pad(
        str(args[0]!, 'padStart'),
        count(args[1]!, 'padStart', { key: 'formula.arg.length' }),
        args[2] === undefined || args[2] === null ? ' ' : str(args[2]!, 'padStart'),
        'start',
      ),
  },
  /** `padEnd(문자열, 길이, 채움?)` */
  padEnd: {
    min: 2,
    max: 3,
    impl: (args) =>
      pad(
        str(args[0]!, 'padEnd'),
        count(args[1]!, 'padEnd', { key: 'formula.arg.length' }),
        args[2] === undefined || args[2] === null ? ' ' : str(args[2]!, 'padEnd'),
        'end',
      ),
  },

  // ── 자르기 ─────────────────────────────────────────────────────────
  /** `slice(문자열, 시작, 끝?)`: 코드포인트 기준(음수는 끝에서부터). 목록이 오면 목록을 자른다. */
  slice: sliceDef('slice'),
  /** `substring(문자열, 시작, 끝?)`: `slice` 와 같은 동작의 별칭. */
  substring: sliceDef('substring'),

  // ── 정규식 ─────────────────────────────────────────────────────────
  /** `replace(문자열, 패턴, 바꿀말)`: 첫 일치만. 바꿀말의 `$1` 참조는 JS 규칙 그대로. */
  replace: {
    min: 3,
    max: 3,
    impl: (args) =>
      str(args[0]!, 'replace').replace(regex(str(args[1]!, 'replace'), ''), str(args[2]!, 'replace')),
  },
  /** `replaceAll(문자열, 패턴, 바꿀말)`: 모든 일치(`g` 플래그). */
  replaceAll: {
    min: 3,
    max: 3,
    impl: (args) =>
      str(args[0]!, 'replaceAll').replace(regex(str(args[1]!, 'replaceAll'), 'g'), str(args[2]!, 'replaceAll')),
  },
  /** `test(문자열, 패턴)`: 일치 여부. */
  test: {
    min: 2,
    max: 2,
    impl: (args) => regex(str(args[1]!, 'test'), '').test(str(args[0]!, 'test')),
  },
  /** `match(문자열, 패턴)`: 일치한 전체 문자열들의 목록(없으면 빈 목록). */
  match: {
    min: 2,
    max: 2,
    impl: (args) => str(args[0]!, 'match').match(regex(str(args[1]!, 'match'), 'g')) ?? [],
  },

  // ── 찾기 ───────────────────────────────────────────────────────────
  /** `contains(문자열 또는 목록, 값)`: 문자열은 부분 문자열(대소문자 구분), 목록은 `valuesEqual`. null 대상·null 값은 false. */
  contains: {
    min: 2,
    max: 2,
    impl: (args) => {
      const target = args[0]!;
      const needle = args[1]!;
      if (target === null || needle === null) return false;
      if (Array.isArray(target)) return target.some((x) => valuesEqual(x, needle));
      if (typeof target === 'string') return target.includes(str(needle, 'contains'));
      return fail('formula.err.needsStringOrList', { fn: 'contains', type: typeName(target) });
    },
  },
  /** `startsWith(문자열, 접두)`: 대소문자 구분. */
  startsWith: {
    min: 2,
    max: 2,
    impl: (args) => str(args[0]!, 'startsWith').startsWith(str(args[1]!, 'startsWith')),
  },
  /** `endsWith(문자열, 접미)`: 대소문자 구분. */
  endsWith: {
    min: 2,
    max: 2,
    impl: (args) => str(args[0]!, 'endsWith').endsWith(str(args[1]!, 'endsWith')),
  },

  // ── 변환 ───────────────────────────────────────────────────────────
  /** `format(값)`: 표기 문자열(`toDisplayString`). */
  format: { min: 1, max: 1, impl: (args) => toDisplayString(args[0]!) },
  /**
   * `toNumber(값)`: 숫자는 그대로, 문자열은 공백·천단위 쉼표를 지우고 끝의 % 를 뗀 뒤 `Number`
   * (실패하면 null), 불리언은 1/0, 날짜는 시작 ms, null 은 null. 목록은 null.
   */
  toNumber: {
    min: 1,
    max: 1,
    impl: (args) => {
      const v = args[0]!;
      if (v === null) return null;
      if (typeof v === 'number') return v;
      if (typeof v === 'boolean') return v ? 1 : 0;
      if (isDate(v)) return v.ms;
      if (typeof v === 'string') {
        const s = v.replace(/\s/g, '').replace(/,/g, '').replace(/%$/, '');
        if (s === '') return null;
        const n = Number(s);
        return Number.isFinite(n) ? n : null;
      }
      return null;
    },
  },

  // ── 논리(and/or/not/typeof 는 연산자가 맡는다) ───────────────────────
  /** `empty(값)`: null, "", [] 이면 true. */
  empty: {
    min: 1,
    max: 1,
    impl: (args) => {
      const v = args[0]!;
      return v === null || v === '' || (Array.isArray(v) && v.length === 0);
    },
  },
  /** `boolean(값)`: eval 의 `truthy` 와 같은 규칙(null/false/0/""/[] 가 false). */
  boolean: { min: 1, max: 1, impl: (args) => truthy(args[0]!) },
};
