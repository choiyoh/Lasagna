import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { waitForWatcher } from '../../e2e/watcher';

/** 볼트/목록만 흉내 내는 page. note.list 는 항상 비어 있어 첫 확인이 타임아웃한다. */
function fakePage(dir: string, calls: { list: number }) {
  const page = {
    evaluate: async (fn: () => unknown) => {
      const src = String(fn);
      if (src.includes('vault.current')) return { id: 'v', name: 'v', path: dir };
      calls.list += 1;
      return [];
    },
  };
  return page as unknown as Page;
}

describe('waitForWatcher 준비 표시', () => {
  it('타임아웃하면 준비 완료로 기록하지 않아 다음 호출이 다시 기다린다', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'nops-watch-test-'));
    try {
      const calls = { list: 0 };
      const page = fakePage(dir, calls);
      await expect(waitForWatcher(page, 60)).rejects.toBeTruthy();
      const first = calls.list;
      expect(first).toBeGreaterThan(0);
      // 준비 완료로 남았다면 두 번째 호출은 즉시 끝나고 list 를 부르지 않는다.
      await expect(waitForWatcher(page, 60)).rejects.toBeTruthy();
      expect(calls.list).toBeGreaterThan(first);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
