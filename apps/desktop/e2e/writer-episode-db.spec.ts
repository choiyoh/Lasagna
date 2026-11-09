import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// 작가 모드(W4c): 회차 DB — 칩을 눌러야 _db.yaml 생성, 자동 열(글자수·목표 달성), 한/영.
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
}

async function resetWriter(page: Page, locale: 'ko' | 'en' = 'ko'): Promise<void> {
  await page.evaluate(
    (next) => window.nops.settings.setLanguage({ language: next, writerMode: true, writerSpacing: 'include' }),
    locale,
  );
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
}

async function createWork(page: Page, name: string): Promise<void> {
  await page.getByTestId('settings-btn').click();
  await page.getByTestId('work-create').click();
  await page.getByTestId('work-dialog-name').fill(name);
  await page.getByTestId('work-dialog-create').click();
  await expect(page.getByTestId('work-dialog')).toHaveCount(0);
  await page.keyboard.press('Escape');
}

test.beforeAll(async () => {
  test.setTimeout(240_000);
  base = mkdtempSync(path.join(tmpdir(), 'nops-epdb-'));
  vaultDir = path.join(base, 'Demo');
  mkdirSync(vaultDir, { recursive: true });
  writeFileSync(path.join(vaultDir, '메모.md'), '# 메모\n');
  app = await launch();
});

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  if (base) rmSync(base, { recursive: true, force: true });
});

test('회차 DB 칩을 눌러야 _db.yaml 이 생기고, 자동 열이 계산된다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await resetWriter(page);
  await createWork(page, '달빛');
  const dbFile = path.join(vaultDir, '달빛', '회차', '_db.yaml');
  // 작품 만들기만으로는 만들지 않는다
  expect(() => readFileSync(dbFile, 'utf8')).toThrow();

  await page.getByTestId('work-card').filter({ hasText: '달빛' }).getByTestId('work-chip-db').click();
  await expect.poll(() => readFileSync(dbFile, 'utf8').includes('note_chars'), { timeout: 15_000 }).toBe(true);
  const yaml = readFileSync(dbFile, 'utf8');
  expect(yaml).toContain('goal_met');
  // DB 화면: 열 이름과 자동 배지
  await expect(page.getByTestId('th-글자수')).toContainText('글자수');
  await expect(page.getByTestId('auto-글자수')).toHaveText('자동');
  await expect(page.getByTestId('auto-목표 달성')).toHaveText('자동');

  // 회차 노트를 만들면 행이 생기고 글자수가 계산된다
  await page.getByTestId('work-card').filter({ hasText: '달빛' }).getByTestId('new-episode').click();
  const prompt = page.locator('.nops-prompt input');
  await expect(prompt).toBeVisible();
  await prompt.fill('1화');
  await prompt.press('Enter');
  await expect.poll(() => readFileSync(path.join(vaultDir, '달빛', '회차', '1화.md'), 'utf8').startsWith('# 1화'), { timeout: 15_000 }).toBe(true);
  // DB 화면에 행과 계산된 자동 값이 보인다('1화' = 2자)
  await expect(page.getByTestId('db-table')).toContainText('1화', { timeout: 15_000 });
  await expect(page.getByTestId('db-table')).toContainText('2');
  // 자동 열 값은 파일에 저장되지 않는다
  expect(readFileSync(path.join(vaultDir, '달빛', '회차', '1화.md'), 'utf8')).not.toContain('글자수');
});

test('영어에서는 Episode/Characters/Auto 로 보인다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await resetWriter(page, 'en');
  await page.getByTestId('work-card').filter({ hasText: '달빛' }).getByTestId('work-chip-db').click();
  await expect(page.getByTestId('th-Episode')).toBeVisible();
  await expect(page.getByTestId('th-Characters')).toBeVisible();
  await expect(page.getByTestId('auto-Characters')).toHaveText('Auto');
});
