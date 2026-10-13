import type { FunctionDef } from './registry.js';
import { FormulaError, typeOf, type FValue } from './value.js';

/** 함수 라이브러리(math) — 수학·집계. 모든 함수는 순수하고 결정적이다(`random()` 은 없다). */
export const MATH_FNS: Record<string, FunctionDef> = {};

const typeName = (v: FValue): string =>
  ({ null: '빈 값', number: '숫자', string: '문자열', boolean: '불리언', date: '날짜', list: '목록' })[typeOf(v)];

/** 인자를 숫자로. 빈 값은 0, 숫자가 아니면 오류. */
function num(v: FValue, what: string): number {
  if (v === null) return 0;
  if (typeof v === 'number') return v;
  throw new FormulaError(`${what}: 숫자가 필요한데 ${typeName(v)} 이에요`);
}

/** 인자 하나짜리 숫자 함수. */
function unaryFn(name: string, impl: (x: number) => number): FunctionDef {
  return { min: 1, max: 1, impl: (args) => impl(num(args[0]!, name)) };
}

/** 집계 함수. 인자들이 숫자이거나 목록이면(중첩 목록 포함) 펼쳐서 모은다. */
function collect(args: FValue[], name: string): number[] {
  const out: number[] = [];
  const walk = (v: FValue): void => {
    if (v === null) return; // 빈 값은 건너뛴다
    if (Array.isArray(v)) {
      for (const item of v) walk(item);
      return;
    }
    if (typeof v === 'number') {
      out.push(v);
      return;
    }
    throw new FormulaError(`${name}: 숫자가 아닌 ${typeName(v)} 이 있어요`);
  };
  for (const a of args) walk(a);
  return out;
}

function aggFn(name: string, impl: (ns: number[]) => FValue): FunctionDef {
  return { min: 1, max: Infinity, impl: (args) => impl(collect(args, name)) };
}

/** 0 에서 먼 쪽으로 반올림(half away from zero). 문자열 지수 트릭으로 부동소수 오차를 줄인다. */
function roundHalfAway(x: number, d: number): number {
  const sign = x < 0 ? -1 : 1;
  const scaled = Number(`${Math.abs(x)}e${d}`);
  // 자릿수가 유효 숫자 범위를 넘어 지수 표기가 깨지면 반올림해도 값이 바뀌지 않는다
  if (!Number.isFinite(scaled)) return x;
  return sign * Number(`${Math.round(scaled)}e${-d}`);
}

Object.assign(MATH_FNS, {
  abs: unaryFn('abs', Math.abs),
  ceil: unaryFn('ceil', Math.ceil),
  floor: unaryFn('floor', Math.floor),
  cbrt: unaryFn('cbrt', Math.cbrt),
  exp: unaryFn('exp', Math.exp),
  sign: unaryFn('sign', Math.sign),
  sqrt: unaryFn('sqrt', (x) => {
    if (x < 0) throw new FormulaError('sqrt: 음수의 제곱근은 정의되지 않아요');
    return Math.sqrt(x);
  }),
  ln: unaryFn('ln', (x) => {
    if (x <= 0) throw new FormulaError('ln: 0 이하의 로그는 정의되지 않아요');
    return Math.log(x);
  }),
  log10: unaryFn('log10', (x) => {
    if (x <= 0) throw new FormulaError('log10: 0 이하의 로그는 정의되지 않아요');
    return Math.log10(x);
  }),
  log2: unaryFn('log2', (x) => {
    if (x <= 0) throw new FormulaError('log2: 0 이하의 로그는 정의되지 않아요');
    return Math.log2(x);
  }),

  /** round(x, 자릿수?) — 0 에서 먼 쪽으로. 자릿수는 정수(음수 가능). */
  round: {
    min: 1,
    max: 2,
    impl: (args) => {
      const x = num(args[0]!, 'round');
      const d = args.length > 1 ? num(args[1]!, 'round') : 0;
      if (!Number.isInteger(d)) throw new FormulaError('round: 자릿수는 정수여야 해요');
      return roundHalfAway(x, d);
    },
  },

  pow: {
    min: 2,
    max: 2,
    impl: (args) => {
      const v = num(args[0]!, 'pow') ** num(args[1]!, 'pow');
      if (!Number.isFinite(v)) throw new FormulaError('pow: 계산 결과가 숫자가 아니에요');
      return v;
    },
  },

  /** 나머지 — 결과 부호는 JS `%` 와 같다(피제수의 부호를 따른다). */
  mod: {
    min: 2,
    max: 2,
    impl: (args) => {
      const a = num(args[0]!, 'mod');
      const b = num(args[1]!, 'mod');
      if (b === 0) throw new FormulaError('0으로 나눌 수 없어요');
      return a % b;
    },
  },

  e: { min: 0, max: 0, impl: () => Math.E },
  pi: { min: 0, max: 0, impl: () => Math.PI },

  min: aggFn('min', (ns) => (ns.length ? Math.min(...ns) : null)),
  max: aggFn('max', (ns) => (ns.length ? Math.max(...ns) : null)),
  sum: aggFn('sum', (ns) => ns.reduce((a, b) => a + b, 0)),
  mean: aggFn('mean', (ns) => (ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : null)),
  median: aggFn('median', (ns) => {
    if (!ns.length) return null;
    const s = [...ns].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
  }),

  /** clamp(x, 최소, 최대) — 범위로 가둔다. */
  clamp: {
    min: 3,
    max: 3,
    impl: (args) => {
      const x = num(args[0]!, 'clamp');
      const lo = num(args[1]!, 'clamp');
      const hi = num(args[2]!, 'clamp');
      if (lo > hi) throw new FormulaError('clamp: 최소값이 최대값보다 클 수 없어요');
      return Math.min(Math.max(x, lo), hi);
    },
  },
} satisfies Record<string, FunctionDef>);
