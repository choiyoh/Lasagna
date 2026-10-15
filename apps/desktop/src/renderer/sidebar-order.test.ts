import { describe, expect, it } from 'vitest';
import { placeInOrder, remapOrder, sortByOrder } from './sidebar-order';

describe('sidebar-order', () => {
  it('저장된 순서대로 정렬하고, 없는 이름은 원래 순서로 뒤에 붙인다', () => {
    const names = ['a', 'b', 'c', 'd'];
    expect(sortByOrder(names, (n) => n, ['c', 'a'])).toEqual(['c', 'a', 'b', 'd']);
    expect(sortByOrder(names, (n) => n, undefined)).toEqual(names);
    expect(sortByOrder(names, (n) => n, ['x', 'd'])).toEqual(['d', 'a', 'b', 'c']);
  });
  it('앞/뒤에 끼워 넣는다', () => {
    expect(placeInOrder(['a', 'b', 'c'], 'c', 'a', 'before')).toEqual(['c', 'a', 'b']);
    expect(placeInOrder(['a', 'b', 'c'], 'a', 'c', 'after')).toEqual(['b', 'c', 'a']);
    expect(placeInOrder(['a', 'b', 'c'], 'a', 'b', 'before')).toEqual(['a', 'b', 'c']);
    expect(placeInOrder(['a', 'b'], 'z', 'b', 'after')).toEqual(['a', 'b', 'z']);
    expect(placeInOrder(['a', 'b'], 'z', 'nope', 'before')).toEqual(['a', 'b', 'z']);
  });
  it('이름 바꾸기·이동에 순서가 따라간다', () => {
    const o = { '': ['폴더', '메모.md'], 폴더: ['a.md', 'b.md'], '폴더/하위': ['c.md'] };
    expect(remapOrder(o, '메모.md', '새메모.md')['']).toEqual(['폴더', '새메모.md']);
    expect(remapOrder(o, '폴더/a.md', '폴더/z.md')['폴더']).toEqual(['z.md', 'b.md']);
    expect(remapOrder(o, '폴더/a.md', 'a.md')['폴더']).toEqual(['b.md']);
    const f = remapOrder(o, '폴더', '다른');
    expect(f['다른']).toEqual(['a.md', 'b.md']);
    expect(f['다른/하위']).toEqual(['c.md']);
    expect(f['']).toEqual(['다른', '메모.md']);
    expect(f['폴더']).toBeUndefined();
  });
});
