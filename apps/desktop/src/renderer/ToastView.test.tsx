// @vitest-environment jsdom
import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastView } from './ToastView';

let container: HTMLDivElement;
let root: Root | null = null;

const render = (node: ReactNode) => {
  if (!root) root = createRoot(container);
  act(() => root!.render(node));
};

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

describe('ToastView', () => {
  it('동작 버튼을 aria-live polite 상태로 보여 주고 누르면 닫힌다', () => {
    const onClick = vi.fn();
    const setToast = vi.fn();
    render(<ToastView toast={{ message: '새 행을 만들었어요.', action: { label: '필터 지우기', onClick } }} setToast={setToast} />);

    const toast = container.querySelector('.toast');
    expect(toast?.getAttribute('role')).toBe('status');
    expect(toast?.getAttribute('aria-live')).toBe('polite');
    const button = container.querySelector<HTMLButtonElement>('.toast button');
    expect(button?.textContent).toBe('필터 지우기');

    act(() => button!.click());
    expect(onClick).toHaveBeenCalledOnce();
    expect(setToast).toHaveBeenCalledWith(null);
  });
});
