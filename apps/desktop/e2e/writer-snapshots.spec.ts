import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// 작가 모드(W4d): 이름 붙인 스냅샷 — 저장·diff·되돌리기·이름 바꾸기·삭제·재시작·일반 모드 불변.
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

async function openDock(page: Page): Promise<void> {
  const links = page.getByRole('tab', { name: '링크', exact: true });
  if (!(await links.isVisible())) await page.getByTitle('링크 패널 열기/닫기').click();
  await expect(links).toBeVisible();
  await links.click();
  await page.getByRole('tab', { name: '기록', exact: true }).click();
  await expect(page.getByTestId('panel-history')).toBeVisible();
}

async function resetSettings(page: Page, opts: { mode?: boolean; locale?: 'ko' | 'en' } = {}): Promise<void> {
  const mode = opts.mode ?? true;
  const language = opts.locale ?? 'ko';
  await page.evaluate(
    (next) => window.nops.settings.setLanguage({ language: next.language, writerMode: next.mode, writerSpacing: 'include' }),
    { mode, language },
  );
  await expect(page.locator('html')).toHaveAttribute('lang', language);
}

async function openNote(page: Page): Promise<void> {
  await openVaultIfNeeded(page);
  await page.locator('aside.sidebar').getByRole('button', { name: '회차', exact: true }).first().click();
  await expect(page.locator('.ProseMirror')).toBeVisible();
}

test.beforeAll(async () => {
  test.setTimeout(240_000);
  base = mkdtempSync(path.join(tmpdir(), 'nops-snap-'));
  vaultDir = path.join(base, 'Demo');
  mkdirSync(vaultDir, { recursive: true });
  notePath = path.join(vaultDir, '회차.md');
  writeFileSync(notePath, '# 회차\n\n처음 문장\n');
  app = await launch();
});

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  if (base) rmSync(base, { recursive: true, force: true });
});

test('작가 모드 OFF 에는 스냅샷 구역이 없고, 켜기만 해서는 폴더가 생기지 않는다', async () => {
  const page = await app.firstWindow();
  await openNote(page);
  await resetSettings(page, { mode: false });
  await openDock(page);
  await expect(page.getByTestId('snapshots')).toHaveCount(0);
  await resetSettings(page, { mode: true });
  await expect(page.getByTestId('snapshots')).toHaveCount(1);
  expect(existsSync(path.join(vaultDir, '.nopsidian', 'snapshots'))).toBe(false);
});

test('1교 칩으로 저장 → 수정 → diff → 되돌리기(자동 이력에 직전 내용)', async () => {
  const page = await app.firstWindow();
  await openNote(page);
  await resetSettings(page);
  await openDock(page);
  await expect(page.getByTestId('snapshots')).toBeVisible();

  await page.getByTestId('snapshot-add').click();
  await page.getByTestId('snapshot-quick').first().click(); // 1교
  await page.getByTestId('snapshot-save').click();
  // 행 모양: 이름·메타가 한 줄이고 행 높이가 부풀지 않는다(디자이너 QA 회귀)
  const snapRow = page.getByTestId('snapshot-entry').first().locator('..');
  const rowBox = await snapRow.boundingBox();
  expect(rowBox?.height ?? 0).toBeLessThan(48);
  // 이름 버튼 자체도 한 줄 높이(줄바꿈으로 쌓이지 않는다)이고 nowrap 이다.
  const entryBox = await page.getByTestId('snapshot-entry').first().boundingBox();
  expect(entryBox?.height ?? 0).toBeLessThan(40);
  const whiteSpace = await page.getByTestId('snapshot-entry').first().evaluate((el) => getComputedStyle(el).whiteSpace);
  expect(whiteSpace).toBe('nowrap');
  await expect(page.getByTestId('snapshot-entry')).toHaveCount(1);
  await expect(page.getByTestId('snapshot-entry')).toContainText('1교');

  // 내용 수정·저장
  await page.locator('.ProseMirror p').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' 고친 문장');
  await expect.poll(() => readFileSync(notePath, 'utf8'), { timeout: 15_000 }).toContain('고친 문장');

  // 스냅샷 선택 → diff 에 스냅샷 내용(추가/삭제 색)
  await page.getByTestId('snapshot-entry').click();
  await expect(page.getByTestId('snapshot-diff')).toContainText('처음 문장');
  await expect(page.locator('.diff-add')).not.toHaveCount(0);

  // 되돌리기 확인 → 내용 복원, 자동 이력에 직전 내용이 남는다
  await page.getByTestId('snapshot-restore').click();
  const restoreDialog = page.locator('.dialog');
  await expect(restoreDialog).toBeVisible();
  await restoreDialog.locator('.primary').click();
  await expect.poll(() => readFileSync(notePath, 'utf8'), { timeout: 15_000 }).toBe('# 회차\n\n처음 문장\n');
  await expect(page.locator('.ProseMirror p')).toContainText('처음 문장');
  await expect(page.getByTestId('history-entry')).not.toHaveCount(0);
});

test('이름 바꾸기·삭제는 그 스냅샷만 바꾼다', async () => {
  const page = await app.firstWindow();
  await openNote(page);
  await resetSettings(page);
  await openDock(page);
  // 이 테스트만 따로 돌아도 되게 스냅샷을 스스로 만든다.
  if ((await page.getByTestId('snapshot-entry').count()) === 0) {
    await page.getByTestId('snapshot-add').click();
    await page.getByTestId('snapshot-name').fill('삭제전');
    await page.getByTestId('snapshot-save').click();
  }
  const entry = page.getByTestId('snapshot-entry').first();
  await expect(entry).toBeVisible();
  await page.getByTestId('snapshot-rename').first().click();
  const input = page.locator('.nops-prompt input');
  await input.fill('2교');
  await input.press('Enter');
  await expect(page.getByTestId('snapshot-entry').filter({ hasText: '2교' })).toHaveCount(1);
  const before = await page.getByTestId('snapshot-entry').count();
  await page.getByTestId('snapshot-delete').first().click();
  await page.locator('.dialog .danger').click();
  await expect(page.getByTestId('snapshot-entry')).toHaveCount(before - 1);
});

test('앱을 다시 켜도 스냅샷이 유지되고, 영어 문구로 바뀐다', async () => {
  const page = await app.firstWindow();
  await openNote(page);
  await resetSettings(page);
  await openDock(page);
  await page.getByTestId('snapshot-add').click();
  await page.getByTestId('snapshot-name').fill('수정');
  await page.getByTestId('snapshot-save').click();
  await expect(page.getByTestId('snapshot-entry').filter({ hasText: '수정' })).toHaveCount(1);
  const snapCount = await page.getByTestId('snapshot-entry').count();

  await app.close();
  app = await launch();
  const again = await app.firstWindow();
  await openNote(again);
  await openDock(again);
  await expect(again.getByTestId('snapshot-entry')).toHaveCount(snapCount); // 앞 테스트 것까지 그대로
  await expect(again.getByTestId('snapshot-entry').filter({ hasText: '수정' })).toHaveCount(1);

  await resetSettings(again, { locale: 'en' });
  await expect(again.getByTestId('snapshots')).toContainText('Snapshots');
  await expect(again.getByTestId('snapshot-add')).toContainText('Snapshot');
});

test('노트 이름을 바꿔도 스냅샷·자동 이력이 따라간다', async () => {
  const page = await app.firstWindow();
  await openNote(page);
  await resetSettings(page);
  await openDock(page);
  // 스냅샷 하나 준비
  await page.getByTestId('snapshot-add').click();
  await page.getByTestId('snapshot-name').fill('이름유지');
  await page.getByTestId('snapshot-save').click();
  await expect(page.getByTestId('snapshot-entry').filter({ hasText: '이름유지' })).toHaveCount(1);

  // 실제 rename IPC 로 이름 바꾸기(링크 갱신 포함 경로)
  const before = (await page.evaluate(() => window.nops.vault.current())) as { id: string } | null;
  expect(before).not.toBeNull();
  await page.evaluate(async () => {
    await window.nops.note.rename({ from: '회차.md', to: '회차-개정.md' });
  });
  // 새 이름 노트를 열고 스냅샷 목록 유지 확인
  // 사이드바 라벨은 H1('회차')이므로 파일 경로로 찾는다.
  const renamedRow = page.locator('aside.sidebar [data-path="회차-개정.md"]');
  await expect(renamedRow).toBeVisible({ timeout: 15_000 });
  await renamedRow.click();
  await openDock(page);
  await expect(page.getByTestId('snapshot-entry')).not.toHaveCount(0); // 앞 테스트의 스냅샷도 함께 남는다
  await expect(page.getByTestId('snapshot-entry').first()).toContainText('이름유지');
  // 자동 이력도 새 이름에서 이어진다(되돌리기용 이력이 있거나, 곧 저장으로 생긴다)
  await page.locator('.ProseMirror p').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' 이름 바꾼 뒤');
  await expect.poll(() => readFileSync(path.join(vaultDir, '회차-개정.md'), 'utf8'), { timeout: 15_000 }).toContain('이름 바꾼 뒤');
  await openDock(page);
  await expect(page.getByTestId('history-entry')).not.toHaveCount(0, { timeout: 15_000 });
});

test('다른 노트로 바꾸면 선택한 스냅샷·diff 가 초기화되고 이전 노트로 덮어쓰지 않는다', async () => {
  const page = await app.firstWindow();
  await openNote(page);
  await resetSettings(page);
  await openDock(page);
  await page.getByTestId('snapshot-add').click();
  await page.getByTestId('snapshot-name').fill('교차방지');
  await page.getByTestId('snapshot-save').click();
  await page.getByTestId('snapshot-entry').filter({ hasText: '교차방지' }).click();
  await expect(page.getByTestId('snapshot-diff')).toBeVisible();

  // 다른 노트를 만들어 전환한다(스냅샷이 없는 노트)
  const other = path.join(vaultDir, '다른노트.md');
  writeFileSync(other, '# 다른노트\n\n건드리면 안 되는 내용\n');
  const otherRow = page.locator('aside.sidebar [data-path="다른노트.md"]');
  await expect(otherRow).toBeVisible({ timeout: 15_000 });
  await otherRow.click();
  await expect(page.locator('.ProseMirror')).toContainText('건드리면 안 되는 내용');

  // 선택·diff·되돌리기 버튼이 초기화되어 있다
  await openDock(page);
  await expect(page.getByTestId('snapshot-diff')).toHaveCount(0);
  await expect(page.getByTestId('snapshot-restore')).toHaveCount(0);
  await expect(page.getByTestId('snapshot-entry')).toHaveCount(0); // 다른노트에는 스냅샷 없음
  expect(readFileSync(other, 'utf8')).toBe('# 다른노트\n\n건드리면 안 되는 내용\n');
});

test('이름 바꾸기를 취소하면 스냅샷이 원래 노트로 돌아온다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  writeFileSync(path.join(vaultDir, '취소노트.md'), '# 취소노트\n\n취소 테스트 내용\n');
  await resetSettings(page);
  const row = page.locator('aside.sidebar [data-path="취소노트.md"]');
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();
  await expect(page.locator('.ProseMirror')).toContainText('취소 테스트 내용');
  await openDock(page);
  const name = '취소테스트';
  await page.getByTestId('snapshot-add').click();
  await page.getByTestId('snapshot-name').fill(name);
  await page.getByTestId('snapshot-save').click();
  await expect(page.getByTestId('snapshot-entry').filter({ hasText: name })).toHaveCount(1);

  const undoId = await page.evaluate(async () => {
    const r = await window.nops.note.rename({ from: '취소노트.md', to: '취소노트-개정.md' });
    return r.undoId;
  });
  await expect(page.locator('aside.sidebar [data-path="취소노트-개정.md"]')).toBeVisible({ timeout: 15_000 });
  await page.evaluate(async (id) => {
    await window.nops.note.undoRename({ undoId: id });
  }, undoId);

  const original = page.locator('aside.sidebar [data-path="취소노트.md"]');
  await expect(original).toBeVisible({ timeout: 15_000 });
  await original.click();
  await openDock(page);
  await expect(page.getByTestId('snapshot-entry').filter({ hasText: name })).toHaveCount(1);
});
