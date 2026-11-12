import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { waitForWatcher, writeExternalNote } from './watcher';

// 빈 제목 노트: 제목 자리 표시('제목 없음')만 보이고, 업스트림 본문 안내문('/'를 눌러…)은 제목 줄에 겹치지 않게 숨긴다.
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

/** 빈 제목 상태: 제목 자리 표시는 보이고, 본문 안내문은 보이지 않는다(겹침 없음). */
async function expectEmptyTitleOnly(page: Page, untitled: string): Promise<void> {
  const h1 = page.locator('.ProseMirror h1.nops-empty-title');
  await expect(h1).toBeVisible({ timeout: 15_000 });
  await expect(h1).toHaveAttribute('data-placeholder', untitled);
  expect(
    await h1.evaluate((el) => {
      const before = getComputedStyle(el, '::before');
      return { content: before.content, display: before.display };
    }),
  ).toEqual({ content: `"${untitled}"`, display: 'block' });
  // 본문 안내문은 CSS 로 숨겨져 화면에 그려지지 않는다(제목 줄과 겹치지 않음).
  const bodyHints = page.locator('.ProseMirror .oh-editor__placeholder');
  await expect(bodyHints).toBeHidden();
  // 숨김 상태라 h1 박스와 교차하는 본문 안내가 없다.
  const overlap = await page.evaluate(() => {
    const pm = document.querySelector('.ProseMirror')!;
    const h1 = pm.querySelector('h1')?.getBoundingClientRect();
    return [...pm.querySelectorAll('.oh-editor__placeholder')].some((el) => {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden') return false;
      const b = el.getBoundingClientRect();
      return h1 ? Math.min(h1.bottom, b.bottom) - Math.max(h1.top, b.top) > 0 : false;
    });
  });
  expect(overlap).toBe(false);
}

test.beforeAll(async () => {
  base = mkdtempSync(path.join(tmpdir(), 'nops-emptytitle-'));
  vaultDir = path.join(base, 'Demo');
  mkdirSync(vaultDir, { recursive: true });
  writeExternalNote(path.join(vaultDir, '메모.md'), '# 메모\n\n본문\n');
  app = await launch();
});

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  if (base) rmSync(base, { recursive: true, force: true });
});

test('새 노트 3경로(＋·⌘N·⌘O 만들기)에서 제목 안내만 보이고 본문 안내는 숨는다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);

  await page.getByTestId('sidebar-new-note').click();
  await expectEmptyTitleOnly(page, '제목 없음');

  await page.keyboard.press('ControlOrMeta+n');
  await expectEmptyTitleOnly(page, '제목 없음');

  // ⌘O 의 만들기 행은 입력한 이름이 제목이 된다 — 빈 제목이 아니므로 겹칠 안내도 없다.
  await page.keyboard.press('ControlOrMeta+o');
  const input = page.getByPlaceholder(/노트 제목·본문 검색/);
  await input.fill('빈제목진단');
  await expect(page.locator('.switcher__item.is-active')).toContainText('새 노트 만들기');
  await page.keyboard.press('Enter');
  await expect(page.locator('.ProseMirror h1')).toHaveText('빈제목진단');
  await expect(page.locator('.ProseMirror .oh-editor__placeholder')).toHaveCount(0);
});

test('제목을 넣으면 규칙이 풀리고, 제목을 지우면 다시 숨긴다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await page.getByTestId('sidebar-new-note').click();
  const h1 = page.locator('.ProseMirror h1');
  await expect(h1).toHaveClass(/nops-empty-title/);

  await h1.click();
  await page.keyboard.type('A');
  await expect(h1).toHaveText('A');
  await expect(h1).not.toHaveClass(/nops-empty-title/);
  // 제목이 있으면 이 숨김 규칙은 적용되지 않는다(다른 상태 불변).
  await expect(page.locator('.ProseMirror .oh-editor__placeholder')).toHaveCount(0);

  // 제목을 지우면 다시 빈 제목 상태 → 본문 안내는 숨고 제목 안내가 돌아온다.
  await page.keyboard.press('Backspace');
  await expectEmptyTitleOnly(page, '제목 없음');

  // 제목을 넣고 Enter 로 본문 첫 줄로 가도(업스트림은 제목+문단에서 안내문을 그리지 않는다) 겹침은 없다.
  await page.keyboard.type('제목');
  await page.keyboard.press('Enter');
  await expect(page.locator('.ProseMirror p')).toHaveCount(1);
  await expect(page.locator('.ProseMirror h1')).toHaveText('제목');
  await expect(page.locator('.ProseMirror .oh-editor__placeholder')).toHaveCount(0);
  const overlap = await page.evaluate(() => {
    const h1 = document.querySelector('.ProseMirror h1')?.getBoundingClientRect();
    return [...document.querySelectorAll('.ProseMirror .oh-editor__placeholder')].some((el) => {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden') return false;
      const b = el.getBoundingClientRect();
      return h1 ? Math.min(h1.bottom, b.bottom) - Math.max(h1.top, b.top) > 0 : false;
    });
  });
  expect(overlap).toBe(false);
});

test('영어·다크에서도 같은 규칙이다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await page.evaluate(() => window.nops.settings.setLanguage({ language: 'en', writerMode: false, writerSpacing: 'include' }));
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.keyboard.press('ControlOrMeta+n');
  await expectEmptyTitleOnly(page, 'Untitled');
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'system'));
  await page.evaluate(() => window.nops.settings.setLanguage({ language: 'ko', writerMode: false, writerSpacing: 'include' }));
});
