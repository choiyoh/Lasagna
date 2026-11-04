import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// 패키징한 앱을 실행해 언어 설정이 화면·<html lang>·재시작 후에도 유지되는지 확인한다.
function packagedExecutable(): string {
  const override = process.env.NOPS_E2E_EXECUTABLE;
  if (override) return override;
  const dir = path.join(__dirname, `../out/Lasagna-${process.platform}-${process.arch}`);
  if (process.platform === 'darwin') return path.join(dir, 'Lasagna.app/Contents/MacOS/Lasagna');
  return path.join(dir, process.platform === 'win32' ? 'lasagna.exe' : 'lasagna');
}

const executable = packagedExecutable();
let app: ElectronApplication;
let base = '';
let userData = '';
let vaultDir = '';

async function launch(): Promise<ElectronApplication> {
  test.setTimeout(240_000);
  const candidate = await electron.launch({
    executablePath: executable,
    env: { ...process.env, NOPS_E2E: '1' },
    args: [
      '--use-mock-keychain',
      `--user-data-dir=${userData}`,
      ...(process.platform === 'linux' ? ['--no-sandbox', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : []),
    ],
  });
  await candidate.firstWindow({ timeout: 90_000 });
  // 폴더 선택 대화상자는 자동화할 수 없으므로 main에서 대체한다.
  await candidate.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dir] })) as typeof dialog.showOpenDialog;
  }, vaultDir);
  return candidate;
}

/**
 * 앱을 닫고 프로세스가 완전히 끝날 때까지 기다린다. 같은 userData 로 곧바로 다시 띄우면 이전 프로세스가
 * 쥐고 있던 단일 인스턴스 락·userData 잠금 때문에 새 창이 뜨지 않을 수 있다(전체 실행에서 드물게 재현).
 */
async function closeApp(): Promise<void> {
  const current = app;
  if (!current) return;
  const child = current.process();
  const exited = new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.once('exit', () => resolve());
  });
  await current.close();
  await Promise.race([
    exited,
    new Promise<void>((_, reject) => setTimeout(() => reject(new Error('이전 앱 프로세스가 30초 안에 끝나지 않았어요')), 30_000)),
  ]);
}

/** 시작 화면이면 볼트를 연다(언어에 따라 문구가 달라서 클래스로 찾는다). */
async function openVaultIfNeeded(page: Page): Promise<void> {
  const cta = page.locator('.start__cta');
  await expect(cta.or(page.locator('aside.sidebar'))).toBeVisible({ timeout: 60_000 });
  if (await cta.isVisible()) {
    await cta.click();
    await expect(page.locator('aside.sidebar')).toBeVisible({ timeout: 60_000 });
  }
}

async function openSettings(page: Page): Promise<void> {
  await page.getByTestId('settings-btn').click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

test.beforeAll(async () => {
  base = mkdtempSync(path.join(tmpdir(), 'nops-lang-'));
  userData = path.join(base, 'userdata');
  vaultDir = path.join(base, 'vault');
  mkdirSync(vaultDir, { recursive: true });
  writeFileSync(path.join(vaultDir, 'Hello.md'), '# Hello\n');
  app = await launch();
});

test.afterAll(async () => {
  // 실패로 끝나도 다음 실행이 영어로 시작하지 않게 되돌린다(임시 userData 지만 한 번 더 확인).
  try {
    const dir = await app?.evaluate(({ app: electronApp }) => electronApp.getPath('userData'));
    if (dir) writeFileSync(path.join(dir, 'app-settings.json'), '{\n  "version": 1,\n  "language": "system"\n}\n');
  } catch {
    // 앱이 이미 닫혔으면 임시 폴더째 지운다.
  }
  await closeApp().catch(() => undefined);
  if (base) rmSync(base, { recursive: true, force: true });
});

test('switches between Korean and English, keeps <html lang> in sync, and survives a restart', async () => {
  let page = await app.firstWindow();
  await openVaultIfNeeded(page);

  // 기본은 OS 를 따르고, e2e 에서는 ko 로 고정된다.
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
  const sidebar = page.locator('aside.sidebar');
  await expect(sidebar.getByRole('button', { name: /새 노트/ })).toBeVisible();
  await expect(page.getByPlaceholder('본문 검색')).toBeVisible();

  // 설정 → English: 화면과 <html lang> 이 즉시 바뀐다.
  await openSettings(page);
  await page.getByRole('radiogroup', { name: '언어' }).getByRole('radio', { name: 'English' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Settings' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sidebar.getByRole('button', { name: /New note/ })).toBeVisible();
  await expect(page.getByPlaceholder('Search notes')).toBeVisible();

  // 설정은 main 의 userData 파일에 저장된다.
  const storedDir = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'));
  expect(realpathSync(storedDir).startsWith(realpathSync(base))).toBe(true); // --user-data-dir 로 격리돼 실제 프로필을 건드리지 않는다
  const settingsFile = path.join(storedDir, 'app-settings.json');
  expect(JSON.parse(readFileSync(settingsFile, 'utf8'))).toMatchObject({ version: 1, language: 'en' });

  // 앱을 다시 띄워도 영어가 유지된다. 이전 프로세스가 끝난 뒤에 띄워야 락 충돌이 없다.
  await closeApp();
  app = await launch();
  page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('aside.sidebar').getByRole('button', { name: /New note/ })).toBeVisible();

  // 다시 시스템 따르기(e2e 는 ko)로 돌려 둔다.
  await openSettings(page);
  await page.getByRole('radiogroup', { name: 'Language' }).getByRole('radio', { name: 'Follow system' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
  await page.keyboard.press('Escape');
  await expect(page.locator('aside.sidebar').getByRole('button', { name: /새 노트/ })).toBeVisible();
  expect(JSON.parse(readFileSync(settingsFile, 'utf8'))).toMatchObject({ version: 1, language: 'system' });
});
