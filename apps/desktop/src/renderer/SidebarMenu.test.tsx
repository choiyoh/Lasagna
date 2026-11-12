// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SidebarMenu, type SidebarMenuItem } from './SidebarMenu';

let container: HTMLDivElement;
let root: Root | null = null;

const render = (node: ReactNode) => {
  if (!root) root = createRoot(container);
  act(() => root!.render(node));
};

const items = (onA = vi.fn(), onB = vi.fn()): SidebarMenuItem[] => [
  { id: 'a', label: '새 폴더', onRun: onA },
  { id: 'b', label: '휴지통', separator: true, onRun: onB },
];

const menuItems = () => [...container.querySelectorAll<HTMLElement>('[role="menuitem"]')];
const press = (init: KeyboardEventInit) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true }));
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
});

describe('SidebarMenu', () => {
  it('열면 첫 항목에 초점이 가고 ↑↓·Home/End 로 돈다', () => {
    const onClose = vi.fn();
    render(<SidebarMenu anchor={{ x: 10, y: 10 }} items={items()} onClose={onClose} />);

    expect(document.activeElement).toBe(menuItems()[0]);
    press({ key: 'ArrowDown' });
    expect(document.activeElement).toBe(menuItems()[1]);
    press({ key: 'ArrowDown' }); // 마지막에서 처음으로 돈다
    expect(document.activeElement).toBe(menuItems()[0]);
    press({ key: 'ArrowUp' });
    expect(document.activeElement).toBe(menuItems()[1]);
    press({ key: 'Home' });
    expect(document.activeElement).toBe(menuItems()[0]);
    press({ key: 'End' });
    expect(document.activeElement).toBe(menuItems()[1]);
  });

  it('Enter(클릭)로 항목을 실행하고 먼저 닫는다', () => {
    const onClose = vi.fn();
    const onA = vi.fn();
    render(<SidebarMenu anchor={{ x: 10, y: 10 }} items={items(onA)} onClose={onClose} />);

    act(() => menuItems()[0].click());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onA).toHaveBeenCalledTimes(1);
  });

  it('Esc 로 닫는다(상위 화면에 전파하지 않는다)', () => {
    const onClose = vi.fn();
    render(<SidebarMenu anchor={{ x: 10, y: 10 }} items={items()} onClose={onClose} />);

    const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => {
      window.dispatchEvent(e);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
  });
});
