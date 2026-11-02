// @vitest-environment jsdom
import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmptyState } from './EmptyState';

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

describe('EmptyState', () => {
  it('조건 제안은 − 글리프와 접근성 이름을 갖는다', () => {
    const onApply = vi.fn();
    render(
      <EmptyState
        title="행이 없어요"
        suggestions={[{ label: '상태 = 완료', count: 1, onApply }]}
      />,
    );

    const button = container.querySelector<HTMLButtonElement>('.emptystate__suggestion');
    expect(button?.getAttribute('aria-label')).toBe('「상태 = 완료」 조건 빼기 — 1개 남음');
    expect(button?.querySelector('.emptystate__suggestion-icon')?.textContent).toBe('−');
    expect(button?.querySelector('.emptystate__suggestion-icon')?.getAttribute('aria-hidden')).toBe('true');

    act(() => button!.click());
    expect(onApply).toHaveBeenCalledOnce();
  });
});
