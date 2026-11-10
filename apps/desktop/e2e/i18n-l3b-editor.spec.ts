import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import {chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { waitForWatcher, writeExternalNote } from './watcher';

// L3b(에디터) 영어 스모크: '/' 메뉴·블록 핸들 메뉴·날짜 멘션·프롬프트 버튼에 한글이 남지 않는지 확인한다.
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
  base = mkdtempSync(path.join(tmpdir(), 'nops-l3b-editor-'));
  userData = path.join(base, 'userdata');
  vaultDir = path.join(base, 'vault');
  mkdirSync(vaultDir, { recursive: true });
  writeExternalNote(path.join(vaultDir, 'Hello.md'), '# Hello\n\none\n\ntwo\n');
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

test('English smoke: switching language while editing keeps the draft and localizes the menus @foreground', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);

  // 한국어 상태로 노트를 연다(에디터는 이때 언어 문구를 잡는다)
  await page.locator('aside.sidebar').getByRole('button', { name: 'Hello', exact: true }).click();
  const editor = page.locator('.ProseMirror');
  await expect(editor).toHaveText(/Hello/);

  // 저장 전 편집을 남겨 둔다
  await page.locator('.ProseMirror p').last().click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' 저장 전 문장');

  // 에디터를 연 채로 언어를 바꾼다(설정에서 전환, reload 없음)
  await page.getByTestId('settings-btn').click();
  await page.getByRole('radiogroup', { name: '언어' }).getByRole('radio', { name: 'English' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.keyboard.press('Escape');
  await expect(editor).toHaveText(/저장 전 문장/);

  // 1) '/' 메뉴: 항목 라벨·설명이 영어다
  await page.locator('.ProseMirror p').last().click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/');
  const items = page.locator('.oh-editor__slash-item');
  await expect(items.first()).toBeVisible();
  const slashText = (await items.allInnerTexts()).join('\n');
  expect(slashText).toContain('Callout');
  expect(slashText).toContain('Toggle heading 1');
  expect(slashText).toContain('Table of contents');
  expect(slashText).not.toMatch(HANGUL);
  await page.keyboard.press('Escape');

  // 2) 블록 핸들 메뉴: 복제·이동·삭제·바꾸기가 영어다
  await editor.locator('p', { hasText: 'one' }).hover();
  await expect(page.locator('.nops-handle')).toBeVisible();
  await expect(page.locator('.nops-handle__grip')).toHaveAttribute('title', 'Drag to move · click for menu');
  await expect(page.locator('.nops-handle__add')).toHaveAttribute('title', 'Add block below');
  await page.locator('.nops-handle__grip').click();
  const blockMenu = page.locator('.nops-block-menu');
  await expect(blockMenu).toBeVisible();
  await expect(blockMenu).toContainText('Duplicate');
  await expect(blockMenu).toContainText('Turn into');
  await expect(blockMenu).toContainText('Delete');
  expect(await blockMenu.innerText()).not.toMatch(HANGUL);
  await page.keyboard.press('Escape');

  // 3) 날짜 멘션: 후보 이름이 영어이고 요일은 Intl 표기다
  await editor.locator('p').last().click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' @to');
  const dateMenu = page.locator('.nops-date-suggest');
  await expect(dateMenu).toBeVisible({ timeout: 5000 });
  await expect(dateMenu).toContainText('Tomorrow');
  expect(await dateMenu.innerText()).not.toMatch(HANGUL);
  await page.keyboard.press('Escape');

  // 전환 전에 입력한 문장이 저장되어 남는다(미저장 편집 보존)
  await expect.poll(() => readFileSync(path.join(vaultDir, 'Hello.md'), 'utf8'), { timeout: 10_000 }).toContain('저장 전 문장');

});

test('소스 모드에서 언어를 바꿔도 빈 화면이 되지 않는다', async () => {
  const page = await app.firstWindow();
  // 앞 테스트(@foreground)가 제외돼도 단독으로 돌 수 있게 볼트를 직접 연다
  await openVaultIfNeeded(page);
  await page.locator('aside.sidebar').getByRole('button', { name: 'Hello', exact: true }).click();
  await expect(page.locator('.ProseMirror')).toHaveText(/Hello/);

  // 앞 테스트가 제외돼도 결정적이도록 언어를 먼저 한국어로 맞춘다(UI 문구에 의존하지 않는다).
  await page.evaluate(() => window.nops.settings.setLanguage({ language: 'ko' }));
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
  await page.locator('.ProseMirror').click();
  await page.keyboard.press('ControlOrMeta+e');
  await expect(page.locator('.cm-content')).toBeVisible();

  await page.getByTestId('settings-btn').click();
  await page.getByRole('radiogroup', { name: '언어' }).getByRole('radio', { name: 'English' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.keyboard.press('Escape');

  // 편집 모드로 돌아와 내용이 그대로 있고, 토글로 소스 모드에 다시 들어갈 수 있다
  await expect(page.locator('.ProseMirror')).toHaveText(/Hello/);
  await page.getByRole('button', { name: 'Source mode' }).click();
  await expect(page.locator('.cm-content')).toContainText('Hello');
  await expect(page.locator('.cm-content')).not.toHaveText('');
  await page.getByRole('button', { name: 'Edit mode' }).click();
  await expect(page.locator('.ProseMirror')).toHaveText(/Hello/);
});

test('저장이 실패하면 언어를 바꿔도 미저장 편집을 잃지 않는다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await page.locator('aside.sidebar').getByRole('button', { name: 'Hello', exact: true }).click();
  const editor = page.locator('.ProseMirror');
  await expect(editor).toHaveText(/Hello/);

  await page.locator('.ProseMirror p').last().click();
  await page.keyboard.press('ControlOrMeta+End');

  // 볼트 폴더를 먼저 읽기 전용으로 만든 뒤 입력해야 자동 저장이 성공하지 않는다
  chmodSync(vaultDir, 0o555);
  try {
    await page.keyboard.type(' 저장 실패 초안');
    await page.getByTestId('settings-btn').click();
    await page.getByRole('radiogroup', { name: /Language|언어/ }).getByRole('radio', { name: '한국어' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
    await page.keyboard.press('Escape');
    // 저장에 실패했으므로 에디터를 다시 만들지 않는다 — 초안이 화면에 그대로 남는다
    await page.waitForTimeout(1200);
    await expect(page.locator('.ProseMirror')).toHaveText(/저장 실패 초안/);
  } finally {
    chmodSync(vaultDir, 0o755);
  }
  // 디스크가 다시 쓰이면 다음 저장은 성공한다
  await page.locator('.ProseMirror p').last().click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('!');
  await expect.poll(() => readFileSync(path.join(vaultDir, 'Hello.md'), 'utf8'), { timeout: 10_000 }).toContain('저장 실패 초안!');
});

test('설정에서 언어를 바꿔도 대화상자 포커스를 훔치지 않고, 에디터에서 바꾸면 커서 자리에서 이어 쓴다 @foreground', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await page.locator('aside.sidebar').getByRole('button', { name: 'Hello', exact: true }).click();
  const editor = page.locator('.ProseMirror');
  await expect(editor).toHaveText(/Hello/);

  // 1) 설정 대화상자에서 언어를 바꾸면 라디오가 포커스를 유지한다(에디터가 훔치지 않음)
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' 설정');
  await page.getByTestId('settings-btn').click();
  const english = page.getByRole('radiogroup', { name: /Language|언어/ }).getByRole('radio', { name: 'English' });
  await english.click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(editor).toHaveText(/설정/);
  const focused = await page.evaluate(() => {
    const el = document.activeElement as HTMLInputElement | null;
    return {
      inDialog: !!el?.closest('[role="dialog"]'),
      isRadio: el?.tagName === 'INPUT' && el?.type === 'radio',
      inEditor: !!el?.classList.contains('ProseMirror'),
    };
  });
  // 설정에서 라디오를 고른 직후에도 포커스는 대화상자 안(라디오 또는 그 주변)에 남아 있어야 한다
  expect(focused.inDialog).toBe(true);
  expect(focused.inEditor).toBe(false);
  expect(focused.isRadio || focused.inDialog).toBe(true);
  await page.keyboard.press('Escape');

  // 2) 에디터에 포커스가 있는 채로 언어가 바뀌면(단축키·팔레트 등 같은 경로) 커서를 되돌려 바로 이어 쓸 수 있다
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' 직접');
  await expect(editor).toHaveText(/직접/);
  await page.evaluate(() => window.nops.settings.setLanguage({ language: 'ko' }));
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
  await expect(editor).toHaveText(/직접/);
  // 에디터에 포커스가 있던 채로 바뀌었으니 재생성 뒤에도 포커스·커서가 복원된다
  await expect(editor).toBeFocused({ timeout: 5000 });
  // 다시 클릭하지 않고 입력해도 복원된 커서(끝)에 이어진다
  await page.keyboard.type(' 이어');
  await expect.poll(() => readFileSync(path.join(vaultDir, 'Hello.md'), 'utf8'), { timeout: 10_000 }).toMatch(/직접 이어/);
});
