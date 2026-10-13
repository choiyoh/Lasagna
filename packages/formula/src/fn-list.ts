import { FormulaError, compareValues, typeOf, valuesEqual, type FValue } from './value.js';
import type { FunctionDef } from './registry.js';

/** 목록이 아닌 값을 받았을 때의 오류 메시지용 타입 이름(eval.ts 와 같은 표기) */
const typeName = (v: FValue) =>
  ({ null: '빈 값', number: '숫자', string: '문자열', boolean: '불리언', date: '날짜', list: '목록' })[typeOf(v)];

/** 첫 인자를 목록으로. 빈 값(null)은 빈 목록으로 본다. */
function listArg(v: FValue, fn: string): FValue[] {
  if (v === null) return [];
  if (!Array.isArray(v)) throw new FormulaError(`${fn}: 목록이 필요한데 ${typeName(v)} 이에요`);
  return v;
}

/** 숫자 인자. 빈 값(null)은 0 으로 본다(산술 연산과 같은 규칙). */
function numArg(v: FValue, fn: string, what: string): number {
  if (v === null) return 0;
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new FormulaError(`${fn}: ${what} 값이 숫자가 아니에요`);
  return v;
}

/** 정수 인자. 1.5 처럼 정수가 아니면 FormulaError. */
function intArg(v: FValue, fn: string, what: string): number {
  const n = numArg(v, fn, what);
  if (!Number.isInteger(n)) throw new FormulaError(`${fn}: ${what} 값은 정수여야 해요`);
  return n;
}

/** 항목이 비어 있는지(null·""·빈 목록). countValues 가 쓴다. */
const isEmptyItem = (v: FValue) => v === null || v === '' || (Array.isArray(v) && v.length === 0);

/**
 * 함수 라이브러리(list) — 첫 인자가 목록이다(메서드 호출 `x.f(a)` 는 `f(x, a)` 와 같다).
 *
 * 콜백을 받는 `map`·`filter`·`find`·`findIndex`·`some`·`every` 와 `if`·`let` 은 평가기가 직접 정의한다.
 * `length`·`join`·`contains`·`slice`·`sum` 은 다른 라이브러리 파일에 있다.
 */
export const LIST_FNS: Record<string, FunctionDef> = {
  /** at(목록, 인덱스): 0부터. 음수는 끝에서부터(-1 = 마지막). 범위 밖은 null. */
  at: {
    min: 2,
    max: 2,
    impl: (args) => {
      const list = listArg(args[0]!, 'at');
      const i = intArg(args[1]!, 'at', '인덱스');
      const idx = i < 0 ? list.length + i : i;
      return idx >= 0 && idx < list.length ? list[idx]! : null;
    },
  },

  /** first(목록): 첫 항목. 빈 목록이면 null. */
  first: { min: 1, max: 1, impl: (args) => listArg(args[0]!, 'first')[0] ?? null },

  /** last(목록): 마지막 항목. 빈 목록이면 null. */
  last: {
    min: 1,
    max: 1,
    impl: (args) => {
      const list = listArg(args[0]!, 'last');
      return list.length > 0 ? list[list.length - 1]! : null;
    },
  },

  /** sort(목록): compareValues 로 오름차순(원본은 그대로, 안정 정렬, 빈 값은 뒤). */
  sort: { min: 1, max: 1, impl: (args) => [...listArg(args[0]!, 'sort')].sort(compareValues) },

  /** reverse(목록): 뒤집은 새 목록(원본은 그대로). */
  reverse: { min: 1, max: 1, impl: (args) => [...listArg(args[0]!, 'reverse')].reverse() },

  /** unique(목록): valuesEqual 로 중복 제거, 첫 등장 순서를 지킨다. */
  unique: {
    min: 1,
    max: 1,
    impl: (args) => {
      const out: FValue[] = [];
      for (const v of listArg(args[0]!, 'unique')) if (!out.some((x) => valuesEqual(x, v))) out.push(v);
      return out;
    },
  },

  /** flat(목록): 한 단계만 펼친다. */
  flat: {
    min: 1,
    max: 1,
    impl: (args) => {
      const out: FValue[] = [];
      for (const v of listArg(args[0]!, 'flat')) {
        if (Array.isArray(v)) out.push(...v);
        else out.push(v);
      }
      return out;
    },
  },

  /** includes(목록, 값): valuesEqual 로 포함 여부. */
  includes: { min: 2, max: 2, impl: (args) => listArg(args[0]!, 'includes').some((v) => valuesEqual(v, args[1]!)) },

  /** indexOf(목록, 값): 처음 위치. 없으면 -1. */
  indexOf: { min: 2, max: 2, impl: (args) => listArg(args[0]!, 'indexOf').findIndex((v) => valuesEqual(v, args[1]!)) },

  /** range(시작, 끝, 간격?): 끝은 포함하지 않는다. 간격 기본 1, 음수 가능. */
  range: {
    min: 2,
    max: 3,
    impl: (args) => {
      const start = numArg(args[0]!, 'range', '시작');
      const end = numArg(args[1]!, 'range', '끝');
      const step = args.length > 2 ? numArg(args[2]!, 'range', '간격') : 1;
      if (step === 0) throw new FormulaError('range: 간격은 0이 될 수 없어요');
      // 간격의 부호와 끝(포함하지 않음)에 맞는 개수를 먼저 세어 무한 루프를 막는다.
      const count = Math.ceil((end - start) / step);
      if (count <= 0) return [];
      if (count > 10000) throw new FormulaError('range: 결과가 10000개를 넘을 수 없어요');
      const out: FValue[] = [];
      // 누적 대신 곱셈으로 만들어 부동소수점 오차가 쌓이지 않게 한다.
      for (let i = 0; i < count; i++) out.push(start + i * step);
      return out;
    },
  },

  /** count(목록): 항목 수. */
  count: { min: 1, max: 1, impl: (args) => listArg(args[0]!, 'count').length },

  /** countValues(목록): 빈 값(null·""·[])이 아닌 항목 수. */
  countValues: { min: 1, max: 1, impl: (args) => listArg(args[0]!, 'countValues').filter((v) => !isEmptyItem(v)).length },
};
