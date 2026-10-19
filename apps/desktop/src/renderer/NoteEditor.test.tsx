// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NopsLinkHost } from '@nopsidian/editor/nops';
import type { AssetStore } from './assets';
import { NoteEditor } from './NoteEditor';

/** 에디터 코어는 무겁고 DOM 레이아웃이 필요하므로, 문서 구조만 흉내 낸 가짜 에디터를 쓴다 */
const mocks = vi.hoisted(() => ({ flashBlock: vi.fn(), createEditor: vi.fn(), parse: vi.fn() }));

vi.mock('@nopsidian/editor/nops', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nopsidian/editor/nops')>();
  return { ...actual, createNopsEditor: mocks.createEditor, parseDocument: mocks.parse, flashBlock: mocks.flashBlock };
});

// 진짜 TextSelection 은 진짜 문서를 요구한다. 가짜 문서에서도 돌도록 위치만 담는 값으로 바꾼다.
vi.mock('prosemirror-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('prosemirror-state')>();
  return {
    ...actual,
    TextSelection: {
      near: (pos: unknown) => ({ near: pos }),
      create: (_doc: unknown, anchor: number, head: number) => ({ anchor, head }),
    },
  };
});

let container: HTMLDivElement;
let root: Root | null = null;

interface Block {
  type: string;
  text: string;
  blockId?: string;
}

/** 블록마다 10칸씩 차지하는 아주 단순한 문서 */
function makeDoc(blocks: Block[]) {
  const nodes = blocks.map((b) => ({
    type: { name: b.type },
    attrs: { blockId: b.blockId ?? null, level: 2 },
    textContent: b.text,
    isBlock: true,
    descendants: () => true,
  }));
  return {
    firstChild: nodes[0],
    content: { size: blocks.length * 10 },
    forEach: (cb: (node: unknown, offset: number) => void) => nodes.forEach((n, i) => cb(n, i * 10)),
    descendants: (cb: (node: unknown, pos: number) => boolean) => void nodes.forEach((n, i) => cb(n, i * 10)),
    resolve: (pos: number) => ({ pos }),
  };
}

const DOC = makeDoc([
  { type: 'heading', text: '소제목' },
  { type: 'paragraph', text: '본문', blockId: 'b1' },
]);

function makeView() {
  return {
    state: {
      doc: DOC,
      selection: { anchor: 0, head: 0 },
      tr: {
        selection: undefined as unknown,
        setSelection(sel: unknown) {
          this.selection = sel;
          return this;
        },
        scrollIntoView() {
          return this;
        },
      },
    },
    dispatch: vi.fn(),
    isDestroyed: false,
  };
}

const nops = {
  note: {
    read: vi.fn(),
    save: vi.fn(),
  },
  asset: { save: vi.fn() },
  on: vi.fn(() => () => {}),
};

const assets = { resolve: () => undefined, add: () => {}, list: () => [] } as unknown as AssetStore;
const links = {} as NopsLinkHost;

type Focus = { heading: string | null; block: string | null; tick: number } | null;

const noteEditor = (focus: Focus): ReactNode => (
  <NoteEditor path="노트.md" vaultId="v1" assets={assets} links={links} onOpenLink={() => {}} noteLinkName="노트" focus={focus} />
);

function render(node: ReactNode): void {
  if (!root) root = createRoot(container);
  act(() => root!.render(node));
}

const flush = () => act(async () => {});

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);

  const view = makeView();
  mocks.flashBlock.mockClear();
  mocks.parse.mockReset();
  mocks.parse.mockReturnValue({ doc: DOC, baseline: null });
  mocks.createEditor.mockReset();
  mocks.createEditor.mockReturnValue({
    getView: () => view,
    getDocument: () => DOC,
    setDocument: vi.fn(),
    on: vi.fn(),
    focus: vi.fn(),
    destroy: vi.fn(),
  });

  nops.note.read.mockReset();
  nops.note.read.mockResolvedValue({ content: '# 노트\n\n본문', hash: 'h1' });
  nops.note.save.mockReset();
  nops.note.save.mockResolvedValue({ status: 'saved', hash: 'h2', content: '' });
  nops.on.mockClear();
  nops.on.mockReturnValue(() => {});
  (window as unknown as { nops: typeof nops }).nops = nops;
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  container.remove();
  vi.restoreAllMocks();
});

describe('NoteEditor 의 링크 이동(focus)', () => {
  it('처음 여는 노트는 한 번만 그 자리로 옮긴다', async () => {
    render(noteEditor({ heading: '소제목', block: null, tick: 1 }));
    await flush();
    expect(mocks.flashBlock).toHaveBeenCalledTimes(1);
  });

  it('같은 노트가 열린 채 이동할 곳이 바뀌면 그 자리로 옮긴다', async () => {
    render(noteEditor(null));
    await flush();
    expect(mocks.flashBlock).not.toHaveBeenCalled();

    render(noteEditor({ heading: '소제목', block: null, tick: 1 }));
    expect(mocks.flashBlock).toHaveBeenCalledTimes(1);
    expect(mocks.flashBlock.mock.calls[0]![1]).toBe(0); // 첫 블록(제목)
  });

  it('같은 제목 링크를 다시 눌러도(tick 이 바뀌면) 다시 옮긴다', async () => {
    render(noteEditor(null));
    await flush();

    render(noteEditor({ heading: '소제목', block: null, tick: 1 }));
    render(noteEditor({ heading: '소제목', block: null, tick: 2 }));
    expect(mocks.flashBlock).toHaveBeenCalledTimes(2);
  });

  it('블록 링크는 그 블록으로 옮긴다', async () => {
    render(noteEditor(null));
    await flush();

    render(noteEditor({ heading: null, block: 'b1', tick: 1 }));
    expect(mocks.flashBlock).toHaveBeenCalledTimes(1);
    expect(mocks.flashBlock.mock.calls[0]![1]).toBe(10); // 두 번째 블록(^b1)
  });
});
