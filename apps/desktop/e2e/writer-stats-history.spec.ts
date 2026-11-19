import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
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

/** 테스트 전제조건(한국어·공백 포함·작가 모드 켬·하루 목표 500자). */
async function resetWriter(page: Page): Promise<void> {
  await page.evaluate(() => window.nops.settings.setLanguage({ language: 'ko', writerMode: true, writerSpacing: 'include', writerDailyGoal: 500 }));
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

/** 통계 파일을 새로 시작하고 싶을 때: userData 를 새 폴더로 바꿔 앱을 다시 띄운다. */
async function freshApp(suffix: string): Promise<Page> {
  return freshAppWith(suffix, null);
}

/** 앱이 읽기 전에 통계 파일을 미리 만들어 두고 띄운다(첫 통계 접근이 그 파일을 읽는다). */
async function freshAppWith(suffix: string, seed: unknown | null): Promise<Page> {
  await app.close();
  userDataDir = path.join(base, `userdata-${suffix}`);
  mkdirSync(userDataDir, { recursive: true });
  if (seed !== null) writeFileSync(path.join(userDataDir, 'writer-stats.json'), JSON.stringify(seed));
  app = await launch();
  return app.firstWindow();
}

/** 볼트 id = 앱이 쓰는 규칙(path.resolve 한 경로의 sha256 앞 12자). 파일을 미리 심을 때 쓴다. */
function vaultIdOf(dir: string): string {
  return createHash('sha256').update(path.resolve(dir)).digest('hex').slice(0, 12);
}

test.beforeAll(async () => {
  test.setTimeout(240_000);
  base = mkdtempSync(path.join(tmpdir(), 'nops-stats-'));
  vaultDir = path.join(base, 'Demo');
  noteDir = path.join(vaultDir, '작품', '회차');
  mkdirSync(noteDir, { recursive: true });
  mkdirSync(path.join(vaultDir, '작품', '캐릭터'), { recursive: true });
  userDataDir = path.join(base, 'userdata');
  mkdirSync(userDataDir, { recursive: true });
  writeExternalNote(path.join(noteDir, '1화.md'), '# 1화\n\n처음\n');
  // 작품 인식(회차+캐릭터 폴더)과 폴더 이름 바꾸기 뒤에도 남는 폴더를 위해 캐릭터 노트도 둔다.
  writeExternalNote(path.join(vaultDir, '작품', '캐릭터', '주인공.md'), '# 주인공\n');
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
  // 닫는 시점의 하루 목표가 그 날짜에 남는다(나중에 목표를 바꿔도 그대로).
  expect(past).toEqual({ [before.date]: { total: todayChars, works: { 작품: todayChars }, goal: 500 } });

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
  expect(afterRestart).toEqual({ [before.date]: { total: todayChars, works: { 작품: todayChars }, goal: 500 } });
});

test('같은 날 이름을 바꿔도 그날 값이 :outside 가 되지 않고, undo 는 되돌린다', async () => {
  const page = await freshApp('rename');
  await resetWriter(page);
  await openEpisode(page);
  const d0 = await dayStart(page, 0);

  await page.locator('.ProseMirror p').last().click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' 이름을 바꾼 날의 문장입니다');
  await expect(page.locator('.note-editor__status')).toHaveAttribute('data-state', 'saved', { timeout: 15_000 });
  await expect(page.getByTestId('writer-today')).toContainText(/[1-9]/, { timeout: 15_000 });
  const chars = await page.evaluate(async (vaultId) => (await window.nops.settings.writerToday({ vaultId })).chars, d0.vaultId);

  // 작품 폴더 이름을 바꾸고(오늘 값이 아직 닫히지 않았다) 자정을 넘긴다.
  const { undoId } = await page.evaluate(() => window.nops.note.rename({ from: '작품', to: '작품나' }));
  expect(undoId).toBeTruthy();
  await shiftDays(1);
  await dayStart(page, 1);
  await page.evaluate(async (vaultId) => window.nops.settings.writerToday({ vaultId }), d0.vaultId);
  const day = await page.evaluate(
    async ([vaultId, date]) => window.nops.settings.writerHistory({ vaultId: vaultId!, from: date!, to: date! }),
    [d0.vaultId, d0.date],
  );
  expect(day[d0.date]).toEqual({ total: chars, works: { 작품나: chars }, goal: 500 });

  // 이름 바꾸기 취소 → 그날 작품 키도 원래 이름으로 돌아간다.
  await page.evaluate((id) => window.nops.note.undoRename({ undoId: id }), undoId);
  const after = await page.evaluate(
    async ([vaultId, date]) => window.nops.settings.writerHistory({ vaultId: vaultId!, from: date!, to: date! }),
    [d0.vaultId, d0.date],
  );
  expect(after[d0.date]).toEqual({ total: chars, works: { 작품: chars }, goal: 500 });

  // 자정을 넘긴 뒤(다음 날 아침) 이름을 바꿔도 그 전날 값은 원래 작품으로 확정된다.
  await openEpisode(page);
  await page.locator('.ProseMirror p').last().click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' 다음 날 아침 문장');
  await expect(page.locator('.note-editor__status')).toHaveAttribute('data-state', 'saved', { timeout: 15_000 });
  const d1 = await dayStart(page, 1);
  const day1Chars = await page.evaluate(async (vaultId) => (await window.nops.settings.writerToday({ vaultId })).chars, d1.vaultId);
  await shiftDays(2);
  await dayStart(page, 2);
  const morning = await page.evaluate(() => window.nops.note.rename({ from: '작품', to: '작품나' }));
  const closed = await page.evaluate(
    async ([vaultId, date]) => window.nops.settings.writerHistory({ vaultId: vaultId!, from: date!, to: date! }),
    [d1.vaultId, d1.date],
  );
  // 마감은 rename 전에 옛 이름으로 끝나고(작품 밖이 아님), rename 이 그 키를 새 이름으로 옮긴다.
  expect(closed[d1.date]).toEqual({ total: day1Chars, works: { 작품나: day1Chars }, goal: 500 });
  await page.evaluate((id) => window.nops.note.undoRename({ undoId: id }), morning.undoId);
  const restored = await page.evaluate(
    async ([vaultId, date]) => window.nops.settings.writerHistory({ vaultId: vaultId!, from: date!, to: date! }),
    [d1.vaultId, d1.date],
  );
  expect(restored[d1.date]).toEqual({ total: day1Chars, works: { 작품: day1Chars }, goal: 500 });
  await shiftDays(0);
});

test('다른 볼트를 연 채 자정이 지나도 닫힌 볼트의 값이 :outside 로 확정되지 않는다', async () => {
  const page = await freshApp('multi');
  await resetWriter(page);
  await openEpisode(page);
  const a = await dayStart(page, 0);

  await page.locator('.ProseMirror p').last().click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' 볼트 A 의 문장');
  await expect(page.locator('.note-editor__status')).toHaveAttribute('data-state', 'saved', { timeout: 15_000 });
  const aChars = await page.evaluate(async (vaultId) => (await window.nops.settings.writerToday({ vaultId })).chars, a.vaultId);
  expect(aChars).toBeGreaterThan(0);

  // 두 번째 볼트로 전환하고, 그 볼트를 연 채 자정이 지나게 한다.
  const second = path.join(base, 'Second');
  mkdirSync(path.join(second, '겨울', '회차'), { recursive: true });
  mkdirSync(path.join(second, '겨울', '캐릭터'), { recursive: true });
  writeExternalNote(path.join(second, '겨울', '회차', '1화.md'), '# 1화\n\n겨울\n');
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dir] })) as typeof dialog.showOpenDialog;
  }, second);
  const b = await page.evaluate(async () => {
    const opened = await window.nops.vault.pick();
    return { id: opened!.id };
  });
  await expect.poll(async () => page.evaluate(async () => (await window.nops.vault.current())?.id)).toBe(b.id);
  await page.evaluate(async (vaultId) => window.nops.settings.writerToday({ vaultId }), b.id);
  await shiftDays(1);
  await dayStart(page, 1);
  await page.evaluate(async (vaultId) => window.nops.settings.writerToday({ vaultId }), b.id);

  // 아직 볼트 A 를 열지 않았으므로 그날 값은 닫히지 않고 보류된다(작품 밖으로 확정되지 않는다).
  const saved = JSON.parse(readFileSync(path.join(userDataDir, 'writer-stats.json'), 'utf8')) as {
    history: Record<string, Record<string, unknown>>;
    pending: Record<string, { date: string; vaults: Record<string, number> }[]>;
  };
  expect(saved.history[a.vaultId]).toBeUndefined();
  expect(saved.pending[a.vaultId]?.[0]).toEqual({ date: a.date, vaults: { '작품/회차/1화.md': aChars } });
  // 그 볼트를 나중에 열면 그때 작품 이름으로 닫힌다(단위 테스트로 고정) — 여기서는 파일에 남은 경로가 증거다.
  expect(Object.keys(saved.pending[a.vaultId]?.[0]?.vaults ?? {})).toEqual(['작품/회차/1화.md']);
});

test('보류를 풀어도 다른 볼트의 오늘 값이 지워지지 않는다', async () => {
  const { today, yesterday } = (() => {
    const key = (offset: number) => {
      const at = new Date(Date.now() + offset * 86_400_000);
      return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
    };
    return { today: key(0), yesterday: key(-1) };
  })();
  const id = vaultIdOf(vaultDir);
  // A(작품)의 어제 값은 보류, 오늘은 B 라는 볼트에서 500자를 쓴 상태를 미리 만들어 둔다.
  const page = await freshAppWith('pending', {
    version: 2,
    today: { date: today, vaults: { otherVault: { '겨울/1화.md': 500 } } },
    history: {},
    pending: { [id]: [{ date: yesterday, vaults: { '작품/회차/1화.md': 300 } }] },
  });
  await resetWriter(page);
  await openEpisode(page); // 첫 통계 읽기에서 보류가 풀린다
  const live = await page.evaluate(async (vaultId) => window.nops.settings.writerToday({ vaultId }), id);
  expect(live.chars).toBe(0);
  const past = await page.evaluate(
    async ([vaultId, date]) => window.nops.settings.writerHistory({ vaultId: vaultId!, from: date!, to: date! }),
    [id, yesterday],
  );
  expect(past[yesterday]).toEqual({ total: 300, works: { 작품: 300 }, goal: 500 });

  const saved = JSON.parse(readFileSync(path.join(userDataDir, 'writer-stats.json'), 'utf8')) as {
    today: { vaults: Record<string, Record<string, number>> };
    pending: Record<string, unknown>;
  };
  // 다른 볼트의 오늘 값과 보류 흔적이 그대로다(지워지지 않았다).
  expect(saved.today.vaults.otherVault).toEqual({ '겨울/1화.md': 500 });
  expect(saved.pending[id]).toBeUndefined();
});

test('이름 바꾸기 취소는 그 rename 의 날짜만 되돌리고 다른 작품 키는 건드리지 않는다', async () => {
  const id = vaultIdOf(vaultDir);
  const at = new Date();
  const today = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
  const page = await freshAppWith('undo', {
    version: 2,
    // 아직 닫히지 않은 오늘 값 — rename 이 이 키를 옮기고 undo 가 되돌린다(undo 레코드가 생기는 조건).
    today: { date: today, vaults: { [id]: { '작품/회차/1화.md': 100 } } },
    history: {
      [id]: {
        // 이번 rename 과 무관한 날짜 — 새 이름과 같은 이름의 다른 작품
        '2026-01-15': { total: 900, works: { 작품나: 900 } },
        // rename 이 옮길 날짜
        '2026-02-01': { total: 1200, works: { 봄: 900, 작품: 300 } },
      },
    },
    pending: {},
  });
  await resetWriter(page);
  await openEpisode(page);
  expect(await page.evaluate(async () => (await window.nops.vault.current())!.id)).toBe(id);

  const { undoId } = await page.evaluate(() => window.nops.note.rename({ from: '작품', to: '작품나' }));
  await page.evaluate((undoIdValue) => window.nops.note.undoRename({ undoId: undoIdValue }), undoId);
  const range = await page.evaluate(
    async (vaultId) => window.nops.settings.writerHistory({ vaultId, from: '2026-01-15', to: '2026-02-01' }),
    id,
  );
  // 이번 rename 이 옮긴 날짜만 원래대로 돌아오고, 다른 날짜의 '작품나' 는 그대로다.
  expect(range['2026-01-15']).toEqual({ total: 900, works: { 작품나: 900 } });
  expect(range['2026-02-01']).toEqual({ total: 1200, works: { 봄: 900, 작품: 300 } });
});
