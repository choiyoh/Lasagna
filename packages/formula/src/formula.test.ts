import { describe, expect, it } from 'vitest';
import { compileFormula, evalFormula, tryFormula } from './compile.js';
import { FormulaError, toDisplayString, type FDate, type FValue } from './value.js';

const NOW = new Date(2026, 9, 12, 9, 30);
const day = (y: number, m: number, d: number): FDate => ({ kind: 'date', ms: new Date(y, m - 1, d).getTime(), hasTime: false });
const props: Record<string, FValue> = { 평점: 4, 이름: '클린 코드', 태그: ['개발', '책'], 마감: day(2026, 10, 20), 완료: false, 비어: null };
const env = { now: NOW, prop: (n: string) => (n in props ? props[n]! : (() => { throw new FormulaError(`없는 속성: ${n}`); })()) };
const run = (src: string): FValue => {
  const r = tryFormula(src, env);
  if (!r.ok) throw new Error(`${r.error.message} @${r.error.pos}`);
  return r.value;
};

describe('수식 통합(파서 + 평가기 + 함수 라이브러리)', () => {
  it('산술·문자열·비교·삼항', () => {
    expect(run('prop("평점") * 20')).toBe(80);
    expect(run('1 + 2 * 3 ^ 2')).toBe(19);
    expect(run('"점수: " + prop("평점")')).toBe('점수: 4');
    expect(run('prop("비어") + 5')).toBe(5);
    expect(run('prop("평점") >= 4 ? "좋음" : "보통"')).toBe('좋음');
    expect(run('prop("평점") > 3 and not prop("완료")')).toBe(true);
    expect(run('-2 ^ 2')).toBe(-4);
    expect(run('7 % 4')).toBe(3);
  });

  it('메서드 체인은 첫 인자 호출과 같다', () => {
    expect(run('prop("이름").upper()')).toBe(run('upper(prop("이름"))'));
    expect(run('prop("이름").replace("코드", "Code").length()')).toBe(7);
    expect(run('prop("평점").round(1)')).toBe(4);
    expect(run('prop("태그").join(" / ")')).toBe('개발 / 책');
    expect(run('[3, 1, 2].sort().first()')).toBe(1);
  });

  it('콜백(map·filter·find·some·every)과 current·index', () => {
    expect(run('[1, 2, 3].map(current * 2)')).toEqual([2, 4, 6]);
    expect(run('[1, 2, 3, 4].filter(current % 2 == 0)')).toEqual([2, 4]);
    expect(run('[5, 6, 7].map(index)')).toEqual([0, 1, 2]);
    expect(run('[1, 2, 3].find(current > 1)')).toBe(2);
    expect(run('[1, 2, 3].some(current > 2)')).toBe(true);
    expect(run('[1, 2, 3].every(current > 2)')).toBe(false);
    expect(run('prop("태그").map(upper(current) + "!")')).toEqual(['개발!', '책!']);
    expect(run('[1, 2, 3].map(current * 2).sum()')).toBe(12);
  });

  it('if·ifs·let·lets', () => {
    expect(run('if(prop("평점") > 3, "높음", "낮음")')).toBe('높음');
    expect(run('ifs(prop("평점") > 4, "A", prop("평점") > 3, "B", "C")')).toBe('B');
    expect(run('let(x, 10, x * 2)')).toBe(20);
    expect(run('lets(a, 2, b, a * 3, a + b)')).toBe(8);
    // 선택되지 않은 가지는 평가하지 않는다(오류가 나지 않는다)
    expect(run('if(true, 1, 1 / 0)')).toBe(1);
  });

  it('날짜', () => {
    expect(toDisplayString(run('today()'))).toBe('2026-10-12');
    expect(run('dateBetween(prop("마감"), today(), "days")')).toBe(8);
    expect(toDisplayString(run('prop("마감").dateAdd(1, "month")'))).toBe('2026-11-20');
    expect(run('formatDate(prop("마감"), "YYYY년 M월 D일")')).toBe('2026년 10월 20일');
    expect(run('prop("마감").day()')).toBe(2); // 화요일
    expect(run('prop("마감") > today()')).toBe(true);
  });

  it('오류는 위치와 함께 정적으로 잡는다', () => {
    const bad = (s: string) => {
      const r = compileFormula(s);
      if (r.ok) throw new Error('오류가 나야 해요');
      return r.error;
    };
    expect(bad('foo(1)')).toMatchObject({ message: expect.stringContaining('알 수 없는 함수'), pos: 0 });
    expect(bad('round()').message).toMatch(/인자/);
    expect(bad('round(1, 2, 3)').message).toMatch(/1~2/);
    expect(bad('prop(1)').message).toMatch(/문자열/);
    expect(bad('prop(x)').message).toMatch(/문자열/);
    expect(bad('current + 1').message).toMatch(/함수 안에서만/);
    expect(bad('y + 1').message).toMatch(/알 수 없는 이름/);
    expect(bad('1 +').pos).toBe(3);
  });

  it('계산 오류도 위치와 함께', () => {
    const r = tryFormula('1 + 4 / 0', env);
    expect(r).toMatchObject({ ok: false, error: { message: '0으로 나눌 수 없어요', pos: 4, end: 9 } });
    expect(tryFormula('prop("없음")', env)).toMatchObject({ ok: false });
    expect(tryFormula('[1].at("a")', env)).toMatchObject({ ok: false });
    expect(tryFormula('sqrt(-1)', env)).toMatchObject({ ok: false, error: { pos: 0 } });
  });

  it('의존하는 속성을 모은다', () => {
    const r = compileFormula('prop("a") + prop("b") * prop("a") + [1].map(current).sum()');
    expect(r.ok && r.compiled.deps).toEqual(['a', 'b']);
    const c = compileFormula('prop("평점") * 2');
    expect(c.ok && evalFormula(c.compiled, env)).toBe(8);
  });
});
