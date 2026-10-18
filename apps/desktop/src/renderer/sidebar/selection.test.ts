import { describe, expect, it } from 'vitest';
import type { NoteSummary } from '@nopsidian/ipc-contract';
import { buildTree } from './build-tree';
import { flattenVisible, rangeBetween, topLevel } from './selection';

const n = (path: string): NoteSummary => ({ path, title: path, aliases: [], icon: null, mtime: 0, size: 0 });

describe('sidebar selection helpers', () => {
  const tree = buildTree([n('a/x.md'), n('a/y.md'), n('b.md'), n('c.md')], ['빈']);
  it('보이는 순서로 펼친다(접힌 폴더 안은 빠진다)', () => {
    const open = flattenVisible(tree, () => true).map((v) => v.path);
    expect(open).toEqual(['빈', 'a', 'a/x.md', 'a/y.md', 'b.md', 'c.md']);
    const closed = flattenVisible(tree, () => false).map((v) => v.path);
    expect(closed).toEqual(['빈', 'a', 'b.md', 'c.md']);
    expect(flattenVisible(tree, () => true).find((v) => v.path === 'a/y.md')).toMatchObject({ depth: 1, parent: 'a', isFolder: false });
  });
  it('폴더마다 한도까지만 펼친다', () => {
    const big = buildTree(Array.from({ length: 10 }, (_, i) => n(`큰/${String(i).padStart(2, '0')}.md`)), []);
    const items = flattenVisible(big, () => true, (f) => (f === '큰' ? 3 : 100)).map((v) => v.path);
    expect(items).toEqual(['큰', '큰/00.md', '큰/01.md', '큰/02.md']);
  });
  it('범위는 순서와 무관하게 양끝을 포함한다', () => {
    const list = flattenVisible(tree, () => true);
    expect(rangeBetween(list, '빈', 'a/x.md').map((v) => v.path)).toEqual(['빈', 'a', 'a/x.md']);
    expect(rangeBetween(list, 'a/x.md', '빈').map((v) => v.path)).toEqual(['빈', 'a', 'a/x.md']);
    expect(rangeBetween(list, '없음', 'b.md').map((v) => v.path)).toEqual(['b.md']);
  });
  it('폴더를 고르면 안의 항목은 따로 옮기지 않는다', () => {
    const items = [
      { path: 'a', isFolder: true },
      { path: 'a/x.md', isFolder: false },
      { path: 'b.md', isFolder: false },
      { path: 'ab.md', isFolder: false },
    ];
    expect(topLevel(items).map((i) => i.path)).toEqual(['a', 'b.md', 'ab.md']);
  });
});
