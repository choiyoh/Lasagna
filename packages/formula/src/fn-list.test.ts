import { describe, expect, it } from 'vitest';
import { LIST_FNS } from './fn-list.js';
import type { FnCtx } from './registry.js';
import { FormulaError, type FValue } from './value.js';

const ctx: FnCtx = { now: new Date('2026-01-01T00:00:00Z') };
/** 평가기를 거치지 않고 레지스트리의 함수를 직접 부른다(위치는 호출 쪽이 채우므로 여기선 없어도 된다). */
const call = (name: string, ...args: FValue[]): FValue => LIST_FNS[name]!.impl(args, ctx);
const fails = (name: string, ...args: FValue[]): FormulaError => {
  try {
    call(name, ...args);
  } catch (e) {
    return e as FormulaError;
  }
  throw new Error('오류가 나야 해요');
};
const d = (ms: number, hasTime = false): FValue => ({ kind: 'date', ms, hasTime });

describe('at', () => {
  it('0부터 세고 범위 밖은 null', () => {
    expect(call('at', [10, 20, 30], 0)).toBe(10);
    expect(call('at', [10, 20, 30], 2)).toBe(30);
    expect(call('at', [10, 20, 30], 3)).toBeNull();
    expect(call('at', [], 0)).toBeNull();
  });

  it('음수는 끝에서부터', () => {
    expect(call('at', [10, 20, 30], -1)).toBe(30);
    expect(call('at', [10, 20, 30], -3)).toBe(10);
    expect(call('at', [10, 20, 30], -4)).toBeNull();
  });

  it('빈 값은 빈 목록·인덱스 0 으로 본다', () => {
    expect(call('at', null, 0)).toBeNull();
    expect(call('at', [1, 2], null)).toBe(1); // 산술과 같은 규칙: null 은 0
  });

  it('정수가 아닌 인덱스와 목록이 아닌 값은 오류', () => {
    expect(fails('at', [1, 2], 1.5).message).toMatch(/정수/);
    expect(fails('at', [1, 2], 'a').message).toMatch(/숫자/);
    expect(fails('at', d(0), 0).message).toMatch(/목록/);
    expect(fails('at', 'abc', 0).message).toMatch(/목록/);
  });
});

describe('first / last', () => {
  it('첫·마지막 항목', () => {
    expect(call('first', [1, 2, 3])).toBe(1);
    expect(call('last', [1, 2, 3])).toBe(3);
    expect(call('last', [false])).toBe(false); // falsy 도 값이다(null 로 뭉개지 않는다)
    expect(call('last', [null])).toBeNull();
  });

  it('빈 목록·빈 값은 null', () => {
    for (const name of ['first', 'last']) {
      expect(call(name, [])).toBeNull();
      expect(call(name, null)).toBeNull();
      expect(fails(name, 5).message).toMatch(/목록/);
    }
  });
});

describe('sort', () => {
  it('오름차순이고 원본은 그대로', () => {
    const src: FValue[] = [3, 1, 2];
    expect(call('sort', src)).toEqual([1, 2, 3]);
    expect(src).toEqual([3, 1, 2]);
    expect(call('sort', null)).toEqual([]);
  });

  it('빈 값은 뒤, 다른 타입은 타입 이름 순', () => {
    expect(call('sort', [1, null, 0])).toEqual([0, 1, null]);
    expect(call('sort', [1, 'a', true])).toEqual([true, 1, 'a']); // boolean < number < string
    expect(call('sort', ['b', 'a', d(5)])).toEqual([d(5), 'a', 'b']);
  });

  it('안정 정렬: 비교가 같으면(같은 ms 의 날짜) 원래 순서를 지킨다', () => {
    const withTime = d(5, true);
    const dayOnly = d(5);
    expect(call('sort', [withTime, dayOnly])).toEqual([withTime, dayOnly]);
    expect(call('sort', [dayOnly, withTime])).toEqual([dayOnly, withTime]);
  });

  it('목록 항목끼리도 비교한다', () => {
    expect(call('sort', [[2], [1, 5], [1]])).toEqual([[1], [1, 5], [2]]);
  });
});

describe('reverse', () => {
  it('뒤집은 새 목록을 돌려주고 원본은 그대로', () => {
    const src: FValue[] = [1, 2, 3];
    expect(call('reverse', src)).toEqual([3, 2, 1]);
    expect(src).toEqual([1, 2, 3]);
    expect(call('reverse', null)).toEqual([]);
    expect(call('reverse', [1])).toEqual([1]);
    expect(fails('reverse', 'abc').message).toMatch(/목록/);
  });
});

describe('unique', () => {
  it('첫 등장 순서를 유지하며 중복을 없앤다', () => {
    expect(call('unique', [2, 1, 2, 1, 3])).toEqual([2, 1, 3]);
    expect(call('unique', [null, null, 1])).toEqual([null, 1]);
    expect(call('unique', null)).toEqual([]);
  });

  it('날짜는 valuesEqual 규칙(시작 시각·끝)으로 중복을 판단한다', () => {
    expect(call('unique', [d(0), d(0, true), d(1)])).toEqual([d(0), d(1)]); // hasTime 은 무시된다
    expect(call('unique', [d(0), { kind: 'date', ms: 0, hasTime: false, endMs: 10 }])).toEqual([
      d(0),
      { kind: 'date', ms: 0, hasTime: false, endMs: 10 },
    ]);
  });

  it('목록 항목은 원소별로 비교한다', () => {
    expect(call('unique', [[1, 2], [1, 2], [3], [1]])).toEqual([[1, 2], [3], [1]]);
  });
});

describe('flat', () => {
  it('한 단계만 펼친다', () => {
    expect(call('flat', [[1, 2], [3], 4])).toEqual([1, 2, 3, 4]);
    expect(call('flat', [[[1]], 2])).toEqual([[1], 2]);
    expect(call('flat', null)).toEqual([]);
    expect(call('flat', [1, 2])).toEqual([1, 2]);
  });
});

describe('includes / indexOf', () => {
  it('valuesEqual 로 찾는다', () => {
    expect(call('includes', [1, 2], 2)).toBe(true);
    expect(call('includes', [1, 2], 3)).toBe(false);
    expect(call('includes', [[1]], [1])).toBe(true);
    expect(call('includes', [d(0)], d(0, true))).toBe(true);
    expect(call('includes', null, 1)).toBe(false);
  });

  it('indexOf 는 처음 위치, 없으면 -1', () => {
    expect(call('indexOf', [1, 2, 1], 1)).toBe(0);
    expect(call('indexOf', [1, 2], 3)).toBe(-1);
    expect(call('indexOf', [[1], [2]], [2])).toBe(1);
    expect(call('indexOf', null, 1)).toBe(-1);
    expect(fails('includes', 5, 1).message).toMatch(/목록/);
    expect(fails('indexOf', d(0), 1).message).toMatch(/목록/);
  });
});

describe('range', () => {
  it('끝은 포함하지 않는다', () => {
    expect(call('range', 0, 5)).toEqual([0, 1, 2, 3, 4]);
    expect(call('range', 0, 1)).toEqual([0]);
    expect(call('range', 0, 0)).toEqual([]);
    expect(call('range', null, 3)).toEqual([0, 1, 2]);
  });

  it('간격을 준다(부동소수점도)', () => {
    expect(call('range', 0, 6, 2)).toEqual([0, 2, 4]);
    expect(call('range', 0, 1, 0.25)).toEqual([0, 0.25, 0.5, 0.75]);
    expect(call('range', 5, 0, -1)).toEqual([5, 4, 3, 2, 1]);
    expect(call('range', 0, 5, -1)).toEqual([]); // 방향이 반대면 빈 목록
  });

  it('간격 0 과 10000개 초과는 오류', () => {
    expect(fails('range', 0, 5, 0).message).toMatch(/0/);
    expect(call('range', 0, 10000)).toHaveLength(10000); // 경계는 통과
    expect(fails('range', 0, 10001).message).toMatch(/10000/);
    expect(fails('range', 0, 10000, 0.5).message).toMatch(/10000/);
  });

  it('숫자가 아닌 인자는 오류', () => {
    expect(fails('range', 'a', 5).message).toMatch(/숫자/);
    expect(fails('range', 0, [5]).message).toMatch(/숫자/);
    expect(fails('range', 0, 5, true).message).toMatch(/숫자/);
  });
});

describe('count / countValues', () => {
  it('count 는 항목 수', () => {
    expect(call('count', [1, null, 2])).toBe(3);
    expect(call('count', [])).toBe(0);
    expect(call('count', null)).toBe(0);
    expect(fails('count', 'abc').message).toMatch(/목록/);
  });

  it('countValues 는 null·""·빈 목록을 빼고 센다', () => {
    expect(call('countValues', [1, null, '', [], 0, false, 'a'])).toBe(4); // 1, 0, false, "a"
    expect(call('countValues', [[1]])).toBe(1); // 내용이 있는 목록은 값으로 센다
    expect(call('countValues', null)).toBe(0);
    expect(fails('countValues', d(0)).message).toMatch(/목록/);
  });
});
