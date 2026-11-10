import { expect, type Page } from '@playwright/test';
import { renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ready = new WeakSet<Page>();

/**
 * 볼트의 외부 파일 감시가 실제로 동작하는지 확인한다(앱 시작 직후 인덱스 준비 완료 신호가
 * 감시 구독보다 먼저 올 수 있어, 테스트가 쓴 외부 파일이 5초 안에 반영되지 않는 간헐 실패가 있었다).
 * sentinel 노트를 쓰고 note.list 에 나타날 때까지, 지운 뒤 사라질 때까지 조건 대기한다.
 * 고정 sleep 을 쓰지 않으며, 같은 page 에서는 한 번만 확인한다.
 */
export async function waitForWatcher(page: Page, timeoutMs = 20_000): Promise<void> {
  if (ready.has(page)) return;
  const vault = await page.evaluate(() => window.nops.vault.current());
  if (!vault) throw new Error('waitForWatcher: 볼트가 열려 있지 않아요');
  const rel = `__nops-e2e-watch-${process.pid}-${Date.now()}.md`;
  const file = path.join(vault.path, rel);
  writeFileSync(file, '# watcher ready\n');
  try {
    await expect
      .poll(async () => page.evaluate(async (p) => (await window.nops.note.list()).some((n) => n.path === p), rel), { timeout: timeoutMs })
      .toBe(true);
    rmSync(file, { force: true });
    await expect
      .poll(async () => page.evaluate(async (p) => (await window.nops.note.list()).some((n) => n.path === p), rel), { timeout: timeoutMs })
      .toBe(false);
    // 두 확인(등장·삭제 반영)이 모두 성공한 뒤에만 준비 완료로 기록한다.
    ready.add(page);
  } finally {
    rmSync(file, { force: true });
  }
}

let seq = 0;
/**
 * 외부 편집기처럼 노트를 원자적으로 쓴다(임시 파일 → rename).
 * writeFileSync 는 truncate~write 사이를 감시자가 읽어 빈 문서로 반영할 수 있고,
 * `.nops-tmp-` 는 감시 제외라 rename 이 만든 최종 이벤트만 처리된다.
 */
export function writeExternalNote(file: string, content: string | Buffer): void {
  const tmp = path.join(path.dirname(file), `.nops-tmp-e2e-${process.pid}-${++seq}`);
  writeFileSync(tmp, content);
  renameSync(tmp, file);
}
