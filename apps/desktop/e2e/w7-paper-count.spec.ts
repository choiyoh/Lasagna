import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { waitForWatcher, writeExternalNote } from './watcher';

// W7: 원고지 매수 표시 — 회차 노트 상태줄의 전체 글자수 뒤에만, 작가 모드 설정을 켰을 때.
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
  test.setTimeout(240_000);
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

async function setWriter(page: Page, on = true, locale: 'ko' | 'en' = 'ko'): Promise<void> {
  await page.evaluate(
    (next) => window.nops.settings.setLanguage({ language: next.locale, writerMode: next.mode, writerSpacing: 'include' }),
    { locale, mode: on },
  );
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
}

async function openEpisode(page: Page): Promise<void> {
  await openVaultIfNeeded(page);
  const row = page.locator('aside.sidebar [data-path="작품/회차/1화.md"]');
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();
  await expect(page.locator('.ProseMirror h1')).toHaveText('1화');
  await expect(page.getByTestId('writer-status')).toBeVisible();
}

/** 설정의 원고지 스위치(설정은 바로 저장된다). */
async function togglePaperSetting(page: Page, on: boolean): Promise<void> {
  await page.getByTestId('settings-btn').click();
  const box = page.getByTestId('writer-paper-count');
  await expect(box).toBeVisible();
  if (on) await box.check();
  else await box.uncheck();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: /설정|Settings/ })).toHaveCount(0);
}

test.beforeAll(async () => {
  base = mkdtempSync(path.join(tmpdir(), 'nops-w7-'));
  vaultDir = path.join(base, 'Demo');
  mkdirSync(path.join(vaultDir, '작품', '회차'), { recursive: true });
  mkdirSync(path.join(vaultDir, '작품', '캐릭터'), { recursive: true });
  // 1화 = 2자 + 본문 '가' 4,000자 + 공백 50자 + '나' 319자 = 4,371자(공백 포함) / 4,321자(제외)
  // (줄 끝 공백은 마크다운이 지우므로 공백은 글자 사이에 둔다.)
  writeExternalNote(path.join(vaultDir, '작품', '회차', '1화.md'), `# 1화\n\n${'가'.repeat(4000)}${' '.repeat(50)}${'나'.repeat(319)}\n`);
  // 2화 = 문서 목표(5,000자)가 있고 단어가 1,201개인 현실적 분량의 회차(영어 접힘 측정용)
  // '가나다' 1,201개를 공백으로 이으면 공백 포함 4,805자(2+1,201×3+1,200)·단어 1,201개.
  writeExternalNote(path.join(vaultDir, '작품', '회차', '2화.md'), `---\ngoal_chars: 5000\n---\n# 2화\n\n${Array.from({ length: 1201 }, () => '가나다').join(' ')}\n`);
  writeExternalNote(path.join(vaultDir, '작품', '캐릭터', '주인공.md'), '# 주인공\n\n외모\n');
  app = await launch();
});

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  if (base) rmSync(base, { recursive: true, force: true });
});

test('설정을 켜면 회차 상태줄 전체 글자수 뒤에 원고지 매수가 붙고, 끄면 사라진다', async () => {
  const page = await app.firstWindow();
  await setWriter(page);
  await openEpisode(page);
  // 기본은 꺼짐 — 매수 표시가 없다
  await expect(page.getByTestId('writer-paper')).toHaveCount(0);

  await togglePaperSetting(page, true);
  await expect(page.getByTestId('writer-chars')).toContainText('4,371자 · 공백 포함');
  await expect(page.getByTestId('writer-paper')).toHaveText(' · 원고지 21.9매');

  // 공백 제외로 바꾸면 같은 규칙으로 매수도 바뀐다(4,321 → 21.6)
  await page.evaluate(() => window.nops.settings.setLanguage({ writerSpacing: 'exclude' }));
  await expect(page.getByTestId('writer-chars')).toContainText('4,321자 · 공백 제외');
  await expect(page.getByTestId('writer-paper')).toHaveText(' · 원고지 21.6매');

  await togglePaperSetting(page, false);
  await expect(page.getByTestId('writer-paper')).toHaveCount(0);
});

test('켠 상태는 앱을 다시 열어도 유지된다(설정 파일)', async () => {
  const page = await app.firstWindow();
  await setWriter(page);
  await openEpisode(page);
  await togglePaperSetting(page, true);
  await expect(page.getByTestId('writer-paper')).toHaveText(/원고지 21\.9매/);

  await app.close();
  app = await launch();
  const again = await app.firstWindow();
  await openEpisode(again);
  await expect(again.getByTestId('writer-paper')).toHaveText(/원고지 21\.9매/);
});

test('920px 에서는 라벨을 줄이고 상태줄 높이·가로 넘침이 그대로다', async () => {
  const page = await app.firstWindow();
  await setWriter(page);
  await openEpisode(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const wide = (await page.getByTestId('writer-status').boundingBox())!.height;
  await expect(page.getByTestId('writer-paper')).toHaveText(/원고지 21\.9매/);

  await page.setViewportSize({ width: 900, height: 800 });
  await expect(page.getByTestId('writer-paper')).toHaveText(' · 21.9매');
  const narrow = await page.evaluate(() => {
    const bar = document.querySelector('[data-testid="writer-status"]')!;
    return { height: bar.getBoundingClientRect().height, overflow: bar.scrollWidth - bar.clientWidth };
  });
  expect(Math.abs(narrow.height - wide)).toBeLessThanOrEqual(1);
  expect(narrow.overflow).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1440, height: 900 });
});

test('영어에서는 짧은 pages 문구로 보인다', async () => {
  const page = await app.firstWindow();
  await openEpisode(page);
  await setWriter(page, true, 'en');
  await expect(page.getByTestId('writer-paper')).toHaveText(' · 21.9 pages');
  await setWriter(page);
});

test('영어에서 문서 목표+일일 목표+매수 표시가 겹쳐도 상태줄은 한 줄(≤37px)이다', async () => {
  const page = await app.firstWindow();
  await setWriter(page, true, 'en');
  await openVaultIfNeeded(page);
  await page.locator('aside.sidebar [data-path="작품/회차/2화.md"]').click();
  await expect(page.locator('.ProseMirror h1')).toHaveText('2화');
  await page.evaluate(() => window.nops.settings.setLanguage({ writerDailyGoal: 5000 }));
  // 매수 표시를 켠 상태로 맞춘다(앞 테스트가 꺼 두었을 수 있다).
  if ((await page.evaluate(async () => (await window.nops.settings.language()).writerPaperCount)) !== true) await togglePaperSetting(page, true);
  await expect(page.getByTestId('writer-goal')).toBeVisible();
  await expect(page.getByTestId('writer-today')).toBeVisible();

  // 기본 레이아웃(도크는 1,340px 이하에서 접힘)에서 잰다 — 도크를 열어 둔 채 좁히면 본문이 528px 로 눌린다.
  const dockClose = page.locator('.dockbody__close');
  if ((await dockClose.count()) > 0) await dockClose.click();
  for (const width of [1440, 1200, 1100, 1000]) {
    await page.setViewportSize({ width, height: 900 });
    const box = await page.evaluate(() => {
      const bar = document.querySelector('[data-testid="writer-status"]')!;
      return {
        height: bar.getBoundingClientRect().height,
        maxChild: Math.max(...[...bar.children].map((el) => el.getBoundingClientRect().height)),
        width: Math.round(bar.getBoundingClientRect().width),
      };
    });
    console.log(`[W7-en ${width}] ${JSON.stringify(box)}`);
    expect(box.height).toBeLessThanOrEqual(37);
    expect(box.maxChild).toBeLessThanOrEqual(30); // 항목 안에서 줄바꿈 없음(한 줄 ≈18px)
    expect(box.width).toBeGreaterThan(550); // 도크가 접힌 기본 레이아웃
  }

  // 950px 은 참고 측정만 남긴다(≤920 과 같은 좁은 본문 폭이라 이번 범위에서 동작을 바꾸지 않는다).
  await page.setViewportSize({ width: 950, height: 900 });
  const at950 = await page.evaluate(() => {
    const bar = document.querySelector('[data-testid="writer-status"]')!;
    return { height: bar.getBoundingClientRect().height, width: Math.round(bar.getBoundingClientRect().width) };
  });
  console.log(`[W7-en 950] ${JSON.stringify(at950)} (참고)`);

  // 같은 조건의 한국어는 그대로 한 줄
  await page.setViewportSize({ width: 1440, height: 900 });
  await setWriter(page);
  const ko = await page.evaluate(() => document.querySelector('[data-testid="writer-status"]')!.getBoundingClientRect().height);
  expect(ko).toBeLessThanOrEqual(37);

  await page.evaluate(() => window.nops.settings.setLanguage({ writerDailyGoal: null }));
  await setWriter(page, false);
});

test('캐릭터 노트·작가 모드 OFF 에서는 표시가 없다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await setWriter(page);
  await page.locator('aside.sidebar [data-path="작품/캐릭터/주인공.md"]').click();
  await expect(page.locator('.ProseMirror h1')).toHaveText('주인공');
  await expect(page.getByTestId('writer-status')).toHaveCount(0);
  await expect(page.getByTestId('writer-paper')).toHaveCount(0);

  await setWriter(page, false);
  await expect(page.getByTestId('writer-status')).toHaveCount(0);
  await expect(page.getByTestId('writer-paper')).toHaveCount(0);
});
