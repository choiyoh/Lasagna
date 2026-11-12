import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { waitForWatcher, writeExternalNote } from './watcher';

// UX-1a: 사이드바 정리(머리줄 `＋`·`⋯`, 통합 검색 팝업, 맨 아래 아이콘 줄).
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

const switcherTitle = '빠른 전환기';

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

async function setWriter(page: Page, on: boolean): Promise<void> {
  await page.evaluate((mode) => window.nops.settings.setLanguage({ language: 'ko', writerMode: mode, writerSpacing: 'include' }), on);
}

const switcher = (page: Page) => page.getByRole('dialog', { name: switcherTitle });

test.beforeAll(async () => {
  base = mkdtempSync(path.join(tmpdir(), 'nops-ux1a-'));
  vaultDir = path.join(base, 'vault');
  mkdirSync(vaultDir, { recursive: true });
  writeExternalNote(path.join(vaultDir, 'Hello.md'), '# Hello\n\n본문고유낱말이 들어 있다\n');
  writeExternalNote(path.join(vaultDir, '메모.md'), '# 메모\n\n짧은 메모\n');
  app = await launch();
  await openVaultIfNeeded(await app.firstWindow());
});

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  if (base) rmSync(base, { recursive: true, force: true });
});

test('머리줄: ＋ 로 새 노트를 만들고, ⋯ 메뉴는 7개 항목·↑↓·Esc 포커스 복귀가 된다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);

  // ＋(새 노트)
  await page.getByTestId('sidebar-new-note').click();
  await expect.poll(() => existsSync(path.join(vaultDir, '제목 없음.md')), { timeout: 15000 }).toBe(true);
  await expect(page.locator('.ProseMirror h1.nops-empty-title')).toBeVisible({ timeout: 15000 });
  await page.keyboard.press('ControlOrMeta+w');

  // ⋯ 메뉴: 항목 7개(새 폴더·오늘·그래프·휴지통·동기화·내보내기·볼트 바꾸기)
  const more = page.getByTestId('sidebar-more');
  await more.click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  for (const name of [/새 폴더/, /오늘의 노트/, /그래프/, /휴지통/, /Google Drive 동기화/, /HTML 사이트로 내보내기/, /다른 볼트 열기/]) {
    await expect(menu.getByRole('menuitem', { name })).toBeVisible();
  }
  await expect(menu.getByRole('menuitem')).toHaveCount(7);

  // 처음 항목에 초점, ↓ 로 다음, Esc 로 닫고 초점은 연 버튼으로 돌아온다
  await expect(menu.getByRole('menuitem', { name: /새 폴더/ })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: /오늘의 노트/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(more).toBeFocused();
  await expect(more).toHaveAttribute('aria-expanded', 'false');

  // 메뉴 항목이 실제 동작으로 이어진다(동기화 대화상자)
  await more.click();
  await page.getByRole('menuitem', { name: /동기화/ }).click();
  const sync = page.getByRole('dialog', { name: 'Google Drive 동기화' });
  await expect(sync).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sync).toHaveCount(0);
});

test('통합 검색 팝업: ⌘O 로 제목 열기·만들기, ⌘Enter 새 탭, ⌘⇧F 로 본문 결과', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);

  // ⌘O → 전체 칩, 제목 일치를 Enter 로 연다
  await page.keyboard.press('ControlOrMeta+o');
  const popup = switcher(page);
  await expect(popup).toBeVisible();
  await expect(popup.getByTestId('quick-chip-all')).toHaveAttribute('aria-pressed', 'true');
  const input = popup.getByPlaceholder(/노트 이름·별칭/);
  await input.fill('메모');
  await expect(page.locator('.switcher__item.is-active')).toContainText('메모');
  await page.keyboard.press('Enter');
  await expect(popup).toHaveCount(0);
  await expect(page.locator('.ProseMirror h1')).toHaveText('메모');

  // ⌘Enter 는 새 탭으로 연다
  await page.keyboard.press('ControlOrMeta+o');
  await input.fill('Hello');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(popup).toHaveCount(0);
  await expect(page.locator('.ProseMirror h1')).toHaveText('Hello');
  await expect(page.getByTestId('note-tab')).toHaveCount(2);

  // 제목 일치가 없으면 만들기 행이 기본 선택 — Enter 로 새 노트
  await page.keyboard.press('ControlOrMeta+o');
  await input.fill('팝업으로 만든 노트');
  await expect(page.locator('.switcher__item.is-active')).toContainText('새 노트 만들기');
  await page.keyboard.press('Enter');
  await expect.poll(() => existsSync(path.join(vaultDir, '팝업으로 만든 노트.md')), { timeout: 15000 }).toBe(true);

  // Esc: 입력 지우기 → 다시 누르면 닫기
  await page.keyboard.press('ControlOrMeta+o');
  await input.fill('Hello');
  await page.keyboard.press('Escape');
  await expect(input).toHaveValue('');
  await expect(popup).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(popup).toHaveCount(0);

  // ⌘⇧F → 본문 칩, 색인 결과에서 Enter 로 연다
  await page.keyboard.press('ControlOrMeta+Shift+F');
  await expect(popup).toBeVisible();
  await expect(popup.getByTestId('quick-chip-body')).toHaveAttribute('aria-pressed', 'true');
  await input.fill('본문고유낱말');
  const bodyHit = popup.getByRole('option', { name: /Hello/ });
  await expect(bodyHit).toBeVisible({ timeout: 15000 });
  await expect(bodyHit).toContainText('본문고유낱');
  await page.keyboard.press('Enter');
  await expect(popup).toHaveCount(0);
  await expect(page.locator('.ProseMirror h1')).toHaveText('Hello');
});

test('맨 아래: 휴지통·테마·설정이 한 줄 아이콘 버튼이고 testid·동작이 그대로다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  const foot = page.locator('.sidebar__foot');
  await expect(foot).toBeVisible();
  // 높이는 기존과 같고, 세 버튼이 28×28 로 한 줄에 온다
  expect(Math.round((await foot.boundingBox())!.height)).toBe(36);
  for (const id of ['trash-btn', 'theme-toggle', 'settings-btn']) {
    const box = await page.getByTestId(id).boundingBox();
    expect(box!.width).toBe(28);
    expect(box!.height).toBe(28);
    expect(Math.abs(box!.y + box!.height / 2 - ((await foot.boundingBox())!.y + 18))).toBeLessThanOrEqual(1);
  }

  await page.getByTestId('trash-btn').click();
  const trash = page.getByRole('dialog', { name: '휴지통' });
  await expect(trash).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(trash).toHaveCount(0);

  // 테마: aria-label 이 현재 테마를 보이고, 아이콘만 있어도 이름은 title·aria-label 에 남는다
  const theme = page.getByTestId('theme-toggle');
  await expect(theme).toHaveAttribute('aria-label', /^테마 /);
  await expect(theme).toHaveAttribute('title', /테마 바꾸기/);
  const before = await theme.getAttribute('aria-label');
  await theme.click();
  await expect(theme).not.toHaveAttribute('aria-label', before!);

  await page.getByTestId('settings-btn').click();
  await expect(page.getByRole('dialog', { name: '설정' })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('집중 모드에서도 ⌘O·⌘⇧F 가 통합 검색 팝업을 연다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await setWriter(page, true);
  await page.locator('aside.sidebar').getByRole('button', { name: 'Hello', exact: true }).first().click();
  await page.keyboard.press('ControlOrMeta+Shift+M');
  await expect(page.getByTestId('workspace')).toHaveClass(/workspace--focus/);
  // 집중 모드에서는 사이드바가 숨는다
  await expect(page.locator('aside.sidebar')).toBeHidden();

  await page.keyboard.press('ControlOrMeta+o');
  await expect(switcher(page)).toBeVisible();
  await expect(switcher(page).getByTestId('quick-chip-all')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');

  await page.keyboard.press('ControlOrMeta+Shift+F');
  await expect(switcher(page)).toBeVisible();
  await expect(switcher(page).getByTestId('quick-chip-body')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(switcher(page)).toHaveCount(0);
  // 팝업을 닫은 뒤에도 집중 모드는 그대로다
  await expect(page.getByTestId('workspace')).toHaveClass(/workspace--focus/);

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('workspace')).not.toHaveClass(/workspace--focus/);
  await setWriter(page, false);
});

test('920px 에서는 검색 버튼 문구가 줄고 단축키 힌트가 숨으며 머리줄·버튼이 겹치지 않는다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await page.setViewportSize({ width: 900, height: 800 });
  const search = page.getByTestId('sidebar-search');
  await expect(search).toContainText('노트·본문 검색');
  await expect(search.locator('kbd')).toHaveCount(0);
  const layout = await page.evaluate(() => {
    const rect = (el: Element | null) => {
      const b = el?.getBoundingClientRect();
      return b ? { x: b.x, y: b.y, w: b.width, h: b.height, right: b.right } : null;
    };
    const side = rect(document.querySelector('aside.sidebar'));
    const head = rect(document.querySelector('aside.sidebar header'));
    const box = rect(document.querySelector('[data-testid="sidebar-search"]'));
    const plus = rect(document.querySelector('[data-testid="sidebar-new-note"]'));
    const more = rect(document.querySelector('[data-testid="sidebar-more"]'));
    return { side, head, box, plus, more, vw: window.innerWidth, scroll: document.documentElement.scrollWidth };
  });
  expect(layout.scroll).toBeLessThanOrEqual(layout.vw);
  expect(layout.box!.right).toBeLessThanOrEqual(layout.side!.right);
  expect(layout.plus!.right).toBeLessThanOrEqual(layout.more!.x);
  expect(layout.more!.right).toBeLessThanOrEqual(layout.side!.right);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(search).toContainText('노트 찾기 · 본문 검색');
});
