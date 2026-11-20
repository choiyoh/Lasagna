import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { waitForWatcher, writeExternalNote } from './watcher';

// FEAT: 찾기·바꾸기 '조사 맞추기'(⌘F). '유리는' 에서 '유리' → '요한' 이면 '요한은'.
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
  test.setTimeout(300_000);
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

/** 찾기 막대가 열려 있으면 닫는다(연 채 노트를 옮기는 것은 이 기능과 상관없다) */
async function closeFindIfOpen(page: Page): Promise<void> {
  const bar = page.getByTestId('find-bar');
  if ((await bar.count()) === 0) return;
  await bar.getByRole('button', { name: '찾기 닫기' }).click();
  await expect(bar).toHaveCount(0);
}

async function openNote(page: Page, title: string): Promise<void> {
  await closeFindIfOpen(page);
  await page.locator('aside.sidebar').getByRole('button', { name: title, exact: true }).click();
  await expect(page.locator('.ProseMirror h1')).toHaveText(title);
  await page.locator('.ProseMirror p').first().click();
}

/** ⌘F 로 찾기·바꾸기 막대를 열고 찾을 말·바꿀 말을 채운다 */
async function openFind(page: Page, find: string, replace: string) {
  await page.keyboard.press('ControlOrMeta+f');
  const bar = page.getByTestId('find-bar');
  await expect(bar).toBeVisible();
  await bar.getByLabel('찾을 말').fill(find);
  await bar.getByRole('button', { name: '바꾸기 열기' }).click();
  await bar.getByLabel('바꿀 말').fill(replace);
  return bar;
}

/** 편집기로 초점을 옮겨 ⌘Z 한 번을 누른다 */
async function undoOnce(page: Page): Promise<void> {
  await page.locator('.ProseMirror p').first().click();
  await page.keyboard.press('ControlOrMeta+z');
}

const SENTENCE = '유리는 유리가 유리를 유리와 유리로 유리야 유리가게';
const ADJUSTED = '요한은 요한이 요한을 요한과 요한으로 요한야 요한가게';
const KEPT = '요한는 요한가 요한를 요한와 요한로 요한야 요한가게';

test.beforeAll(async () => {
  base = mkdtempSync(path.join(tmpdir(), 'nops-josa-'));
  vaultDir = path.join(base, 'Demo');
  mkdirSync(vaultDir, { recursive: true });
  writeExternalNote(path.join(vaultDir, '조사.md'), `# 조사\n\n${SENTENCE}\n`);
  writeExternalNote(path.join(vaultDir, '서식.md'), '# 서식\n\n**유리**는 밝다\n');
  writeExternalNote(path.join(vaultDir, '끄기.md'), `# 끄기\n\n${SENTENCE}\n`);
  writeExternalNote(path.join(vaultDir, '하나.md'), `# 하나\n\n${SENTENCE}\n`);
  app = await launch();
});

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  if (base) rmSync(base, { recursive: true, force: true });
});

test('모두 바꾸기: 바로 뒤 조사를 새 말의 받침에 맞추고, ⌘Z 한 번으로 전부 돌아온다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await openNote(page, '조사');
  const file = path.join(vaultDir, '조사.md');
  const original = `# 조사\n\n${SENTENCE}\n`;

  const bar = await openFind(page, '유리', '요한');
  await expect(bar.getByLabel('조사 맞추기')).toBeChecked();
  await bar.getByRole('button', { name: '모두 바꾸기' }).click();
  await expect(page.locator('.ProseMirror p').first()).toHaveText(ADJUSTED);
  await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 15_000 }).toBe(`# 조사\n\n${ADJUSTED}\n`);

  await undoOnce(page);
  await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 15_000 }).toBe(original);
});

test('조사 맞추기를 끄면 예전과 똑같이 바꾸고, 끈 상태는 기억한다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await openNote(page, '끄기');
  const file = path.join(vaultDir, '끄기.md');

  const bar = await openFind(page, '유리', '요한');
  const toggle = bar.getByLabel('조사 맞추기');
  await toggle.uncheck();
  await bar.getByRole('button', { name: '모두 바꾸기' }).click();
  await expect(page.locator('.ProseMirror p').first()).toHaveText(KEPT);
  await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 15_000 }).toBe(`# 끄기\n\n${KEPT}\n`);

  // 닫았다 다시 열어도 꺼진 채다(기기 설정). 바꾸기 줄은 접혀서 다시 열어야 보인다
  await bar.getByRole('button', { name: '찾기 닫기' }).click();
  await expect(page.getByTestId('find-bar')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+f');
  await expect(page.getByTestId('find-bar')).toBeVisible();
  await page.getByTestId('find-bar').getByRole('button', { name: '바꾸기 열기' }).click();
  await expect(page.getByTestId('find-bar').getByLabel('조사 맞추기')).not.toBeChecked();
  await page.getByTestId('find-bar').getByLabel('조사 맞추기').check();
  await undoOnce(page);
  await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 15_000 }).toBe(`# 끄기\n\n${SENTENCE}\n`);
});

test('서식을 건 말도 내용·서식이 남는다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await openNote(page, '서식');
  const file = path.join(vaultDir, '서식.md');

  const bar = await openFind(page, '유리', '요한');
  await bar.getByRole('button', { name: '모두 바꾸기' }).click();
  await expect(page.locator('.ProseMirror p').first()).toHaveText('요한은 밝다');
  await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 15_000 }).toBe('# 서식\n\n**요한**은 밝다\n');

  await undoOnce(page);
  await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 15_000 }).toBe('# 서식\n\n**유리**는 밝다\n');
});

test('바꾸기(하나)도 조사를 맞춘다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await openNote(page, '하나');
  const file = path.join(vaultDir, '하나.md');

  const bar = await openFind(page, '유리', '요한');
  await bar.getByRole('button', { name: '바꾸기', exact: true }).click();
  await expect(page.locator('.ProseMirror p').first()).toHaveText(`요한은${SENTENCE.slice(3)}`);
  await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 15_000 }).toBe(`# 하나\n\n요한은${SENTENCE.slice(3)}\n`);

  await undoOnce(page);
  await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 15_000 }).toBe(`# 하나\n\n${SENTENCE}\n`);
});
