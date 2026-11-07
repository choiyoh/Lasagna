import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// 작가 모드(W1): 토글·글자수 상태줄·선택 영역·공백 기준·언어 전환·재시작 유지, 그리고 노트 파일 불변.
const HANGUL = /[\u3131-\u318e\uac00-\ud7a3]/;

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

test.beforeAll(async () => {
  test.setTimeout(240_000);
  base = mkdtempSync(path.join(tmpdir(), 'nops-writer-'));
  vaultDir = path.join(base, 'Demo');
  mkdirSync(vaultDir, { recursive: true });
  notePath = path.join(vaultDir, 'Hello.md');
  writeFileSync(notePath, '# Hello\n\n본문\n');
  app = await launch();
});

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  if (base) rmSync(base, { recursive: true, force: true });
});

async function openNote(page: Page): Promise<void> {
  await openVaultIfNeeded(page);
  await page.locator('aside.sidebar').getByRole('button', { name: 'Hello', exact: true }).click();
  await expect(page.locator('.ProseMirror')).toHaveText(/Hello/);
}

async function toggleWriter(page: Page, on: boolean): Promise<void> {
  await page.getByTestId('settings-btn').click();
  const box = page.getByTestId('writer-mode');
  await expect(box).toBeVisible();
  if ((await box.isChecked()) !== on) await box.click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('writer-status')).toHaveCount(on ? 1 : 0);
}

test('작가 모드를 켜면 글자수 상태줄이 보이고, 노트 파일은 바뀌지 않는다', async () => {
  const page = await app.firstWindow();
  await openNote(page);
  const before = readFileSync(notePath);

  // 일반 모드에서는 상태줄이 없다(화면 동일)
  await expect(page.getByTestId('writer-status')).toHaveCount(0);

  await toggleWriter(page, true);
  const status = page.getByTestId('writer-status');
  await expect(status).toBeVisible();
  // 계산이 끝나기 전에는 0 이 아니라 … 을 보여 준다(짧은 노트는 곧 숫자로 바뀐다)
  await expect(page.getByTestId('writer-chars')).toHaveText(/^(…|\d+자 · 공백 포함)$/);
  // "# Hello" → 보이는 글자 'Hello' 5자
  // '# Hello' + '본문' → 보이는 글자 7자
  await expect(page.getByTestId('writer-chars')).toHaveText(/^7자 · 공백 포함$/);

  // 입력하면 150ms 디바운스 뒤 갱신
  await page.locator('.ProseMirror p').last().click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' world');
  await expect(page.getByTestId('writer-chars')).toHaveText(/^13자 · 공백 포함$/);

  // 선택 영역 표시
  for (let i = 0; i < 5; i += 1) await page.keyboard.press('Shift+ArrowLeft');
  await expect(page.getByTestId('writer-selection')).toContainText(/선택 5 \/ 전체 13/);
  // 선택 중에는 글자수 줄을 숨긴다(선택/전체만)
  await expect(page.getByTestId('writer-chars')).toHaveCount(0);

  // 공백 제외로 바꾸면 기준 표기가 바뀐다
  await page.getByTestId('settings-btn').click();
  await page.getByRole('radiogroup', { name: '글자수 기준' }).getByRole('radio', { name: '공백 제외' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('writer-chars')).toHaveText(/^12자 · 공백 제외$/);

  // 끄면 사라지고, 토글 전후 노트 파일은 바이트 단위로 같다(입력으로 바뀐 내용은 그대로)
  await expect.poll(() => readFileSync(notePath, 'utf8'), { timeout: 10_000 }).toContain('world');
  const edited = readFileSync(notePath);
  await toggleWriter(page, false);
  expect(readFileSync(notePath).equals(edited)).toBe(true);
  // 처음 연 뒤 편집한 내용만 다르고, 토글이 파일을 건드리지 않았는지는 위 비교로 확인된다
  expect(before.length).toBeGreaterThan(0);
});

test('작가 모드 설정은 재시작해도 유지되고, 영어에서는 characters·words 로 보인다', async () => {
  const page = await app.firstWindow();
  await openNote(page);
  await toggleWriter(page, true);
  await expect(page.getByTestId('writer-chars')).toHaveText(/\d+자 · 공백/);

  // 재시작해도 켜져 있다
  await app.close();
  app = await launch();
  const again = await app.firstWindow();
  await openNote(again);
  await expect(again.getByTestId('writer-status')).toBeVisible();
  // 설정이 저장된 채 앱을 다시 열면 노트를 열자마자 숫자가 나온다('…' 로 남지 않음)
  await expect(again.getByTestId('writer-chars')).toHaveText(/\d+자 · 공백 포함$/);

  // 다른 노트로 바꾸면 숫자도 그 노트 기준으로 갱신된다
  const other = path.join(vaultDir, 'Other.md');
  writeFileSync(other, '# Other\n\n짧은 글\n');
  await expect(again.locator('aside.sidebar').getByRole('button', { name: 'Other', exact: true })).toBeVisible({ timeout: 20_000 });
  await again.locator('aside.sidebar').getByRole('button', { name: 'Other', exact: true }).click();
  const otherCount = await again.getByTestId('writer-chars').innerText();
  await expect(again.getByTestId('writer-chars')).toHaveText(/\d+자 · 공백 포함$/);

  // 빠른 전환기로 노트를 바꿔도 상태줄이 새 노트 값으로 갱신된다
  await again.keyboard.press('ControlOrMeta+o');
  await again.keyboard.type('Hello');
  await again.keyboard.press('Enter');
  await expect(again.locator('.ProseMirror')).toHaveText(/Hello/);
  await expect(again.getByTestId('writer-chars')).not.toHaveText(otherCount);

  // 영어로 바꾸면 characters · words
  await again.getByTestId('settings-btn').click();
  await again.getByRole('radiogroup', { name: '언어' }).getByRole('radio', { name: 'English' }).click();
  await expect(again.locator('html')).toHaveAttribute('lang', 'en');
  await again.keyboard.press('Escape');
  const en = await again.getByTestId('writer-chars').innerText();
  expect(en).toMatch(/characters/);
  expect(en).toMatch(/words/);
  expect(en).not.toMatch(HANGUL);
});

test('소스 모드에서도 같은 규칙으로 세고, 공백만 선택하면 선택 표시가 없다', async () => {
  const page = await app.firstWindow();
  await openNote(page);
  await toggleWriter(page, true);
  const editCount = await page.getByTestId('writer-chars').innerText();

  // 소스 모드로 바꿔도(마크다운 원문 기준) 같은 값 — 두 경로가 같은 규칙을 쓴다
  await page.keyboard.press('ControlOrMeta+e');
  await expect(page.getByTestId('source-editor')).toBeVisible();
  await expect(page.getByTestId('writer-chars')).toHaveText(editCount);
  // 소스에서 편집해도 숫자가 갱신된다
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('\n\n소스에서 추가');
  await expect(page.getByTestId('writer-chars')).not.toHaveText(editCount);
  await page.keyboard.press('ControlOrMeta+e');
  await expect(page.getByTestId('note-editor')).toBeVisible();

  // 공백만 선택하면 선택/전체 표시를 띄우지 않는다
  await page.locator('.ProseMirror').click();
  await page.keyboard.press('ControlOrMeta+End');
  for (let i = 0; i < 2; i += 1) await page.keyboard.press('Shift+ArrowLeft');
  await expect(page.getByTestId('writer-selection')).toHaveCount(0);
});

test('긴 회차에서도 글자수 상태줄은 화면 하단에 붙어 있다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  const longPath = path.join(vaultDir, 'Long.md');
  writeFileSync(longPath, `# Long\n\n${'문장 하나입니다. '.repeat(4000)}\n`);
  // 파일 감시가 목록에 반영될 때까지 기다린 뒤 연다
  await expect(page.locator('aside.sidebar').getByRole('button', { name: 'Long', exact: true })).toBeVisible({ timeout: 20_000 });
  await page.locator('aside.sidebar').getByRole('button', { name: 'Long', exact: true }).click();
  await toggleWriter(page, true);

  const bar = page.getByTestId('writer-status');
  await expect(bar).toBeVisible();
  // 스크롤을 문서 끝/중간으로 옮겨도 상태줄은 뷰포트 안(하단)에 있다
  const viewport = page.viewportSize() ?? { width: 1200, height: 800 };
  for (const where of ['middle', 'end']) {
    if (where === 'end') await page.keyboard.press('ControlOrMeta+End');
    else await page.keyboard.press('ControlOrMeta+Home');
    await page.waitForTimeout(300);
    const box = await bar.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
    expect(box!.y).toBeGreaterThanOrEqual(0);
  }
});

test('소스 모드에서 링크 주소만 선택하면 0자이고, columns 문서도 표식 없이 센다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  const colsPath = path.join(vaultDir, 'Columns.md');
  writeFileSync(colsPath, ':::columns\n:::column\n첫째\n:::\n:::column\n둘째\n:::\n:::\n\n[보기](https://example.com/very/long/url)\n');
  await expect(page.locator('aside.sidebar').getByRole('button', { name: 'Columns', exact: true })).toBeVisible({ timeout: 20_000 });
  await page.locator('aside.sidebar').getByRole('button', { name: 'Columns', exact: true }).click();
  await toggleWriter(page, true);
  // 표식(:::columns 등)은 세지 않는다: 보이는 글자 '첫째둘째' + '보기' = 6자
  await expect(page.getByTestId('writer-chars')).toHaveText(/^6자 · 공백 포함$/);

  // 소스 모드에서는 선택 글자수를 표시하지 않는다(문맥 손실·불변식 문제로 단순화)
  await page.keyboard.press('ControlOrMeta+e');
  await expect(page.getByTestId('source-editor')).toBeVisible();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  for (let i = 0; i < 4; i += 1) await page.keyboard.press('Shift+ArrowLeft');
  await expect(page.getByTestId('writer-selection')).toHaveCount(0);
  await expect(page.getByTestId('writer-chars')).toHaveText(/자 · 공백 포함$/);
});

test('편집한 뒤 외부 변경·소스 왕복·언어 전환이 있어도 상태줄은 현재 문서 값이다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  const livePath = path.join(vaultDir, 'Live.md');
  writeFileSync(livePath, '# Live\n\n처음\n');
  await expect(page.locator('aside.sidebar').getByRole('button', { name: 'Live', exact: true })).toBeVisible({ timeout: 20_000 });
  await page.locator('aside.sidebar').getByRole('button', { name: 'Live', exact: true }).click();
  await toggleWriter(page, true);
  await expect(page.getByTestId('writer-chars')).toHaveText(/^\d+자 · 공백 포함$/);

  // 편집으로 총계를 바꾼다
  await page.locator('.ProseMirror p').last().click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('추가 문장');
  await expect(page.getByTestId('writer-chars')).toHaveText(/^\d+자 · 공백 포함$/);

  // 밖에서 파일을 통째로 바꾸면(무음 reload) 상태줄도 새 내용 기준이어야 한다
  writeFileSync(livePath, '# Live\n\n짧\n');
  await expect(page.locator('.ProseMirror')).toHaveText(/짧/);
  const shortCount = await page.getByTestId('writer-chars').innerText();
  expect(shortCount).toMatch(/^\d+자 · 공백 포함$/);

  // 소스 모드 왕복·언어 전환 뒤에도 값이 현재 문서와 일치한다
  await page.keyboard.press('ControlOrMeta+e');
  await expect(page.getByTestId('source-editor')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+e');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await expect(page.getByTestId('writer-chars')).toHaveText(shortCount);
  await page.getByTestId('settings-btn').click();
  await page.getByRole('radiogroup', { name: /Language|언어/ }).getByRole('radio', { name: 'English' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('writer-chars')).toContainText('characters');
});

test('키보드·마우스로 문단 안 일부를 선택하면 선택 글자수가 DOM 선택과 일치한다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  const selPath = path.join(vaultDir, 'Select.md');
  writeFileSync(selPath, '# Select\n\n가나다라마바사아자차\n');
  await expect(page.locator('aside.sidebar').getByRole('button', { name: 'Select', exact: true })).toBeVisible({ timeout: 20_000 });
  await page.locator('aside.sidebar').getByRole('button', { name: 'Select', exact: true }).click();
  await toggleWriter(page, true);

  // 키보드: 문단 끝에서 Shift+← 3자·5자
  const para = page.locator('.ProseMirror p').last();
  await para.click();
  await page.keyboard.press('ControlOrMeta+End');
  for (const n of [3, 5]) {
    for (let i = 0; i < n; i += 1) await page.keyboard.press('Shift+ArrowLeft');
    const dom = await page.evaluate(() => window.getSelection()?.toString().length ?? 0);
    expect(dom).toBe(n);
    await expect(page.getByTestId('writer-selection')).toContainText(String(n));
  }

  // 마우스 드래그: 문단 안 5자(연속 selectionchange 후 마지막 값)
  const box = await para.boundingBox();
  if (!box) throw new Error('no paragraph box');
  await page.mouse.move(box.x + 4, box.y + box.height / 2);
  await page.mouse.down();
  for (let step = 1; step <= 6; step += 1) {
    await page.mouse.move(box.x + 4 + step * 12, box.y + box.height / 2, { steps: 2 });
  }
  await page.mouse.up();
  const dom = await page.evaluate(() => window.getSelection()?.toString().length ?? 0);
  expect(dom).toBeGreaterThan(0);
  await expect(page.getByTestId('writer-selection')).toContainText(`선택 ${dom}`);
});

test('위키링크가 든 문단을 선택하면 별칭 글자수로 표시된다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  const wikiPath = path.join(vaultDir, 'Wiki.md');
  writeFileSync(wikiPath, '# Wiki\n\n가 [[노트|별칭]] 나\n');
  await expect(page.locator('aside.sidebar').getByRole('button', { name: 'Wiki', exact: true })).toBeVisible({ timeout: 20_000 });
  await page.locator('aside.sidebar').getByRole('button', { name: 'Wiki', exact: true }).click();
  await toggleWriter(page, true);

  const para = page.locator('.ProseMirror p').last();
  await para.click();
  await page.keyboard.press('ControlOrMeta+a');
  const dom = await page.evaluate(() => window.getSelection()?.toString().length ?? 0);
  expect(dom).toBeGreaterThan(0);
  // 상태줄 선택 값은 화면(DOM) 선택 글자수와 같다(위키링크는 별칭 글자수)
  await expect(page.getByTestId('writer-selection')).toContainText(`선택 ${dom}`);
});

test('위키링크 별칭 단어만 선택해도 선택 글자수가 보인다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  const aliasPath = path.join(vaultDir, 'Alias.md');
  writeFileSync(aliasPath, '# Alias\n\n가 [[노트|별칭]] 나\n');
  await expect(page.locator('aside.sidebar').getByRole('button', { name: 'Alias', exact: true })).toBeVisible({ timeout: 20_000 });
  await page.locator('aside.sidebar').getByRole('button', { name: 'Alias', exact: true }).click();
  await toggleWriter(page, true);

  // 별칭 텍스트(2자)만 더블클릭으로 선택 — NodeView 안쪽 선택
  await page.locator('.ProseMirror .nops-wikilink').last().dblclick();
  const dom = await page.evaluate(() => window.getSelection()?.toString() ?? '');
  expect(dom).toContain('별칭');
  await expect(page.getByTestId('writer-selection')).toContainText(`선택 ${dom.replace(/\s/g, '').length}`);
});

test('표 셀·행을 선택해도 상태줄 선택 글자수가 셀 텍스트와 같다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  const tablePath = path.join(vaultDir, 'Table.md');
  writeFileSync(tablePath, '# Table\n\n| 12 | 34 |\n|---|---|\n| 5 | 6 |\n');
  await expect(page.locator('aside.sidebar').getByRole('button', { name: 'Table', exact: true })).toBeVisible({ timeout: 20_000 });
  await page.locator('aside.sidebar').getByRole('button', { name: 'Table', exact: true }).click();
  await toggleWriter(page, true);

  // 셀 하나(2자)를 더블클릭으로 선택
  await page.locator('.ProseMirror table td').first().dblclick();
  const dom = await page.evaluate(() => window.getSelection()?.toString() ?? '');
  expect(dom.replace(/\s/g, '').length).toBe(2);
  await expect(page.getByTestId('writer-selection')).toContainText('선택 2');
});
