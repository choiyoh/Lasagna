import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// `pnpm package` 로 만든 앱을 실행한다(Fuses·asar·네이티브 모듈까지 함께 검증).
const executable = path.join(
  __dirname,
  `../out/Nopsidian-${process.platform}-${process.arch}/Nopsidian.app/Contents/MacOS/Nopsidian`,
);

let app: ElectronApplication;
let vaultDir: string;

test.beforeAll(async () => {
  const base = mkdtempSync(path.join(tmpdir(), 'nops-e2e-'));
  vaultDir = path.join(base, '내 볼트');
  mkdirSync(path.join(vaultDir, '프로젝트'), { recursive: true });
  writeFileSync(path.join(vaultDir, '프로젝트', 'Nopsidian.md'), '# Nopsidian\n핵심은 읽기 쉬운 코드다\n');
  writeFileSync(
    path.join(vaultDir, '위험.md'),
    '# 위험\n<script>window.__pwned = 1</script>\n<img src=x onerror="window.__pwned = 1">\n[링크](javascript:alert(1))\n',
  );
  app = await electron.launch({
    executablePath: executable,
    args: [`--user-data-dir=${path.join(base, 'userdata')}`],
  });
  // 폴더 선택 대화상자는 자동화할 수 없으므로 main에서 대체한다.
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dir] })) as typeof dialog.showOpenDialog;
  }, vaultDir);
});

test.afterAll(async () => {
  await app.close();
});

test('볼트를 열고 목록·검색·미리보기가 동작한다', async () => {
  const page = await app.firstWindow();
  await page.getByRole('button', { name: '폴더 열기 / 만들기' }).click();

  await expect(page.getByRole('button', { name: 'Nopsidian', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '위험' })).toBeVisible();

  await page.getByPlaceholder('전문 검색').fill('읽기 쉬운');
  const hit = page.locator('.hit', { hasText: 'Nopsidian' });
  await expect(hit).toBeVisible();
  await hit.click();
  await expect(page.locator('.preview h1')).toHaveText('Nopsidian');
});

test('렌더러는 Node에 접근할 수 없고 악성 HTML은 실행되지 않는다', async () => {
  const page = await app.firstWindow();
  const flags = await page.evaluate(() => ({
    require: typeof (window as unknown as { require?: unknown }).require,
    process: typeof (window as unknown as { process?: unknown }).process,
    nops: typeof window.nops,
  }));
  expect(flags).toEqual({ require: 'undefined', process: 'undefined', nops: 'object' });

  await page.getByPlaceholder('전문 검색').fill('');
  await page.getByRole('button', { name: '위험' }).click();
  await expect(page.locator('.preview h1')).toHaveText('위험');
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  expect(await page.locator('.preview script, .preview [onerror]').count()).toBe(0);
  expect(await page.locator('.preview a[href^="javascript"]').count()).toBe(0);
});

test('앱 밖에서 만든 파일이 목록과 검색에 반영된다', async () => {
  const page = await app.firstWindow();
  writeFileSync(path.join(vaultDir, '외부.md'), '# 외부 편집\n다른 편집기에서 작성한 바나나우유\n');
  await expect(page.getByRole('button', { name: '외부 편집' })).toBeVisible({ timeout: 5000 });
  await page.getByPlaceholder('전문 검색').fill('바나나우유');
  await expect(page.locator('.hit', { hasText: '외부 편집' })).toBeVisible();
  await page.getByPlaceholder('전문 검색').fill('');
});

test('계약에 없는 채널은 호출할 수 없다', async () => {
  const page = await app.firstWindow();
  const keys = await page.evaluate(() => Object.keys(window.nops).sort());
  expect(keys).toEqual(['app', 'note', 'on', 'search', 'vault']);
});

test('앱 URL이 app:// 오리진이다', async () => {
  const page = await app.firstWindow();
  expect(page.url()).toBe('app://nopsidian/index.html');
});
