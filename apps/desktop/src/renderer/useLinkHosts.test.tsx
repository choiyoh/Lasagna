// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NoteSummary } from '@nopsidian/ipc-contract';
import type { WikiLinkTarget } from '@nopsidian/editor/nops';
import type { AssetStore } from './assets';
import { useLinkHosts } from './useLinkHosts';

let container: HTMLDivElement;
let root: Root | null = null;
/** 마지막 렌더의 openLink */
let opened: ((link: WikiLinkTarget) => void) | null = null;

const assets = { resolve: () => undefined, add: () => {}, list: () => [] } as unknown as AssetStore;

const note = (path: string, title: string): NoteSummary => ({ path, title, aliases: [], icon: null, cover: null, mtime: 0, size: 0 });

const link = (over: Partial<WikiLinkTarget> = {}): WikiLinkTarget => ({ target: '', heading: null, block: null, embed: false, ...over });

function Host({
  notes,
  selected,
  setSelected,
  setFocus,
}: {
  notes: NoteSummary[];
  selected: string | null;
  setSelected: (path: string) => void;
  setFocus: (focus: { heading: string | null; block: string | null } | null) => void;
}): ReactNode {
  opened = useLinkHosts({ notes, selected, assets, setSelected, setFocus }).openLink;
  return null;
}

function render(node: ReactNode): void {
  if (!root) root = createRoot(container);
  act(() => root!.render(node));
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  opened = null;
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  container.remove();
});

describe('useLinkHosts.openLink', () => {
  it('노트 이름이 없는 [[#제목]]·[[#^블록]] 은 지금 열린 노트를 연다', () => {
    const setSelected = vi.fn();
    const setFocus = vi.fn();
    render(<Host notes={[note('노트.md', '노트')]} selected="노트.md" setSelected={setSelected} setFocus={setFocus} />);

    act(() => opened!(link({ heading: '제목' })));
    expect(setSelected).toHaveBeenLastCalledWith('노트.md');
    expect(setFocus).toHaveBeenLastCalledWith({ heading: '제목', block: null });

    act(() => opened!(link({ block: 'b1' })));
    expect(setFocus).toHaveBeenLastCalledWith({ heading: null, block: 'b1' });
  });

  it('이름이 있는 링크는 그 노트를 연다', () => {
    const setSelected = vi.fn();
    const setFocus = vi.fn();
    const notes = [note('노트.md', '노트'), note('다른 노트.md', '다른 노트')];
    render(<Host notes={notes} selected="노트.md" setSelected={setSelected} setFocus={setFocus} />);

    act(() => opened!(link({ target: '다른 노트', heading: '소제목' })));
    expect(setSelected).toHaveBeenLastCalledWith('다른 노트.md');
    expect(setFocus).toHaveBeenLastCalledWith({ heading: '소제목', block: null });
  });

  it('열린 노트가 없으면 아무 것도 하지 않는다', () => {
    const setSelected = vi.fn();
    const setFocus = vi.fn();
    render(<Host notes={[note('노트.md', '노트')]} selected={null} setSelected={setSelected} setFocus={setFocus} />);

    act(() => opened!(link({ heading: '제목' })));
    expect(setSelected).not.toHaveBeenCalled();
    expect(setFocus).not.toHaveBeenCalled();
  });
});
