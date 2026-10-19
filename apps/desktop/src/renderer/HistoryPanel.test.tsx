// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HistoryPanel } from './HistoryPanel';

let container: HTMLDivElement;
let root: Root | null = null;

function render(node: ReactNode): void {
  if (!root) root = createRoot(container);
  act(() => root!.render(node));
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const entry = (id: string) => ({ id, time: '2026-10-12T10:00:00.000Z', size: 12 });

const nops = {
  history: { list: vi.fn(), read: vi.fn() },
  note: { read: vi.fn() },
  on: vi.fn(() => () => {}),
};

const flush = () => act(async () => {});

const diffText = () => container.querySelector('[data-testid="history-diff"]')?.textContent ?? '';
const entryButtons = () => [...container.querySelectorAll<HTMLElement>('[data-testid="history-entry"]')];
const clickEntry = (i: number) => act(() => entryButtons()[i]!.click());

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  nops.history.list.mockReset();
  nops.history.read.mockReset();
  nops.note.read.mockReset();
  nops.on.mockReset();
  nops.history.list.mockResolvedValue([entry('a'), entry('b')]);
  nops.note.read.mockResolvedValue({ content: '현재 내용', hash: 'h1' });
  nops.on.mockReturnValue(() => {});
  (window as unknown as { nops: typeof nops }).nops = nops;
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  container.remove();
  vi.restoreAllMocks();
});

describe('HistoryPanel', () => {
  it('빠르게 두 버전을 고르면 늦게 도착한 이전 응답은 무시한다', async () => {
    const a = deferred<{ content: string }>();
    const b = deferred<{ content: string }>();
    nops.history.read.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);

    render(<HistoryPanel path="노트.md" onRestored={() => {}} />);
    await flush();
    clickEntry(0);
    clickEntry(1);
    expect(nops.history.read).toHaveBeenNthCalledWith(1, { path: '노트.md', id: 'a' });
    expect(nops.history.read).toHaveBeenNthCalledWith(2, { path: '노트.md', id: 'b' });

    await act(async () => b.resolve({ content: 'B 버전' }));
    expect(diffText()).toContain('B 버전');

    // 먼저 고른 버전의 응답이 늦게 와도 화면을 바꾸지 않는다
    await act(async () => a.resolve({ content: 'A 버전' }));
    expect(diffText()).toContain('B 버전');
    expect(diffText()).not.toContain('A 버전');
  });

  it('읽기에 실패하면 이전 화면을 그대로 두고 미처리 거부를 남기지 않는다', async () => {
    const a = deferred<{ content: string }>();
    const b = deferred<{ content: string }>();
    nops.history.read.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);

    render(<HistoryPanel path="노트.md" onRestored={() => {}} />);
    await flush();
    clickEntry(0);
    await act(async () => a.resolve({ content: 'A 버전' }));
    expect(diffText()).toContain('A 버전');

    clickEntry(1);
    await act(async () => b.reject(new Error('읽기 실패')));
    expect(diffText()).toContain('A 버전');
  });

  it('노트를 빠르게 바꾸면 이전 노트의 목록이 늦게 덮어쓰지 않는다', async () => {
    const first = deferred<ReturnType<typeof entry>[]>();
    const second = deferred<ReturnType<typeof entry>[]>();
    nops.history.list.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    render(<HistoryPanel path="a.md" onRestored={() => {}} />);
    render(<HistoryPanel path="b.md" onRestored={() => {}} />);

    await act(async () => second.resolve([entry('b1')]));
    await flush();
    expect(entryButtons()).toHaveLength(1);

    await act(async () => first.resolve([entry('a1'), entry('a2'), entry('a3')]));
    await flush();
    expect(entryButtons()).toHaveLength(1);
  });
});
