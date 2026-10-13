import { describe, expect, it } from 'vitest';
import { MATH_FNS } from './fn-math.js';
import { FormulaError, type FValue } from './value.js';

const ctx = { now: new Date(2026, 0, 1) };
const run = (name: string, args: FValue[]): FValue => MATH_FNS[name]!.impl(args, ctx);
/** 오류가 나야 하는 호출. 오류 메시지를 돌려준다. */
const runErr = (name: string, args: FValue[]): FormulaError => {
  try {
    run(name, args);
  } catch (e) {
    if (e instanceof FormulaError) return e;
    throw e;
  }
  throw new Error(`${name} 은 오류가 나야 해요`);
};
const close = (name: string, args: FValue[], want: number) => expect(run(name, args)).toBeCloseTo(want, 12);

describe('MATH_FNS — 숫자 하나', () => {
  it('표', () => {
    expect(run('abs', [-3])).toBe(3);
    expect(run('abs', [-3.5])).toBe(3.5);
    expect(run('ceil', [1.2])).toBe(2);
    expect(run('ceil', [-1.2])).toBe(-1);
    expect(run('floor', [1.8])).toBe(1);
    expect(run('floor', [-1.2])).toBe(-2);
    expect(run('sqrt', [9])).toBe(3);
    expect(run('cbrt', [27])).toBe(3);
    expect(run('cbrt', [-27])).toBe(-3);
    expect(run('exp', [0])).toBe(1);
    close('exp', [1], Math.E);
    expect(run('ln', [1])).toBe(0);
    close('ln', [Math.E], 1);
    expect(run('log10', [1000])).toBe(3);
    expect(run('log2', [8])).toBe(3);
    expect(run('sign', [-5])).toBe(-1);
    expect(run('sign', [0])).toBe(0);
    expect(run('sign', [3])).toBe(1);
  });

  it('빈 값(null)은 0 으로 본다', () => {
    for (const name of ['abs', 'ceil', 'floor', 'sqrt', 'cbrt', 'exp', 'sign'] as const) {
      expect(run(name, [null])).toBe(name === 'sign' ? 0 : Math[name](0));
    }
    expect(runErr('ln', [null]).message).toMatch(/0 이하/);
    expect(runErr('log10', [null]).message).toMatch(/0 이하/);
  });

  it('정의역 밖은 오류', () => {
    expect(runErr('sqrt', [-1]).message).toMatch(/제곱근/);
    expect(runErr('ln', [0]).message).toMatch(/0 이하/);
    expect(runErr('ln', [-1]).message).toMatch(/0 이하/);
    expect(runErr('log10', [0]).message).toMatch(/0 이하/);
    expect(runErr('log2', [-2]).message).toMatch(/0 이하/);
  });

  it('숫자 자리에 다른 타입이면 오류', () => {
    expect(runErr('abs', ['3']).message).toMatch(/숫자가 필요한데 문자열/);
    expect(runErr('sqrt', [true]).message).toMatch(/숫자가 필요한데 불리언/);
    expect(runErr('floor', [{ kind: 'date', ms: 0, hasTime: false }]).message).toMatch(/숫자가 필요한데 날짜/);
    expect(runErr('abs', [[1, 2]]).message).toMatch(/숫자가 필요한데 목록/);
  });
});

describe('MATH_FNS — round', () => {
  it('0 에서 먼 쪽으로 반올림(half away from zero)', () => {
    expect(run('round', [2.5])).toBe(3);
    expect(run('round', [-2.5])).toBe(-3);
    expect(run('round', [2.4])).toBe(2);
    expect(run('round', [1.5])).toBe(2);
    expect(run('round', [-1.5])).toBe(-2);
    expect(run('round', [-2.4])).toBe(-2);
    expect(run('round', [3])).toBe(3);
    expect(run('round', [null])).toBe(0);
  });

  it('자릿수(양수·음수)', () => {
    expect(run('round', [1.005, 2])).toBe(1.01);
    expect(run('round', [2.675, 2])).toBe(2.68);
    expect(run('round', [3.14159, 3])).toBe(3.142);
    expect(run('round', [-1.005, 2])).toBe(-1.01);
    expect(run('round', [1234, -2])).toBe(1200);
    expect(run('round', [-1234, -2])).toBe(-1200);
    expect(run('round', [1250, -2])).toBe(1300);
    expect(run('round', [0.5, 0])).toBe(1);
    expect(run('round', [1.005, null])).toBe(1);
  });

  it('자릿수가 정수가 아니면 오류', () => {
    expect(runErr('round', [1, 1.5]).message).toMatch(/정수/);
  });
});

describe('MATH_FNS — pow·mod·e·pi', () => {
  it('pow', () => {
    expect(run('pow', [2, 10])).toBe(1024);
    expect(run('pow', [2, -1])).toBe(0.5);
    expect(run('pow', [4, 0.5])).toBe(2);
    expect(run('pow', [null, 3])).toBe(0);
    expect(runErr('pow', [1e308, 2]).message).toMatch(/숫자가 아니/);
    expect(runErr('pow', [-1, 0.5]).message).toMatch(/숫자가 아니/);
  });

  it('mod 는 JS % 와 부호가 같다', () => {
    expect(run('mod', [7, 3])).toBe(1);
    expect(run('mod', [-7, 3])).toBe(-1);
    expect(run('mod', [7, -3])).toBe(1);
    expect(run('mod', [-7, -3])).toBe(-1);
    expect(run('mod', [7.5, 2])).toBe(1.5);
    expect(runErr('mod', [7, 0]).message).toBe('0으로 나눌 수 없어요');
    expect(runErr('mod', [null, null]).message).toBe('0으로 나눌 수 없어요');
  });

  it('e·pi', () => {
    expect(run('e', [])).toBe(Math.E);
    expect(run('pi', [])).toBe(Math.PI);
    expect(MATH_FNS.e!.min).toBe(0);
    expect(MATH_FNS.e!.max).toBe(0);
  });
});

describe('MATH_FNS — 집계', () => {
  it('min·max', () => {
    expect(run('min', [3, 1, 2])).toBe(1);
    expect(run('max', [3, 1, 2])).toBe(3);
    expect(run('min', [[3, 1, 2]])).toBe(1);
    expect(run('max', [5, [1, 9]])).toBe(9);
    expect(run('min', [[[3], [2]]])).toBe(2);
    expect(run('min', [-3, -1])).toBe(-3);
  });

  it('sum·mean', () => {
    expect(run('sum', [1, 2, 3])).toBe(6);
    expect(run('sum', [[1, 2, 3]])).toBe(6);
    expect(run('sum', [1, [2, 3]])).toBe(6);
    expect(run('sum', [null, 1, null])).toBe(1);
    expect(run('sum', [[]])).toBe(0);
    expect(run('sum', [null])).toBe(0);
    expect(run('mean', [1, 2, 3])).toBe(2);
    expect(run('mean', [[2, 4]])).toBe(3);
    expect(run('mean', [1, null, 3])).toBe(2);
  });

  it('median — 홀수는 가운데, 짝수는 두 값의 평균', () => {
    expect(run('median', [1, 2, 3])).toBe(2);
    expect(run('median', [3, 1, 2])).toBe(2);
    expect(run('median', [1, 2, 3, 4])).toBe(2.5);
    expect(run('median', [[4, 1, 3, 2]])).toBe(2.5);
    expect(run('median', [1, null, 3])).toBe(2);
    expect(run('median', [5])).toBe(5);
  });

  it('숫자가 하나도 없으면 sum 은 0, 나머지는 null', () => {
    expect(run('sum', [[]])).toBe(0);
    expect(run('min', [[]])).toBeNull();
    expect(run('max', [[]])).toBeNull();
    expect(run('min', [null])).toBeNull();
    expect(run('mean', [[]])).toBeNull();
    expect(run('median', [[]])).toBeNull();
  });

  it('숫자가 아닌 항목이 있으면 오류', () => {
    expect(runErr('sum', [1, 'a']).message).toMatch(/숫자가 아닌 문자열/);
    expect(runErr('min', [[1, true]]).message).toMatch(/숫자가 아닌 불리언/);
    expect(runErr('max', [{ kind: 'date', ms: 0, hasTime: false }]).message).toMatch(/숫자가 아닌 날짜/);
    expect(runErr('median', [1, [2, 'x']]).message).toMatch(/숫자가 아닌 문자열/);
  });
});

describe('MATH_FNS — clamp', () => {
  it('범위로 가둔다', () => {
    expect(run('clamp', [5, 0, 10])).toBe(5);
    expect(run('clamp', [-1, 0, 10])).toBe(0);
    expect(run('clamp', [11, 0, 10])).toBe(10);
    expect(run('clamp', [null, -1, 1])).toBe(0);
    expect(run('clamp', [3, 3, 3])).toBe(3);
  });

  it('최소가 최대보다 크면 오류', () => {
    expect(runErr('clamp', [5, 10, 0]).message).toMatch(/최소값이 최대값보다/);
  });
});
