import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { addDays, dateKey, startOfMonth, startOfWeek } from '@nopsidian/core';

// M1-2 PR 2: 쓰기 통계 창 — 진입점 2곳(작품 카드 '오늘' 줄·⌘P), 범위 전환, 달 이동, Esc·포커스 복귀.
// 데이터는 PR 1 의 userData 통계 파일이며, 이 스펙은 그 파일을 미리 심어 결정적으로 확인한다.
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
const today = dateKey(new Date());
const vaultId = () => createHash('sha256').update(path.resolve(vaultDir)).digest('hex').slice(0, 12);

async function launch(): Promise<ElectronApplication> {
  const launched = await electron.launch({
    executablePath: packagedExecutable(),
    env: { ...process.env, NOPS_E2E: '1' },
    args: ['--use-mock-keychain', `--user-data-dir=${userDataDir}`],
  });
  await launched.firstWindow({ timeout: 90_000 });
  await launched.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dir] })) as typeof dialog.showOpenDialog;
  }, vaultDir);
  return launched;
}

/** 작품 두 개(달빛·별빛)가 있는 볼트 — 작품 인식은 회차+캐릭터 폴더다. */
function makeVault(): void {
  for (const work of ['달빛', '별빛'] as const) {
    mkdirSync(path.join(vaultDir, work, '회차'), { recursive: true });
    mkdirSync(path.join(vaultDir, work, '캐릭터'), { recursive: true });
    writeFileSync(path.join(vaultDir, work, '회차', '1화.md'), `# ${work} 1화\n\n본문\n`);
    writeFileSync(path.join(vaultDir, work, '캐릭터', '주인공.md'), '# 주인공\n');
  }
}

/** 통계 파일을 심는다: 오늘 값은 live(today.vaults), 지난 날짜는 history. */
function seedStats(): void {
  const id = vaultId();
  const yesterday = addDays(today, -1);
  const threeDaysAgo = addDays(today, -3);
  const lastMonth = addDays(today, -40);
  writeFileSync(
    path.join(userDataDir, 'writer-stats.json'),
    JSON.stringify({
      version: 2,
      today: { date: today, vaults: { [id]: { '달빛/회차/1화.md': 1000, '별빛/회차/1화.md': 1140 } } },
      history: {
        [id]: {
          [yesterday]: { total: 1600, works: { 달빛: 1600 }, goal: 3000 },
          [threeDaysAgo]: { total: 3000, works: { 달빛: 3000 } },
          [lastMonth]: { total: 900, works: { 달빛: 900 } },
        },
      },
      pending: {},
    }),
  );
}

async function openVaultIfNeeded(page: Page): Promise<void> {
  const cta = page.locator('.start__cta');
  await expect(cta.or(page.locator('aside.sidebar'))).toBeVisible({ timeout: 60_000 });
  if (await cta.isVisible()) {
    await cta.click();
    await expect(page.locator('aside.sidebar')).toBeVisible({ timeout: 60_000 });
  }
}

/** 그 작품의 회차 노트를 연다 — 작품 카드는 열린 노트의 작품을 펼친다. */
async function openWorkNote(page: Page, work: string): Promise<void> {
  await openVaultIfNeeded(page);
  await page.keyboard.press('ControlOrMeta+o');
  const switcher = page.getByRole('dialog', { name: '빠른 전환기' });
  await expect(switcher).toBeVisible();
  await switcher.getByPlaceholder(/노트 제목·본문 검색/).fill(`${work} 1화`);
  await switcher.getByRole('option').first().click();
  await expect(page.locator('.ProseMirror')).toBeVisible();
}

test.beforeAll(async () => {
  test.setTimeout(240_000);
  base = mkdtempSync(path.join(tmpdir(), 'nops-statsui-'));
  vaultDir = path.join(base, 'Demo');
  userDataDir = path.join(base, 'userdata');
  mkdirSync(userDataDir, { recursive: true });
  makeVault();
  seedStats();
  app = await launch();
});

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  if (base) rmSync(base, { recursive: true, force: true });
});

test('카드의 오늘 줄(목표 없음)과 ⌘P 로 열고, 범위·달·Esc 가 동작한다', async () => {
  const page = await app.firstWindow();
  await openWorkNote(page, '달빛');
  await page.evaluate(() => window.nops.settings.setLanguage({ language: 'ko', writerMode: true, writerSpacing: 'include', writerDailyGoal: null }));
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
  await expect(page.getByTestId('work-card')).toHaveAttribute('data-work', '달빛');

  // 하루 목표가 없어도 카드에 오늘 글자수 줄이 있고, 그 줄이 진입점이다.
  const row = page.getByTestId('work-today-stats');
  await expect(row).toBeVisible();
  await expect(row).toContainText('2,140');
  await expect(row).toHaveAttribute('aria-label', /쓰기 통계 보기/);
  await expect(row.locator('.note-editor__goalbar')).toHaveCount(0); // 목표가 없으면 막대 없음

  // 하루 목표를 켜면 같은 줄이 막대+`n/목표` 로 바뀌고, 그 목표가 오늘 달성 판정에 쓰인다.
  await page.evaluate(() => window.nops.settings.setLanguage({ writerDailyGoal: 2000 }));
  await expect(row.locator('.note-editor__goalbar')).toBeVisible();
  await expect(row).toContainText('2,140/2,000');

  await row.click();
  const dialog = page.getByTestId('stats-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: '쓰기 통계' })).toBeVisible();
  // 초기 초점은 범위 세그먼트의 첫 버튼
  await expect(page.getByTestId('stats-scope-vault')).toBeFocused();
  // 카드에서 열면 그 작품이 범위다: 이번 주 = 오늘 1,000 + 어제 1,600 (+ 이번 주에 든 3,000)
  const weekPart = 1000 + 1600;
  const inWeek = addDays(today, -3) >= startOfWeek(today);
  await expect(page.getByTestId('stats-week')).toContainText((inWeek ? weekPart + 3000 : weekPart).toLocaleString('ko'));

  // 범위를 볼트 전체로 바꾸면 다른 작품 몫이 더해진다.
  await page.getByTestId('stats-scope-vault').click();
  const allWeek = weekPart + 1140;
  await expect(page.getByTestId('stats-week')).toContainText((inWeek ? allWeek + 3000 : allWeek).toLocaleString('ko'));

  // 오늘은 아직 닫히지 않아 기록에 goal 이 없지만, 지금 하루 목표(2,000자)로 달성 표시가 나와야 한다.
  const todayCell = dialog.locator(`.cal__cell[data-date="${today}"]`);
  await expect(todayCell).toHaveClass(/goal/);
  await expect(todayCell).toHaveAttribute('aria-label', /목표 달성/);
  await expect(page.getByTestId('stats-month-sum')).toContainText('목표 달성 1일');
  // 막대 목표선은 막대 영역 눈금(2,000/4,000 = 50%)과 같은 높이여야 한다.
  const geo = await dialog.evaluate((el) => {
    const bars = el.querySelector('.bars')!.getBoundingClientRect();
    const line = el.querySelector('[data-testid="stats-goalline"]')!.getBoundingClientRect();
    return { bottom: bars.bottom, height: bars.height, line: line.top };
  });
  expect(Math.abs(geo.line - (geo.bottom - geo.height * 0.5))).toBeLessThanOrEqual(1);

  // 작품 선택으로 다른 작품을 고르면 오늘 값만 남는다.
  await page.getByTestId('stats-scope-work').selectOption('별빛');
  await expect(page.getByTestId('stats-week')).toContainText('1,140');
  await expect(page.getByTestId('stats-streak')).toContainText('일');

  // 달 이동: 지난달에는 900자 기록이 있다.
  await page.getByTestId('stats-scope-vault').click();
  await page.getByTestId('stats-prev-month').click();
  const prev = addDays(startOfMonth(today), -1);
  await expect(dialog.locator('.cal__title')).toContainText(new Intl.DateTimeFormat('ko', { year: 'numeric', month: 'long' }).format(new Date(`${prev}T12:00:00`)));
  await expect(page.getByTestId('stats-month-sum')).toContainText('900');
  await expect(page.getByTestId('stats-next-month')).toBeEnabled();
  await page.getByTestId('stats-next-month').click();
  await expect(page.getByTestId('stats-next-month')).toBeDisabled(); // 이번 달이 마지막

  // 숫자로 보기 표
  await page.getByTestId('stats-toggle-numbers').click();
  await expect(page.getByTestId('stats-numbers')).toBeVisible();
  await expect(page.getByTestId('stats-numbers')).toContainText('2,140');
  // 오늘 행의 목표 열에는 '달성'이 보인다(그날 목표 기준).
  await expect(page.getByTestId('stats-numbers').locator('tbody tr').last()).toContainText('달성');
  await page.getByTestId('stats-toggle-numbers').click();
  await expect(page.getByTestId('stats-numbers')).toHaveCount(0);

  // 대화상자 안 빈 곳을 눌러 포커스가 빠져도 Esc 로 닫힌다(설정 대화상자와 같은 동작).
  await page.getByTestId('stats-summary').click();
  await expect(page.evaluate(() => document.activeElement?.tagName)).resolves.toBe('BODY');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  // 다시 열어 진입점 복귀까지 확인한다.
  await row.click();
  await expect(page.getByTestId('stats-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('work-today-stats')).toBeFocused();

  // ⌘P 명령으로도 열린다.
  await page.keyboard.press('ControlOrMeta+p');
  const palette = page.getByTestId('command-palette');
  await expect(palette).toBeVisible();
  const command = palette.getByRole('option', { name: /쓰기 통계/ });
  await expect(command).toBeVisible();
  await command.click();
  await expect(page.getByTestId('stats-dialog')).toBeVisible();
  await expect(page.getByTestId('stats-scope-vault')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('stats-dialog')).toHaveCount(0);
});
