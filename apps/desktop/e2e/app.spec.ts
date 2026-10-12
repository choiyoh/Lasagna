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
  await expect(page.locator('.ProseMirror h1')).toHaveText('Nopsidian');
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
  await expect(page.locator('.ProseMirror h1')).toHaveText('위험');
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  // HTML은 실행되지 않고 원문 텍스트로만 보인다
  expect(await page.locator('.ProseMirror script, .ProseMirror [onerror]').count()).toBe(0);
  expect(await page.locator('.ProseMirror a[href^="javascript"]').count()).toBe(0);
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

test('편집: 고친 문단만 저장되고 나머지 바이트는 그대로다', async () => {
  const page = await app.firstWindow();
  const original = '# 편집\n\n첫 문단  \n\n둘째 문단\n\n- a\n- b\n';
  const file = path.join(vaultDir, '편집.md');
  writeFileSync(file, original);
  await page.getByRole('button', { name: '편집', exact: true }).click();
  const p = page.locator('.ProseMirror p', { hasText: '둘째 문단' });
  await p.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' 추가한 문장');
  await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 5000 }).toContain('추가한 문장');
  expect(readFileSync(file, 'utf8')).toBe(original.replace('둘째 문단', '둘째 문단 추가한 문장'));
  await expect(page.locator('.note-editor__status')).toHaveText('저장됨');
});

test('한글 조합 입력(IME): 조합 중 글자가 확정되고 Enter로 문단이 나뉜다', async () => {
  const page = await app.firstWindow();
  const file = path.join(vaultDir, 'IME.md');
  writeFileSync(file, '# IME\n\n끝\n');
  await page.getByRole('button', { name: 'IME', exact: true }).click();
  await page.locator('.ProseMirror p', { hasText: '끝' }).click();
  await page.keyboard.press('End');
  const cdp = await page.context().newCDPSession(page);
  for (const text of ['ㅎ', '하', '한']) {
    await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
  }
  await cdp.send('Input.insertText', { text: '한' });
  for (const text of ['ㄱ', '그', '글']) {
    await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
  }
  await cdp.send('Input.insertText', { text: '글' });
  await page.keyboard.press('Enter');
  await page.keyboard.type('다음 줄');
  await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 5000 }).toContain('다음 줄');
  expect(readFileSync(file, 'utf8')).toBe('# IME\n\n끝한글\n\n다음 줄\n');
});

test('슬래시 메뉴: 초성(ㅋㅇㅇ)으로 콜아웃을 찾아 넣으면 마크다운 콜아웃으로 저장된다', async () => {
  const page = await app.firstWindow();
  const file = path.join(vaultDir, '슬래시.md');
  writeFileSync(file, '# 슬래시\n\n');
  await page.getByRole('button', { name: '슬래시', exact: true }).click();
  await page.locator('.ProseMirror').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/ㅋㅇㅇ');
  const item = page.locator('.oh-editor__slash-item', { hasText: '콜아웃' }).first();
  await expect(item).toBeVisible();
  await page.keyboard.press('Enter');
  await page.keyboard.type('중요한 내용');
  await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 5000 }).toContain('[!note]');
  expect(readFileSync(file, 'utf8')).toBe('# 슬래시\n\n> [!note] 중요한 내용\n');
});

test('편집 중 같은 노트의 다른 블록이 밖에서 바뀌면 저장할 때 자동 병합된다', async () => {
  const page = await app.firstWindow();
  const original = '# 병합편집\n\n앞 문단\n\n뒷 문단\n';
  const file = path.join(vaultDir, '병합편집.md');
  writeFileSync(file, original);
  await page.getByRole('button', { name: '병합편집', exact: true }).click();
  await page.locator('.ProseMirror p', { hasText: '앞 문단' }).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' (앱)');
  writeFileSync(file, original.replace('뒷 문단', '뒷 문단 (외부)'));
  await expect
    .poll(() => readFileSync(file, 'utf8'), { timeout: 8000 })
    .toBe('# 병합편집\n\n앞 문단 (앱)\n\n뒷 문단 (외부)\n');
  await expect(page.locator('.note-editor__notice')).toContainText('합쳤어요');
  await expect(page.locator('.ProseMirror')).toContainText('뒷 문단 (외부)');
});

test('편집하지 않은 노트는 밖에서 바뀌면 조용히 다시 불러온다', async () => {
  const page = await app.firstWindow();
  const file = path.join(vaultDir, '리로드.md');
  writeFileSync(file, '# 리로드\n\n처음\n');
  await page.getByRole('button', { name: '리로드', exact: true }).click();
  await expect(page.locator('.ProseMirror')).toContainText('처음');
  writeFileSync(file, '# 리로드\n\n바뀐 내용\n');
  await expect(page.locator('.ProseMirror')).toContainText('바뀐 내용', { timeout: 5000 });
});

test('위키링크를 클릭하면 해당 노트가 열린다', async () => {
  const page = await app.firstWindow();
  writeFileSync(path.join(vaultDir, '출발.md'), '# 출발\n\n[[도착]]으로 가자\n');
  writeFileSync(path.join(vaultDir, '도착.md'), '# 도착\n\n여기가 도착지\n');
  await page.getByRole('button', { name: '출발', exact: true }).click();
  await page.locator('.nops-wikilink', { hasText: '도착' }).click();
  await expect(page.locator('.ProseMirror h1')).toHaveText('도착');
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
