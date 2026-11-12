import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import {mkdirSync, mkdtempSync, rmSync} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { waitForWatcher, writeExternalNote } from './watcher';

// L2a 영어 스모크: 영어로 전환한 뒤 이번에 번역한 화면들이 한글 없이 뜨는지 확인한다.
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

async function launch(): Promise<ElectronApplication> {
  test.setTimeout(240_000);
  const candidate = await electron.launch({
    executablePath: packagedExecutable(),
    env: { ...process.env, NOPS_E2E: '1' },
    args: [
      '--use-mock-keychain',
      `--user-data-dir=${userData}`,
      ...(process.platform === 'linux' ? ['--no-sandbox', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : []),
    ],
  });
  await candidate.firstWindow({ timeout: 90_000 });
  await candidate.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dir] })) as typeof dialog.showOpenDialog;
  }, vaultDir);
  return candidate;
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

test.beforeAll(async () => {
  base = mkdtempSync(path.join(tmpdir(), 'nops-l2a-'));
  userData = path.join(base, 'userdata');
  vaultDir = path.join(base, 'vault');
  mkdirSync(vaultDir, { recursive: true });
  writeExternalNote(path.join(vaultDir, 'Hello.md'), '# Hello\n\nSee [[Other]].\n');
  writeExternalNote(path.join(vaultDir, 'Other.md'), '# Other\n');
  app = await launch();
});

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  if (base) rmSync(base, { recursive: true, force: true });
});

test('English smoke: shortcuts, links panel, find bar, and switcher have no Korean left', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);

  // 영어로 전환
  await page.getByTestId('settings-btn').click();
  await page.getByRole('radiogroup', { name: '언어' }).getByRole('radio', { name: 'English' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.keyboard.press('Escape');
  await expect(page.locator('aside.sidebar').getByRole('button', { name: /New note/ })).toBeVisible();

  // 노트를 열어 오른쪽 도크를 쓴다
  await page.locator('aside.sidebar').getByRole('button', { name: 'Hello', exact: true }).click();
  await expect(page.locator('.ProseMirror h1')).toHaveText('Hello');

  // 1) 단축키 목록 (F1)
  await page.keyboard.press('F1');
  const shortcuts = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(shortcuts).toBeVisible();
  await expect(shortcuts).toContainText('Move');
  await expect(shortcuts).toContainText('Note');
  await expect(shortcuts).toContainText('Edit');
  expect(await shortcuts.innerText()).not.toMatch(HANGUL);
  await page.keyboard.press('Escape');
  await expect(shortcuts).toHaveCount(0);

  // 2) 링크 패널 (도크 레일)
  const rail = page.locator('.rightdock__rail');
  if (await rail.isVisible()) await rail.click();
  const linkPanel = page.locator('.linkpanel');
  await expect(linkPanel).toBeVisible();
  await expect(linkPanel.getByRole('tab', { name: /Backlinks/ })).toBeVisible();
  await expect(linkPanel.getByRole('tab', { name: /Outgoing links/ })).toBeVisible();
  await expect(linkPanel.getByRole('tab', { name: /Unlinked mentions/ })).toBeVisible();
  expect(await linkPanel.innerText()).not.toMatch(HANGUL);

  // 3) 노트 안 찾기 (⌘F)
  await page.keyboard.press('ControlOrMeta+f');
  const findbar = page.locator('.findbar');
  await expect(findbar).toBeVisible();
  await expect(findbar.getByPlaceholder('Find in note')).toBeVisible();
  expect(await findbar.innerText()).not.toMatch(HANGUL);
  await page.keyboard.press('Escape');

  // 4) 동기화 대화상자 (팔레트에서 열기)
  await page.keyboard.press('ControlOrMeta+p');
  const palette = page.getByTestId('command-palette');
  await expect(palette).toBeVisible();
  await palette.getByRole('option', { name: /Google Drive sync/ }).click();
  const sync = page.locator('.dialog.syncdialog');
  await expect(sync).toBeVisible();
  await expect(sync.getByRole('heading', { name: 'Google Drive sync' })).toBeVisible();
  expect(await sync.innerText()).not.toMatch(HANGUL);
  await page.keyboard.press('Escape');
  await expect(sync).toHaveCount(0);

  // 5) 빠른 전환기 (⌘O)
  await page.keyboard.press('ControlOrMeta+o');
  const switcher = page.getByRole('dialog', { name: 'Quick switcher' });
  await expect(switcher).toBeVisible();
  await expect(switcher.getByPlaceholder('Search note titles and text')).toBeVisible();
  expect(await switcher.innerText()).not.toMatch(HANGUL);
  await page.keyboard.press('Escape');

  // 6) 독 탭: 댓글 수가 붙어도 영어에서 잘리지 않는다(줄바꿈 허용, 라벨 자르지 않음)
  const commentsTab = page.locator('.dockbody__tabs').getByRole('tab', { name: /Comments/ });
  await commentsTab.click();
  const box = page.locator('.comments textarea');
  await box.fill('Nice note');
  await page.locator('.comments__bar').getByRole('button', { name: 'Comment' }).click();
  await expect(page.locator('.dockbody__tabs').getByRole('tab', { name: 'Comments 1' })).toBeVisible();
  for (const [w, h] of [[920, 760], [1440, 900]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(200);
    const m = await page.evaluate(() => {
      const row = document.querySelector('.dockbody__tabs') as HTMLElement;
      const tabs = [...row.querySelectorAll('button')] as HTMLElement[];
      const rowRect = row.getBoundingClientRect();
      return {
        overflow: row.scrollWidth - row.clientWidth,
        clipped: tabs.filter((el) => {
          const r = el.getBoundingClientRect();
          return r.right > rowRect.right + 1 || el.scrollWidth > el.clientWidth + 1 || r.width === 0;
        }).map((el) => el.textContent),
        history: tabs.find((el) => el.textContent === 'History')?.getBoundingClientRect().right ?? null,
        rowRight: rowRect.right,
      };
    });
    expect(m.overflow).toBeLessThanOrEqual(0);
    expect(m.clipped).toEqual([]);
    expect(m.history).not.toBeNull();
    expect((m.history ?? 0) <= m.rowRight + 1).toBe(true);
  }
});
