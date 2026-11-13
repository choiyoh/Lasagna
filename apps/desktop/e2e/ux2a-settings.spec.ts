import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { waitForWatcher, writeExternalNote } from './watcher';

// UX-2a: 설정 화면 구조 — 왼쪽 페이지 목록 + 오른쪽 페이지(값·testid·바로 저장은 그대로).
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

const dialog = (page: Page) => page.getByRole('dialog', { name: /^(설정|Settings)$/ });
const tab = (page: Page, id: string) => page.getByTestId(`settings-tab-${id}`);

async function openSettings(page: Page): Promise<void> {
  await page.keyboard.press('ControlOrMeta+,');
  await expect(dialog(page)).toBeVisible();
}

test.beforeAll(async () => {
  base = mkdtempSync(path.join(tmpdir(), 'nops-ux2a-'));
  vaultDir = path.join(base, 'Demo');
  mkdirSync(vaultDir, { recursive: true });
  writeExternalNote(path.join(vaultDir, '메모.md'), '# 메모\n\n본문\n');
  app = await launch();
});

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  if (base) rmSync(base, { recursive: true, force: true });
});

test('왼쪽 목록 + 오른쪽 페이지: 기본은 일반, 기존 testid 가 그대로다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await openSettings(page);
  const dlg = dialog(page);

  const rail = dlg.getByRole('tablist', { name: '설정 목록' });
  await expect(rail).toHaveAttribute('aria-orientation', 'vertical');
  // 작가 모드 OFF: 작가 모드 페이지는 목록에 없다
  await expect(rail.getByRole('tab')).toHaveCount(6);
  await expect(tab(page, 'general')).toHaveAttribute('aria-selected', 'true');
  // tab ↔ tabpanel 연결
  await expect(tab(page, 'general')).toHaveAttribute('aria-controls', 'settings-page-general');
  await expect(dlg.locator('#settings-page-general')).toBeVisible();
  await expect(dlg.locator('#settings-page-appearance')).toBeHidden();
  // 페이지 제목 h2
  await expect(dlg.locator('#settings-page-general').getByRole('heading', { level: 2 })).toHaveText('일반');
  // 기존 testid: 작가 모드 스위치는 [일반], 작품 만들기는 작가 모드 OFF 라 DOM 에 없다
  await expect(dlg.getByTestId('writer-mode')).toBeVisible();
  await expect(dlg.getByTestId('work-create')).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0);
  await expect(page.getByTestId('settings-btn')).toBeFocused();
});

test('작가 모드를 켜면 목록에 [작가 모드]가 생기고, 끄면 그 페이지는 [일반]으로 돌아간다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await openSettings(page);
  const dlg = dialog(page);

  await dlg.getByTestId('writer-mode').check();
  await expect(page.getByTestId('settings-tab-writer')).toBeVisible();
  await expect(page.getByRole('tablist', { name: '설정 목록' }).getByRole('tab')).toHaveCount(7);
  await tab(page, 'writer').click();
  await expect(dlg.locator('#settings-page-writer')).toBeVisible();
  for (const id of ['writer-daily-goal', 'writer-paper-count', 'writer-typewriter', 'work-create']) {
    await expect(dlg.getByTestId(id)).toBeVisible();
  }
  // 원고지 매수는 글자수 기준 바로 아래
  const order = await dlg.locator('#settings-page-writer .settings__row').evaluateAll((rows) => rows.map((row) => row.textContent ?? ''));
  const spacingAt = order.findIndex((text) => text.includes('글자수 기준'));
  const paperAt = order.findIndex((text) => text.includes('원고지 매수 표시'));
  expect(spacingAt).toBeGreaterThanOrEqual(0);
  expect(paperAt).toBe(spacingAt + 1);

  // [작가 모드] 페이지를 연 채로 작가 모드를 끄면 목록에서 사라지고 [일반]으로 돌아간다
  await page.evaluate(() => window.nops.settings.setLanguage({ writerMode: false }));
  await expect(page.getByTestId('settings-tab-writer')).toHaveCount(0);
  await expect(tab(page, 'general')).toHaveAttribute('aria-selected', 'true');
  await expect(dlg.locator('#settings-page-general')).toBeVisible();
  await page.keyboard.press('Escape');
});

test('목록은 ↑↓·Home/End 로 이동하고 페이지도 함께 바뀐다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await openSettings(page);
  const dlg = dialog(page);

  await tab(page, 'general').focus();
  await page.keyboard.press('ArrowDown');
  await expect(tab(page, 'editing')).toHaveAttribute('aria-selected', 'true');
  await expect(tab(page, 'editing')).toBeFocused();
  await expect(dlg.locator('#settings-page-editing')).toBeVisible();
  await page.keyboard.press('End');
  await expect(tab(page, 'advanced')).toHaveAttribute('aria-selected', 'true');
  await expect(dlg.locator('#settings-page-advanced')).toBeVisible();
  await page.keyboard.press('Home');
  await expect(tab(page, 'general')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowUp'); // 처음에서 위로 = 마지막
  await expect(tab(page, 'advanced')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
});

test('페이지별 대표 설정이 동작한다(외형·편집·동기화·단축키·연결·고급)', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await openSettings(page);
  const dlg = dialog(page);

  // 외형: 테마
  await tab(page, 'appearance').click();
  await dlg.getByRole('radio', { name: '라이트' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await dlg.getByRole('radio', { name: '시스템' }).click();

  // 편집: 제목 동기화
  await tab(page, 'editing').click();
  await dlg.getByLabel('제목을 바꾸면 파일 이름도 맞추기').uncheck();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('nops.prefs') ?? '{}').titleSync)).toBe(false);
  await dlg.getByLabel('제목을 바꾸면 파일 이름도 맞추기').check();

  // 동기화: 기존 버튼이 동기화 대화상자를 연다
  await tab(page, 'sync').click();
  await dlg.getByRole('button', { name: /Google Drive 동기화/ }).click();
  const sync = page.getByRole('dialog', { name: 'Google Drive 동기화' });
  await expect(sync).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sync).toHaveCount(0);

  // 단축키: 목록 대화상자
  await openSettings(page);
  await tab(page, 'shortcuts').click();
  await dialog(page).getByRole('button', { name: /단축키 목록/ }).click();
  await expect(page.getByRole('dialog', { name: '단축키' })).toBeVisible();
  await page.keyboard.press('Escape');

  // 연결·고급: MCP 설정과 휴지통
  await openSettings(page);
  await tab(page, 'advanced').click();
  await expect(dialog(page).getByTestId('mcp-settings')).toBeVisible();
  await dialog(page).getByRole('button', { name: /휴지통/ }).click();
  const trash = page.getByRole('dialog', { name: '휴지통' });
  await expect(trash).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(trash).toHaveCount(0);
});

test('920px·700px 미만·영어에서도 목록과 페이지가 겹치지 않는다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await openSettings(page);

  await page.setViewportSize({ width: 900, height: 800 });
  const at900 = await page.evaluate(() => {
    const el = document.querySelector('.dialog.settings')!.getBoundingClientRect();
    const rail = document.querySelector('.settings__rail')!.getBoundingClientRect();
    return { width: Math.round(el.width), rail: Math.round(rail.width) };
  });
  expect(at900.width).toBeLessThanOrEqual(720);
  expect(at900.rail).toBeLessThanOrEqual(150);

  await page.setViewportSize({ width: 650, height: 800 });
  const labelsHidden = await page.evaluate(() => {
    const label = document.querySelector('.settings__tablabel')!;
    return { hidden: getComputedStyle(label).display === 'none', rail: Math.round(document.querySelector('.settings__rail')!.getBoundingClientRect().width) };
  });
  expect(labelsHidden.hidden).toBe(true);
  expect(labelsHidden.rail).toBeLessThanOrEqual(60);

  // 영어: 목록 이름도 즉시 영어
  await page.setViewportSize({ width: 1440, height: 900 });
  await tab(page, 'general').click();
  await dialog(page).getByRole('radio', { name: 'English' }).click();
  await expect(tab(page, 'appearance')).toHaveAttribute('aria-label', 'Appearance');
  await tab(page, 'appearance').click();
  await expect(dialog(page).locator('#settings-page-appearance').getByRole('heading', { level: 2 })).toHaveText('Appearance');
  await page.keyboard.press('Escape');

  // 원래 언어로
  await openSettings(page);
  await dialog(page).getByRole('radio', { name: '한국어' }).click();
  await page.keyboard.press('Escape');
});
