import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// L2b 영어 스모크(그래프): 영어로 전환한 뒤 그래프 화면·설정·통계·0건 안내에 한글이 남지 않는지 확인한다.
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
  base = mkdtempSync(path.join(tmpdir(), 'nops-l2b-graph-'));
  userData = path.join(base, 'userdata');
  vaultDir = path.join(base, 'vault');
  mkdirSync(vaultDir, { recursive: true });
  writeFileSync(path.join(vaultDir, 'Alpha.md'), '# Alpha\n\nSee [[Beta]].\n');
  writeFileSync(path.join(vaultDir, 'Beta.md'), '# Beta\n');
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

test('English smoke: graph screen, settings, stats and empty state have no Korean', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);

  // 영어로 전환
  await page.getByTestId('settings-btn').click();
  await page.getByRole('radiogroup', { name: '언어' }).getByRole('radio', { name: 'English' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.keyboard.press('Escape');

  // 그래프 화면
  await page.locator('aside.sidebar').getByRole('button', { name: /Graph/ }).first().click();
  const screen = page.getByTestId('graph-screen');
  await expect(screen).toBeVisible();
  await expect(screen.locator('.graphscreen__bar strong')).toHaveText('Graph');
  await expect(screen.getByLabel('Graph filter')).toBeVisible();
  await expect(screen.getByLabel('Find a node')).toBeVisible();
  await expect(screen.getByRole('button', { name: 'Close' })).toBeVisible();
  // 설정 항목
  await expect(screen.getByLabel('Tags')).toBeVisible();
  await expect(screen.getByLabel('Unresolved links')).toBeVisible();
  await expect(screen.getByLabel('Unlinked notes')).toBeVisible();
  await expect(screen.getByLabel('Arrows')).toBeVisible();
  await expect(screen.getByLabel('Gravity')).toBeVisible();
  await expect(screen.getByLabel('Repulsion')).toBeVisible();
  await expect(screen.getByLabel('Link distance')).toBeVisible();
  await expect(screen.getByRole('button', { name: '+ Add group' })).toBeVisible();
  expect(await screen.innerText()).not.toMatch(HANGUL);

  // 통계: 노드·링크 수가 영어 복수형으로 나온다
  const stats = page.getByTestId('graph-global-stats');
  await expect(stats).toContainText('2 nodes', { timeout: 10_000 });
  await expect(stats).toContainText('1 link');

  // 0건 안내도 영어
  await screen.getByLabel('Graph filter').fill('zzz-no-match');
  const empty = page.locator('.graphview__empty .emptystate');
  await expect(empty).toContainText('No nodes match the filter');
  await expect(empty).toContainText('Clear filter');
  expect(await empty.innerText()).not.toMatch(HANGUL);
  await empty.getByRole('button', { name: 'Clear filter' }).click();
  await expect(page.getByTestId('graph-global-stats')).toContainText('2 nodes');

  // 로컬 그래프(오른쪽 패널 탭): 깊이·방향 라벨이 영어다
  await screen.getByRole('button', { name: 'Close' }).click();
  await page.locator('aside.sidebar').getByRole('button', { name: 'Alpha', exact: true }).click();
  await expect(page.locator('.ProseMirror h1')).toHaveText('Alpha');
  // 오른쪽 도크가 닫혀 있으면 연다(사이드바 레일)
  const graphTab = page.getByRole('tab', { name: 'Graph', exact: true });
  if (!(await graphTab.isVisible())) await page.getByTitle('Open or close the links panel').click();
  await graphTab.click();
  const local = page.getByTestId('local-graph');
  await expect(local).toBeVisible();
  await expect(local.getByLabel('Depth')).toBeVisible();
  await expect(local.getByLabel('Direction')).toBeVisible();
  await expect(local.locator('option', { hasText: 'Both directions' })).toHaveCount(1);
  await expect(local.locator('option', { hasText: 'Outgoing' })).toHaveCount(1);
  await expect(local.locator('option', { hasText: 'Incoming' })).toHaveCount(1);
  await expect(page.getByTestId('graph-local-stats')).toContainText('nodes', { timeout: 10_000 });
  expect(await local.innerText()).not.toMatch(HANGUL);
});
