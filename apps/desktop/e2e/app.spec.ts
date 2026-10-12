import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
  // 방금 패키징한 앱의 첫 실행은 macOS의 검사 때문에 30초 넘게 걸릴 수 있다.
  test.setTimeout(180_000);
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
  await app.firstWindow({ timeout: 150_000 });
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

test('저장: 앱 편집과 외부 편집을 병합하고, 자기 쓰기는 external=false로 알린다', async () => {
  const page = await app.firstWindow();
  const file = path.join(vaultDir, '병합.md');
  const base = '# 병합\n\n첫 문단\n\n둘째 문단\n';
  writeFileSync(file, base);
  await expect(page.getByRole('button', { name: '병합', exact: true })).toBeVisible({ timeout: 5000 });

  const read = await page.evaluate(() => window.nops.note.read({ path: '병합.md' }));
  expect(read.content).toBe(base);

  // 앱이 읽은 뒤 다른 편집기가 둘째 문단을 고친다
  writeFileSync(file, base.replace('둘째 문단', '둘째(외부)'));

  const events: { path: string; external: boolean }[] = await page.evaluate(async () => {
    const seen: { path: string; external: boolean }[] = [];
    window.nops.on('note.changed', (e) => seen.push({ path: e.path, external: e.external }));
    (window as unknown as { __seen: typeof seen }).__seen = seen;
    return seen;
  });
  void events;

  const saved = await page.evaluate((hash) =>
    window.nops.note.save({ path: '병합.md', content: '# 병합\n\n첫(앱)\n\n둘째 문단\n', baseHash: hash }),
    read.hash,
  );
  expect(saved.status).toBe('merged');
  expect(saved.content).toBe('# 병합\n\n첫(앱)\n\n둘째(외부)\n');
  expect(readFileSync(file, 'utf8')).toBe(saved.content);

  // 우리가 쓴 내용에 대한 감시 이벤트는 external=false
  await expect
    .poll(
      async () =>
        page.evaluate(() =>
          (window as unknown as { __seen: { path: string; external: boolean }[] }).__seen
            .filter((e) => e.path === '병합.md')
            .map((e) => e.external),
        ),
      { timeout: 5000 },
    )
    .toContain(false);
});

test('링크: 위키링크가 해석되어 백링크로 조회된다', async () => {
  const page = await app.firstWindow();
  writeFileSync(path.join(vaultDir, '링크A.md'), '# 링크A\n[[링크B]] 를 본다\n');
  writeFileSync(path.join(vaultDir, '링크B.md'), '---\naliases: [비]\n---\n# 링크B\n');
  await expect(page.getByRole('button', { name: '링크B', exact: true })).toBeVisible({ timeout: 5000 });
  const hits = await page.evaluate(() => window.nops.search.query({ q: '를 본다', limit: 5 }));
  expect(hits.map((h) => h.path)).toContain('링크A.md');
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
