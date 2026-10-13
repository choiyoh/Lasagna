import { describe, expect, it } from 'vitest';
import type { Node } from './ast.js';
import { parseFormula } from './parse.js';
import { FormulaError } from './value.js';

/** 구조만 비교하려고 위치를 지운다 */
const strip = (n: unknown): unknown => JSON.parse(JSON.stringify(n, (k, v) => (k === 'pos' || k === 'end' ? undefined : v)));
const p = (s: string) => strip(parseFormula(s)) as Record<string, unknown>;
const err = (s: string): FormulaError => {
  try {
    parseFormula(s);
  } catch (e) {
    return e as FormulaError;
  }
  throw new Error('오류가 나야 해요');
};

describe('parseFormula', () => {
  it('리터럴', () => {
    expect(p('42')).toEqual({ kind: 'num', value: 42 });
    expect(p('1.5e2')).toEqual({ kind: 'num', value: 150 });
    expect(p('.5')).toEqual({ kind: 'num', value: 0.5 });
    expect(p('"a\\n\\"b"')).toEqual({ kind: 'str', value: 'a\n"b' });
    expect(p("'한글'")).toEqual({ kind: 'str', value: '한글' });
    expect(p('true')).toEqual({ kind: 'bool', value: true });
    expect(p('[1, "a"]')).toEqual({ kind: 'list', items: [{ kind: 'num', value: 1 }, { kind: 'str', value: 'a' }] });
    expect(p('[]')).toEqual({ kind: 'list', items: [] });
  });

  it('우선순위: 곱셈 > 덧셈, 괄호, 거듭제곱은 오른쪽 결합이고 단항보다 강하다', () => {
    expect(p('1 + 2 * 3')).toMatchObject({ op: '+', right: { op: '*' } });
    expect(p('(1 + 2) * 3')).toMatchObject({ op: '*', left: { op: '+' } });
    expect(p('2 ^ 3 ^ 2')).toMatchObject({ op: '^', right: { op: '^' } });
    expect(p('-2 ^ 2')).toMatchObject({ kind: 'unary', op: '-', arg: { op: '^' } });
    expect(p('1 - 2 - 3')).toMatchObject({ op: '-', left: { op: '-' } });
  });

  it('논리·비교: 단어 연산자와 기호 연산자는 같다', () => {
    expect(p('a and b or c')).toMatchObject({ op: '||', left: { op: '&&' } });
    expect(p('a && b || c')).toEqual(p('a and b or c'));
    expect(p('not a')).toEqual({ kind: 'unary', op: '!', arg: { kind: 'ident', name: 'a' } });
    expect(p('!a == b')).toMatchObject({ op: '==', left: { kind: 'unary' } });
    expect(p('1 < 2 == true')).toMatchObject({ op: '==', left: { op: '<' } });
  });

  it('삼항은 가장 약하고 오른쪽으로 중첩된다', () => {
    expect(p('a ? 1 : b ? 2 : 3')).toMatchObject({ kind: 'cond', otherwise: { kind: 'cond' } });
    expect(p('a || b ? 1 : 2')).toMatchObject({ kind: 'cond', test: { op: '||' } });
  });

  it('함수 호출과 메서드 체인', () => {
    expect(p('prop("평점")')).toEqual({ kind: 'call', name: 'prop', args: [{ kind: 'str', value: '평점' }] });
    expect(p('f()')).toEqual({ kind: 'call', name: 'f', args: [] });
    expect(p('[1,2].map(current * 2).sum()')).toMatchObject({
      kind: 'method',
      name: 'sum',
      target: { kind: 'method', name: 'map', args: [{ op: '*', left: { kind: 'ident', name: 'current' } }] },
    });
    expect(p('"a".length() + 1')).toMatchObject({ op: '+', left: { kind: 'method', name: 'length' } });
    expect(p('-x.abs()')).toMatchObject({ kind: 'unary', arg: { kind: 'method' } });
  });

  it('한글 식별자', () => {
    expect(p('점수 + 1')).toMatchObject({ left: { kind: 'ident', name: '점수' } });
  });

  it('위치를 정확히 기록한다', () => {
    const n = parseFormula('1 + foo(2)') as Extract<Node, { kind: 'binary' }>;
    expect([n.pos, n.end]).toEqual([0, 10]);
    expect([n.right.pos, n.right.end]).toEqual([4, 10]);
  });

  it('오류는 위치와 함께', () => {
    expect(err('').message).toMatch(/비어/);
    expect(err('1 +').pos).toBe(3);
    expect(err('(1 + 2').message).toMatch(/\)/);
    expect(err('f(1, 2').message).toMatch(/\)/);
    expect(err('1 2')).toMatchObject({ pos: 2, end: 3 });
    expect(err('"abc').message).toMatch(/닫히지/);
    expect(err('1 # 2')).toMatchObject({ pos: 2 });
    expect(err('a ? 1').message).toMatch(/:/);
    expect(err('x.y')).toMatchObject({ message: expect.stringContaining('속성 접근') });
    expect(err('1 + )').message).toMatch(/값/);
  });
});
