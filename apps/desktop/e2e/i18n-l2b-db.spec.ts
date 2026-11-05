import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// L2b 영어 스모크(데이터베이스): 영어로 전환한 뒤 db 화면·필터·속성 관리·템플릿에 한글이 남지 않는지 확인한다.
const HANGUL = /[\u3131-\u318e\uac00-\ud7a3]/;

function packagedExecutable(): string {
  const override = process.env.NOPS_E2E_EXECUTABLE;
  if (override) return override;
  const dir = path.join(__dirname, `../out/Lasagna-${process.platform}-${process.arch}`);
  if (process.platform === 'darwin') return path.join(dir, 'Lasagna.app/Contents/MacOS/Lasagna');
  return path.join(dir, process.platform === 'win32' ? 'lasagna.exe' : 'lasagna');
}

const DB_YAML = `version: 1
title: Tasks
properties:
  Status: { type: status, options: [{ name: Todo, group: todo }, { name: Doing, group: doing }, { name: Done, group: done }] }
  Score: { type: number, format: number }
views:
  - id: v1
    name: All
    type: table
    columns: [title, Status, Score]
  - id: v2
    name: Board
    type: board
    groupBy: Status
`;

let app: ElectronApplication;
let base = '';
let userData = '';
let vaultDir = '';

test.beforeAll(async () => {
  test.setTimeout(240_000);
  base = mkdtempSync(path.join(tmpdir(), 'nops-l2b-db-'));
  userData = path.join(base, 'userdata');
  vaultDir = path.join(base, 'vault');
  const dbDir = path.join(vaultDir, 'Tasks');
  mkdirSync(dbDir, { recursive: true });
  writeFileSync(path.join(dbDir, '_db.yaml'), DB_YAML);
  for (const [title, status, score] of [['Alpha', 'Todo', 3], ['Beta', 'Doing', 5], ['Gamma', 'Done', 8]] as const) {
    writeFileSync(path.join(dbDir, `${title}.md`), `---\nStatus: ${status}\nScore: ${score}\ncreated: 2026-11-01T00:00:00.000Z\n---\n${title} note\n`);
  }
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

test('English smoke: database toolbar, filter, properties and templates have no Korean', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);

  // 영어로 전환
  await page.getByTestId('settings-btn').click();
  await page.getByRole('radiogroup', { name: '언어' }).getByRole('radio', { name: 'English' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.keyboard.press('Escape');

  // 데이터베이스 화면
  await page.getByRole('tab', { name: 'DB' }).click();
  await page.locator('.dblistpanel').getByRole('button', { name: /Tasks/ }).first().click();
  const screen = page.getByTestId('db-screen');
  await expect(screen).toBeVisible();
  await expect(screen.getByRole('heading', { name: 'Tasks' })).toBeVisible();
  await expect(screen).toContainText('3 rows');
  // 툴바·탭
  await expect(screen.getByRole('button', { name: 'Filter', exact: true })).toBeVisible();
  await expect(screen.getByRole('button', { name: 'Sort', exact: true })).toBeVisible();
  await expect(screen.getByRole('button', { name: 'Show properties', exact: true })).toBeVisible();
  await expect(screen.getByRole('button', { name: 'Calculations', exact: true })).toBeVisible();
  await expect(screen.getByRole('tab', { name: 'All' })).toBeVisible();
  await expect(screen.getByRole('tab', { name: 'Board' })).toBeVisible();
  expect(await screen.innerText()).not.toMatch(HANGUL);

  // 필터: 연산자·값 라벨이 영어다
  await screen.getByRole('button', { name: 'Filter', exact: true }).click();
  const filter = page.getByRole('dialog', { name: 'Filter' });
  await expect(filter).toBeVisible();
  await filter.getByRole('button', { name: '+ Add condition' }).click();
  await expect(filter.getByLabel('Property', { exact: true })).toBeVisible();
  await expect(filter.getByLabel('Condition', { exact: true })).toBeVisible();
  expect(await filter.innerText()).not.toMatch(HANGUL);
  await filter.getByLabel('Property', { exact: true }).selectOption('Score');
  await filter.getByLabel('Condition', { exact: true }).selectOption('>=');
  await expect(filter.getByRole('option', { name: 'Greater than or equal' })).toHaveCount(1);
  await filter.getByLabel('Value', { exact: true }).fill('100');
  await page.keyboard.press('Escape');
  // 0행 빈 화면도 영어
  const empty = page.locator('.emptystate');
  await expect(empty).toContainText('No rows match the filter');
  await expect(empty).toContainText('Clear all filters');
  expect(await empty.innerText()).not.toMatch(HANGUL);
  await empty.getByRole('button', { name: 'Clear all filters' }).click();
  await expect(page.getByTestId('db-table')).toContainText('Alpha');

  // 0행 추천 라벨은 언어를 바꾸면 다시 만들어진다(t() 결과를 캐시하지 않는다)
  await screen.getByRole('button', { name: 'Filter', exact: true }).click();
  const again = page.getByRole('dialog', { name: 'Filter' });
  await again.getByRole('button', { name: '+ Add condition' }).click();
  await again.getByLabel('Property', { exact: true }).selectOption('Score');
  await again.getByLabel('Condition', { exact: true }).selectOption('>=');
  await again.getByLabel('Value', { exact: true }).fill('100');
  await page.keyboard.press('Escape');
  await expect(page.locator('.emptystate')).toContainText('No rows match the filter');
  await page.getByTestId('settings-btn').click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('radiogroup', { name: 'Language' }).getByRole('radio', { name: '한국어' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
  await page.keyboard.press('Escape');
  await expect(page.locator('.emptystate')).toContainText('조건에 맞는 결과가 없어요');
  await expect(page.locator('.emptystate')).not.toContainText('No rows match the filter');
  expect(await page.locator('.emptystate').innerText()).toMatch(HANGUL);
  // 영어로 되돌린다
  await page.getByTestId('settings-btn').click();
  await page.getByRole('radiogroup', { name: '언어' }).getByRole('radio', { name: 'English' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.keyboard.press('Escape');
  await expect(page.locator('.emptystate')).toContainText('No rows match the filter');
  await page.locator('.emptystate').getByRole('button', { name: 'Clear all filters' }).click();
  await expect(page.getByTestId('db-table')).toContainText('Alpha');

  // 속성 관리: 유형 라벨이 영어다
  await screen.getByRole('button', { name: 'Properties', exact: true }).click();
  const props = page.getByRole('dialog', { name: 'Properties' });
  await expect(props).toBeVisible();
  await expect(props).toContainText('Name');
  await expect(props).toContainText('Type');
  await expect(props.getByLabel('New property name')).toBeVisible();
  await expect(props.getByLabel('Status type')).toHaveValue('status');
  await expect(props.getByLabel('Status type').getByRole('option', { name: 'Status' })).toHaveCount(1);
  await expect(props.getByLabel('Score type').getByRole('option', { name: 'Number' })).toHaveCount(1);
  expect(await props.innerText()).not.toMatch(HANGUL);
  await props.getByRole('button', { name: 'Close properties' }).click();

  // 템플릿: 제목·안내 문구가 영어다
  await screen.getByRole('button', { name: 'Templates', exact: true }).click();
  const templates = page.getByRole('dialog', { name: 'Templates' });
  await expect(templates).toBeVisible();
  await expect(templates).toContainText('No templates yet.');
  expect(await templates.innerText()).not.toMatch(HANGUL);
  await screen.getByRole('button', { name: 'Templates', exact: true }).click();

  // CSV 가져오기: 제목(type=title) 라벨이 raw 키가 아니라 영어 낱말이다
  const csvPath = path.join(vaultDir, 'import.csv');
  writeFileSync(csvPath, 'Name,Note\nOne,n1\n');
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as typeof dialog.showOpenDialog;
  }, csvPath);
  await screen.getByRole('button', { name: 'Import CSV', exact: true }).click();
  const csv = page.getByRole('dialog', { name: 'Import CSV' });
  await expect(csv).toBeVisible();
  const firstType = csv.locator('tbody tr').first().getByRole('combobox');
  await expect(firstType.getByRole('option', { name: 'Title', exact: true })).toHaveCount(1);
  await expect(firstType.getByRole('option', { name: 'title', exact: true })).toHaveCount(0);
  await expect(csv).toContainText('Import CSV — import.csv (1 row)');
  expect(await csv.innerText()).not.toMatch(HANGUL);
  await csv.getByRole('button', { name: 'Cancel' }).click();
});
