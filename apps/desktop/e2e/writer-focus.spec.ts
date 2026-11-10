import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// 작가 모드(W4b): 선택 글자수·집중 모드(⌘⇧M)·타자기 스크롤·글꼴 설정.
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

async function openNote(page: Page): Promise<void> {
  await openVaultIfNeeded(page);
  await revealEpisode(page);
  await page.locator('aside.sidebar [data-path="작품/회차/회차.md"]').click();
  await expect(page.locator('.ProseMirror')).toBeVisible();
}


/** 사이드바에서 작품/회차 폴더를 펼쳐 회차 노트가 보이게 한다(W6 픽스처는 작품/회차 아래에 있다). */
async function revealEpisode(page: Page): Promise<void> {
  for (const name of ['작품', '회차']) {
    const box = page
      .locator('aside.sidebar details')
      .filter({ has: page.locator('summary', { hasText: new RegExp(`^${name}$`) }) })
      .first();
    if ((await box.count()) && !(await box.evaluate((el) => el.hasAttribute('open')))) await box.locator('summary').click();
  }
}

test.beforeAll(async () => {
  test.setTimeout(240_000);
  base = mkdtempSync(path.join(tmpdir(), 'nops-focus-'));
  vaultDir = path.join(base, 'Demo');
  noteDir = path.join(vaultDir, '작품', '회차');
  mkdirSync(noteDir, { recursive: true });
  mkdirSync(path.join(vaultDir, '작품', '캐릭터'), { recursive: true });
  mkdirSync(vaultDir, { recursive: true });
  writeFileSync(path.join(noteDir, '회차.md'), '# 1화\n\n가나다라마바사아자차\n\n' + Array.from({ length: 600 }, () => '문단입니다.').join('\n\n') + '\n');
  app = await launch();
});

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  if (base) rmSync(base, { recursive: true, force: true });
});

test('선택하면 선택 글자수가, 해제하면 전체 글자수가 보인다(IME 조합 중 미갱신)', async () => {
  const page = await app.firstWindow();
  await openNote(page);
  await resetWriter(page);
  await page.locator('.ProseMirror p').first().click();
  await page.keyboard.press('ControlOrMeta+End');
  for (let i = 0; i < 5; i += 1) await page.keyboard.press('Shift+ArrowLeft');
  await expect(page.getByTestId('writer-selection')).toContainText(/선택 5 \/ 전체 [\d,]+/);
  // 선택 해제 → 전체 표시
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('writer-chars')).toHaveText(/자 · 공백 포함/);
  await expect(page.getByTestId('writer-selection')).toHaveCount(0);

  // 영어 문구
  await resetWriter(page, { locale: 'en' });
  for (let i = 0; i < 3; i += 1) await page.keyboard.press('Shift+ArrowLeft');
  await expect(page.getByTestId('writer-selection')).toContainText(/selected/);
  await resetWriter(page);
});

test('⌘⇧M 으로 집중 모드에 들어가고 Esc 로 나온다', async () => {
  const page = await app.firstWindow();
  await openNote(page);
  await resetWriter(page);
  await page.keyboard.press('ControlOrMeta+Shift+M');
  await expect(page.getByTestId('workspace')).toHaveClass(/workspace--focus/);
  await expect(page.locator('aside.sidebar')).toBeHidden();
  await expect(page.locator('.rightdock')).toBeHidden();
  await expect(page.locator('.tabbar')).toBeHidden();
  // 크롬은 마우스를 움직이면 보인다
  await page.mouse.move(600, 300);
  await expect(page.getByTestId('focus-chrome')).toBeVisible();
  await expect(page.getByTestId('focus-exit')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('workspace')).not.toHaveClass(/workspace--focus/);
  await expect(page.locator('aside.sidebar')).toBeVisible();
  await expect(page.locator('.tabbar')).toBeVisible();
});

test('작가 모드 OFF 에서는 ⌘⇧M 이 아무 일도 하지 않는다', async () => {
  const page = await app.firstWindow();
  await openNote(page);
  await resetWriter(page, { mode: false });
  await page.keyboard.press('ControlOrMeta+Shift+M');
  await expect(page.getByTestId('workspace')).not.toHaveClass(/workspace--focus/);
  await expect(page.locator('aside.sidebar')).toBeVisible();
});

test('집중 모드 타자기 스크롤은 커서 줄을 화면 위쪽으로 맞춘다', async () => {
  const page = await app.firstWindow();
  await openNote(page);
  await resetWriter(page);
  await page.locator('.ProseMirror p').last().click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('ControlOrMeta+Shift+M');
  await expect(page.getByTestId('workspace')).toHaveClass(/workspace--focus/);
  // 집중 모드 진입 뒤 한 번 더 커서를 움직여 타자기 스크롤을 확정한다.
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowRight');
  // 편집기 영역(.pane__body)이 실제 스크롤 컨테이너 — 타자기 스크롤로 커서 줄까지 내려간다.
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const el = document.querySelector('.ProseMirror-focused') ?? document.querySelector('.ProseMirror');
          let p: HTMLElement | null = el instanceof HTMLElement ? el.parentElement : null;
          while (p && p !== document.body && p.scrollHeight <= p.clientHeight + 4) p = p.parentElement;
          return p && p !== document.body ? p.scrollTop : -1;
        }),
      { timeout: 10_000 },
    )
    .toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('workspace')).not.toHaveClass(/workspace--focus/);
});

test('920px 에서는 집중 모드 본문 폭이 560px 이고, 일반 모드에서는 폭이 그대로다', async () => {
  const page = await app.firstWindow();
  await openNote(page);
  await resetWriter(page);
  await page.setViewportSize({ width: 900, height: 800 });
  const normal = await page.locator('.ProseMirror').boundingBox();
  await page.keyboard.press('ControlOrMeta+Shift+M');
  await expect(page.getByTestId('workspace')).toHaveClass(/workspace--focus/);
  const focus = await page.locator('.ProseMirror').boundingBox();
  expect(focus?.width ?? 0).toBeLessThanOrEqual(560);
  expect(focus?.width ?? 0).toBeLessThan(normal?.width ?? 1);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('workspace')).not.toHaveClass(/workspace--focus/);
  await page.setViewportSize({ width: 1440, height: 900 });
});

test('집중 모드 글꼴을 바꾸면 재시작해도 유지된다', async () => {
  const page = await app.firstWindow();
  await openNote(page);
  await resetWriter(page);
  await page.keyboard.press('ControlOrMeta+Shift+M');
  await page.mouse.move(600, 300);
  await page.getByTestId('focus-font-serif').click();
  await expect(page.getByTestId('workspace')).toHaveAttribute('data-font', 'serif');

  await app.close();
  app = await launch();
  const again = await app.firstWindow();
  await openNote(again);
  await resetWriter(again);
  await again.keyboard.press('ControlOrMeta+Shift+M');
  await expect(again.getByTestId('workspace')).toHaveAttribute('data-font', 'serif');
  await again.keyboard.press('Escape');
  await expect(again.getByTestId('workspace')).not.toHaveClass(/workspace--focus/);
});

test('집중 모드에서 도크를 열면 집중 모드를 끝내고 도크를 보여 준다', async () => {
  const page = await app.firstWindow();
  await openNote(page);
  await resetWriter(page);
  await page.keyboard.press('ControlOrMeta+Shift+M');
  await expect(page.getByTestId('workspace')).toHaveClass(/workspace--focus/);
  await page.keyboard.press('ControlOrMeta+Shift+Backslash');
  await expect(page.getByTestId('workspace')).not.toHaveClass(/workspace--focus/);
  await expect(page.locator('.rightdock')).toBeVisible();
  await expect(page.locator('aside.sidebar')).toBeVisible();
});

test('집중 모드에서 Esc 는 찾기 막대를 먼저 닫고, 다음 Esc 가 집중 모드를 끝낸다', async () => {
  const page = await app.firstWindow();
  await openNote(page);
  await resetWriter(page);
  await page.keyboard.press('ControlOrMeta+Shift+M');
  await expect(page.getByTestId('workspace')).toHaveClass(/workspace--focus/);
  await page.keyboard.press('ControlOrMeta+f');
  await expect(page.getByTestId('find-bar')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('find-bar')).toHaveCount(0);
  await expect(page.getByTestId('workspace')).toHaveClass(/workspace--focus/);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('workspace')).not.toHaveClass(/workspace--focus/);
});

test('IME 조합이 시작돼도 선택 글자수는 지워지지 않고 마지막 값을 유지한다', async () => {
  const page = await app.firstWindow();
  await openNote(page);
  await resetWriter(page);
  await page.locator('.ProseMirror p').first().click();
  await page.keyboard.press('ControlOrMeta+End');
  for (let i = 0; i < 4; i += 1) await page.keyboard.press('Shift+ArrowLeft');
  const before = await page.getByTestId('writer-selection').innerText();
  await page.evaluate(() => {
    document.querySelector('.ProseMirror')?.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  });
  await page.waitForTimeout(200);
  await expect(page.getByTestId('writer-selection')).toHaveText(before); // 조합 중에도 유지
  await page.evaluate(() => {
    document.querySelector('.ProseMirror')?.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
  });
  await expect(page.getByTestId('writer-selection')).toContainText('선택');
});

test('문서 중간 문단을 클릭하고 입력해도 캐럿은 화면 42% 근처에 머문다', async () => {
  const page = await app.firstWindow();
  await openNote(page);
  await resetWriter(page);
  await page.keyboard.press('ControlOrMeta+Shift+M');
  await expect(page.getByTestId('workspace')).toHaveClass(/workspace--focus/);

  const ratio = () =>
    page.evaluate(() => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return -1;
      const caret = sel.getRangeAt(0).getBoundingClientRect();
      const pane = document.querySelector('.pane__body')?.getBoundingClientRect();
      if (!pane || pane.height === 0) return -1;
      return (caret.top - pane.top) / pane.height;
    });

  await page.locator('.ProseMirror p').nth(14).click();
  // 디바운스(60ms) 뒤 커서 줄이 42%로 내려온다.
  await expect.poll(ratio, { timeout: 10_000 }).toBeLessThan(0.6);
  expect(await ratio()).toBeGreaterThan(0.25);

  await page.keyboard.type('입력');
  await expect.poll(ratio, { timeout: 10_000 }).toBeLessThan(0.6);
  expect(await ratio()).toBeGreaterThan(0.25);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('workspace')).not.toHaveClass(/workspace--focus/);
});
