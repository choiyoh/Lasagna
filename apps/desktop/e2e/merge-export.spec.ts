import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { waitForWatcher, writeExternalNote } from './watcher';
import { selectSettingsPage } from './settings';
import { workCard } from './work-list';

// M1-1: 작품 회차 합본 내보내기(.docx/.txt) — 작가 모드 전용, 노트는 읽기만.
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
const out = () => path.join(base, 'out');

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

async function setWriter(page: Page, on = true, locale: 'ko' | 'en' = 'ko'): Promise<void> {
  await page.evaluate(
    (next) => window.nops.settings.setLanguage({ language: next.locale, writerMode: next.mode, writerSpacing: 'include' }),
    { locale, mode: on },
  );
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
}

async function createWork(page: Page, name: string): Promise<void> {
  await page.getByTestId('settings-btn').click();
  await selectSettingsPage(page, '작가 모드');
  await page.getByTestId('work-create').click();
  await expect(page.getByTestId('work-dialog')).toBeVisible();
  await page.getByTestId('work-dialog-name').fill(name);
  await page.getByTestId('work-dialog-create').click();
  await expect(page.getByTestId('work-dialog')).toHaveCount(0);
  await page.keyboard.press('Escape');
}

/** 설정 화면 왼쪽 목록에서 페이지만 고른다(대화상자는 열려 있어야 한다). */

async function stubSave(app: ElectronApplication, file: string): Promise<void> {
  await app.evaluate(({ dialog }, target) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: target })) as typeof dialog.showSaveDialog;
  }, file);
}

async function openMerge(page: Page): Promise<void> {
  await (await workCard(page, '달빛')).getByTestId('work-more').click();
  await page.getByTestId('work-menu-merge').click();
  await expect(page.getByTestId('merge-dialog')).toBeVisible();
}

test.beforeAll(async () => {
  base = mkdtempSync(path.join(tmpdir(), 'nops-merge-'));
  vaultDir = path.join(base, 'Demo');
  mkdirSync(vaultDir, { recursive: true });
  mkdirSync(out(), { recursive: true });
  writeExternalNote(path.join(vaultDir, '메모.md'), '# 메모\n');
  app = await launch();
});

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  if (base) rmSync(base, { recursive: true, force: true });
});

test('작품 ⋯ 메뉴에서 .docx 합본을 내보낸다(순서·제목·색 span 제거·쪽 나눔)', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await setWriter(page);
  await createWork(page, '달빛');
  writeExternalNote(path.join(vaultDir, '달빛', '회차', '1화.md'), '# 1화 시작\n\n첫 문단\n\n\n둘째 문단 <span style="color:#c0392b">빨강</span>\n');
  writeExternalNote(path.join(vaultDir, '달빛', '회차', '2화.md'), '# 2화 다음\n\n이어짐\n');
  writeExternalNote(path.join(vaultDir, '달빛', '회차', '10화.md'), '# 10화 끝\n\n마지막\n');
  const noteBefore = readFileSync(path.join(vaultDir, '달빛', '회차', '1화.md'));
  await expect(page.locator('[data-testid="work-card"][data-work="달빛"]')).toBeVisible({ timeout: 15_000 });
  // 색인이 끝나 노트 제목이 잡힐 때까지 기다린다(회차 제목은 note.list 에서 온다).
  await expect
    .poll(
      () => page.evaluate(() => window.nops.note.list().then((list) => ['1화 시작', '2화 다음', '10화 끝'].every((t) => list.some((n) => n.title === t)))),
      { timeout: 15_000 },
    )
    .toBe(true);
  // 앱 상태(작품 카드 회차 수)도 갱신될 때까지 기다린다.
  await expect(page.locator('[data-testid="work-card"][data-work="달빛"] [data-testid="work-meta"]')).toContainText('3회차', { timeout: 15_000 });

  // ⋯ 메뉴에 합본 항목이 있다
  await (await workCard(page, '달빛')).getByTestId('work-more').click();
  await expect(page.getByTestId('work-menu-merge')).toBeVisible();
  await page.keyboard.press('Escape');

  await openMerge(page);
  const file = path.join(out(), 'full.docx');
  await stubSave(app, file);
  await expect(page.getByTestId('merge-summary')).toContainText('3개 회차');
  await page.getByTestId('merge-export').click();
  await expect(page.getByTestId('merge-dialog')).toHaveCount(0, { timeout: 20_000 });
  await expect.poll(() => readFileSync(file).length > 0, { timeout: 15_000 }).toBe(true);

  const files = unzipSync(readFileSync(file));
  expect(files['[Content_Types].xml']).toBeTruthy();
  const xml = new TextDecoder().decode(files['word/document.xml']);
  const at = (text: string) => xml.indexOf(text);
  expect(at('1화 시작')).toBeGreaterThanOrEqual(0);
  expect(at('1화 시작')).toBeLessThan(at('2화 다음'));
  expect(at('2화 다음')).toBeLessThan(at('10화 끝'));
  expect(xml).toContain('빨강');
  expect(xml).not.toContain('color:#c0392b');
  expect(xml).not.toContain('&lt;span');
  expect((xml.match(/w:type="page"/g) ?? []).length).toBe(2);
  // 노트 파일은 읽기만 한다
  expect(readFileSync(path.join(vaultDir, '달빛', '회차', '1화.md'))).toEqual(noteBefore);
});

test('.txt 는 BOM·CRLF 로 저장하고 범위·구분선·요약 옵션을 반영한다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await setWriter(page);
  await expect(page.locator('[data-testid="work-card"][data-work="달빛"]')).toBeVisible({ timeout: 15_000 });
  await openMerge(page);

  // .txt: 쪽 나눔이 비활성이고 빈 줄로 자동 전환된다
  await page.getByTestId('merge-txt').check();
  await expect(page.getByTestId('merge-sep-page')).toBeDisabled();
  await expect(page.getByTestId('merge-sep-blank')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('merge-sep-rule').click();
  await page.getByTestId('merge-summary-toggle').check();

  const file = path.join(out(), 'full.txt');
  await stubSave(app, file);
  await page.getByTestId('merge-export').click();
  await expect(page.getByTestId('merge-dialog')).toHaveCount(0, { timeout: 20_000 });
  await expect.poll(() => readFileSync(file).length > 0, { timeout: 15_000 }).toBe(true);

  const bytes = readFileSync(file);
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const text = bytes.subarray(3).toString('utf8');
  expect(text).toContain('\r\n');
  expect(/[^\r]\n/.test(text)).toBe(false);
  expect(text).toContain('달빛');
  const at = text.indexOf('1화 시작');
  expect(at).toBeGreaterThanOrEqual(0);
  expect(at).toBeLessThan(text.indexOf('2화 다음'));
  expect(text.indexOf('2화 다음')).toBeLessThan(text.indexOf('10화 끝'));
  expect(text).toContain('---');
  expect(text).toContain('빨강');
  expect(text).not.toContain('<span');
});

test('범위를 고르면 그 회차만, 작가 모드 OFF 면 진입점이 없다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await setWriter(page);
  await expect(page.locator('[data-testid="work-card"][data-work="달빛"]')).toBeVisible({ timeout: 15_000 });
  await openMerge(page);
  await page.getByTestId('merge-start').selectOption('1');
  await page.getByTestId('merge-end').selectOption('1');
  await expect(page.getByTestId('merge-summary')).toContainText('1개 회차');
  const file = path.join(out(), 'range.docx');
  await stubSave(app, file);
  await page.getByTestId('merge-export').click();
  await expect(page.getByTestId('merge-dialog')).toHaveCount(0, { timeout: 20_000 });
  await expect.poll(() => readFileSync(file).length > 0, { timeout: 15_000 }).toBe(true);
  const xml = new TextDecoder().decode(unzipSync(readFileSync(file))['word/document.xml']);
  expect(xml).toContain('2화 다음');
  expect(xml).not.toContain('1화 시작');
  expect(xml).not.toContain('10화 끝');

  // 작가 모드 OFF: 카드 메뉴·팔레트 항목이 없다
  await setWriter(page, false);
  await expect(page.getByTestId('work-section')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+p');
  const palette = page.getByTestId('command-palette');
  await expect(palette).toBeVisible();
  await expect(palette.getByRole('option', { name: /원고 합본|Merge & export/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
});
