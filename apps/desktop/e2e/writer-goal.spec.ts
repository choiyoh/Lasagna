import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// 작가 모드(W1b): 문서 목표(노트 속성 goal_chars)·진행 막대·오늘 쓴 글자수(userData 통계)·일일 목표.
// 노트 파일은 '목표를 정하는 순간'에만 바뀌고, 통계는 볼트·노트에 기록하지 않는다.
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
let userDataDir = '';

async function launch(): Promise<ElectronApplication> {
  const launched = await electron.launch({
    executablePath: packagedExecutable(),
    env: { ...process.env, NOPS_E2E: '1' },
    args: [
      '--use-mock-keychain',
      `--user-data-dir=${userDataDir}`,
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

async function openNote(page: Page, name: string): Promise<void> {
  await openVaultIfNeeded(page);
  await page.locator('aside.sidebar').getByRole('button', { name, exact: true }).click();
  await expect(page.locator('.ProseMirror')).toBeVisible();
}

async function toggleWriter(page: Page, on: boolean): Promise<void> {
  await page.getByTestId('settings-btn').click();
  const box = page.getByTestId('writer-mode');
  await expect(box).toBeVisible();
  if ((await box.isChecked()) !== on) await box.click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('writer-status')).toHaveCount(on ? 1 : 0);
}

test.beforeAll(async () => {
  test.setTimeout(240_000);
  base = mkdtempSync(path.join(tmpdir(), 'nops-goal-'));
  vaultDir = path.join(base, 'Demo');
  userDataDir = path.join(base, 'userdata');
  mkdirSync(vaultDir, { recursive: true });
  writeFileSync(path.join(vaultDir, 'Hello.md'), '# Hello\n\n본문\n');
  writeFileSync(path.join(vaultDir, 'Swap.md'), '# Swap\n\n처음\n');
  writeFileSync(path.join(vaultDir, 'NoFm.md'), '# 제목\n\n본문 문장\n');
  writeFileSync(path.join(vaultDir, 'Crlf.md'), '---\r\ntitle: CRLF\r\n---\r\n# 제목\r\n\r\n본문\r\n');
  writeFileSync(
    path.join(vaultDir, 'Mixed.md'),
    '# Mixed\n\n가 [[노트|별칭]] 나\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n![그림](a.png)\n\n```ts\nconst a = 1;\n```\n\n> [!note] 콜아웃\n> 내용\n',
  );
  app = await launch();
});

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  if (base) rmSync(base, { recursive: true, force: true });
});

test('목표가 없으면 "목표 설정" 이 보이고, 설정하면 노트 속성에만 저장된다', async () => {
  const page = await app.firstWindow();
  await openNote(page, 'Hello');
  await toggleWriter(page, true);
  await expect(page.getByTestId('writer-goal-set')).toBeVisible();
  await expect(page.getByTestId('writer-today')).toContainText(/오늘/);
  const before = readFileSync(path.join(vaultDir, 'Hello.md'), 'utf8');

  await page.getByTestId('writer-goal-set').click();
  await page.getByTestId('writer-goal-input').fill('5000');
  await page.getByTestId('writer-goal-save').click();
  await expect(page.getByTestId('writer-goal-text')).toContainText('/5,000자');
  const after = readFileSync(path.join(vaultDir, 'Hello.md'), 'utf8');
  expect(after).toBe(`---\ngoal_chars: 5000\n---\n${before}`);
});

test('목표를 정할 때만 파일이 바뀐다(토글·표시만으로는 바뀌지 않는다)', async () => {
  const page = await app.firstWindow();
  await openNote(page, 'NoFm');
  const file = path.join(vaultDir, 'NoFm.md');
  const before = readFileSync(file, 'utf8');
  const stamp = statSync(file).mtimeMs;
  await toggleWriter(page, true);
  await expect(page.getByTestId('writer-chars')).toHaveText(/자/);
  await page.waitForTimeout(500);
  expect(readFileSync(file, 'utf8')).toBe(before);
  expect(statSync(file).mtimeMs).toBe(stamp);
});

test('위키·표·이미지·코드가 든 문서도 목표 저장 후 본문 바이트가 그대로다', async () => {
  const page = await app.firstWindow();
  await openNote(page, 'Mixed');
  const file = path.join(vaultDir, 'Mixed.md');
  const before = readFileSync(file, 'utf8');
  await toggleWriter(page, true);
  await page.getByTestId('writer-goal-set').click();
  await page.getByTestId('writer-goal-input').fill('1200');
  await page.getByTestId('writer-goal-save').click();
  await expect(page.getByTestId('writer-goal-text')).toContainText('/1,200자');
  const after = readFileSync(file, 'utf8');
  expect(after.startsWith('---\ngoal_chars: 1200\n---\n')).toBe(true);
  expect(after.slice(after.indexOf('---\n', 4) + 4)).toBe(before); // 본문은 한 바이트도 다르지 않다
});

test('CRLF·frontmatter 없는 노트도 목표 저장이 줄바꿈을 망가뜨리지 않는다', async () => {
  const page = await app.firstWindow();
  await openNote(page, 'Crlf');
  const file = path.join(vaultDir, 'Crlf.md');
  await toggleWriter(page, true);
  await page.getByTestId('writer-goal-set').click();
  await page.getByTestId('writer-goal-input').fill('800');
  await page.getByTestId('writer-goal-save').click();
  const after = readFileSync(file, 'utf8');
  expect(after).toContain('goal_chars: 800');
  expect(after.replace(/\\r\\n/g, '')).not.toContain('\\n'); // 모든 줄바꿈이 CRLF 로 유지
});

test('목표 해제: 입력을 비우면 속성이 지워지고 "목표 설정" 으로 돌아간다', async () => {
  const page = await app.firstWindow();
  await openNote(page, 'Hello');
  await expect(page.getByTestId('writer-goal-text')).toContainText('/5,000자');
  await page.getByTestId('writer-goal-edit').click();
  await page.getByTestId('writer-goal-input').fill('');
  await page.getByTestId('writer-goal-save').click();
  await expect(page.getByTestId('writer-goal-set')).toBeVisible();
  expect(readFileSync(path.join(vaultDir, 'Hello.md'), 'utf8')).not.toContain('goal_chars');
});

test('입력하면 오늘 쓴 글자수가 늘고, 삭제로 줄어도 0 미만으로 내려가지 않는다', async () => {
  const page = await app.firstWindow();
  await openNote(page, 'Swap');
  await toggleWriter(page, true);
  const readToday = async () => Number((await page.getByTestId('writer-today').innerText()).replace(/[^0-9]/g, ''));
  const start = await readToday();
  await page.locator('.ProseMirror').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('오늘 쓴 문장');
  await expect.poll(readToday, { timeout: 10_000 }).toBe(start + 6);
  for (let i = 0; i < 20; i += 1) await page.keyboard.press('Backspace');
  await expect.poll(readToday, { timeout: 10_000 }).toBe(0);
});

test('앱을 다시 켜도 목표·오늘 쓴 글자수가 그대로 보인다', async () => {
  await app.close();
  app = await launch();
  const page = await app.firstWindow();
  await openNote(page, 'Hello');
  await expect(page.getByTestId('writer-status')).toHaveCount(1); // 작가 모드 유지
  await expect(page.getByTestId('writer-today')).toContainText(/오늘/);
  // 목표는 노트 속성에서 읽는다(앱 재시작·노트 열기 경로)
  writeFileSync(path.join(vaultDir, 'Hello.md'), '---\ngoal_chars: 5000\n---\n# Hello\n\n본문\n');
  await expect(page.getByTestId('writer-goal-text')).toContainText('/5,000자');
});

test('다른 노트로 전환해도 그 노트의 목표·현재 값으로 바뀐다', async () => {
  const page = await app.firstWindow();
  await openNote(page, 'Mixed');
  await expect(page.getByTestId('writer-goal-text')).toContainText('/1,200자');
  await openNote(page, 'NoFm');
  await expect(page.getByTestId('writer-goal-set')).toBeVisible();
});

test('외부에서 파일을 바꾸면(무음 reload) 목표·총계가 새 내용 기준이다', async () => {
  const page = await app.firstWindow();
  await openNote(page, 'Swap');
  writeFileSync(path.join(vaultDir, 'Swap.md'), '---\ngoal_chars: 100\n---\n# Swap\n\n짧\n');
  await expect(page.locator('.ProseMirror')).toHaveText(/짧/);
  await expect(page.getByTestId('writer-goal-text')).toContainText('/100자');
});

test('소스 모드 왕복·언어 전환에도 오늘 쓴 글자수가 중복·누락 없이 유지된다', async () => {
  const page = await app.firstWindow();
  await openNote(page, 'Swap');
  const readToday = async () => Number((await page.getByTestId('writer-today').innerText()).replace(/[^0-9]/g, ''));
  const before = await readToday();
  await page.keyboard.press('ControlOrMeta+e');
  await expect(page.getByTestId('source-editor')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+e');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  expect(await readToday()).toBe(before);
  await page.getByTestId('settings-btn').click();
  await page.getByRole('radiogroup', { name: /Language|언어/ }).getByRole('radio', { name: 'English' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('writer-today')).toContainText(/Today/);
  expect(await readToday()).toBe(before);
});

test('일반 모드에는 목표·오늘 요소가 DOM 에 없다', async () => {
  const page = await app.firstWindow();
  await toggleWriter(page, false);
  await expect(page.getByTestId('writer-status')).toHaveCount(0);
  await expect(page.getByTestId('writer-goal')).toHaveCount(0);
  await expect(page.getByTestId('writer-today')).toHaveCount(0);
});

test('읽기 전용 볼트에서 목표 저장이 실패하면 화면 값이 유지되고 오류를 알린다', async () => {
  const page = await app.firstWindow();
  await openNote(page, 'NoFm');
  await toggleWriter(page, true);
  const file = path.join(vaultDir, 'NoFm.md');
  writeFileSync(file, '---\ngoal_chars: 500\n---\n# 제목\n\n본문 문장\n');
  await expect(page.getByTestId('writer-goal-text')).toContainText('/500자');
  const { chmodSync } = await import('node:fs');
  chmodSync(file, 0o444);
  chmodSync(vaultDir, 0o555);
  try {
    await page.getByTestId('writer-goal-edit').click();
    await page.getByTestId('writer-goal-input').fill('900');
    await page.getByTestId('writer-goal-save').click();
    // 저장 실패: 오류 토스트가 뜨고, 편집기 내용은 그대로 남는다
    await expect(page.locator('.toast')).toContainText(/목표|goal/i, { timeout: 10_000 });
    await expect(page.locator('.ProseMirror')).toContainText('본문 문장');
  } finally {
    chmodSync(vaultDir, 0o755);
    chmodSync(file, 0o644);
  }
});
