import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import {mkdirSync, mkdtempSync, rmSync} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { waitForWatcher, writeExternalNote } from './watcher';

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
  Due: { type: date }
  Done: { type: checkbox }
views:
  - id: v1
    name: All
    type: table
    columns: [title, Status, Score, Due, Done]
  - id: v2
    name: Board
    type: board
    groupBy: Status
  - id: v3
    name: Checks
    type: board
    groupBy: Done
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
  writeExternalNote(path.join(dbDir, '_db.yaml'), DB_YAML);
  for (const [title, status, score, due, done] of [
    ['Alpha', 'Todo', 3, '2026-11-05', 'true'],
    ['Beta', 'Doing', 5, '2026-11-06', 'false'],
    ['Gamma', 'Done', 8, '2026-11-07', 'true'],
  ] as const) {
    writeExternalNote(path.join(path.join(vaultDir, 'Tasks'), `${title}.md`), `---\nStatus: ${status}\nScore: ${score}\nDue: ${due}\nDone: ${done}\ncreated: 2026-11-01T00:00:00.000Z\n---\n${title} note\n`);
  }
  // _db.yaml 이 깨진 데이터베이스(예약어 title 을 속성 이름으로) — 문제 문구도 앱 언어를 따라야 한다
  const broken = path.join(vaultDir, 'Broken');
  mkdirSync(broken, { recursive: true });
  writeExternalNote(path.join(broken, '_db.yaml'), 'version: 1\ntitle: Broken\nproperties:\n  title: { type: text }\nviews:\n  - id: v1\n    name: All\n    type: table\n');
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

  // 그룹 라벨(빈 값·체크)은 worker 문구가 아니라 렌더 시점 번역이다 — 언어를 바꾸면 바로 따라간다
  await screen.getByRole('tab', { name: 'Checks' }).click();
  const board = page.locator('.dbboard');
  await expect(board).toBeVisible();
  await expect(board).toContainText('Checked');
  await expect(board).toContainText('Not checked');
  expect(await board.innerText()).not.toMatch(HANGUL);
  await page.getByTestId('settings-btn').click();
  await page.getByRole('radiogroup', { name: 'Language' }).getByRole('radio', { name: '한국어' }).click();
  await page.keyboard.press('Escape');
  await expect(board).toContainText('체크됨');
  await expect(board).toContainText('체크 안 됨');
  await page.getByTestId('settings-btn').click();
  await page.getByRole('radiogroup', { name: '언어' }).getByRole('radio', { name: 'English' }).click();
  await page.keyboard.press('Escape');
  await expect(board).toContainText('Checked');
  await screen.getByRole('tab', { name: 'All' }).click();

  // 깨진 _db.yaml 의 문제 문구도 영어
  await page.getByRole('tab', { name: 'DB' }).click();
  await page.locator('.dblistpanel').getByRole('button', { name: /Broken/ }).first().click();
  const brokenScreen = page.getByTestId('db-screen');
  await expect(brokenScreen.locator('.dbissues')).toContainText('reserved for the note title');
  expect(await brokenScreen.locator('.dbissues').innerText()).not.toMatch(HANGUL);
  await brokenScreen.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('.dblistpanel').getByRole('button', { name: /Tasks/ }).first().click();

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

  // 수식 속성: 오류·속성 표시가 영어다(문구는 표시 시점 번역)
  await screen.getByRole('button', { name: 'Properties', exact: true }).click();
  const props2 = page.getByRole('dialog', { name: 'Properties' });
  await props2.getByLabel('New property name').fill('Calc');
  await props2.getByLabel('New property type').selectOption('formula');
  await props2.getByRole('button', { name: 'Add', exact: true }).click();
  const formula = props2.getByLabel('Calc formula');
  await expect(formula).toBeVisible();
  await formula.fill('1 +');
  const details = props2.locator('.dbprops__details');
  await expect(details).toContainText('The formula ended unexpectedly');
  expect(await details.innerText()).not.toMatch(HANGUL);
  await formula.fill('prop("Score") * 2');
  await expect(details).toContainText('Uses: Score');
  expect(await details.innerText()).not.toMatch(HANGUL);
  await props2.getByRole('button', { name: 'Close properties' }).click();

  // 템플릿: 제목·안내 문구가 영어다
  await screen.getByRole('button', { name: 'Templates', exact: true }).click();
  const templates = page.getByRole('dialog', { name: 'Templates' });
  await expect(templates).toBeVisible();
  await expect(templates).toContainText('No templates yet.');
  expect(await templates.innerText()).not.toMatch(HANGUL);
  await screen.getByRole('button', { name: 'Templates', exact: true }).click();

  // CSV 가져오기: 제목(type=title) 라벨이 raw 키가 아니라 영어 낱말이다
  const csvPath = path.join(vaultDir, 'import.csv');
  writeExternalNote(csvPath, 'Name,Note\nOne,n1\n');
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

  // 날짜 고르기: 기간 체크 상자의 표시 라벨과 aria 이름이 같다(영어)
  const alpha = page.getByTestId('db-table').locator('.dbtable__row', { hasText: 'Alpha' });
  await alpha.locator('.dbtable__td').nth(3).click();
  const picker = page.locator('.datepicker');
  await expect(picker).toBeVisible();
  await expect(picker).toHaveAttribute('aria-label', 'Pick a date');
  const rangeBox = picker.locator('input[type=checkbox]');
  await expect(rangeBox).toHaveAttribute('aria-label', 'Date range');
  await expect(picker.getByText('Date range', { exact: true })).toBeVisible();
  expect(await picker.innerText()).not.toMatch(HANGUL);
  await page.keyboard.press('Escape');

  // 캘린더 단위 선택 라벨
  await screen.getByLabel('View type').selectOption('calendar');
  const unit = page.locator('.dbcal').getByLabel('Time scale');
  await expect(unit).toBeVisible();
  await expect(unit.getByRole('option', { name: 'Month' })).toHaveCount(1);
  await screen.getByLabel('View type').selectOption('table');
});
