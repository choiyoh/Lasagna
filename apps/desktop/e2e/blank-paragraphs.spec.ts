import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { waitForWatcher, writeExternalNote } from './watcher';

// FIX-1: Enter 두 번으로 띄운 빈 문단이 저장·재열기·제목 변경(파일명 변경) 후에도 남는다.
function packagedExecutable(): string {
  const override = process.env.NOPS_E2E_EXECUTABLE;
  if (override) return override;
  const dir = path.join(__dirname, `../out/Lasagna-${process.platform}-${process.arch}`);
  if (process.platform === 'darwin') return path.join(dir, 'Lasagna.app/Contents/MacOS/Lasagna');
  return path.join(dir, process.platform === 'win32' ? 'lasagna.exe' : 'lasagna');
}

let app: ElectronApplication;
let base = '';
let vaultDir = '';

async function launch(): Promise<ElectronApplication> {
  test.setTimeout(240_000);
  const launched = await electron.launch({
    executablePath: packagedExecutable(),
    env: { ...process.env, NOPS_E2E: '1' },
    args: ['--use-mock-keychain', `--user-data-dir=${path.join(base, 'userdata')}`, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
  });
  await launched.firstWindow({ timeout: 90_000 });
  await launched.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dir] })) as typeof dialog.showOpenDialog;
  }, vaultDir);
  return launched;
}

async function openVaultIfNeeded(page: Page): Promise<void> {
  const cta = page.locator('.start__cta');
  await expect(cta.or(page.locator('aside.sidebar'))).toBeVisible({ timeout: 60_000 });
  if (await cta.isVisible()) {
    await cta.click();
    await expect(page.locator('aside.sidebar')).toBeVisible({ timeout: 60_000 });
  }
  await waitForWatcher(page);
}

async function openNote(page: Page, title: string): Promise<void> {
  await page.locator('aside.sidebar').getByRole('button', { name: title, exact: true }).first().click();
  await expect(page.locator('.ProseMirror h1')).toHaveText(title);
}

/** 본문의 빈 문단(텍스트 없는 p) 개수 */
async function emptyParagraphs(page: Page): Promise<number> {
  return page.locator('.ProseMirror:visible > p').evaluateAll((ps) => ps.filter((p) => (p.textContent ?? '') === '').length);
}

test.beforeAll(async () => {
  base = mkdtempSync(path.join(tmpdir(), 'nops-blank-'));
  vaultDir = path.join(base, 'Demo');
  mkdirSync(vaultDir, { recursive: true });
  writeExternalNote(path.join(vaultDir, '문단.md'), '# 문단\n\n첫 문단\n');
  writeExternalNote(path.join(vaultDir, '다른.md'), '# 다른\n\n본문\n');
  writeExternalNote(path.join(vaultDir, '기존.md'), '# 기존\n\n가\n\n\n나\n');
  app = await launch();
});

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  if (base) rmSync(base, { recursive: true, force: true });
});

test('Enter 두 번으로 띄운 문단이 저장되고, 다시 열어도 남는다(서식 포함)', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  const file = path.join(vaultDir, '문단.md');
  await openNote(page, '문단');

  // 첫 문단 끝에서 Enter 두 번 → 빈 문단 하나 → 둘째 문단
  const firstP = page.locator('.ProseMirror > p', { hasText: '첫 문단' });
  const box = (await firstP.boundingBox())!;
  await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2);
  await page.waitForTimeout(200);
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('**second paragraph**');
  await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 15_000 }).toContain('첫 문단\n\n\n**second paragraph**');

  expect(await emptyParagraphs(page)).toBe(1);

  // 다른 노트로 갔다가 다시 열어도 빈 문단·굵게 유지
  await openNote(page, '다른');
  await openNote(page, '문단');
  expect(await emptyParagraphs(page)).toBe(1);
  await expect(page.locator('.ProseMirror:visible strong', { hasText: 'second paragraph' })).toHaveText('second paragraph');
  expect(readFileSync(file, 'utf8')).toContain('첫 문단\n\n\n**second paragraph**');
});

test('제목에 이모지를 넣어 파일명이 바뀌어도 빈 문단·굵게가 유지된다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  const before = path.join(vaultDir, '문단.md');
  const content = readFileSync(before, 'utf8');
  expect(content).toContain('\n\n\n');

  await openNote(page, '문단');
  await page.locator('.ProseMirror h1').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' 😀');
  // 노트를 떠날 때 제목이 파일 이름으로 반영된다(다른 노트 클릭)
  await openNote(page, '다른');
  await expect.poll(() => readdirSync(vaultDir).some((n) => n === '문단 😀.md'), { timeout: 15_000 }).toBe(true);
  const renamed = path.join(vaultDir, '문단 😀.md');
  expect(readFileSync(renamed, 'utf8')).toContain('첫 문단\n\n\n**second paragraph**');

  // 새 경로로 다시 읽어도(재마운트) 빈 문단·굵게가 그대로
  await openNote(page, '문단 😀');
  expect(await emptyParagraphs(page)).toBe(1);
  await expect(page.locator('.ProseMirror:visible strong', { hasText: 'second paragraph' })).toHaveText('second paragraph');
  expect(readFileSync(renamed, 'utf8')).toContain('첫 문단\n\n\n**second paragraph**');

  // 앱을 다시 열어도 유지
  await app.close();
  app = await launch();
  const again = await app.firstWindow();
  await openVaultIfNeeded(again);
  await openNote(again, '문단 😀');
  expect(await emptyParagraphs(again)).toBe(1);
});

test('기존 노트를 열기만 하고 떠나도 파일 바이트가 그대로다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  const file = path.join(vaultDir, '기존.md');
  const before = readFileSync(file, 'utf8');
  expect(before).toContain('가\n\n\n나');
  await openNote(page, '기존');
  expect(await emptyParagraphs(page)).toBe(1);
  await page.waitForTimeout(1500);
  await openNote(page, '다른');
  await page.waitForTimeout(500);
  expect(readFileSync(file, 'utf8')).toBe(before);
  expect(existsSync(file)).toBe(true);
});
