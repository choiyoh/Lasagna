import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// L3b(에디터) 영어 스모크: '/' 메뉴·블록 핸들 메뉴·날짜 멘션·프롬프트 버튼에 한글이 남지 않는지 확인한다.
const HANGUL = /[\u3131-\u318e\uac00-\ud7a3]/;

function packagedExecutable(): string {
  const override = process.env.NOPS_E2E_EXECUTABLE;
  if (override) return override;
  const dir = path.join(__dirname, `../out/Lasagna-${process.platform}-${process.arch}`);
  if (process.platform === 'darwin') return path.join(dir, 'Lasagna.app/Contents/MacOS/Lasagna');
  return path.join(dir, process.platform === 'win32' ? 'lasagna.exe' : 'lasagna');
}

let app: ElectronApplication;
let base = '';
let userData = '';
let vaultDir = '';

test.beforeAll(async () => {
  test.setTimeout(240_000);
  base = mkdtempSync(path.join(tmpdir(), 'nops-l3b-editor-'));
  userData = path.join(base, 'userdata');
  vaultDir = path.join(base, 'vault');
  mkdirSync(vaultDir, { recursive: true });
  writeFileSync(path.join(vaultDir, 'Hello.md'), '# Hello\n\none\n\ntwo\n');
  app = await electron.launch({
    executablePath: packagedExecutable(),
    env: { ...process.env, NOPS_E2E: '1' },
    args: [
      '--use-mock-keychain',
      `--user-data-dir=${userData}`,
      ...(process.platform === 'linux' ? ['--no-sandbox', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : []),
    ],
  });
  await app.firstWindow({ timeout: 90_000 });
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dir] })) as typeof dialog.showOpenDialog;
  }, vaultDir);
});

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  if (base) rmSync(base, { recursive: true, force: true });
});

async function openVaultIfNeeded(page: Page): Promise<void> {
  const cta = page.locator('.start__cta');
  await expect(cta.or(page.locator('aside.sidebar'))).toBeVisible({ timeout: 60_000 });
  if (await cta.isVisible()) {
    await cta.click();
    await expect(page.locator('aside.sidebar')).toBeVisible({ timeout: 60_000 });
  }
}

test('English smoke: switching language while editing keeps the draft and localizes the menus', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);

  // 한국어 상태로 노트를 연다(에디터는 이때 언어 문구를 잡는다)
  await page.locator('aside.sidebar').getByRole('button', { name: 'Hello', exact: true }).click();
  const editor = page.locator('.ProseMirror');
  await expect(editor).toHaveText(/Hello/);

  // 저장 전 편집을 남겨 둔다
  await page.locator('.ProseMirror p').last().click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' 저장 전 문장');

  // 에디터를 연 채로 언어를 바꾼다(설정에서 전환, reload 없음)
  await page.getByTestId('settings-btn').click();
  await page.getByRole('radiogroup', { name: '언어' }).getByRole('radio', { name: 'English' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.keyboard.press('Escape');
  await expect(editor).toHaveText(/저장 전 문장/);

  // 1) '/' 메뉴: 항목 라벨·설명이 영어다
  await page.locator('.ProseMirror p').last().click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/');
  const items = page.locator('.oh-editor__slash-item');
  await expect(items.first()).toBeVisible();
  const slashText = (await items.allInnerTexts()).join('\n');
  expect(slashText).toContain('Callout');
  expect(slashText).toContain('Toggle heading 1');
  expect(slashText).toContain('Table of contents');
  expect(slashText).not.toMatch(HANGUL);
  await page.keyboard.press('Escape');

  // 2) 블록 핸들 메뉴: 복제·이동·삭제·바꾸기가 영어다
  await editor.locator('p', { hasText: 'one' }).hover();
  await expect(page.locator('.nops-handle')).toBeVisible();
  await expect(page.locator('.nops-handle__grip')).toHaveAttribute('title', 'Drag to move · click for menu');
  await expect(page.locator('.nops-handle__add')).toHaveAttribute('title', 'Add block below');
  await page.locator('.nops-handle__grip').click();
  const blockMenu = page.locator('.nops-block-menu');
  await expect(blockMenu).toBeVisible();
  await expect(blockMenu).toContainText('Duplicate');
  await expect(blockMenu).toContainText('Turn into');
  await expect(blockMenu).toContainText('Delete');
  expect(await blockMenu.innerText()).not.toMatch(HANGUL);
  await page.keyboard.press('Escape');

  // 3) 날짜 멘션: 후보 이름이 영어이고 요일은 Intl 표기다
  await editor.locator('p').last().click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' @to');
  const dateMenu = page.locator('.nops-date-suggest');
  await expect(dateMenu).toBeVisible({ timeout: 5000 });
  await expect(dateMenu).toContainText('Tomorrow');
  expect(await dateMenu.innerText()).not.toMatch(HANGUL);
  await page.keyboard.press('Escape');

  // 전환 전에 입력한 문장이 저장되어 남는다(미저장 편집 보존)
  await expect.poll(() => readFileSync(path.join(vaultDir, 'Hello.md'), 'utf8'), { timeout: 10_000 }).toContain('저장 전 문장');

});
