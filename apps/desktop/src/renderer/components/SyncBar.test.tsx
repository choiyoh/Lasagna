// @vitest-environment jsdom
import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SyncStatus } from '@nopsidian/ipc-contract';
import { SyncBar, syncBarCopy } from './SyncBar';

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

describe('syncBarCopy', () => {
  it.each([
    ['syncing', '동기화 중…', 'Google Drive 동기화 중'],
    ['error', '동기화 오류', '일부 파일을 동기화하지 못했어요. 눌러서 확인하세요.'],
    ['offline', '오프라인', '오프라인 — 연결되면 자동으로 다시 시도해요.'],
    ['needsAuth', '재연결 필요', 'Google 계정을 다시 연결해 주세요.'],
    ['blocked', '동기화 멈춤', '삭제가 많아 동기화를 멈췄어요. 눌러서 확인하세요.'],
  ] as const)('%s 문구와 title 을 상태별로 고른다', (state, label, title) => {
    const copy = syncBarCopy(status({ state }), false);
    expect(copy).toMatchObject({ label, title });
    expect(copy?.announcement).toBeTruthy();
  });

  it('꺼짐·켜진 idle·최근 완료만 표시 여부를 정한다', () => {
    expect(syncBarCopy(status({ state: 'off', enabled: false }), false)).toBeNull();
    expect(syncBarCopy(status({ state: 'idle' }), false)).toBeNull();
    expect(syncBarCopy(status({ state: 'idle' }), true)).toMatchObject({ label: '방금 동기화됨', title: 'Google Drive 동기화 완료' });
    expect(syncBarCopy(null, false)).toBeNull();
  });
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
    expect(bar?.textContent).toBe('오프라인');
    expect(bar?.getAttribute('title')).toBe('오프라인 — 연결되면 자동으로 다시 시도해요.');
    expect(bar?.classList.contains('syncbar--warn')).toBe(true);
  });

  it('상태를 aria-live polite 로 알리고 클릭하면 연다', () => {
    let opened = 0;
    render(<SyncBar status={status({ state: 'needsAuth' })} onOpen={() => (opened += 1)} />);
    const live = container.querySelector('[role="status"]');
    expect(live?.getAttribute('aria-live')).toBe('polite');
    expect(live?.getAttribute('aria-atomic')).toBe('true');
    expect(live?.textContent).toBe('Google 계정을 다시 연결해야 합니다.');
    expect(container.querySelector('[data-testid="sync-bar"]')?.getAttribute('title')).toBe('Google 계정을 다시 연결해 주세요.');

    act(() => (container.querySelector('[data-testid="sync-bar"]') as HTMLButtonElement).click());
    expect(opened).toBe(1);
  });
});
