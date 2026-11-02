// @vitest-environment jsdom
import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SyncStatus } from '@nopsidian/ipc-contract';
import { SyncBar } from './SyncBar';

const status = (patch: Partial<SyncStatus>): SyncStatus => ({
  configured: true,
  clientSource: 'builtin',
  builtinClientAvailable: true,
  connected: true,
  enabled: true,
  confirmedFirst: true,
  state: 'idle',
  lastSync: null,
  lastAttempt: null,
  message: null,
  conflicts: [],
  ...patch,
});

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

describe('SyncBar', () => {
  it('동기화가 꺼졌거나 켜진 idle 이면 아예 렌더하지 않는다', () => {
    render(<SyncBar status={status({ enabled: false, state: 'off' })} onOpen={() => {}} />);
    expect(container.querySelector('[data-testid="sync-bar"]')).toBeNull();

    render(<SyncBar status={status({ enabled: true, state: 'idle' })} onOpen={() => {}} />);
    expect(container.querySelector('[data-testid="sync-bar"]')).toBeNull();
  });

  it('진행 중과 실패만 표시한다', () => {
    render(<SyncBar status={status({ state: 'syncing' })} onOpen={() => {}} />);
    expect(container.querySelector('[data-testid="sync-bar"]')?.textContent).toBe('동기화 중…');

    render(<SyncBar status={status({ state: 'offline' })} onOpen={() => {}} />);
    const bar = container.querySelector('[data-testid="sync-bar"]');
    expect(bar?.textContent).toBe('동기화 실패');
    expect(bar?.classList.contains('syncbar--warn')).toBe(true);
  });
});
