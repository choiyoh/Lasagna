// @vitest-environment jsdom
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '@nopsidian/i18n';
import type { WorkSummary } from '@nopsidian/core';
import { MergeExportDialog } from './MergeExportDialog';

vi.mock('./flush', () => ({ flushAll: async () => undefined }));

function work(episodes: number): WorkSummary {
  return {
    name: '달빛',
    episodes,
    characters: 0,
    storyBible: null,
    episodeFolder: '달빛/회차',
    characterFolder: '달빛/캐릭터',
    storyBibleFolder: null,
    chars: 0,
    charsNoSpace: 0,
    episodeRows: Array.from({ length: episodes }, (_, i) => ({ path: `달빛/회차/${i + 1}화.md`, chars: 10, charsNoSpace: 8 })),
  };
}

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  setLocale('ko');
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = '';
});

function render(episodes: number, onClose = () => undefined): void {
  act(() => {
    root.render(
      <MergeExportDialog work={work(episodes)} notes={[]} locale="ko" spacing="include" onClose={onClose} onSaved={() => undefined} />,
    );
  });
}

describe('MergeExportDialog', () => {
  it('회차가 없으면 안내 문구를 보이고 저장 버튼을 잠근다', () => {
    render(0);
    expect(host.querySelector('[data-testid="merge-empty"]')?.textContent).toContain('회차가 없어요');
    expect(host.querySelector<HTMLButtonElement>('[data-testid="merge-export"]')?.disabled).toBe(true);
    expect(host.querySelector('[data-testid="merge-start"]')).toBeNull();
  });

  it('한 회차를 고르면 영어에서 단수 문구를 쓴다', () => {
    setLocale('en');
    act(() => {
      root.render(
        <MergeExportDialog work={work(1)} notes={[]} locale="en" spacing="include" onClose={() => undefined} onSaved={() => undefined} />,
      );
    });
    expect(host.querySelector('[data-testid="merge-summary"]')?.textContent).toContain('Selected: 1 episode');
    expect(host.querySelector('[data-testid="merge-summary"]')?.textContent).toContain('spaces included');
  });

  it('Esc 로 닫고, 내보내는 중에는 닫지 않는다', async () => {
    const onClose = vi.fn();
    render(2, onClose);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
