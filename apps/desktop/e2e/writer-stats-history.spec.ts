import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { waitForWatcher, writeExternalNote } from './watcher';

// 작가 모드(M1-2 PR1): 날짜가 바뀌면 그날 합계가 history 로 남고, 날짜별 조회가 그 값을 돌려준다.
// 통계는 userData/writer-stats.json 에만 쓰고 볼트·노트 파일은 건드리지 않는다.
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
let noteDir = '';
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
  await waitForWatcher(page);
}

async function openEpisode(page: Page): Promise<void> {
  await openVaultIfNeeded(page);
  for (const name of ['작품', '회차']) {
    const box = page
      .locator('aside.sidebar details')
      .filter({ has: page.locator('summary', { hasText: new RegExp(`^${name}$`) }) })
      .first();
    if ((await box.count()) && !(await box.evaluate((el) => el.hasAttribute('open')))) await box.locator('summary').click();
  }
  await page.locator('aside.sidebar [data-path$="/1화.md"]').click();
  await expect(page.locator('.ProseMirror')).toBeVisible();
}

/** 테스트 전제조건(한국어·공백 포함·작가 모드 켬). */
async function resetWriter(page: Page): Promise<void> {
  await page.evaluate(() => window.nops.settings.setLanguage({ language: 'ko', writerMode: true, writerSpacing: 'include' }));
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
}

/** 메인 프로세스의 e2e 전용 날짜 오프셋(일). 배포 빌드에는 이 훅이 없다. */
async function shiftDays(days: number): Promise<void> {
  await app.evaluate((_electron, n) => {
    (globalThis as unknown as { __nopsE2ESetWriterDayOffset?: (days: number) => void }).__nopsE2ESetWriterDayOffset?.(n);
  }, days);
}

/** 기기 로컬 날짜 키(YYYY-MM-DD) — 오프셋을 반영한다. */
async function dayStart(page: Page, offsetDays: number): Promise<{ vaultId: string; date: string }> {
  return page.evaluate((offset) => {
    const at = new Date(Date.now() + offset * 86_400_000);
    const date = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
    return window.nops.vault.current().then((v) => ({ vaultId: v!.id, date }));
  }, offsetDays);
}

test.beforeAll(async () => {
  test.setTimeout(240_000);
  base = mkdtempSync(path.join(tmpdir(), 'nops-stats-'));
  vaultDir = path.join(base, 'Demo');
  noteDir = path.join(vaultDir, '작품', '회차');
  mkdirSync(noteDir, { recursive: true });
  mkdirSync(path.join(vaultDir, '작품', '캐릭터'), { recursive: true });
  userDataDir = path.join(base, 'userdata');
  writeExternalNote(path.join(noteDir, '1화.md'), '# 1화\n\n처음\n');
  writeExternalNote(path.join(noteDir, '2화.md'), '# 2화\n\n처음\n');
  app = await launch();
});

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  if (base) rmSync(base, { recursive: true, force: true });
});

test('날짜가 바뀌면 그날 합계가 history 로 남고, 날짜별 조회·작품 귀속이 맞는다', async () => {
  const page = await app.firstWindow();
  await resetWriter(page);
  await openEpisode(page);
  const before = await dayStart(page, 0);

  await page.locator('.ProseMirror p').last().click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' 오늘 쓴 문장입니다');
  await expect(page.locator('.note-editor__status')).toHaveAttribute('data-state', 'saved', { timeout: 15_000 });
  await expect(page.getByTestId('writer-today')).toContainText(/[1-9]/, { timeout: 15_000 });

  const todayChars = await page.evaluate(async (vaultId) => (await window.nops.settings.writerToday({ vaultId })).chars, before.vaultId);
  expect(todayChars).toBeGreaterThan(0);
  // 오늘 기록은 조회에도 현재 값으로 보인다.
  const live = await page.evaluate(
    async ([vaultId, date]) => window.nops.settings.writerHistory({ vaultId: vaultId!, from: date!, to: date! }),
    [before.vaultId, before.date],
  );
  expect(live[before.date]?.total).toBe(todayChars);
  expect(live[before.date]?.works).toEqual({ 작품: todayChars });

  // 하루를 넘긴다(시계 주입) → 오늘은 0 에서 시작하고 지난 날은 history 에 남는다.
  await shiftDays(1);
  const tomorrow = await dayStart(page, 1);
  const reset = await page.evaluate(async (vaultId) => window.nops.settings.writerToday({ vaultId }), before.vaultId);
  expect(reset).toEqual({ date: tomorrow.date, chars: 0 });

  const past = await page.evaluate(
    async ([vaultId, date]) => window.nops.settings.writerHistory({ vaultId: vaultId!, from: date!, to: date! }),
    [before.vaultId, before.date],
  );
  expect(past).toEqual({ [before.date]: { total: todayChars, works: { 작품: todayChars } } });

  // 파일에는 version 2 로 남고, 노트 파일은 그대로다.
  const saved = JSON.parse(readFileSync(path.join(userDataDir, 'writer-stats.json'), 'utf8')) as {
    version: number;
    history: Record<string, Record<string, { total: number }>>;
  };
  expect(saved.version).toBe(2);
  expect(saved.history[before.vaultId]?.[before.date]?.total).toBe(todayChars);
  // 노트에는 우리가 친 글자만 늘고, 통계 파일은 볼트 안에 생기지 않는다.
  expect(readFileSync(path.join(noteDir, '1화.md'), 'utf8')).toContain('오늘 쓴 문장입니다');
  expect(existsSync(path.join(vaultDir, 'writer-stats.json'))).toBe(false);

  // 앱을 다시 열어도 지난 날 기록이 남아 있다(재시작 뒤에도 조회된다).
  await app.close();
  app = await launch();
  const again = await app.firstWindow();
  await openVaultIfNeeded(again);
  const afterRestart = await again.evaluate(
    async ([vaultId, date]) => window.nops.settings.writerHistory({ vaultId: vaultId!, from: date!, to: date! }),
    [before.vaultId, before.date],
  );
  expect(afterRestart).toEqual({ [before.date]: { total: todayChars, works: { 작품: todayChars } } });
});
