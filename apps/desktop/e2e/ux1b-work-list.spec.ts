import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { waitForWatcher, writeExternalNote } from './watcher';
import { workCard } from './work-list';

// UX-1b: 작가 모드 '작품' 영역 목록형 — 열린 작품 1개만 4줄, 나머지는 이름 한 줄.
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

async function setWriter(page: Page, opts: { mode?: boolean; locale?: 'ko' | 'en' } = {}): Promise<void> {
  await page.evaluate(
    (next) => window.nops.settings.setLanguage({ language: next.locale, writerMode: next.mode, writerSpacing: 'include' }),
    { mode: opts.mode ?? true, locale: opts.locale ?? 'ko' },
  );
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

const card = (page: Page, name: string) => workCard(page, name);

test.beforeAll(async () => {
  base = mkdtempSync(path.join(tmpdir(), 'nops-ux1b-'));
  vaultDir = path.join(base, 'Demo');
  mkdirSync(vaultDir, { recursive: true });
  writeExternalNote(path.join(vaultDir, '메모.md'), '# 메모\n\n본문\n');
  app = await launch();
});

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  if (base) rmSync(base, { recursive: true, force: true });
});

test('작품 3개를 만들면 열린 1개만 펼쳐지고 나머지는 이름 한 줄이라 트리가 넓어진다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await setWriter(page);
  for (const name of ['달빛', '출판작', '메모작']) await createWork(page, name);

  await expect(page.getByTestId('work-card')).toHaveCount(1);
  await expect(page.getByTestId('work-row')).toHaveCount(2);
  // 열린 작품 4줄: 이름+회차+⋯ / 회차·글자수 / 목표 / 칩
  const open = await card(page, '달빛');
  await expect(open.getByTestId('work-open-name')).toHaveText('달빛');
  await expect(open.getByTestId('new-episode')).toBeVisible();
  await expect(open.getByTestId('work-more')).toBeVisible();
  await expect(open.getByTestId('work-meta')).toHaveText(/0회차 · 0자/);
  await expect(open.getByTestId('work-goal-line')).toHaveText('목표 설정');
  await expect(open.getByTestId('work-chip-db')).toHaveText('회차 DB');
  await expect(open.getByTestId('work-chip-characters')).toHaveText(/캐릭터 0/);
  await expect(open.getByTestId('work-chip-story')).toHaveText(/설정집 0/);
  // 이름 한 줄에는 버튼·칩이 없다
  const row = page.locator('[data-testid="work-row"][data-work="메모작"]');
  await expect(row).toHaveText(/▸메모작\s*0/);
  await expect(row.locator('.workrow__count')).toHaveText('0');
  await expect(open.locator('.workcard__chev')).toHaveText('▾');
  await expect(row.getByTestId('new-episode')).toHaveCount(0);

  // 트리가 카드형(작품 3개·창 900 에서 171px)보다 확실히 넓다
  await page.setViewportSize({ width: 1440, height: 900 });
  const treeHeight = (await page.locator('aside.sidebar .list').boundingBox())!.height;
  console.log(`[UX-1b] tree height with 3 works = ${Math.round(treeHeight)}px`);
  expect(treeHeight).toBeGreaterThan(300);
  await expect(page.locator('aside.sidebar .works__add')).toBeVisible();
});

test('노트를 열면 그 작품이 펼쳐지고, 다른 작품 행을 누르면 그쪽으로 바뀐다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await setWriter(page);
  // 달빛에 회차를 만든다 → 그 노트가 열리며 달빛이 열린 작품이 된다
  await (await card(page, '달빛')).getByTestId('new-episode').click();
  await prompt(page, '1화');
  await expect(page.locator('.ProseMirror h1')).toHaveText('1화');
  await expect(page.getByTestId('work-card')).toHaveAttribute('data-work', '달빛');

  // 다른 작품 행을 누르면 그 작품이 펼쳐지고 이전 작품은 한 줄로 접힌다
  await page.locator('[data-testid="work-row"][data-work="출판작"]').click();
  await expect(page.getByTestId('work-card')).toHaveAttribute('data-work', '출판작');
  await expect(page.locator('[data-testid="work-row"][data-work="달빛"]')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('[data-testid="work-row"]')).toHaveCount(2);

  // 작품 밖 노트를 열면 마지막으로 연 작품(출판작)이 유지되고, 달빛 회차를 다시 열면 달빛이 펼쳐진다
  await page.locator('aside.sidebar').getByRole('button', { name: '메모', exact: true }).click();
  await expect(page.getByTestId('work-card')).toHaveAttribute('data-work', '출판작');
  await page.locator('aside.sidebar [data-path="달빛/회차/1화.md"]').click();
  await expect(page.getByTestId('work-card')).toHaveAttribute('data-work', '달빛');
});

test('열린 작품에서 + 회차·⋯ 메뉴(새 캐릭터·설정집 폴더)·칩이 동작한다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await setWriter(page);
  const open = await card(page, '메모작');

  // + 회차
  await open.getByTestId('new-episode').click();
  await prompt(page, '1화');
  await expect(page.locator('.ProseMirror h1')).toHaveText('1화');
  await expect((await card(page, '메모작')).getByTestId('work-meta')).toContainText('1회차');

  // ⋯ 메뉴: 새 캐릭터
  await page.getByTestId('work-more').click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /새 캐릭터/ })).toBeVisible();
  await menu.getByTestId('new-character').click();
  await prompt(page, '주인공');
  await expect(page.locator('.ProseMirror h1')).toHaveText('주인공');
  await expect((await card(page, '메모작')).getByTestId('work-chip-characters')).toHaveText(/캐릭터 1/);

  // ⋯ 메뉴: 설정집 폴더 열기 → 파일 트리에서 그 폴더가 펼쳐진다
  await page.getByTestId('work-more').click();
  await page.getByTestId('work-menu-story').click();
  await expect(page.locator('aside.sidebar [data-path="메모작/설정집"]')).toBeVisible({ timeout: 10_000 });

  // 칩: 회차 DB
  await (await card(page, '메모작')).getByTestId('work-chip-db').click();
  await expect(page.getByTestId('db-screen')).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('db-screen')).toHaveCount(0);
});

test('920px·영어에서는 축약 문구를 쓰고 긴 작품 이름은 말줄임으로 넘치지 않는다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await setWriter(page, { locale: 'en' });
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await createWork(page, '아주 긴 제목의 작품 이름이 사이드바 폭을 넘는 경우');
  await page.setViewportSize({ width: 900, height: 800 });

  const open = await card(page, '아주 긴 제목의 작품 이름이 사이드바 폭을 넘는 경우');
  await expect(open.getByTestId('new-episode')).toHaveText('+ New episode');
  await expect(open.getByTestId('work-chip-characters')).toHaveText('Characters');
  await expect(open.getByTestId('work-chip-story')).toHaveText('Story bible');
  await expect(open.getByTestId('work-chip-db')).toHaveText('Episode DB');

  const layout = await page.evaluate(() => {
    const sidebar = document.querySelector('aside.sidebar')!;
    const name = document.querySelector('[data-testid="work-open-name"]')!;
    const box = document.querySelector('[data-testid="work-card"]')!.getBoundingClientRect();
    const side = sidebar.getBoundingClientRect();
    return {
      overflow: sidebar.scrollWidth - sidebar.clientWidth,
      cardRight: box.right,
      sideRight: side.right,
      nameClipped: name.scrollWidth > name.clientWidth,
    };
  });
  expect(layout.overflow).toBe(0);
  expect(layout.cardRight).toBeLessThanOrEqual(layout.sideRight);
  expect(layout.nameClipped).toBe(true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await setWriter(page, { locale: 'ko' });
});

test('작가 모드 OFF 에는 작품 영역이 DOM 에 없다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await setWriter(page, { mode: false });
  await expect(page.getByTestId('work-section')).toHaveCount(0);
  await setWriter(page);
  await expect(page.getByTestId('work-section')).toHaveCount(1);
});
