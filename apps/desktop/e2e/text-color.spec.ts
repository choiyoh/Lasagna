import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { waitForWatcher, writeExternalNote } from './watcher';

// FEAT: 글씨색 — 선택 → 팔레트 → `<span style="color:#RRGGBB">` 저장/복원, 기본 색 복귀, 다크 표시.
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

const editor = (page: Page) => page.locator('.ProseMirror:visible');

/** 본문에서 낱말을 선택(브라우저 선택 영역)하고 팔레트에서 색을 고른다. */
async function selectWord(page: Page, word: string): Promise<void> {
  await page.evaluate((w) => {
    const pm = [...document.querySelectorAll('.ProseMirror')].find((el) => el.getClientRects().length > 0);
    if (!pm) throw new Error('editor not visible');
    (pm as HTMLElement).focus();
    const walker = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = (node.textContent ?? '').indexOf(w);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + w.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    throw new Error(`word not found: ${w}`);
  }, word);
  await expect(page.getByTestId('text-color')).toBeEnabled();
}

async function paint(page: Page, word: string, swatch: string): Promise<void> {
  await selectWord(page, word);
  await page.getByTestId('text-color').click();
  await expect(page.getByTestId('color-palette')).toBeVisible();
  await page.getByTestId(`text-color-${swatch}`).click();
  await expect(page.getByTestId('color-palette')).toHaveCount(0);
}

test.beforeAll(async () => {
  base = mkdtempSync(path.join(tmpdir(), 'nops-color-'));
  vaultDir = path.join(base, 'Demo');
  mkdirSync(vaultDir, { recursive: true });
  writeExternalNote(path.join(vaultDir, '색.md'), '# 색\n\n빨강\n\n파랑\n');
  writeExternalNote(path.join(vaultDir, '다른.md'), '# 다른\n\n본문\n');
  app = await launch();
});

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  if (base) rmSync(base, { recursive: true, force: true });
});

test('선택한 글자에 색을 주면 span 으로 저장되고, 다시 열어도 유지된다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await page.locator('aside.sidebar').getByRole('button', { name: '색', exact: true }).click();
  await expect(editor(page).locator('h1')).toHaveText('색');
  await page.waitForTimeout(300);
  const file = path.join(vaultDir, '색.md');

  // 선택이 없으면 버튼이 꺼져 있다
  await expect(page.getByTestId('text-color')).toBeDisabled();

  await paint(page, '빨강', 'red');
  await paint(page, '파랑', 'blue');
  await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 15_000 }).toContain('<span style="color:#2f6f9f">파랑</span>');
  expect(readFileSync(file, 'utf8')).toContain('<span style="color:#c0392b">빨강</span>');

  // 다른 노트를 갔다 와도(디스크 다시 읽기) 색이 유지된다
  await page.locator('aside.sidebar').getByRole('button', { name: '다른', exact: true }).click();
  await page.locator('aside.sidebar').getByRole('button', { name: '색', exact: true }).click();
  await expect(editor(page).locator('h1')).toHaveText('색');
  await page.waitForTimeout(300);
  await expect(editor(page).locator('.nops-color')).toHaveCount(2);
  await expect(editor(page).getByText('빨강', { exact: true })).toBeVisible();
});

test('다크에서도 읽히고(표시만 밝게), 기본 색으로 되돌리면 마크가 빠진다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await page.locator('aside.sidebar').getByRole('button', { name: '색', exact: true }).click();
  await expect(editor(page).locator('h1')).toHaveText('색');
  await page.waitForTimeout(300);
  await expect(editor(page).locator('.nops-color')).toHaveCount(2);
  const file = path.join(vaultDir, '색.md');

  // 다크: 파일 값은 그대로, 화면 표시만 밝게(필터)
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  const red = editor(page).locator('.nops-color').first();
  await expect(red).toHaveCSS('color', 'rgb(192, 57, 43)');
  await expect(red).toHaveCSS('filter', 'brightness(1.45)');
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'system'));

  // 기본 색으로: 선택 → 기본 색으로
  await selectWord(page, '빨강');
  await page.getByTestId('text-color').click();
  await page.getByTestId('text-color-default').click();
  await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 15_000 }).not.toContain('<span style="color:#c0392b">빨강</span>');
  expect(readFileSync(file, 'utf8')).toContain('빨강');
  expect(readFileSync(file, 'utf8')).toContain('<span style="color:#2f6f9f">파랑</span>');
  await expect(editor(page).locator('.nops-color')).toHaveCount(1);
});

test('마우스로 열어도 Tab 이 팔레트 안에서만 돌고, 닫으면 선택이 유지된다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await page.locator('aside.sidebar').getByRole('button', { name: '색', exact: true }).click();
  await expect(editor(page).locator('h1')).toHaveText('색');
  await page.waitForTimeout(300);
  const file = path.join(vaultDir, '색.md');

  await selectWord(page, '파랑');
  await page.getByTestId('text-color').click();
  await expect(page.getByTestId('text-color-gray')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('text-color-red')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('text-color-orange')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByTestId('text-color-red')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('color-palette')).toHaveCount(0);
  await expect(page.getByTestId('text-color')).toBeFocused();
  await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 15_000 }).toContain('<span style="color:#c0392b">파랑</span>');
  // 닫힌 뒤에도 선택이 남아 있어 바로 다시 색을 줄 수 있다
  await expect(page.getByTestId('text-color')).toBeEnabled();

  await page.getByTestId('text-color').click();
  await expect(page.getByTestId('color-palette')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('color-palette')).toHaveCount(0);
  await expect(page.getByTestId('text-color')).toBeFocused();
  await expect(page.getByTestId('text-color')).toBeEnabled();
});
