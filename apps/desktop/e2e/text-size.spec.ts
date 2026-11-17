import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { waitForWatcher, writeExternalNote } from './watcher';

// FEAT: 글자 크기 — 작가 모드 서식 줄에서 선택 글자에 85/120/150% 를 주고 span 으로 저장한다.
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

async function setWriter(page: Page, on: boolean): Promise<void> {
  await page.evaluate((mode) => window.nops.settings.setLanguage({ language: 'ko', writerMode: mode, writerSpacing: 'include' }), on);
}

const editor = (page: Page) => page.locator('.ProseMirror:visible');

async function selectWord(page: Page, word: string): Promise<void> {
  await page.evaluate(async (w) => {
    const pm = [...document.querySelectorAll('.ProseMirror')].find((el) => el.getClientRects().length > 0);
    if (!pm) throw new Error('editor not visible');
    (pm as HTMLElement).focus();
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
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
  await expect(page.getByTestId('text-size')).toBeEnabled();
}

async function resize(page: Page, word: string, step: string): Promise<void> {
  await selectWord(page, word);
  await page.getByTestId('text-size').click();
  await expect(page.getByTestId('size-palette')).toBeVisible();
  await page.getByTestId(`text-size-${step}`).click();
  await expect(page.getByTestId('size-palette')).toHaveCount(0);
}

async function openNote(page: Page, title: string): Promise<void> {
  await page.locator('aside.sidebar').getByRole('button', { name: title, exact: true }).click();
  await expect(editor(page).locator('h1')).toHaveText(title);
  await page.waitForTimeout(300);
}

test.beforeAll(async () => {
  base = mkdtempSync(path.join(tmpdir(), 'nops-size-'));
  vaultDir = path.join(base, 'Demo');
  mkdirSync(vaultDir, { recursive: true });
  writeExternalNote(path.join(vaultDir, '크기.md'), '# 크기\n\n작게글\n\n큰글\n\n아주글\n\n보통글\n');
  writeExternalNote(path.join(vaultDir, '겹침.md'), '# 겹침\n\n색크기\n');
  writeExternalNote(path.join(vaultDir, '입력.md'), '# 입력\n\n낱말\n');
  writeExternalNote(
    path.join(vaultDir, '보존.md'),
    '# 보존\n\n앞 <span style="color:#2f6f9f"><span style="font-size:120%">가</span>나</span> 뒤\n\n<span style="font-size:150%">큰</span>\n',
  );
  app = await launch();
});

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  if (base) rmSync(base, { recursive: true, force: true });
});

test('선택한 글자 크기를 주면 span 으로 저장되고, 다시 열어도 유지된다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await setWriter(page, true);
  await openNote(page, '크기');
  const file = path.join(vaultDir, '크기.md');

  await expect(page.getByTestId('text-size')).toBeDisabled();
  await resize(page, '작게글', 'small');
  await resize(page, '큰글', 'large');
  await resize(page, '아주글', 'xlarge');

  await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 15_000 }).toContain('<span style="font-size:85%">작게글</span>');
  await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 15_000 }).toContain('<span style="font-size:150%">아주글</span>');
  const text = readFileSync(file, 'utf8');
  expect(text).toContain('<span style="font-size:120%">큰글</span>');
  expect(text).toContain('<span style="font-size:150%">아주글</span>');

  await openNote(page, '보존');
  await openNote(page, '크기');
  await expect(editor(page).locator('.nops-size')).toHaveCount(3);
  await expect(editor(page).getByText('큰글', { exact: true })).toHaveAttribute('style', /font-size:\s*120%/);

  // 기본 크기로 되돌리면 마크가 빠진다
  await selectWord(page, '큰글');
  await page.getByTestId('text-size').click();
  await page.getByTestId('text-size-default').click();
  await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 15_000 }).not.toContain('<span style="font-size:120%">큰글</span>');
  expect(readFileSync(file, 'utf8')).toContain('큰글');
  await expect(editor(page).locator('.nops-size')).toHaveCount(2);
});

test('색과 크기를 함께 주면 별도 span 으로 겹쳐 저장되고 다시 열어도 둘 다 남는다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await setWriter(page, true);
  await openNote(page, '겹침');
  const file = path.join(vaultDir, '겹침.md');

  await selectWord(page, '색크기');
  await page.getByTestId('text-color').click();
  await page.getByTestId('text-color-blue').click();
  await resize(page, '색크기', 'large');
  await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 15_000 }).toContain('font-size:120%');
  const text = readFileSync(file, 'utf8');
  expect(text).toContain('color:#2f6f9f');
  expect(text).toContain('font-size:120%');
  expect((text.match(/<span\b/g) ?? []).length).toBe((text.match(/<\/span>/g) ?? []).length);

  await openNote(page, '크기');
  await openNote(page, '겹침');
  await expect(editor(page).locator('.nops-size')).toHaveCount(1);
  await expect(editor(page).locator('.nops-color')).toHaveCount(1);
});

test('적용 직후 타이핑은 본문에 들어가고, Esc 로 닫으면 버튼으로 돌아온다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await setWriter(page, true);
  await openNote(page, '입력');
  const file = path.join(vaultDir, '입력.md');

  await resize(page, '낱말', 'large');
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type('ZZ');
  await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 15_000 }).toContain('ZZ');

  await selectWord(page, 'ZZ');
  await page.getByTestId('text-size').click();
  await expect(page.getByTestId('text-size-small')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('text-size-large')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('size-palette')).toHaveCount(0);
  await expect(page.getByTestId('text-size')).toBeFocused();
});

test('팝업 Esc 직후 같은 틱에 ⌘P 를 눌러도 명령 팔레트가 초점을 갖는다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await setWriter(page, true);
  await openNote(page, '크기');

  await selectWord(page, '보통글');
  await page.getByTestId('text-size').click();
  await expect(page.getByTestId('size-palette')).toBeVisible();
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', metaKey: true, ctrlKey: true, bubbles: true }));
  });
  const palette = page.getByTestId('command-palette');
  await expect(palette).toBeVisible();
  await expect(palette.locator('input')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(palette).toHaveCount(0);
});

test('작가 모드 OFF 에는 버튼이 없지만 크기가 적용된 글은 그대로 보이고, 열기만 하면 바이트가 같다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await setWriter(page, false);
  const file = path.join(vaultDir, '보존.md');
  const before = readFileSync(file);

  await openNote(page, '보존');
  await expect(page.getByTestId('text-size')).toHaveCount(0);
  await expect(page.getByTestId('text-color')).toHaveCount(1);
  await expect(editor(page).locator('.nops-size')).toHaveCount(2);
  await expect(editor(page).getByText('큰', { exact: true })).toHaveAttribute('style', /font-size:\s*150%/);
  await page.waitForTimeout(800);
  expect(readFileSync(file)).toEqual(before);
});
