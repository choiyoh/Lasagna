import { describe, expect, it } from 'vitest';
import { initialTabs, parseTabs, selectedOf, tabsReducer, type TabsAction, type TabsState } from './tabs';

const run = (...actions: TabsAction[]): TabsState => actions.reduce(tabsReducer, initialTabs());

describe('탭 상태', () => {
  it('처음 열면 탭이 생기고, 다시 열면 같은 탭을 바꿔치기한다', () => {
    const s = run({ type: 'open', path: 'a.md' }, { type: 'open', path: 'b.md' });
    expect(s.panes[0]).toEqual({ tabs: ['b.md'], active: 'b.md' });
  });
  it('새 탭으로 열면 나란히 쌓이고, 이미 열린 노트는 그 탭으로 간다', () => {
    const s = run({ type: 'open', path: 'a.md' }, { type: 'open', path: 'b.md', newTab: true }, { type: 'open', path: 'a.md' });
    expect(s.panes[0]).toEqual({ tabs: ['a.md', 'b.md'], active: 'a.md' });
  });
  it('탭을 닫으면 이웃 탭이 활성, 마지막이면 빈 칸', () => {
    let s = run({ type: 'open', path: 'a.md' }, { type: 'open', path: 'b.md', newTab: true }, { type: 'open', path: 'c.md', newTab: true });
    s = tabsReducer(s, { type: 'close', pane: 0, path: 'c.md' });
    expect(s.panes[0]!.active).toBe('b.md');
    s = tabsReducer(s, { type: 'close', pane: 0, path: 'a.md' });
    s = tabsReducer(s, { type: 'close', pane: 0, path: 'b.md' });
    expect(s.panes[0]).toEqual({ tabs: [], active: null });
    expect(selectedOf(s)).toBeNull();
  });
  it('분할: 빈 칸이 생기고 거기로 열린다. 같은 노트는 다른 칸에서 열리지 않고 그리로 이동', () => {
    let s = run({ type: 'open', path: 'a.md' }, { type: 'split', dir: 'row' });
    expect(s.panes).toHaveLength(2);
    expect(s.activePane).toBe(1);
    s = tabsReducer(s, { type: 'open', path: 'b.md' });
    expect(s.panes[1]).toEqual({ tabs: ['b.md'], active: 'b.md' });
    s = tabsReducer(s, { type: 'open', path: 'a.md' });
    expect(s.activePane).toBe(0);
    expect(s.panes[0]!.tabs).toEqual(['a.md']);
  });
  it('분할 칸의 마지막 탭을 닫으면 분할이 풀린다', () => {
    let s = run({ type: 'open', path: 'a.md' }, { type: 'split', dir: 'col' }, { type: 'open', path: 'b.md' });
    s = tabsReducer(s, { type: 'close', pane: 1, path: 'b.md' });
    expect(s.panes).toHaveLength(1);
    expect(selectedOf(s)).toBe('a.md');
  });
  it('unsplit: 모든 탭을 첫 칸으로', () => {
    const s = run({ type: 'open', path: 'a.md' }, { type: 'split', dir: 'row' }, { type: 'open', path: 'b.md' }, { type: 'unsplit' });
    expect(s.panes).toEqual([{ tabs: ['a.md', 'b.md'], active: 'b.md' }]);
  });
  it('이름이 바뀌면 탭도 따라간다(폴더 포함)', () => {
    const s = run({ type: 'open', path: '폴더/a.md' }, { type: 'open', path: 'b.md', newTab: true }, { type: 'remap', from: '폴더', to: '새폴더' });
    expect(s.panes[0]!.tabs).toEqual(['새폴더/a.md', 'b.md']);
  });
  it('저장된 상태 복원: 없는 노트·중복은 버린다', () => {
    const exists = (p: string) => p !== 'gone.md';
    const s = parseTabs({ panes: [{ tabs: ['a.md', 'gone.md', 'a.md'], active: 'gone.md' }, { tabs: ['b.md'], active: 'b.md' }], activePane: 1, dir: 'col' }, exists);
    expect(s).toEqual({ panes: [{ tabs: ['a.md'], active: 'a.md' }, { tabs: ['b.md'], active: 'b.md' }], activePane: 1, dir: 'col' });
    expect(parseTabs('x', exists)).toBeNull();
    expect(parseTabs({ panes: [] }, exists)).toBeNull();
  });
});
