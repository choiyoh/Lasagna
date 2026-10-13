import { describe, expect, it } from 'vitest';
import { truthy } from './eval.js';
import { TEXT_FNS } from './fn-text.js';
import { FormulaError, toDisplayString, type FDate, type FValue } from './value.js';

const ctx = { now: new Date('2026-01-02T03:04:05Z') };

/** 레지스트리를 직접 호출한다(평가기 통합은 메인이 따로 확인한다). */
const call = (name: string, ...args: FValue[]): FValue => {
  const def = TEXT_FNS[name];
  if (!def) throw new Error(`없는 함수: ${name}`);
  return def.impl(args, ctx);
};

/** 정상·null·경계를 표로 확인한다. */
function ok(name: string, cases: [FValue[], FValue][]): void {
  describe(name, () => {
    for (const [args, want] of cases) {
      it(`${JSON.stringify(args)} → ${JSON.stringify(want)}`, () => {
        expect(call(name, ...args)).toEqual(want);
      });
    }
  });
}

/** 오류가 나야 하는 인자 표. `part` 는 메시지에 들어 있어야 하는 조각. */
function bad(name: string, cases: [FValue[], string][]): void {
  describe(`${name} (오류)`, () => {
    for (const [args, part] of cases) {
      it(`${JSON.stringify(args)} → ${part}`, () => {
        expect(() => call(name, ...args)).toThrow(FormulaError);
        expect(() => call(name, ...args)).toThrow(part);
      });
    }
  });
}

const d = (ms: number): FDate => ({ kind: 'date', ms, hasTime: false });

describe('TEXT_FNS', () => {
  ok('concat', [
    [[], ''],
    [['a', 1, true], 'a1true'],
    [[null], ''],
    [[null, 'a'], 'a'],
    [[1.5, 'x'], '1.5x'],
    [[['a', 'b'], 'c'], 'a, bc'],
    [[[null, 'a']], ', a'],
  ]);

  ok('join', [
    [[['a', 'b'], '-'], 'a-b'],
    [[[], ','], ''],
    [[null, '-'], ''],
    [[[1, true, null], ','], '1,true,'],
    [[[[1, 2], 3], '|'], '1, 2|3'],
  ]);
  bad('join', [[['abc', ','], '목록이 필요한데']]);

  ok('split', [
    [['a-b-c', '-'], ['a', 'b', 'c']],
    [['a', ','], ['a']],
    [['ab', ''], ['a', 'b']],
    [['🙂a', ''], ['🙂', 'a']],
    [['', ''], []],
    [[null, ','], ['']],
  ]);

  ok('repeat', [
    [['ab', 3], 'ababab'],
    [['a', 0], ''],
    [['🙂', 2], '🙂🙂'],
    [[null, 3], ''],
    [['a', null], ''],
    [['a', 10000], 'a'.repeat(10000)],
  ]);
  bad('repeat', [
    [['a', -1], '0~10000'],
    [['a', 10001], '0~10000'],
    [['a', 1.5], '정수'],
    [['a', true], '정수'],
  ]);

  ok('length', [
    [['🙂a'], 2],
    [['한글'], 2],
    [[''], 0],
    [[null], 0],
    [[[1, 2, 3]], 3],
    [[[]], 0],
  ]);
  bad('length', [
    [[42], '문자열이나 목록'],
    [[true], '문자열이나 목록'],
    [[d(0)], '문자열이나 목록'],
  ]);

  ok('lower', [
    [['ABC'], 'abc'],
    [['한글'], '한글'],
    [[null], ''],
    [[12], '12'],
  ]);
  ok('upper', [
    [['abc'], 'ABC'],
    [['한글'], '한글'],
    [[null], ''],
    [[12], '12'],
    // 날짜는 `toDisplayString`(로컬 시간대 표기)을 거친다 — 표기 자체는 value.ts 가 정한다.
    [[d(0)], toDisplayString(d(0)).toUpperCase()],
  ]);
  ok('trim', [
    [['  a b  '], 'a b'],
    [['\n a \t'], 'a'],
    [[null], ''],
  ]);
  bad('lower', [[[['a']], '문자열이 필요한데']]);
  bad('trim', [[[['a']], '문자열이 필요한데']]);

  ok('padStart', [
    [['5', 3], '  5'],
    [['5', 3, '0'], '005'],
    [['5', 1, '0'], '5'],
    [['5', 3, ''], '5'],
    [['5', 5, '🙂'], '🙂🙂🙂🙂5'],
    [['🙂a', 3, '-'], '-🙂a'],
    [[null, 2, 'x'], 'xx'],
  ]);
  ok('padEnd', [
    [['5', 3], '5  '],
    [['5', 3, '0'], '500'],
    [['5', 5, 'ab'], '5abab'],
    [['🙂', 3, '-'], '🙂--'],
  ]);
  bad('padStart', [
    [['5', -1], '0~10000'],
    [['5', 10001], '0~10000'],
    [['5', 1.5], '정수'],
  ]);
  bad('padEnd', [[['5', 'x'], '정수']]);

  ok('slice', [
    [['🙂abc', 1], 'abc'],
    [['🙂abc', 0, 1], '🙂'],
    [['abc', -2], 'bc'],
    [['abc', 2, 1], ''],
    [['abc', -3, -1], 'ab'],
    [['abc', 0, -1], 'ab'],
    [['abc', 10], ''],
    [['abc', 0], 'abc'],
    [[null, 0], ''],
    [[[1, 2, 3], 1], [2, 3]],
    [[[1, 2, 3], -2], [2, 3]],
    [[[1, 2, 3], 0, 2], [1, 2]],
    [[[1, 2, 3], 2, 1], []],
  ]);
  ok('substring', [
    [['🙂abc', 1], 'abc'],
    [['abc', -2], 'bc'],
    [[[1, 2, 3], 1], [2, 3]],
  ]);
  bad('slice', [[['abc', 'x'], '숫자여야']]);

  ok('replace', [
    [['a-b-c', '-', '+'], 'a+b-c'],
    [['abc', '(b)', '[$1]'], 'a[b]c'],
    [['abc', 'z', 'y'], 'abc'],
    [['a.c', '\\.', '-'], 'a-c'],
    [['010-1234', '-(\\d{4})$', '-****'], '010-****'],
    [[null, 'a', 'b'], ''],
  ]);
  ok('replaceAll', [
    [['a-b-c', '-', '+'], 'a+b+c'],
    [['ab', 'x', 'y'], 'ab'],
    [[null, 'a', 'b'], ''],
  ]);
  bad('replace', [[['a', '(', 'b'], '정규식이 올바르지 않아요']]);
  bad('replace', [[['a', '[', 'b'], '정규식이 올바르지 않아요']]);
  bad('replaceAll', [[['a', '(', 'b'], '정규식이 올바르지 않아요']]);

  ok('test', [
    [['abc', '^a'], true],
    [['abc', '^b'], false],
    [['🙂a', 'a$'], true],
    [['abc', '(b)'], true],
    [[null, '^$'], true],
  ]);
  ok('match', [
    [['a1b22', '\\d+'], ['1', '22']],
    [['abc', '\\d'], []],
    [['a-b', '(\\w)(?=-)'], ['a']],
    [[null, 'x'], []],
  ]);
  bad('test', [[['a', '('], '정규식이 올바르지 않아요']]);
  bad('match', [[['a', ')'], '정규식이 올바르지 않아요']]);

  ok('contains', [
    [['abc', 'b'], true],
    [['abc', 'B'], false],
    [['abc', ''], true],
    [['abc', null], false],
    [[null, 'x'], false],
    [[[1, 'a', true], 'a'], true],
    [[[1, 2], '1'], false],
    [[[1, 2], 3], false],
    [[[d(1000)], d(1000)], true],
    [[[1, null], 1], true],
  ]);
  bad('contains', [[[42, 1], '문자열이나 목록이 필요한데']]);

  ok('startsWith', [
    [['abc', 'ab'], true],
    [['abc', 'bc'], false],
    [['abc', null], true],
    [[null, 'x'], false],
    [[12, '1'], true],
  ]);
  ok('endsWith', [
    [['abc', 'bc'], true],
    [['abc', 'ab'], false],
    [[null, null], true],
  ]);

  ok('format', [
    [[1.5], '1.5'],
    [[true], 'true'],
    [[null], ''],
    [['a'], 'a'],
    [[[1, 'a']], '1, a'],
  ]);

  ok('toNumber', [
    [[5], 5],
    [[-1.5], -1.5],
    [['1,234'], 1234],
    [['50%'], 50],
    [['12%'], 12],
    [['abc'], null],
    [[''], null],
    [[' 12 '], 12],
    [['1 234'], 1234],
    [['1e3'], 1000],
    [['Infinity'], null],
    [[true], 1],
    [[false], 0],
    [[null], null],
    [[d(1000)], 1000],
    [[[1]], null],
  ]);

  ok('empty', [
    [[null], true],
    [[''], true],
    [[[]], true],
    [[' '], false],
    [[0], false],
    [[false], false],
    [['a'], false],
    [[[0]], false],
  ]);

  ok('boolean', [
    [[null], false],
    [[false], false],
    [[0], false],
    [[-0], false],
    [[''], false],
    [[[]], false],
    [[1], true],
    [['0'], true],
    [[[0]], true],
    [[d(0)], true],
  ]);
});

describe('레지스트리', () => {
  it('eval 의 truthy 와 boolean 이 같은 규칙을 쓴다', () => {
    const vals: FValue[] = [null, false, true, 0, -0, 1, '', 'a', [], [0], [null], d(0)];
    for (const v of vals) expect(call('boolean', v)).toBe(truthy(v));
  });

  it('연산자가 맡는 이름은 두지 않는다', () => {
    for (const name of ['not', 'and', 'or', 'typeof']) expect(TEXT_FNS[name]).toBeUndefined();
  });

  it('인자 개수', () => {
    expect(TEXT_FNS.concat!.min).toBe(0);
    expect(TEXT_FNS.concat!.max).toBe(Infinity);
    expect(TEXT_FNS.slice!.min).toBe(2);
    expect(TEXT_FNS.slice!.max).toBe(3);
    expect(TEXT_FNS.substring!.min).toBe(2);
    expect(TEXT_FNS.substring!.max).toBe(3);
    expect(TEXT_FNS.padEnd!.min).toBe(2);
    expect(TEXT_FNS.padEnd!.max).toBe(3);
    expect(TEXT_FNS.replaceAll!.max).toBe(3);
    expect(TEXT_FNS.boolean!.max).toBe(1);
  });

  it('오류에는 위치가 없다(호출 쪽이 채운다)', () => {
    try {
      call('repeat', 'a', 10001);
      throw new Error('오류가 나야 해요');
    } catch (e) {
      expect(e).toBeInstanceOf(FormulaError);
      expect((e as FormulaError).pos).toBeUndefined();
      expect((e as FormulaError).end).toBeUndefined();
    }
  });
});

