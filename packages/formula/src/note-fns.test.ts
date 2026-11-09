import { describe, expect, it } from 'vitest';
import { compileFormula } from './compile.js';
import { evaluate, type Env } from './eval.js';

const run = (expr: string, env: Env) => {
  const c = compileFormula(expr);
  if (!c.ok) throw c.error;
  return evaluate(c.compiled.ast, env);
};

describe('노트 자동 값 수식 함수', () => {
  it('note_chars() 는 주입된 글자수를, goal_met() 은 목표 비교를 돌려준다', () => {
    expect(run('note_chars()', { prop: () => null, noteChars: () => 1234, goalChars: () => 4000 })).toBe(1234);
    expect(run('goal_met()', { prop: () => null, noteChars: () => 4000, goalChars: () => 4000 })).toBe(true);
    expect(run('goal_met()', { prop: () => null, noteChars: () => 3999, goalChars: () => 4000 })).toBe(false);
    // 목표 없음 → null
    expect(run('goal_met()', { prop: () => null, noteChars: () => 100, goalChars: () => null })).toBe(null);
  });

  it('본문 컨텍스트가 없으면 note_chars() 는 오류, goal_met() 은 null', () => {
    expect(() => run('note_chars()', { prop: () => null })).toThrow();
    expect(run('goal_met()', { prop: () => null })).toBe(null);
  });
});
