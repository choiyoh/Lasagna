import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// 작가 모드(W3): 사이드바 '작품' 섹션 — 카드·칩·새 캐릭터·글자수 갱신·일반 모드 불변.
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

async function resetWriter(page: Page, opts: { mode?: boolean; locale?: 'ko' | 'en' } = {}): Promise<void> {
  const mode = opts.mode ?? true;
  const language = opts.locale ?? 'ko';
  await page.evaluate(
    (next) => window.nops.settings.setLanguage({ language: next.language, writerMode: next.mode, writerSpacing: 'include' }),
    { mode, language },
  );
  await expect(page.locator('html')).toHaveAttribute('lang', language);
}

async function prompt(page: Page, text: string): Promise<void> {
  const input = page.locator('.nops-prompt input');
  await expect(input).toBeVisible();
  await input.fill(text);
  await input.press('Enter');
}

async function createWork(page: Page, name: string): Promise<void> {
  await page.getByTestId('settings-btn').click();
  await page.getByTestId('work-create').click();
  await prompt(page, name);
  await page.keyboard.press('Escape');
}

test.beforeAll(async () => {
  test.setTimeout(240_000);
  base = mkdtempSync(path.join(tmpdir(), 'nops-sidebar-'));
  vaultDir = path.join(base, 'Demo');
  userDataDir = path.join(base, 'userdata');
  mkdirSync(vaultDir, { recursive: true });
  writeFileSync(path.join(vaultDir, '메모.md'), '# 메모\n\n본문\n');
  app = await launch();
});

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  if (base) rmSync(base, { recursive: true, force: true });
});

test('작품 카드가 0회차·0자로 보이고, 새 캐릭터가 시트로 열린다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await resetWriter(page);
  await createWork(page, '달빛 조각사');
  await expect(page.getByTestId('work-card')).toHaveCount(1);
  await expect(page.getByTestId('work-meta')).toHaveText(/0회차 · 0자/);
  await expect(page.getByTestId('work-chip-characters')).toHaveText(/캐릭터 0/);

  await page.getByTestId('new-character').click();
  await prompt(page, '서연');
  await expect(page.locator('.ProseMirror h1')).toHaveText('서연');
  const file = path.join(vaultDir, '달빛 조각사', '캐릭터', '서연.md');
  expect(readFileSync(file, 'utf8')).toContain('name: 서연');
  await expect(page.getByTestId('work-chip-characters')).toHaveText(/캐릭터 1/);

  // 두 번째 캐릭터를 만들면 노트 제목(첫 H1)이 각자 이름이다 — 둘 다 '캐릭터 시트'로 보이지 않는다.
  await page.getByTestId('new-character').click();
  await prompt(page, '도윤');
  await expect(page.locator('.ProseMirror h1')).toHaveText('도윤');
  expect(readFileSync(path.join(vaultDir, '달빛 조각사', '캐릭터', '도윤.md'), 'utf8')).toContain('name: 도윤');
  await expect(page.locator('aside.sidebar [data-path="달빛 조각사/캐릭터/도윤.md"]')).toContainText('도윤');
  await expect(page.getByTestId('work-chip-characters')).toHaveText(/캐릭터 2/);
  await expect(page.getByTestId('work-add')).toHaveText(/\+ 작품 만들기/);

  // 일일 목표가 설정돼 있으면 카드에 오늘 진행 막대가 보인다(W1b 같은 값)
  await page.evaluate(() => window.nops.settings.setLanguage({ writerDailyGoal: 3000 }));
  await expect(page.getByTestId('work-card').locator('.workcard__goal')).toBeVisible();
  await expect(page.getByTestId('work-card')).toContainText('오늘');
});

test('회차 글자수가 카드에 반영되고, 입력·저장 후에도 갱신된다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await resetWriter(page);
  const episode = path.join(vaultDir, '달빛 조각사', '회차', '1화.md');
  writeFileSync(episode, '# 1화\n\n가나다라마바사아자차\n'); // 본문 10자(+제목 2자)
  await expect(page.getByTestId('work-meta')).toHaveText(/1회차 · 12자/, { timeout: 10_000 });
  await page.locator('aside.sidebar').getByRole('button', { name: '1화', exact: true }).click();
  await page.locator('.ProseMirror p').last().click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('추가');
  await expect(page.getByTestId('work-meta')).toHaveText(/1회차 · 14자/, { timeout: 15_000 });
});

test('캐릭터 칩을 누르면 파일 트리에서 캐릭터 폴더가 펼쳐진다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await resetWriter(page);
  await page.getByTestId('work-chip-characters').click();
  // 캐릭터 노트의 H1 은 템플릿 그대로('캐릭터 시트')이므로 파일 경로로 확인한다.
  await expect(page.locator('aside.sidebar [data-path="달빛 조각사/캐릭터/서연.md"]')).toBeVisible({ timeout: 10_000 });
});

test('일반 모드에는 작품 섹션이 DOM 에 없고, 다시 켜면 그대로 보인다(재시작)', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await resetWriter(page, { mode: false });
  await expect(page.getByTestId('work-section')).toHaveCount(0);
  await resetWriter(page);
  await expect(page.getByTestId('work-section')).toHaveCount(1);

  await app.close();
  app = await launch();
  const again = await app.firstWindow();
  await openVaultIfNeeded(again);
  await expect(again.getByTestId('work-section')).toHaveCount(1); // 작가 모드 설정은 재시작해도 유지된다
  await resetWriter(again);
  await expect(again.getByTestId('work-card')).toHaveCount(1);
});

test('영어로 바꾸면 영어 문구로 보인다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await resetWriter(page, { locale: 'en' });
  await expect(page.getByTestId('work-section')).toContainText('Work');
  await expect(page.getByTestId('work-meta')).toHaveText(/1 episodes · 14 characters/);
  await expect(page.getByTestId('work-chip-characters')).toHaveText(/Characters/);
  await expect(page.getByTestId('work-add')).toHaveText(/\+ New work/);
});

test('한국어로 만든 작품을 영어 UI 에서 열어도 그 작품의 한국어 템플릿을 복사한다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await resetWriter(page, { locale: 'en' });
  await page.getByTestId('new-character').click();
  await prompt(page, 'Ha-eun');
  const file = path.join(vaultDir, '달빛 조각사', '캐릭터', 'Ha-eun.md');
  await expect.poll(() => readFileSync(file, 'utf8').includes('name: Ha-eun'), { timeout: 10_000 }).toBe(true);
  const content = readFileSync(file, 'utf8');
  // 작품 템플릿(한국어)을 그대로 복사 — 영어 기본 시트(Appearance)로 대체되지 않는다
  expect(content).toContain('## 외모');
  expect(content).not.toContain('## Appearance');
  expect(content).toContain('first_appears:');
});
