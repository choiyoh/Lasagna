import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// L4a 영어 스모크: MCP 설정 화면 문구가 영어이고, 복사 스니펫의 명령·키는 그대로인지 확인한다.
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
let userData = '';
let vaultDir = '';

test.beforeAll(async () => {
  test.setTimeout(240_000);
  base = mkdtempSync(path.join(tmpdir(), 'nops-l4a-'));
  userData = path.join(base, 'userdata');
  vaultDir = path.join(base, 'Demo');
  mkdirSync(vaultDir, { recursive: true });
  writeFileSync(path.join(vaultDir, 'Hello.md'), '# Hello\n');
  app = await electron.launch({
    executablePath: packagedExecutable(),
    env: { ...process.env, NOPS_E2E: '1' },
    args: [
      '--use-mock-keychain',
      `--user-data-dir=${userData}`,
      ...(process.platform === 'linux' ? ['--no-sandbox', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : []),
    ],
  });
  await app.firstWindow({ timeout: 90_000 });
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dir] })) as typeof dialog.showOpenDialog;
  }, vaultDir);
});

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  if (base) rmSync(base, { recursive: true, force: true });
});

async function openVaultIfNeeded(page: Page): Promise<void> {
  const cta = page.locator('.start__cta');
  await expect(cta.or(page.locator('aside.sidebar'))).toBeVisible({ timeout: 60_000 });
  if (await cta.isVisible()) {
    await cta.click();
    await expect(page.locator('aside.sidebar')).toBeVisible({ timeout: 60_000 });
  }
}

test('English smoke: MCP settings and command palette, snippet command unchanged', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);

  await page.getByTestId('settings-btn').click();
  await page.getByRole('radiogroup', { name: '언어' }).getByRole('radio', { name: 'English' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.keyboard.press('Escape');

  // 설정 → MCP
  await page.getByTestId('settings-btn').click();
  const mcp = page.getByTestId('mcp-settings');
  await expect(mcp).toBeVisible();
  await expect(mcp).toContainText('Connect an AI agent (MCP)');
  await expect(mcp).toContainText('Let agents write notes');
  await expect(mcp).toContainText('Server name');
  await expect(mcp).toContainText('Recent agent activity');
  expect(await mcp.innerText()).not.toMatch(HANGUL);

  // 복사 스니펫: 명령·키는 그대로(번역되지 않는다)
  await mcp.getByRole('checkbox', { name: 'Let agents write notes' }).check();
  const cli = (await page.getByTestId('mcp-cli').textContent()) ?? '';
  expect(cli).toContain('claude mcp add -s user');
  expect(cli).toContain('--vault');
  expect(cli).toContain('--write');
  await page.getByRole('tab', { name: 'Claude Desktop' }).click();
  const json = (await page.getByTestId('mcp-json').textContent()) ?? '';
  expect(json).toContain('"mcpServers"');
  expect(json).toContain('"command"');
  expect(json).toContain('"args"');
  await expect(page.getByRole('tab', { name: 'Gemini CLI' })).toBeVisible();
  expect(await page.getByTestId('mcp-json').textContent()).not.toMatch(HANGUL);
  await page.keyboard.press('Escape');

  // 명령 팔레트(App.tsx): 항목 라벨이 영어다
  await page.keyboard.press('ControlOrMeta+p');
  const palette = page.getByTestId('command-palette');
  await expect(palette).toBeVisible();
  const items = await palette.locator('[role="option"]').allInnerTexts();
  expect(items.length).toBeGreaterThan(5);
  expect(items.join('\n')).not.toMatch(HANGUL);
  expect(items.join('\n')).toMatch(/[A-Za-z]/);
  await page.keyboard.press('Escape');
});

test('깨진 정책 파일도 화면 언어로 안내한다', async () => {
  const page = await app.firstWindow();
  // 볼트의 정책 파일을 깨뜨린다(사용자 데이터가 아니라 앱이 만드는 설정 파일)
  mkdirSync(path.join(vaultDir, '.nopsidian'), { recursive: true });
  writeFileSync(path.join(vaultDir, '.nopsidian', 'mcp-policy.json'), '{ not json');
  await page.reload();
  await openVaultIfNeeded(page);

  // 영어로 연다 — 설정 창은 열어 둔 채 언어만 바꾼다
  await page.getByTestId('settings-btn').click();
  const englishRadio = page.getByRole('radiogroup', { name: /Language|언어/ }).getByRole('radio', { name: 'English' });
  const koreanRadio = page.getByRole('radiogroup', { name: /Language|언어/ }).getByRole('radio', { name: '한국어' });
  await englishRadio.click();
  const mcp = page.getByTestId('mcp-settings');
  await expect(mcp).toContainText('The policy file is not valid JSON');
  expect(await mcp.innerText()).not.toMatch(HANGUL);

  // 한국어로 바꾸면 base 문구, 다시 영어로 바꾸면 영어 (혼합 언어 없음)
  await koreanRadio.click();
  await expect(mcp).toContainText('정책 파일이 올바른 JSON 이 아니에요');
  expect(await mcp.innerText()).not.toMatch(/policy file/);
  await englishRadio.click();
  await expect(mcp).toContainText('The policy file is not valid JSON');
  expect(await mcp.innerText()).not.toMatch(HANGUL);
  await page.keyboard.press('Escape');

  // 루트가 배열인 스키마 오류: 영어 상세 문구 유지, 한글 0
  writeFileSync(path.join(vaultDir, '.nopsidian', 'mcp-policy.json'), '[]');
  await page.reload();
  await openVaultIfNeeded(page);
  await page.getByTestId('settings-btn').click();
  const mcp2 = page.getByTestId('mcp-settings');
  await expect(mcp2).toContainText('The policy file has the wrong shape');
  expect(await mcp2.innerText()).not.toMatch(HANGUL);
  await page.getByRole('radiogroup', { name: /Language|언어/ }).getByRole('radio', { name: '한국어' }).click();
  await expect(mcp2).toContainText('정책 파일 형식이 올바르지 않아요');
  await page.keyboard.press('Escape');
});

test('잘못된 폴더·VSCode 탭·복사·언어 전환이 모두 화면 언어를 따른다', async () => {
  const page = await app.firstWindow();
  await openVaultIfNeeded(page);
  await page.getByTestId('settings-btn').click();
  await page.getByRole('radiogroup', { name: /Language|언어/ }).getByRole('radio', { name: 'English' }).click();
  await page.keyboard.press('Escape');
  await page.getByTestId('settings-btn').click();
  const mcp = page.getByTestId('mcp-settings');

  // VSCode 탭: 경로는 그대로, 설명만 번역
  await page.getByRole('tab', { name: 'VS Code' }).click();
  await expect(mcp).toContainText('.vscode/mcp.json (workspace)');
  const vscode = (await page.getByTestId('mcp-code-vscode').textContent()) ?? '';
  expect(vscode).toContain('"servers"');
  expect(vscode).toContain('"type": "stdio"');
  expect(vscode).not.toMatch(HANGUL);

  // 복사 결과 문구
  await mcp.getByRole('button', { name: 'Copy' }).click();
  await expect(mcp.getByRole('button', { name: 'Copied' })).toBeVisible();

  // 잘못된 폴더: 영어 경고 → 한국어 전환 시 즉시 한국어(상태 문자열 재번역)
  await mcp.getByRole('checkbox', { name: 'Let agents write notes' }).check();
  const folder = mcp.getByLabel('Folders agents can write');
  await folder.fill('../bad');
  const warning = mcp.locator('[data-testid="mcp-folder-warning"]');
  await expect(warning).toContainText('Fix the folder “../bad” first');
  expect(await warning.innerText()).not.toMatch(HANGUL);

  // 같은 설정 창 안에서 언어만 바꾼다 — 상태 문구가 즉시 새 언어로 바뀌어야 한다
  await page.getByRole('radiogroup', { name: 'Language' }).getByRole('radio', { name: '한국어' }).click();
  await expect(mcp.locator('[data-testid="mcp-folder-warning"]')).toContainText('쓰기 폴더로 쓸 수 없는 경로예요');
  // 한국어 경고에 영어가 섞이지 않는다
  expect(await mcp.locator('[data-testid="mcp-folder-warning"]').innerText()).not.toMatch(/Fix|folder|can’t/);
  await page.getByRole('radiogroup', { name: '언어' }).getByRole('radio', { name: 'English' }).click();
  const enWarning = await mcp.locator('[data-testid="mcp-folder-warning"]').innerText();
  expect(enWarning).toContain('Fix the folder “../bad” first');
  expect(enWarning).not.toMatch(HANGUL);
  await page.keyboard.press('Escape');
});
