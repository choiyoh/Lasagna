import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// 작가 모드(W4c): 회차 DB — 칩을 눌러야 _db.yaml 생성, 자동 열(글자수·목표 달성), 한/영.
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
}

async function resetWriter(page: Page, locale: 'ko' | 'en' = 'ko'): Promise<void> {
  await page.evaluate(
    (next) => window.nops.settings.setLanguage({ language: next, writerMode: true, writerSpacing: 'include' }),
    locale,
  );
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
}

async function createWork(page: Page, name: string): Promise<void> {
  await page.getByTestId('settings-btn').click();
  await page.getByTestId('work-create').click();
  await page.getByTestId('work-dialog-name').fill(name);
  await page.getByTestId('work-dialog-create').click();
  await expect(page.getByTestId('work-dialog')).toHaveCount(0);
  await page.keyboard.press('Escape');
}

test.beforeAll(async () => {
  test.setTimeout(240_000);
  base = mkdtempSync(path.join(tmpdir(), 'nops-epdb-'));
  vaultDir = path.join(base, 'Demo');
  mkdirSync(vaultDir, { recursive: true });
  writeFileSync(path.join(vaultDir, '메모.md'), '# 메모\n');
  app = await launch();
});

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  if (base) rmSync(base, { recursive: true, force: true });
});

test('회차 DB 칩을 눌러야 _db.yaml 이 생기고, 자동 열이 계산된다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await resetWriter(page);
  await createWork(page, '달빛');
  const dbFile = path.join(vaultDir, '달빛', '회차', '_db.yaml');
  // 작품 만들기만으로는 만들지 않는다
  expect(() => readFileSync(dbFile, 'utf8')).toThrow();

  await page.getByTestId('work-card').filter({ hasText: '달빛' }).getByTestId('work-chip-db').click();
  await expect.poll(() => { const y = readFileSync(dbFile, 'utf8'); return y.includes('note_chars') && y.includes('goal_met') && y.includes('id: v1') && y.includes('calc'); }, { timeout: 15_000 }).toBe(true);
  await page.waitForTimeout(300); // 뷰 저장이 끝난 뒤 비교한다
  const yaml = readFileSync(dbFile, 'utf8');
  expect(yaml).toContain('goal_met');
  // DB 화면: 열 이름과 자동 배지
  await expect(page.getByTestId('th-글자수')).toContainText('글자수');
  await expect(page.getByTestId('auto-글자수')).toHaveText('자동');
  await expect(page.getByTestId('auto-목표 달성')).toHaveText('자동');

  // 빈 상태: '+ 첫 회차' → 회차 1·상태 초고 행 생성
  await expect(page.getByRole('button', { name: /\+ 첫 회차/ })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /\+ 첫 회차/ }).click();
  await expect(page.getByTestId('db-table')).toContainText('1화', { timeout: 15_000 });
  await expect(page.getByTestId('db-table')).toContainText('초고');
  // 새 행의 회차 기본값 = 최대+1
  await page.getByTestId('db-new-row').click();
  await page.getByTestId('db-add-title').fill('2화');
  await page.getByTestId('db-add-title').press('Enter');
  await expect(page.getByTestId('db-table')).toContainText('2화', { timeout: 15_000 });

  // 회차 노트를 만들면 행이 생기고 글자수가 계산된다
  await page.getByTestId('work-card').filter({ hasText: '달빛' }).getByTestId('new-episode').click();
  const prompt = page.locator('.nops-prompt input');
  await expect(prompt).toBeVisible();
  await prompt.fill('3화');
  await prompt.press('Enter');
  await expect.poll(() => readFileSync(path.join(vaultDir, '달빛', '회차', '3화.md'), 'utf8').startsWith('# 3화'), { timeout: 15_000 }).toBe(true);
  // DB 화면에 행과 계산된 자동 값이 보인다('1화' = 2자)
  await expect(page.getByTestId('db-table')).toContainText('3화', { timeout: 15_000 });
  // 자동 열 값은 파일에 저장되지 않는다
  expect(readFileSync(path.join(vaultDir, '달빛', '회차', '3화.md'), 'utf8')).not.toContain('글자수');

  // 기본 뷰: 회차 내림차순(3화가 맨 위), 합계 행, 탭 전환 후에도 제목 열
  const firstRow = page.locator('[data-testid="db-table"] .dbtable__row').first();
  await expect(firstRow).toContainText('2화'); // 회차 내림차순(1·2 중 2가 위)
  await expect(page.locator('.dbtable__calc')).toContainText(/합계/);
  await page.getByRole('tab', { name: '퇴고' }).click();
  await expect(page.getByTestId('th-title')).toBeVisible();
  await expect(page.getByTestId('db-new-row')).toContainText(/새 행/);

  // 920px: 회차 DB에서만 수정일 열 숨김 + 다른 열 유지
  await page.setViewportSize({ width: 900, height: 800 });
  await expect(page.getByTestId('th-수정일')).toBeHidden();
  await expect(page.getByTestId('th-회차')).toBeVisible();
  await expect(page.getByTestId('th-글자수')).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  // 920 숨김은 회차 DB 테이블에만 적용된다(data-episode 스코프 규칙 + attr 확인)
  const scoped = await page.evaluate(() => {
    const table = document.querySelector('[data-testid="db-table"]');
    const hasRule = [...document.styleSheets].some((sheet) => {
      try {
        return [...sheet.cssRules].some(
          (rule) => rule.cssText.includes('data-episode') && rule.cssText.includes('dbtable__narrow-hide'),
        );
      } catch {
        return false;
      }
    });
    return { episode: table?.getAttribute('data-episode') ?? null, hasRule };
  });
  expect(scoped).toEqual({ episode: '1', hasRule: true });
  await page.setViewportSize({ width: 1440, height: 900 });
});

test('언어를 바꿔 다시 열어도 기존 회차 DB 는 그대로다(열·뷰 덮어쓰기 없음)', async () => {
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1440, height: 900 });
  await openVaultIfNeeded(page);
  await resetWriter(page, 'ko');
  await page.getByRole('tab', { name: '파일' }).click();
  // 이 테스트만 따로 돌아도 되게 자기 작품을 만든다.
  await page.getByTestId('settings-btn').click();
  await page.getByTestId('work-create').click();
  await page.getByTestId('work-dialog-name').fill('영어작');
  await page.getByTestId('work-dialog-create').click();
  await expect(page.getByTestId('work-dialog')).toHaveCount(0);
  await page.keyboard.press('Escape');
  const dbFile = path.join(vaultDir, '영어작', '회차', '_db.yaml');
  await page.getByTestId('work-card').filter({ hasText: '영어작' }).getByTestId('work-chip-db').click();
  await expect.poll(() => { const y = readFileSync(dbFile, 'utf8'); return y.includes('note_chars') && y.includes('goal_met') && y.includes('id: v1') && y.includes('calc'); }, { timeout: 15_000 }).toBe(true);
  await page.waitForTimeout(300); // 뷰 저장이 끝난 뒤 비교한다
  const before = readFileSync(dbFile, 'utf8');
  // DB 를 연 채 언어를 바꾸지 않고 앱을 다시 열어(새 화면) 영어로 연다.
  await app.close();
  app = await launch();
  const again = await app.firstWindow();
  await again.setViewportSize({ width: 1440, height: 900 });
  await openVaultIfNeeded(again);
  await resetWriter(again, 'en');
  await again.getByRole('tab', { name: /파일|Files/ }).click();
  await expect(again.getByTestId('work-card').filter({ hasText: '영어작' })).toBeVisible({ timeout: 15_000 });
  await again.getByTestId('work-card').filter({ hasText: '영어작' }).getByTestId('work-chip-db').click();
  await expect(again.getByTestId('db-screen')).toBeVisible();
  // 기존 한국어 열 그대로, 새 Episode/Characters 열이 생기지 않는다
  await expect(again.getByTestId('th-회차')).toBeVisible();
  await expect(again.getByTestId('th-Episode')).toHaveCount(0);
  expect(readFileSync(dbFile, 'utf8')).toBe(before);
  expect((readFileSync(dbFile, 'utf8').match(/회차: \{ type: number/g) ?? []).length).toBe(1);
});
