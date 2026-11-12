// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { useAppShortcuts, type ShortcutActions } from './useAppShortcuts';

let container: HTMLDivElement;
let root: Root | null = null;

/** window.addEventListener/removeEventListener 스파이 */
type Listener = MockInstance<(...args: unknown[]) => void>;

/** 에러 바운더리 테스트와 같은 방식으로 그린다 */
function render(node: ReactNode): void {
  if (!root) root = createRoot(container);
  act(() => root!.render(node));
}

const actions = (over: Partial<ShortcutActions> = {}): ShortcutActions => ({
  overlayOpen: false,
  closeOverlay: vi.fn(),
  selected: null,
  openSwitcher: vi.fn(),
  toggleGraph: vi.fn(),
  newNote: vi.fn(),
  openSettings: vi.fn(),
  openShortcuts: vi.fn(),
  rename: vi.fn(),
  closeTab: vi.fn(),
  openPalette: vi.fn(),
  toggleBookmark: vi.fn(),
  openDaily: vi.fn(),
  togglePanel: vi.fn(),
  openBodySearch: vi.fn(),
  dbOpen: false,
  ...over,
});

/** App 처럼 매 렌더 새 객체를 넘기는 화면 */
function Host({ tick, make }: { tick: number; make: (tick: number) => ShortcutActions }): ReactNode {
  useAppShortcuts(make(tick));
  return <p>{tick}</p>;
}

const keydown = (init: KeyboardEventInit) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', init));
  });

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  container.remove();
  vi.restoreAllMocks();
});

describe('useAppShortcuts', () => {
  it('다시 그려도 keydown 리스너는 한 번만 등록하고 언마운트 때 한 번만 뗀다', () => {
    const add = vi.spyOn(window, 'addEventListener') as unknown as Listener;
    const remove = vi.spyOn(window, 'removeEventListener') as unknown as Listener;
    const make = () => actions();

    render(<Host tick={0} make={make} />);
    render(<Host tick={1} make={make} />);
    render(<Host tick={2} make={make} />);

    expect(add.mock.calls.filter((c) => c[0] === 'keydown')).toHaveLength(1);
    expect(remove.mock.calls.filter((c) => c[0] === 'keydown')).toHaveLength(0);

    act(() => root!.unmount());
    root = null;
    expect(remove.mock.calls.filter((c) => c[0] === 'keydown')).toHaveLength(1);
  });

  it('핸들러는 마지막 렌더의 콜백을 쓴다', () => {
    const first = actions();
    const second = actions();

    render(<Host tick={0} make={() => first} />);
    render(<Host tick={1} make={() => second} />);
    keydown({ key: 'n', metaKey: true });

    expect(second.newNote).toHaveBeenCalledTimes(1);
    expect(first.newNote).not.toHaveBeenCalled();
  });

  it('핸들러는 마지막 렌더의 상태(overlayOpen)도 본다', () => {
    const first = actions();
    const second = actions({ overlayOpen: true });

    render(<Host tick={0} make={() => first} />);
    keydown({ key: 'Escape' });
    expect(first.closeOverlay).not.toHaveBeenCalled();

    render(<Host tick={1} make={() => second} />);
    keydown({ key: 'Escape' });
    expect(second.closeOverlay).toHaveBeenCalledTimes(1);
  });

  it('하위 레이어가 열려 있으면 상위 DB/그래프를 닫지 않는다', () => {
    const a = actions({ overlayOpen: true });
    render(<Host tick={0} make={() => a} />);

    const layer = document.createElement('div');
    layer.className = 'dbpop';
    document.body.appendChild(layer);
    keydown({ key: 'Escape' });
    expect(a.closeOverlay).not.toHaveBeenCalled();

    layer.remove();
    keydown({ key: 'Escape' });
    expect(a.closeOverlay).toHaveBeenCalledTimes(1);
  });

  it('하위 핸들러가 preventDefault 한 Escape 는 상위를 닫지 않는다', () => {
    const a = actions({ overlayOpen: true });
    render(<Host tick={0} make={() => a} />);

    const e = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    e.preventDefault();
    act(() => {
      window.dispatchEvent(e);
    });
    expect(a.closeOverlay).not.toHaveBeenCalled();
  });

  it('⌘⇧\\ 로 도크를, ⌘⇧F 로 본문 검색을 연다', () => {
    const a = actions();
    render(<Host tick={0} make={() => a} />);

    keydown({ key: '|', code: 'Backslash', metaKey: true, shiftKey: true });
    expect(a.togglePanel).toHaveBeenCalledTimes(1);

    keydown({ key: 'F', code: 'KeyF', metaKey: true, shiftKey: true });
    expect(a.openBodySearch).toHaveBeenCalledTimes(1);
    // ⇧ 없는 ⌘F 는 편집기 찾기라 앱 단축키가 가로채지 않는다
    keydown({ key: 'f', code: 'KeyF', metaKey: true });
    expect(a.openBodySearch).toHaveBeenCalledTimes(1);
  });
});

describe('집중 모드 단축키', () => {
  it('⌘⇧M 은 작가 모드에서만 집중 모드를 토글한다', () => {
    const on = actions({ focusAvailable: true, toggleFocus: vi.fn() });
    render(<Host tick={0} make={() => on} />);
    keydown({ key: 'M', code: 'KeyM', metaKey: true, shiftKey: true });
    expect(on.toggleFocus).toHaveBeenCalledTimes(1);

    // 작가 모드 OFF: 아무 일도 하지 않고 이벤트도 가로채지 않는다
    const off = actions({ focusAvailable: false, toggleFocus: vi.fn() });
    render(<Host tick={1} make={() => off} />);
    const e = new KeyboardEvent('keydown', { key: 'M', code: 'KeyM', metaKey: true, shiftKey: true, cancelable: true });
    act(() => {
      window.dispatchEvent(e);
    });
    expect(off.toggleFocus).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it('집중 모드에서 Esc 는 집중 모드를 먼저 끝낸다', () => {
    const a = actions({ focusMode: true, toggleFocus: vi.fn() });
    render(<Host tick={0} make={() => a} />);
    keydown({ key: 'Escape' });
    expect(a.toggleFocus).toHaveBeenCalledTimes(1);
    expect(a.closeOverlay).not.toHaveBeenCalled();
  });
});

describe('집중 모드 Esc 와 열린 레이어', () => {
  it('찾기 막대가 열려 있으면 Esc 는 집중 모드를 끝내지 않는다', () => {
    const a = actions({ focusMode: true, toggleFocus: vi.fn() });
    render(<Host tick={0} make={() => a} />);
    const bar = document.createElement('div');
    bar.className = 'findbar';
    document.body.append(bar);
    keydown({ key: 'Escape' });
    expect(a.toggleFocus).not.toHaveBeenCalled();
    bar.remove();
    keydown({ key: 'Escape' });
    expect(a.toggleFocus).toHaveBeenCalledTimes(1);
  });
});
