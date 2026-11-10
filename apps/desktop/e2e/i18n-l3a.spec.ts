import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { waitForWatcher } from './watcher';

// L3a: 영어에서 새로 만드는 기본값은 영어 이름으로 저장되고(한번 저장되면 그대로),
//       댓글 작성자 저장값 '나' 는 화면에서만 Me 로 보인다.
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
  base = mkdtempSync(path.join(tmpdir(), 'nops-l3a-'));
  userData = path.join(base, 'userdata');
  vaultDir = path.join(base, 'vault');
  mkdirSync(vaultDir, { recursive: true });
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
  await waitForWatcher(page);
}

const day = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

test('English defaults are created in English and comments still store 나', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);

  // 영어로 전환한 뒤에 만든다
  await page.getByTestId('settings-btn').click();
  await page.getByRole('radiogroup', { name: '언어' }).getByRole('radio', { name: 'English' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.keyboard.press('Escape');

  // 1) 새 노트: Untitled.md
  await page.locator('aside.sidebar').getByRole('button', { name: /New note/ }).click();
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await expect.poll(() => existsSync(path.join(vaultDir, 'Untitled.md')), { timeout: 10_000 }).toBe(true);
  expect(existsSync(path.join(vaultDir, '제목 없음.md'))).toBe(false);
  await expect(page.locator('.ProseMirror')).toBeVisible();

  // 2) 데일리 노트: Journal/<날짜>.md (예전 한국어 폴더가 없으므로 영어 기본 폴더)
  await page.locator('aside.sidebar').getByRole('button', { name: /Today/ }).click();
  await expect.poll(() => existsSync(path.join(vaultDir, 'Journal', `${day()}.md`)), { timeout: 10_000 }).toBe(true);
  expect(existsSync(path.join(vaultDir, '일기'))).toBe(false);

  // 3) 새 데이터베이스: 기본 속성·보기 이름이 영어
  await page.getByRole('tab', { name: 'DB' }).click();
  await page.getByRole('button', { name: /New database/ }).click();
  await page.getByLabel('Database name').fill('Tasks');
  await page.getByLabel('Database name').press('Enter');
  await expect(page.getByTestId('db-screen')).toBeVisible();
  const yamlPath = path.join(vaultDir, 'Tasks', '_db.yaml');
  await expect.poll(() => existsSync(yamlPath), { timeout: 10_000 }).toBe(true);
  const yaml = readFileSync(yamlPath, 'utf8');
  expect(yaml).toContain('title: Tasks');
  expect(yaml).toContain('name: Table');
  expect(yaml).not.toMatch(/표|보기/);
  // 화면의 보기 탭도 영어
  const screen = page.getByTestId('db-screen');
  await expect(screen.getByRole('tab', { name: 'Table' })).toBeVisible();

  // 4) 댓글: 저장은 '나', 표시는 Me, 언어를 되돌리면 나
  await screen.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('tab', { name: 'Files' }).click();
  await page.locator('aside.sidebar').getByRole('button', { name: 'Untitled', exact: true }).click();
  const commentsTab = page.getByRole('tab', { name: /Comments/ });
  if (!(await commentsTab.isVisible())) await page.getByTitle('Open or close the links panel').click();
  await commentsTab.click();
  await page.locator('.comments textarea').fill('Looks good');
  await page.locator('.comments__bar').getByRole('button', { name: 'Comment' }).click();
  const comment = page.getByTestId('comment').first();
  await expect(comment).toContainText('Me');
  await expect(comment).not.toContainText('나 ');
  const commentsDir = path.join(vaultDir, '.nopsidian', 'comments');
  const file = readdirSync(commentsDir).map((f) => path.join(commentsDir, f))[0]!;
  expect(readFileSync(file, 'utf8')).toContain('"author": "나"');

  // 언어를 바꾸면 표시만 따라간다(저장값 불변)
  await page.getByTestId('settings-btn').click();
  await page.getByRole('radiogroup', { name: 'Language' }).getByRole('radio', { name: '한국어' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('comment').first()).toContainText('나');
  expect(readFileSync(file, 'utf8')).toContain('"author": "나"');

  // 영어로 되돌려도 새로 만든 이름은 그대로(한번 저장된 기본값은 바뀌지 않는다)
  await page.getByTestId('settings-btn').click();
  await page.getByRole('radiogroup', { name: '언어' }).getByRole('radio', { name: 'English' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('comment').first()).toContainText('Me');
  expect(existsSync(path.join(vaultDir, 'Untitled.md'))).toBe(true);
  expect(existsSync(path.join(vaultDir, 'Journal', `${day()}.md`))).toBe(true);
});
