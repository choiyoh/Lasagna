import { describe, expect, it } from 'vitest';
import { movedColumns, movedRows, sortedView } from './view-edit';
import type { View } from './types';

const view = (extra: Partial<View> = {}): View => ({ id: 'v', name: 'v', type: 'table', sort: [], ...extra });

describe('view-edit', () => {
  it('열 옮기기: 대상 앞으로, 제목은 고정', () => {
    expect(movedColumns(['title', 'a', 'b', 'c'], 'c', 'a')).toEqual(['title', 'c', 'a', 'b']);
    expect(movedColumns(['title', 'a', 'b'], 'b', 'title')).toEqual(['title', 'b', 'a']);
    expect(movedColumns(['title', 'a', 'b'], 'title', 'b')).toEqual(['title', 'a', 'b']);
    expect(movedColumns(['title', 'a'], 'a', 'a')).toEqual(['title', 'a']);
  });
  it('행 옮기기', () => {
    expect(movedRows(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b']);
    expect(movedRows(['a', 'b', 'c'], 'a', 'c')).toEqual(['b', 'a', 'c']);
  });
  it('정렬: 맨 앞에 두고 기존 같은 열 규칙은 대체, 해제, 수동 순서 버림', () => {
    const v = sortedView(view({ sort: [{ prop: 'x', dir: 'asc' }, { prop: 'y', dir: 'desc' }], manualOrder: ['p'] }), 'y', 'asc');
    expect(v.sort).toEqual([{ prop: 'y', dir: 'asc' }, { prop: 'x', dir: 'asc' }]);
    expect(v.manualOrder).toBeUndefined();
    expect(sortedView(v, 'y', null).sort).toEqual([{ prop: 'x', dir: 'asc' }]);
  });
});
