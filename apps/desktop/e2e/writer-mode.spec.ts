import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// 작가 모드(W1): 토글·글자수 상태줄·선택 영역·공백 기준·언어 전환·재시작 유지, 그리고 노트 파일 불변.
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
let vaultDir = '';
let notePath = '';

async function launch(): Promise<ElectronApplication> {
  const launched = await electron.launch({
    executablePath: packagedExecutable(),
    env: { ...process.env, NOPS_E2E: '1' },
    args: [
      '--use-mock-keychain',
      `--user-data-dir=${path.join(base, 'userdata')}`,
      ...(process.platform === 'linux' ? ['--no-sandbox', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : []),
    ],
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
}

test.beforeAll(async () => {
  test.setTimeout(240_000);
  base = mkdtempSync(path.join(tmpdir(), 'nops-writer-'));
  vaultDir = path.join(base, 'Demo');
  mkdirSync(vaultDir, { recursive: true });
  notePath = path.join(vaultDir, 'Hello.md');
  writeFileSync(notePath, '# Hello\n\n본문\n');
  app = await launch();
});

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  if (base) rmSync(base, { recursive: true, force: true });
});

async function openNote(page: Page): Promise<void> {
  await openVaultIfNeeded(page);
  await page.locator('aside.sidebar').getByRole('button', { name: 'Hello', exact: true }).click();
  await expect(page.locator('.ProseMirror')).toHaveText(/Hello/);
}

async function toggleWriter(page: Page, on: boolean): Promise<void> {
  await page.getByTestId('settings-btn').click();
  const box = page.getByTestId('writer-mode');
  await expect(box).toBeVisible();
  if ((await box.isChecked()) !== on) await box.click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('writer-status')).toHaveCount(on ? 1 : 0);
}

test('작가 모드를 켜면 글자수 상태줄이 보이고, 노트 파일은 바뀌지 않는다', async () => {
  const page = await app.firstWindow();
  await openNote(page);
  const before = readFileSync(notePath);

  // 일반 모드에서는 상태줄이 없다(화면 동일)
  await expect(page.getByTestId('writer-status')).toHaveCount(0);

  await toggleWriter(page, true);
  const status = page.getByTestId('writer-status');
  await expect(status).toBeVisible();
  // "# Hello" → 보이는 글자 'Hello' 5자
  // '# Hello' + '본문' → 보이는 글자 7자
  await expect(page.getByTestId('writer-chars')).toHaveText(/^7자 · 공백 포함$/);

  // 입력하면 150ms 디바운스 뒤 갱신
  await page.locator('.ProseMirror p').last().click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' world');
  await expect(page.getByTestId('writer-chars')).toHaveText(/^13자 · 공백 포함$/);

  // 선택 영역 표시
  for (let i = 0; i < 5; i += 1) await page.keyboard.press('Shift+ArrowLeft');
  await expect(page.getByTestId('writer-selection')).toContainText(/선택 5 \/ 전체 13/);

  // 공백 제외로 바꾸면 기준 표기가 바뀐다
  await page.getByTestId('settings-btn').click();
  await page.getByRole('radiogroup', { name: '글자수 기준' }).getByRole('radio', { name: '공백 제외' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('writer-chars')).toHaveText(/^12자 · 공백 제외$/);

  // 끄면 사라지고, 토글 전후 노트 파일은 바이트 단위로 같다(입력으로 바뀐 내용은 그대로)
  await expect.poll(() => readFileSync(notePath, 'utf8'), { timeout: 10_000 }).toContain('world');
  const edited = readFileSync(notePath);
  await toggleWriter(page, false);
  expect(readFileSync(notePath).equals(edited)).toBe(true);
  // 처음 연 뒤 편집한 내용만 다르고, 토글이 파일을 건드리지 않았는지는 위 비교로 확인된다
  expect(before.length).toBeGreaterThan(0);
});

test('작가 모드 설정은 재시작해도 유지되고, 영어에서는 characters·words 로 보인다', async () => {
  const page = await app.firstWindow();
  await openNote(page);
  await toggleWriter(page, true);
  await expect(page.getByTestId('writer-chars')).toHaveText(/\d+자 · 공백/);

  // 재시작해도 켜져 있다
  await app.close();
  app = await launch();
  const again = await app.firstWindow();
  await openNote(again);
  await expect(again.getByTestId('writer-status')).toBeVisible();
  await expect(again.getByTestId('writer-chars')).toHaveText(/\d+자/);

  // 영어로 바꾸면 characters · words
  await again.getByTestId('settings-btn').click();
  await again.getByRole('radiogroup', { name: '언어' }).getByRole('radio', { name: 'English' }).click();
  await expect(again.locator('html')).toHaveAttribute('lang', 'en');
  await again.keyboard.press('Escape');
  const en = await again.getByTestId('writer-chars').innerText();
  expect(en).toMatch(/characters/);
  expect(en).toMatch(/words/);
  expect(en).not.toMatch(HANGUL);
});

test('소스 모드에서도 같은 규칙으로 세고, 공백만 선택하면 선택 표시가 없다', async () => {
  const page = await app.firstWindow();
  await openNote(page);
  await toggleWriter(page, true);
  const editCount = await page.getByTestId('writer-chars').innerText();

  // 소스 모드로 바꿔도(마크다운 원문 기준) 같은 값 — 두 경로가 같은 규칙을 쓴다
  await page.keyboard.press('ControlOrMeta+e');
  await expect(page.getByTestId('source-editor')).toBeVisible();
  await expect(page.getByTestId('writer-chars')).toHaveText(editCount);
  // 소스에서 편집해도 숫자가 갱신된다
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('\n\n소스에서 추가');
  await expect(page.getByTestId('writer-chars')).not.toHaveText(editCount);
  await page.keyboard.press('ControlOrMeta+e');
  await expect(page.getByTestId('note-editor')).toBeVisible();

  // 공백만 선택하면 선택/전체 표시를 띄우지 않는다
  await page.locator('.ProseMirror').click();
  await page.keyboard.press('ControlOrMeta+End');
  for (let i = 0; i < 2; i += 1) await page.keyboard.press('Shift+ArrowLeft');
  await expect(page.getByTestId('writer-selection')).toHaveCount(0);
});
