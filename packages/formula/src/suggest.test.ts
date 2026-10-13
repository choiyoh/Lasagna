import { describe, expect, it } from 'vitest';
import { suggestAt } from './suggest.js';

describe('suggestAt', () => {
  const props = ['평점', '비용합', '마감일'];
  it('함수 이름을 접두어로 찾는다(짧은 이름 먼저)', () => {
    const r = suggestAt('ro', 2, props)!;
    expect(r.from).toBe(0);
    expect(r.items.map((i) => i.label)).toContain('round');
    expect(r.items[0]!.insert.endsWith('(')).toBe(true);
  });
  it('이미 완성된 이름이나 빈 위치에는 제안하지 않는다', () => {
    expect(suggestAt('round', 5, props)).toBeNull();
    expect(suggestAt('1 + ', 4, props)).toBeNull();
  });
  it('인자가 없는 함수는 () 까지 넣는다', () => {
    expect(suggestAt('to', 2, props)!.items.find((i) => i.label === 'today')!.insert).toBe('today()');
  });
  it('점 뒤에서는 모든 함수를 보여 준다', () => {
    const r = suggestAt('prop("평점").', 11, props)!;
    expect(r.items.length).toBeGreaterThan(3);
  });
  it('prop(" 안에서는 속성 이름을 부분 일치로 제안하고 따옴표·괄호를 닫는다', () => {
    const r = suggestAt('prop("비', 7, props)!;
    expect(r.items.map((i) => i.label)).toEqual(['비용합']);
    expect(r.items[0]).toMatchObject({ kind: 'property', insert: '비용합")' });
    expect(r.from).toBe(6);
    const already = suggestAt('prop("비")', 7, props)!;
    expect(already.items[0]!.insert).toBe('비용합');
  });
  it('한글 단어 경계', () => {
    expect(suggestAt('1 + ro', 6, props)!.from).toBe(4);
  });
});
