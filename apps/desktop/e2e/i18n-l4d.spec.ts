import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// L4d 영어 스모크: 동기화 대화상자·CSV 가져오기 화면 문구가 영어이고, 언어를 바꾸면 즉시 다시 그린다.
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
let vaultDir = '';

test.beforeAll(async () => {
  test.setTimeout(240_000);
  base = mkdtempSync(path.join(tmpdir(), 'nops-l4d-'));
  vaultDir = path.join(base, 'Demo');
  mkdirSync(vaultDir, { recursive: true });
  writeFileSync(path.join(vaultDir, 'Hello.md'), '# Hello\n');
  app = await electron.launch({
    executablePath: packagedExecutable(),
    env: { ...process.env, NOPS_E2E: '1' },
    args: [
      '--use-mock-keychain',
      `--user-data-dir=${path.join(base, 'userdata')}`,
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

test('English smoke: sync dialog is English, switching language redraws it', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);

  await page.getByTestId('settings-btn').click();
  await page.getByRole('radiogroup', { name: /Language|언어/ }).getByRole('radio', { name: 'English' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.keyboard.press('Escape');

  // 동기화 대화상자는 명령 팔레트에서 연다(연결 전이라 상태 바가 없을 수 있다)
  await page.keyboard.press('ControlOrMeta+p');
  const palette = page.getByTestId('command-palette');
  await expect(palette).toBeVisible();
  await page.keyboard.type('sync');
  await palette.locator('[role="option"]').first().click();
  const dialog = page.locator('.syncdialog');
  await expect(dialog).toBeVisible();
  const en = await dialog.innerText();
  expect(en).not.toMatch(HANGUL);
  expect(en).toMatch(/[A-Za-z]/);

  // 언어를 바꾼 뒤 다시 열면 한국어로 그린다(혼합 언어 0)
  await page.keyboard.press('Escape');
  await page.getByTestId('settings-btn').click();
  await page.getByRole('radiogroup', { name: /Language|언어/ }).getByRole('radio', { name: '한국어' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+p');
  await page.keyboard.type('동기화');
  await page.getByTestId('command-palette').locator('[role="option"]').first().click();
  await expect(dialog).toBeVisible();
  expect(await dialog.innerText()).toMatch(HANGUL);
  await page.keyboard.press('Escape');
});
