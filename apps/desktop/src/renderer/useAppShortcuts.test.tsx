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
});
