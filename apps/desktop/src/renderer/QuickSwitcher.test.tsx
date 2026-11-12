// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuickSwitcher } from './QuickSwitcher';
import type { NoteSummary } from '@nopsidian/ipc-contract';

let container: HTMLDivElement;
let root: Root | null = null;

const render = (node: ReactNode) => {
  if (!root) root = createRoot(container);
  act(() => root!.render(node));
};

const note = (path: string, title: string, aliases: string[] = []): NoteSummary => ({
  path,
  title,
  aliases,
  icon: null,
  cover: null,
  mtime: 0,
  size: 0,
});

const notes = [note('클린 코드.md', '클린 코드', ['Clean Code']), note('메모.md', '메모')];

type BodyHit = { path: string; title: string; snippet: string };
const query = vi.fn<() => Promise<BodyHit[]>>(async () => []);

const flush = () => act(async () => {});

const input = () => container.querySelector<HTMLInputElement>('input[role="combobox"]')!;
const typeInto = (value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input(), value);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const press = (init: KeyboardEventInit) =>
  act(() => {
    input().dispatchEvent(new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true }));
  });
const itemTexts = () => [...container.querySelectorAll('[role="option"]')].map((el) => el.textContent ?? '');
const activeText = () => container.querySelector('.switcher__item.is-active')?.textContent ?? '';
const chip = (label: string) => [...container.querySelectorAll<HTMLElement>('.switcher__chip')].find((el) => el.textContent === label)!;
const wait = (ms: number) => act(async () => {
  await new Promise((r) => setTimeout(r, ms));
});

const onOpen = vi.fn();
const onCreate = vi.fn();
const onClose = vi.fn();

const mount = (over: { initialScope?: 'all' | 'title' | 'body'; indexing?: boolean } = {}) => {
  render(<QuickSwitcher notes={notes} onOpen={onOpen} onCreate={onCreate} onClose={onClose} {...over} />);
};

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  query.mockClear();
  query.mockResolvedValue([]);
  onOpen.mockClear();
  onCreate.mockClear();
  onClose.mockClear();
  (window as unknown as { nops: unknown }).nops = { search: { query } };
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  container.remove();
  vi.useRealTimers();
});

describe('QuickSwitcher 통합 검색 팝업', () => {
  it('제목 일치가 없으면 만들기 행이 기본 선택이고 Enter 로 새 노트를 만든다', async () => {
    mount();
    typeInto('없는노트');
    await wait(160);

    expect(activeText()).toContain('“없는노트” 새 노트 만들기');
    press({ key: 'Enter' });
    expect(onCreate).toHaveBeenCalledWith('없는노트');
    expect(onOpen).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('제목 일치가 있으면 첫 제목이 기본 선택이고, 만들기 행은 목록 맨 아래에 남는다', async () => {
    mount();
    typeInto('클린');
    await wait(160);

    expect(activeText()).toContain('클린 코드');
    expect(itemTexts().at(-1)).toContain('새 노트 만들기');
    press({ key: 'Enter' });
    expect(onOpen).toHaveBeenCalledWith('클린 코드.md', false);
  });

  it('↑↓ 은 한 목록 안에서 움직이고 경계에서 멈춘다', async () => {
    mount();
    typeInto('클린');
    await wait(160);
    const rows = container.querySelectorAll('[role="option"]').length;
    // 아래로 여러 번 눌러도 마지막(만들기) 행에서 멈춘다
    for (let i = 0; i < rows + 3; i++) press({ key: 'ArrowDown' });
    expect(activeText()).toContain('새 노트 만들기');
    for (let i = 0; i < rows + 3; i++) press({ key: 'ArrowUp' });
    expect(activeText()).toContain('클린 코드');
  });

  it('⌘/Ctrl+Enter 는 새 탭으로 열고, ⌘/Ctrl+클릭도 같다', async () => {
    mount();
    typeInto('클린');
    await wait(160);
    press({ key: 'Enter', metaKey: true });
    expect(onOpen).toHaveBeenLastCalledWith('클린 코드.md', true);

    onOpen.mockClear();
    typeInto('클린 코드');
    await wait(160);
    const option = container.querySelector<HTMLElement>('[role="option"]')!;
    act(() => {
      option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, ctrlKey: true }));
    });
    expect(onOpen).toHaveBeenCalledWith('클린 코드.md', true);
  });

  it('본문 칩은 제목 구역·만들기 행 없이 색인 결과를 보여 주고 120ms 뒤에만 묻는다', async () => {
    vi.useFakeTimers();
    mount({ initialScope: 'body' });
    typeInto('바나나');
    expect(query).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(119);
    });
    expect(query).not.toHaveBeenCalled();
    query.mockResolvedValue([{ path: '메모.md', title: '메모', snippet: '바나나우유를 사 왔다' }]);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    await flush();

    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith({ q: '바나나', limit: 20 });
    expect(itemTexts().join('\n')).toContain('메모');
    expect(itemTexts().join('\n')).toContain('바나나우유를 사 왔다');
    expect(itemTexts().join('\n')).not.toContain('새 노트 만들기');

    press({ key: 'Enter' });
    expect(onOpen).toHaveBeenCalledWith('메모.md', false);
  });

  it('칩을 바꾸면 구역이 바뀐다(제목 칩은 본문 결과를 감춘다)', async () => {
    mount();
    typeInto('메모');
    await wait(160);
    query.mockResolvedValue([{ path: '메모.md', title: '메모', snippet: '본문 일치' }]);
    act(() => chip('본문').click());
    await wait(160);
    expect(itemTexts().join('\n')).toContain('본문 일치');
    expect(itemTexts().join('\n')).not.toContain('새 노트 만들기');

    act(() => chip('제목').click());
    expect(itemTexts().join('\n')).not.toContain('본문 일치');
  });

  it('색인 중이면 본문 구역에 안내를 보여 준다', async () => {
    mount({ initialScope: 'body', indexing: true });
    typeInto('바나나');
    await wait(160);
    expect(container.textContent).toContain('색인 중');
  });

  it('Esc 는 입력을 먼저 지우고, 빈 입력에서 다시 누르면 닫는다', async () => {
    mount();
    typeInto('클린');
    press({ key: 'Escape' });
    expect(input().value).toBe('');
    expect(onClose).not.toHaveBeenCalled();
    press({ key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
