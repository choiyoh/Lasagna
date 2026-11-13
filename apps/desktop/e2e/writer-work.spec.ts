import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { selectSettingsPage } from './settings';
import {mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { waitForWatcher, writeExternalNote } from './watcher';
import { workCard } from './work-list';

// 작가 모드(W2): '작품 만들기' — 폴더 구조·템플릿 노트·중복/이름 검증·일반 모드 불변.
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
  await waitForWatcher(page);
}

/** 테스트마다 언어와 작가 모드를 스스로 맞춘다. */
async function resetWriter(page: Page, opts: { mode?: boolean; locale?: 'ko' | 'en' } = {}): Promise<void> {
  const mode = opts.mode ?? true;
  const language = opts.locale ?? 'ko';
  await page.evaluate(
    (next) => window.nops.settings.setLanguage({ language: next.language, writerMode: next.mode, writerSpacing: 'include' }),
    { mode, language },
  );
  await expect(page.locator('html')).toHaveAttribute('lang', language);
}

/** 원자적 쓰기(.nops-tmp-*)가 끝나고 기대한 템플릿 3개가 다 생길 때까지 기다린다. */
async function waitForTemplates(work: string): Promise<void> {
  const dir = path.join(vaultDir, work, '템플릿');
  await expect
    .poll(
      () => {
        try {
          return readdirSync(dir)
            .filter((f) => f.endsWith('.md') && !f.includes('.nops-tmp-'))
            .sort()
            .join(',');
        } catch {
          return '';
        }
      },
      { timeout: 15_000 },
    )
    .toBe('세계관·복선.md,캐릭터 시트.md,회차.md');
  // rename 이 끝나 임시 파일이 남아 있지 않은 상태에서만 목록을 단언한다.
  await expect
    .poll(() => {
      try {
        return readdirSync(dir).some((f) => f.includes('.nops-tmp-'));
      } catch {
        return true;
      }
    }, { timeout: 10_000 })
    .toBe(false);
}

/** 텍스트 프롬프트(캐릭터·회차 이름) */
async function prompt(page: Page, text: string): Promise<void> {
  const input = page.locator('.nops-prompt input');
  await expect(input).toBeVisible();
  await input.fill(text);
  await input.press('Enter');
}

async function createWork(page: Page, name: string, kind: 'serial' | 'publish' = 'serial'): Promise<void> {
  await page.getByTestId('settings-btn').click();
  await selectSettingsPage(page, '작가 모드');
  await page.getByTestId('work-create').click();
  await expect(page.getByTestId('work-dialog')).toBeVisible();
  await page.getByTestId('work-dialog-name').fill(name);
  if (kind === 'publish') await page.getByTestId('work-structure-publish').click();
  await page.getByTestId('work-dialog-create').click();
  await expect(page.getByTestId('work-dialog')).toHaveCount(0);
  await page.keyboard.press('Escape'); // 설정 대화상자 닫기
}

test.beforeAll(async () => {
  test.setTimeout(240_000);
  base = mkdtempSync(path.join(tmpdir(), 'nops-work-'));
  vaultDir = path.join(base, 'Demo');
  mkdirSync(vaultDir, { recursive: true });
  writeExternalNote(path.join(vaultDir, '메모.md'), '# 메모\n\n본문\n');
  app = await launch();
});

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  if (base) rmSync(base, { recursive: true, force: true });
});

test('작가 모드 토글만으로는 볼트에 아무 파일도 생기지 않는다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  const before = readdirSync(vaultDir).sort();
  await resetWriter(page, { mode: true });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  expect(readdirSync(vaultDir).sort()).toEqual(before);
  // 일반 모드에는 작품 만들기 버튼이 없다
  await resetWriter(page, { mode: false });
  await page.getByTestId('settings-btn').click();
  await expect(page.getByTestId('work-create')).toHaveCount(0);
  await page.keyboard.press('Escape');
});

test('작품을 만들면 폴더 구조와 템플릿 노트가 생기고 캐릭터 시트가 열린다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await resetWriter(page);
  await createWork(page, '달빛 조각사');
  await page.keyboard.press('Escape');

  for (const folder of ['회차', '캐릭터', '설정집', '템플릿']) {
    await expect.poll(() => statSync(path.join(vaultDir, '달빛 조각사', folder)).isDirectory(), { timeout: 15_000 }).toBe(true);
  }
  await waitForTemplates('달빛 조각사');
  const templates = readdirSync(path.join(vaultDir, '달빛 조각사', '템플릿')).sort();
  expect(templates).toEqual(['세계관·복선.md', '캐릭터 시트.md', '회차.md'].sort());
  // 캐릭터 시트가 열리고 속성 키는 영문, 섹션은 한국어
  const sheet = readFileSync(path.join(vaultDir, '달빛 조각사', '템플릿', '캐릭터 시트.md'), 'utf8');
  expect(sheet).toContain('name:');
  expect(sheet).toContain('first_appears:');
  expect(sheet).toContain('## 외모');
  await expect(page.locator('.ProseMirror h1')).toHaveText('캐릭터 시트');
  // 회차 템플릿에는 goal_chars 가 없다
  expect(readFileSync(path.join(vaultDir, '달빛 조각사', '템플릿', '회차.md'), 'utf8')).not.toContain('goal_chars');
});

test('같은 이름으로 다시 만들면 오류를 알리고 기존 파일은 바이트 그대로다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await resetWriter(page);
  const file = path.join(vaultDir, '달빛 조각사', '템플릿', '캐릭터 시트.md');
  await waitForTemplates('달빛 조각사'); // 앞 테스트가 만든 파일이라도 쓰기가 끝났는지 확인하고 읽는다
  const before = readFileSync(file);
  const stamp = statSync(file).mtimeMs;
  await createWork(page, '달빛 조각사');
  await expect(page.locator('.toast')).toContainText(/이미 있어요|already exists/);
  await page.keyboard.press('Escape');
  expect(readFileSync(file).equals(before)).toBe(true);
  expect(statSync(file).mtimeMs).toBe(stamp);
});

test('쓸 수 없는 이름은 대화상자에서 거부하고 아무것도 만들지 않는다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await resetWriter(page);
  const before = readdirSync(vaultDir).sort();
  await page.getByTestId('settings-btn').click();
  await selectSettingsPage(page, '작가 모드');
  await page.getByTestId('work-create').click();
  await page.getByTestId('work-dialog-name').fill('가/나');
  await page.getByTestId('work-dialog-create').click();
  // 대화상자는 열린 채로 입력칸 아래 오류를 보여 준다
  await expect(page.getByTestId('work-dialog-error')).toContainText(/쓸 수 없는 문자|characters/);
  await expect(page.getByTestId('work-dialog')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  expect(readdirSync(vaultDir).sort()).toEqual(before);
});

test('영어로 바꾼 뒤 만들면 영어 폴더·템플릿 이름으로 만들어진다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await resetWriter(page, { locale: 'en' });
  await createWork(page, 'Moonlight');
  await page.keyboard.press('Escape');
  for (const folder of ['Episodes', 'Characters', 'Story bible', 'Templates']) {
    expect(statSync(path.join(vaultDir, 'Moonlight', folder)).isDirectory()).toBe(true);
  }
  // 저장은 원자적 쓰기(임시 파일 → rename)라 목록이 잠깐 임시 파일을 포함할 수 있다 — 세 노트가 다 보일 때까지 기다린다.
  const templatesDir = path.join(vaultDir, 'Moonlight', 'Templates');
  await expect
    .poll(() => readdirSync(templatesDir).filter((f) => f.endsWith('.md')).sort().join(','), { timeout: 10_000 })
    .toBe('Character sheet.md,Episode.md,Worldbuilding.md');
  const sheet = readFileSync(path.join(vaultDir, 'Moonlight', 'Templates', 'Character sheet.md'), 'utf8');
  expect(sheet).toContain('## Appearance');
  expect(sheet).toContain('first_appears:');
});

test('일반 모드에서는 작품 만들기 버튼도, 폴더도 생기지 않는다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await resetWriter(page, { mode: false });
  const before = readdirSync(vaultDir).sort();
  await page.getByTestId('settings-btn').click();
  await expect(page.getByTestId('work-create')).toHaveCount(0);
  await page.keyboard.press('Escape');
  expect(readdirSync(vaultDir).sort()).toEqual(before); // 일반 모드 조작으로는 아무 폴더도 생기지 않는다
});

test('출판형 구조를 고르면 폴더 8개와 템플릿만 만들고, 새 회차는 원고 폴더에 생긴다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await resetWriter(page);
  await createWork(page, '출판작', 'publish');
  for (const folder of ['원고', '교정', '시놉시스 양식', '표지', '인세지급', '캐릭터', '설정집', '템플릿']) {
    await expect.poll(() => statSync(path.join(vaultDir, '출판작', folder)).isDirectory(), { timeout: 15_000 }).toBe(true);
  }
  const dir = path.join(vaultDir, '출판작', '템플릿');
  await expect.poll(() => readdirSync(dir).filter((f) => f.endsWith('.md')).sort().join(','), { timeout: 15_000 }).toBe('세계관·복선.md,캐릭터 시트.md,회차.md');
  // 원고·교정 폴더에는 샘플 파일을 만들지 않는다
  expect(readdirSync(path.join(vaultDir, '출판작', '원고'))).toEqual([]);
  expect(readdirSync(path.join(vaultDir, '출판작', '교정'))).toEqual([]);
  await expect(await workCard(page, '출판작')).toBeVisible({ timeout: 15_000 });

  // + 새 회차 → 원고 폴더 바로 아래
  await (await workCard(page, '출판작')).getByTestId('new-episode').click();
  await prompt(page, '1화');
  const row = page.locator('aside.sidebar [data-path$="출판작/원고/1화.md"]');
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row.getByTestId('tree-badge')).toHaveText('2');

  // 교정 폴더 노트는 회차 수·글자수에서 제외된다
  writeExternalNote(path.join(vaultDir, '출판작', '교정', '1교.md'), '# 1교\n\n교정 메모 문장\n');
  await expect.poll(
    async () => (await (await workCard(page, '출판작')).getByTestId('work-meta').innerText()),
    { timeout: 15_000 },
  ).toMatch(/1회차 · 2자/); // 원고/1화('1화' 2자)만 — 교정 노트는 제외
});

test('이름이 비면 오류를 보여 주고 구조 선택은 유지된다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await resetWriter(page);
  await page.getByTestId('settings-btn').click();
  await selectSettingsPage(page, '작가 모드');
  await page.getByTestId('work-create').click();
  await page.getByTestId('work-structure-publish').click();
  await expect(page.getByTestId('work-structure-publish')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('work-dialog-create').click();
  await expect(page.getByTestId('work-dialog-error')).toContainText(/이름|name/i);
  await expect(page.getByTestId('work-structure-publish')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape'); // 대화상자 닫기
  await page.keyboard.press('Escape'); // 설정 닫기
});

test('영어로 바꾼 뒤 출판형을 만들면 영어 폴더 이름', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await resetWriter(page, { locale: 'en' });
  await createWork(page, 'Moon', 'publish');
  for (const folder of ['Manuscript', 'Proofreading', 'Synopsis', 'Cover', 'Royalties', 'Characters', 'Story bible', 'Templates']) {
    await expect.poll(() => statSync(path.join(vaultDir, 'Moon', folder)).isDirectory(), { timeout: 15_000 }).toBe(true);
  }
});
