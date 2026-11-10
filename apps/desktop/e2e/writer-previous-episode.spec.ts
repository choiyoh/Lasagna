import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// 작가 모드(W5): '이전 회차'를 오른쪽 칸에 열기 — 진입점·비활성·분할 재사용·일반 모드 불변.
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
    args: [
      '--use-mock-keychain',
      `--user-data-dir=${path.join(base, 'userdata')}`,
      ...(process.platform === 'linux' ? ['--no-sandbox', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : []),
    ],
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

async function resetWriter(page: Page, mode = true, locale: 'ko' | 'en' = 'ko'): Promise<void> {
  await page.evaluate(
    (next) => window.nops.settings.setLanguage({ language: next.locale, writerMode: next.mode, writerSpacing: 'include' }),
    { mode, locale },
  );
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
}

async function prompt(page: Page, text: string): Promise<void> {
  const input = page.locator('.nops-prompt input');
  await expect(input).toBeVisible();
  await input.fill(text);
  await input.press('Enter');
}

async function createWork(page: Page, name: string): Promise<void> {
  await page.getByTestId('settings-btn').click();
  await page.getByTestId('work-create').click();
  await expect(page.getByTestId('work-dialog')).toBeVisible();
  await page.getByTestId('work-dialog-name').fill(name);
  await page.getByTestId('work-dialog-create').click();
  await expect(page.getByTestId('work-dialog')).toHaveCount(0);
  await page.keyboard.press('Escape');
}

async function episode(page: Page, name: string): Promise<void> {
  await page.getByTestId('new-episode').click();
  await prompt(page, name);
  await expect(page.locator('.pane .ProseMirror h1').first()).toHaveText(name, { timeout: 15_000 });
}

test.beforeAll(async () => {
  test.setTimeout(240_000);
  base = mkdtempSync(path.join(tmpdir(), 'nops-prev-'));
  vaultDir = path.join(base, 'Demo');
  mkdirSync(vaultDir, { recursive: true });
  writeFileSync(path.join(vaultDir, '메모.md'), '# 메모\n');
  app = await launch();
});

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  if (base) rmSync(base, { recursive: true, force: true });
});

test('이전 회차 버튼은 오른쪽 칸에 앞 회차를 열고, 쓰던 노트 입력은 이어진다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await resetWriter(page);
  await createWork(page, '두쪽');
  await episode(page, '1화');
  await episode(page, '2화');
  await episode(page, '3화');

  // 작가 모드에서만 버튼이 있다
  const prev = page.getByTestId('pane-0').getByTestId('previous-episode');
  await expect(prev).toBeVisible();
  await expect(prev).toBeEnabled();
  // 940px 이하에서도 줄바꿈·겹침 없이 보인다
  await page.setViewportSize({ width: 940, height: 800 });
  await expect(prev).toBeVisible();
  const box = await prev.boundingBox();
  const copy = await page.getByTestId('copy-open').boundingBox();
  expect(box && copy && box.x + box.width <= copy.x + 1).toBe(true);
  await page.setViewportSize({ width: 1440, height: 900 });

  // 저장 전 입력을 남긴 채 누른다(소스 모드에서 입력 → 제목·파일 이름은 그대로)
  await page.getByRole('button', { name: '소스 모드' }).click();
  const src = page.getByTestId('source-editor').first();
  await src.locator('.cm-content').click();
  await page.keyboard.press('Meta+ArrowDown');
  await page.keyboard.type('첫문장');
  await prev.click();

  // 오른쪽 칸에 2화, 왼쪽(쓰던 칸)은 3화 그대로
  await expect(page.getByTestId('pane-1')).toBeVisible();
  await expect(page.getByTestId('pane-1').getByTestId('note-tab')).toContainText('2화');
  await expect(page.getByTestId('pane-0').getByTestId('note-tab')).toContainText('3화');
  await expect(page.getByTestId('pane-0')).toHaveClass(/is-active/);

  // 이어서 입력하면 두 문장이 모두 저장된다
  await src.locator('.cm-content').click();
  await page.keyboard.press('Meta+ArrowDown');
  await page.keyboard.type('이어');
  await expect
    .poll(() => readFileSync(path.join(vaultDir, '두쪽', '회차', '3화.md'), 'utf8').includes('첫문장이어'), { timeout: 15_000 })
    .toBe(true);

  // 이미 분할돼 있어도 같은 회차를 중복으로 열지 않는다
  await prev.click();
  await expect(page.locator('.pane')).toHaveCount(2);
  await expect(page.getByTestId('pane-1').getByTestId('note-tab')).toContainText('2화');

  // 오른쪽 탭을 닫으면 기존 규칙대로 한 칸으로 돌아온다
  await page.getByTestId('pane-1').locator('.tab__close').click();
  await expect(page.locator('.pane')).toHaveCount(1);
  await expect(page.getByTestId('pane-0').getByTestId('note-tab')).toContainText('3화');

  // 첫 회차에서는 비활성 + 툴팁
  await page.locator('aside.sidebar [data-path$="/1화.md"]').first().click();
  await expect(page.getByTestId('pane-0').getByTestId('note-tab')).toContainText('1화');
  await expect(prev).toBeDisabled();
  await expect(prev).toHaveAttribute('title', '이전 회차가 없어요');
  await prev.click({ force: true });
  await expect(page.locator('.pane')).toHaveCount(1);

  // 팔레트: 첫 회차에서는 항목이 없고(비활성은 목록에서 빠진다), 앞 회차가 있으면 보인다
  await page.keyboard.press('Meta+p');
  const palette = page.getByTestId('command-palette');
  await expect(palette).toBeVisible();
  await palette.locator('input').fill('이전 회차');
  await expect(palette.getByRole('option')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.locator('aside.sidebar [data-path$="/2화.md"]').first().click();
  await expect(page.getByTestId('pane-0').getByTestId('note-tab')).toContainText('2화');
  await page.keyboard.press('Meta+p');
  await expect(palette).toBeVisible();
  await palette.locator('input').fill('이전 회차');
  await expect(palette.getByRole('option').first()).toContainText('이전 회차');
  await page.keyboard.press('Escape');
});

test('작가 모드 OFF·일반 모드에는 버튼과 팔레트 항목이 DOM 에 없다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await resetWriter(page, false);
  await page.locator('aside.sidebar [data-path$="/2화.md"]').first().click();
  await expect(page.locator('.ProseMirror h1')).toHaveText('2화');
  await expect(page.getByTestId('previous-episode')).toHaveCount(0);
  await page.keyboard.press('Meta+p');
  const palette = page.getByTestId('command-palette');
  await palette.locator('input').fill('이전 회차');
  await expect(palette.getByRole('option')).toHaveCount(0);
  await page.keyboard.press('Escape');
});

test('영어에서는 Previous episode 로 보이고, 첫 회차 툴팁도 영어다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await resetWriter(page, true, 'en');
  await page.locator('aside.sidebar [data-path$="/1화.md"]').first().click();
  const prev = page.getByTestId('pane-0').getByTestId('previous-episode');
  await expect(prev).toHaveText('Previous episode');
  await expect(prev).toBeDisabled();
  await expect(prev).toHaveAttribute('title', 'No previous episode');
  await page.locator('aside.sidebar [data-path$="/3화.md"]').first().click();
  await expect(prev).toBeEnabled();
});
