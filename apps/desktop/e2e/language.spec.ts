import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import {mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { waitForWatcher, writeExternalNote } from './watcher';

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
  await waitForWatcher(page);
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
  writeExternalNote(path.join(vaultDir, 'Hello.md'), '# Hello\n');
  app = await launch();
});

test.afterAll(async () => {
  // 실패로 끝나도 다음 실행이 영어로 시작하지 않게 되돌린다(임시 userData 지만 한 번 더 확인).
  try {
    const dir = await app?.evaluate(({ app: electronApp }) => electronApp.getPath('userData'));
    if (dir) writeExternalNote(path.join(dir, 'app-settings.json'), '{\n  "version": 1,\n  "language": "system"\n}\n');
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

  await openSettings(page);

  // 테마 라디오도 같은 컴포넌트: 화살표·Home/End 로 이동하며 선택하고, 동작(테마 적용)은 그대로다.
  const themeGroup = page.getByRole('radiogroup', { name: '테마' });
  const systemTheme = themeGroup.getByRole('radio', { name: '시스템' });
  await expect(systemTheme).toHaveAttribute('aria-checked', 'true');
  await systemTheme.focus();
  await page.keyboard.press('ArrowRight');
  await expect(themeGroup.getByRole('radio', { name: '라이트' })).toHaveAttribute('aria-checked', 'true');
  await expect(themeGroup.getByRole('radio', { name: '라이트' })).toBeFocused();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.keyboard.press('End');
  await expect(themeGroup.getByRole('radio', { name: '다크' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.keyboard.press('Home');
  await expect(systemTheme).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'system');

  // 설정의 언어 라디오그룹은 표준 키보드 패턴: 선택된 항목만 Tab 으로 닿고 화살표·Home/End 로 이동한다.
  const languageGroup = page.getByRole('radiogroup', { name: '언어' });
  const systemRadio = languageGroup.getByRole('radio', { name: '시스템 따르기' });
  await expect(systemRadio).toHaveAttribute('aria-checked', 'true');
  await expect(systemRadio).toHaveAttribute('tabindex', '0');
  await expect(languageGroup.getByRole('radio', { name: '한국어' })).toHaveAttribute('tabindex', '-1');
  await systemRadio.focus();
  await page.keyboard.press('ArrowRight');
  const koreanRadio = languageGroup.getByRole('radio', { name: '한국어' });
  await expect(koreanRadio).toHaveAttribute('aria-checked', 'true');
  await expect(koreanRadio).toBeFocused();
  // End = 마지막 항목(English)으로 이동·선택 → 화면과 <html lang> 이 즉시 바뀐다.
  await page.keyboard.press('End');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('radio', { name: 'English' })).toHaveAttribute('tabindex', '0');
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Settings' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sidebar.getByRole('button', { name: /New note/ })).toBeVisible();
  await expect(page.getByPlaceholder('Search notes')).toBeVisible();
  // 같은 줄의 탭 라벨도 한 언어로: Files · ★(Bookmarks) · DB · Tags
  await expect(page.getByRole('tab', { name: 'Bookmarks', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Tags', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Files', exact: true })).toBeVisible();

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

test('a failed language save keeps the old language and shows an inline error', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko');

  // 쓰기를 실패시키려면 설정 파일 자리에 디렉터리를 둔다(원자적 rename 이 실패한다).
  const dir = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'));
  const settingsFile = path.join(dir, 'app-settings.json');
  rmSync(settingsFile, { force: true });
  mkdirSync(settingsFile);

  await openSettings(page);
  const languageGroup = page.getByRole('radiogroup', { name: '언어' });
  const systemRadio = languageGroup.getByRole('radio', { name: '시스템 따르기' });
  await expect(systemRadio).toHaveAttribute('aria-checked', 'true');
  await languageGroup.getByRole('radio', { name: 'English' }).click();

  // 실패: 인라인 오류, 언어·라디오는 그대로, 포커스는 선택된(시스템) 라디오로 돌아온다.
  await expect(page.getByRole('alert')).toHaveText('언어를 저장하지 못했어요. 다시 시도해 주세요.');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
  await expect(systemRadio).toHaveAttribute('aria-checked', 'true');
  await expect(systemRadio).toBeFocused();

  // 실패 원인을 없애면 같은 조작이 성공한다.
  rmSync(settingsFile, { recursive: true, force: true });
  await languageGroup.getByRole('radio', { name: 'English' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(JSON.parse(readFileSync(settingsFile, 'utf8'))).toMatchObject({ version: 1, language: 'en' });

  // 원래대로 시스템(ko)으로 되돌린다.
  await page.getByRole('radiogroup', { name: 'Language' }).getByRole('radio', { name: 'Follow system' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
});
