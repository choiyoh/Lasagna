import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// 작가 모드(W4e): 작품 목표·마감 계산, 일일 목표 연결, 복사용 미리보기/클립보드.
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

async function resetWriter(page: Page, opts: { mode?: boolean; locale?: 'ko' | 'en' } = {}): Promise<void> {
  const mode = opts.mode ?? true;
  const language = opts.locale ?? 'ko';
  await page.evaluate(
    (next) => window.nops.settings.setLanguage({ language: next.language, writerMode: next.mode, writerSpacing: 'include' }),
    { mode, language },
  );
  await expect(page.locator('html')).toHaveAttribute('lang', language);
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
  base = mkdtempSync(path.join(tmpdir(), 'nops-w4e-'));
  vaultDir = path.join(base, 'Demo');
  mkdirSync(vaultDir, { recursive: true });
  writeFileSync(path.join(vaultDir, '회차.md'), '# 1화 밤의 시작\n\n**굵은** 문장과 [[노트|별칭]], [링크](https://x.y)\n\n> 인용문\n');
  app = await launch();
});

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  if (base) rmSync(base, { recursive: true, force: true });
});

test('작품 목표를 저장하면 카드 목표선이 보이고 재시작 후 유지된다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await resetWriter(page);
  await createWork(page, '달빛');
  // 회차 두 개
  for (const name of ['1화', '2화']) {
    await page.getByTestId('work-card').filter({ hasText: '달빛' }).getByTestId('new-episode').click();
    const input = page.locator('.nops-prompt input');
    await expect(input).toBeVisible();
    await input.fill(name);
    await input.press('Enter');
  }
  const line = page.getByTestId('work-card').filter({ hasText: '달빛' }).getByTestId('work-goal-line');
  await expect(line).toHaveText(/목표 설정/);
  await line.click();
  await page.getByTestId('work-goal-preset-naver').click();
  await expect(page.getByTestId('work-goal-per')).toHaveValue('4000');
  await page.getByTestId('work-goal-episodes').fill('80');
  await page.getByTestId('work-goal-deadline').fill('2027-12-31');
  await page.getByTestId('work-goal-save').click();
  await expect(page.getByTestId('work-goal-dialog')).toHaveCount(0);
  await expect(line).toHaveText(/완결 2\/80화 · 하루 [\d,]+자/);
  // 툴팁: 마감일·남은 일수
  await expect(line).toHaveAttribute('title', /마감 .*일 남음/);

  // 저장 위치는 userData 이고 볼트에는 목표 파일을 만들지 않는다
  const userData = path.join(base, 'userdata');
  await expect.poll(() => statSync(path.join(userData, 'writer-works.json')).size, { timeout: 10_000 }).toBeGreaterThan(0);
  expect(readFileSync(path.join(vaultDir, '회차.md'), 'utf8')).toBe('# 1화 밤의 시작\n\n**굵은** 문장과 [[노트|별칭]], [링크](https://x.y)\n\n> 인용문\n');

  // 재시작 후 유지
  await app.close();
  app = await launch();
  const again = await app.firstWindow();
  await openVaultIfNeeded(again);
  await expect(again.getByTestId('work-card').filter({ hasText: '달빛' }).getByTestId('work-goal-line')).toHaveText(/완결 2\/80화/);
});

test('일일 목표로 설정을 누르면 전역 일일 목표가 계산값으로 바뀐다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await resetWriter(page);
  const line = page.getByTestId('work-card').filter({ hasText: '달빛' }).getByTestId('work-goal-line');
  await line.click();
  const perDay = await page.getByTestId('work-goal-summary').innerText();
  const value = Number((perDay.match(/하루 ([\d,]+)자/) ?? [])[1]?.replace(/,/g, '') ?? '0');
  expect(value).toBeGreaterThan(0);
  await page.getByTestId('work-goal-set-daily').click();
  await expect.poll(async () => (await page.evaluate(() => window.nops.settings.language())).writerDailyGoal, { timeout: 10_000 }).toBe(value);
  // 대화상자와 입력값은 그대로(작품 목표는 저장을 눌렀을 때만 저장)
  await expect(page.getByTestId('work-goal-dialog')).toBeVisible();
  await expect(page.getByTestId('work-goal-episodes')).toHaveValue('80');
  await page.keyboard.press('Escape');
  // 상태줄에도 같은 값이 반영된다(노트를 연 뒤)
  await page.locator('aside.sidebar [data-path="회차.md"]').click();
  await expect(page.getByTestId('writer-today')).toContainText(`/${new Intl.NumberFormat('ko').format(value)}`);
});

test('복사 미리보기: 플랫폼용은 제목·기호를 빼고, 클립보드에는 그 텍스트가 들어간다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await resetWriter(page);
  await page.locator('aside.sidebar [data-path="회차.md"]').click();
  await expect(page.locator('.ProseMirror')).toContainText('굵은');
  await page.evaluate(() => {
    (window as unknown as { __copied?: string }).__copied = '';
    Object.defineProperty(navigator.clipboard, 'writeText', {
      configurable: true,
      value: async (text: string) => {
        (window as unknown as { __copied?: string }).__copied = text;
      },
    });
  });
  await page.getByTestId('copy-open').click();
  await expect(page.getByTestId('copy-dialog')).toBeVisible();
  const platform = await page.getByTestId('copy-text').innerText();
  expect(platform).not.toContain('# 1화');
  expect(platform).not.toContain('**');
  expect(platform).toContain('별칭');
  await page.getByTestId('copy-tab-original').click();
  await expect(page.getByTestId('copy-text')).toContainText('# 1화 밤의 시작');
  await page.getByTestId('copy-tab-platform').click();
  await page.getByTestId('copy-confirm').click();
  await expect(page.getByTestId('copy-dialog')).toHaveCount(0);
  const copied = await page.evaluate(() => (window as unknown as { __copied?: string }).__copied ?? '');
  expect(copied).toBe(platform);
});

test('카카오 장르 힌트는 선택한 장르 하나만, 오늘 비교 줄도 계산된다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await resetWriter(page);
  await page.getByTestId('work-card').filter({ hasText: '달빛' }).getByTestId('work-goal-line').click();
  await page.getByTestId('work-goal-preset-kakao').click();
  await expect(page.getByTestId('work-goal-hint')).toContainText(/장르를 고르면/);
  await page.getByTestId('work-goal-genre').selectOption('romance');
  await expect(page.getByTestId('work-goal-hint')).toContainText('~80');
  await expect(page.getByTestId('work-goal-hint')).not.toContainText('판타지');
  // 오늘 쓴 글자수와 필요량 비교(사실만)
  await expect(page.getByTestId('work-goal-today')).toContainText(/오늘 [\d,]+자 · 필요량의 \d+%/);
  await page.keyboard.press('Escape');
});

test('일반 모드에는 목표선·복사 버튼이 DOM 에 없다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await resetWriter(page, { mode: false });
  await page.locator('aside.sidebar [data-path="회차.md"]').click();
  await expect(page.getByTestId('work-goal-line')).toHaveCount(0);
  await expect(page.getByTestId('copy-open')).toHaveCount(0);
});

test('영어 문구로 보인다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await resetWriter(page, { locale: 'en' });
  await expect(page.getByTestId('work-goal-line')).toHaveText(/episodes/);
  await page.getByTestId('work-goal-line').click();
  await expect(page.getByTestId('work-goal-dialog')).toContainText('Work goal');
  // 영어 복수형: 현재 회차가 1 이하일 때 단수 문구가 나온다(데이터는 2회차라 other).
  await expect(page.getByTestId('work-goal-summary')).toContainText(/episodes left/);
  await page.keyboard.press('Escape');
});
