import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { strToU8, zipSync } from 'fflate';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';

// `pnpm package` 로 만든 앱을 실행한다(Fuses·asar·네이티브 모듈까지 함께 검증).
/** 패키징한 앱의 실행 파일. darwin 은 .app 번들 안, win32 는 .exe, linux 는 실행 파일이다. NOPS_E2E_EXECUTABLE 로 덮어쓸 수 있다. */
function packagedExecutable(): string {
  const override = process.env.NOPS_E2E_EXECUTABLE;
  if (override) return override;
  const dir = path.join(__dirname, `../out/Lasagna-${process.platform}-${process.arch}`);
  if (process.platform === 'darwin') return path.join(dir, 'Lasagna.app/Contents/MacOS/Lasagna');
  return path.join(dir, process.platform === 'win32' ? 'lasagna.exe' : 'lasagna');
}

/** 패키징한 앱의 resources 폴더(MCP 서버 번들이 들어 있다). 실행 파일 위치에서 찾아 플랫폼마다 달라도 같은 코드로 동작한다. */
function packagedResourcesDir(): string {
  const dir = path.dirname(packagedExecutable());
  return process.platform === 'darwin' ? path.join(dir, '..', 'Resources') : path.join(dir, 'resources');
}

const executable = packagedExecutable();

/** 오른쪽 링크 도크는 창 폭 1,200px 이하에서 기본으로 접힌다 — 탭을 쓰기 전에 펼친다. */
async function openDock(page: Page): Promise<void> {
  const links = page.getByRole('tab', { name: '링크', exact: true });
  if (!(await links.isVisible())) await page.getByTitle('링크 패널 열기/닫기').click();
  await expect(links).toBeVisible();
  // 앞선 테스트가 다른 탭(기록·개요…)을 열어 두었어도 링크 탭에서 시작한다
  await links.click();
}

/** 시작 화면이면 볼트를 연다. beforeAll 이 이미 열어 두었으면(테스트 재시작) 그냥 지나간다. */
async function openVaultIfNeeded(page: Page): Promise<void> {
  const openVault = page.getByRole('button', { name: '폴더 열기 / 만들기' });
  await expect(openVault.or(page.locator('aside.sidebar'))).toBeVisible({ timeout: 30_000 });
  if (await openVault.isVisible()) {
    await openVault.click();
    await expect(page.locator('aside.sidebar')).toBeVisible({ timeout: 30_000 });
  }
}

/**
 * 열 머리 메뉴를 실제 마우스 좌표로 연다.
 * locator.click() 은 부모 overflow 에 잘린 요소에도 이벤트를 보내므로, 메뉴 항목이 화면에서 실제로
 * 맞는지 elementFromPoint 로 확인한 뒤 그 좌표를 눌러야 잘림 회귀를 잡는다.
 */
async function clickColumnMenu(page: Page, table: Locator, col: string, item: string): Promise<void> {
  const head = table.getByTestId(`th-${col}`);
  await head.scrollIntoViewIfNeeded();
  const headBox = await head.boundingBox();
  if (!headBox) throw new Error(`열 머리가 없어요: ${col}`);
  await page.mouse.click(headBox.x + headBox.width / 2, headBox.y + headBox.height / 2);

  const menu = page.locator('.dbtable__menu');
  await expect(menu).toBeVisible();
  const target = menu.getByRole('menuitem', { name: item });
  const box = await target.boundingBox();
  if (!box) throw new Error(`메뉴 항목이 없어요: ${item}`);
  const hit = await page.evaluate(
    ([x, y]) => !!document.elementFromPoint(x!, y!)?.closest('.dbtable__menu'),
    [box.x + box.width / 2, box.y + box.height / 2],
  );
  expect(hit, `메뉴 항목이 다른 요소에 가려졌어요: ${item}`).toBe(true);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

let app: ElectronApplication;
let vaultDir: string;

test.beforeAll(async () => {
  // 방금 패키징한 앱의 첫 실행은 macOS의 검사 때문에 30초 넘게 걸릴 수 있다.
  test.setTimeout(240_000);
  const base = mkdtempSync(path.join(tmpdir(), 'nops-e2e-'));
  vaultDir = path.join(base, '내 볼트');
  mkdirSync(path.join(vaultDir, '프로젝트'), { recursive: true });
  writeFileSync(path.join(vaultDir, '프로젝트', 'Nopsidian.md'), '# Nopsidian\n핵심은 읽기 쉬운 코드다\n');
  writeFileSync(
    path.join(vaultDir, '위험.md'),
    '# 위험\n<script>window.__pwned = 1</script>\n<img src=x onerror="window.__pwned = 1">\n[링크](javascript:alert(1))\n',
  );
  // 앱을 막 종료하거나 재패키징한 직후에는 첫 창이 안 뜨고 멈추는 경우가 가끔 있다(macOS 쪽 일시 현상).
  // 짧게 기다려 보고 안 뜨면 닫고 다시 띄운다. 앱 동작이 아니라 테스트 준비 단계의 재시도다.
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const candidate = await electron.launch({
      executablePath: executable,
      args: [
        // 재빌드마다 달라지는 ad-hoc 서명이 실제 키체인 허용 대화상자를 띄우지 않도록 모의 키체인을 쓴다.
        '--use-mock-keychain',
        `--user-data-dir=${path.join(base, `userdata-${attempt}`)}`,
        // GitHub Actions 리눅스 러너에서는 chrome-sandbox 에 setuid 를 걸 수 없어(루트가 아니다) 그냥 두면 Chromium 이 뜨지 않는다.
        // 화면 없는 리눅스(xvfb)에는 GPU 가 없다: 그래프 테스트가 그래프를 그리도록 소프트웨어 WebGL(SwiftShader)을 쓴다.
        ...(process.platform === 'linux' ? ['--no-sandbox', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : []),
      ],
    });
    try {
      await candidate.firstWindow({ timeout: attempt === 1 ? 60_000 : 45_000 });
      app = candidate;
      break;
    } catch (e) {
      lastError = e;
      await candidate.close().catch(() => undefined);
    }
  }
  if (!app) throw lastError;
  // 폴더 선택 대화상자는 자동화할 수 없으므로 main에서 대체한다.
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dir] })) as typeof dialog.showOpenDialog;
  }, vaultDir);

  // 앞선 테스트가 실패하면 Playwright 가 워커를 다시 시작하면서 앱만 새로 띄운다(볼트는 아직 안 열린 상태).
  // 그대로 두면 뒤따르는 모든 테스트가 '열린 볼트가 없어요'로 죽으므로, 여기서 볼트를 열어 둔다.
  await openVaultIfNeeded(await app.firstWindow());
});

test.afterAll(async () => {
  await app.close();
});

// _electron 은 Playwright 의 page 픽스처를 쓰지 않아 자동 스크린샷이 없다. 실패한 테스트의 화면을 직접 남겨
// CI(e2e 작업)가 `apps/desktop/test-results` 를 아티팩트로 올릴 수 있게 한다.
// Playwright 훅의 첫 인자는 구조 분해 패턴이어야 해서 빈 객체를 받는다.
// eslint-disable-next-line no-empty-pattern
test.afterEach(async ({}, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  const page = app?.windows()[0];
  if (!page) return;
  await page.screenshot({ path: testInfo.outputPath('failure.png') }).catch(() => undefined);
});

test('볼트를 열고 목록·검색·미리보기가 동작한다', async () => {
  const page = await app.firstWindow();
  // beforeAll 이 볼트를 열어 두었을 수 있다(테스트 재시작). 그때도 목록·검색·미리보기는 그대로 확인한다.
  await openVaultIfNeeded(page);

  await expect(page.getByRole('button', { name: 'Nopsidian', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '위험', exact: true })).toBeVisible();

  await page.getByPlaceholder('본문 검색').fill('읽기 쉬운');
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

  await page.getByPlaceholder('본문 검색').fill('');
  await page.getByRole('button', { name: '위험', exact: true }).click();
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
  await page.getByPlaceholder('본문 검색').fill('바나나우유');
  await expect(page.locator('.hit', { hasText: '외부 편집' })).toBeVisible();
  await page.getByPlaceholder('본문 검색').fill('');
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

test.describe('블록 핸들', () => {
  const open = async (page: import('@playwright/test').Page, name: string, content: string) => {
    const file = path.join(vaultDir, `${name}.md`);
    writeFileSync(file, content);
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.locator('.ProseMirror')).toBeVisible();
    return file;
  };
  const hoverBlock = async (page: import('@playwright/test').Page, text: string) => {
    const el = page.locator('.ProseMirror p, .ProseMirror li, .ProseMirror h1, .ProseMirror h2', { hasText: text }).first();
    await el.hover();
    await expect(page.locator('.nops-handle')).toBeVisible();
    return el;
  };

  test('⋮⋮ 메뉴: 다른 블록으로 바꾸기(제목 2), 복제, 삭제가 파일에 반영된다', async () => {
    const page = await app.firstWindow();
    const file = await open(page, '핸들메뉴', '# 핸들메뉴\n\n가\n\n나\n\n다\n');
    await hoverBlock(page, '나');
    await page.locator('.nops-handle__grip').click();
    await page.locator('.nops-block-menu button', { hasText: '제목 2' }).click();
    await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 5000 }).toContain('## 나');

    await hoverBlock(page, '가');
    await page.locator('.nops-handle__grip').click();
    await page.locator('.nops-block-menu button', { hasText: '복제' }).click();
    await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 5000 }).toBe('# 핸들메뉴\n\n가\n\n가\n\n## 나\n\n다\n');

    await hoverBlock(page, '다');
    await page.locator('.nops-handle__grip').click();
    await page.locator('.nops-block-menu button', { hasText: '삭제' }).click();
    await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 5000 }).toBe('# 핸들메뉴\n\n가\n\n가\n\n## 나\n');
  });

  test('+ 버튼: 아래에 블록을 만들고 슬래시 메뉴가 열린다', async () => {
    const page = await app.firstWindow();
    await open(page, '핸들추가', '# 핸들추가\n\n끝 문단\n');
    await hoverBlock(page, '끝 문단');
    await page.locator('.nops-handle__add').click();
    await expect(page.locator('.oh-editor__slash-item').first()).toBeVisible();
  });

  test('단축키: ⌘D 복제, ⌘⇧↓ 아래로 이동', async () => {
    const page = await app.firstWindow();
    const file = await open(page, '핸들키', '# 핸들키\n\nA\n\nB\n');
    await page.locator('.ProseMirror p', { hasText: 'A' }).click();
    // 클릭 직후 ProseMirror가 선택 영역을 동기화할 시간(사람의 입력 속도에서는 문제되지 않는다)
    await page.waitForTimeout(150);
    await page.keyboard.press('ControlOrMeta+Shift+ArrowDown');
    await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 5000 }).toBe('# 핸들키\n\nB\n\nA\n');
    await page.keyboard.press('ControlOrMeta+d');
    await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 5000 }).toBe('# 핸들키\n\nB\n\nA\n\nA\n');
  });

  test('끌어서 순서 바꾸기: 핸들을 잡고 다른 블록 위로 놓는다', async () => {
    const page = await app.firstWindow();
    const file = await open(page, '드래그순서', '# 드래그순서\n\n첫째\n\n둘째\n\n셋째\n');
    await hoverBlock(page, '첫째');
    const grip = await page.locator('.nops-handle__grip').boundingBox();
    const target = await page.locator('.ProseMirror p', { hasText: '셋째' }).boundingBox();
    await page.mouse.move(grip!.x + grip!.width / 2, grip!.y + grip!.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip!.x + 20, grip!.y + 20, { steps: 4 });
    // 셋째 문단의 아래쪽 절반 한가운데(가장자리 열 영역은 피한다)
    await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height * 0.9, { steps: 12 });
    await page.mouse.up();
    await expect
      .poll(() => readFileSync(file, 'utf8'), { timeout: 5000 })
      .toBe('# 드래그순서\n\n둘째\n\n셋째\n\n첫째\n');
  });

  test('블록을 다른 블록의 오른쪽 가장자리에 놓으면 열 레이아웃이 된다', async () => {
    const page = await app.firstWindow();
    const file = await open(page, '드래그열', '# 드래그열\n\n왼쪽에 둘 글\n\n옮길 글\n');
    await hoverBlock(page, '옮길 글');
    const grip = await page.locator('.nops-handle__grip').boundingBox();
    const target = await page.locator('.ProseMirror p', { hasText: '왼쪽에 둘 글' }).boundingBox();
    await page.mouse.move(grip!.x + grip!.width / 2, grip!.y + grip!.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip!.x + 20, grip!.y - 20, { steps: 4 });
    await page.mouse.move(target!.x + target!.width - 8, target!.y + target!.height / 2, { steps: 12 });
    await expect(page.locator('.nops-drop-side')).toBeVisible();
    await page.mouse.up();
    await expect
      .poll(() => readFileSync(file, 'utf8'), { timeout: 5000 })
      .toBe('# 드래그열\n\n::::columns\n\n:::column\n\n왼쪽에 둘 글\n\n:::\n\n:::column\n\n옮길 글\n\n:::\n\n::::\n');
    await expect(page.locator('[data-columns] [data-column]')).toHaveCount(2);
  });
});

const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test.describe('첨부', () => {
  /** 클립보드/드롭에 파일을 실어 `.ProseMirror`에 이벤트를 쏜다 */
  const fire = (page: import('@playwright/test').Page, kind: 'paste' | 'drop', file: { name: string; type: string; b64: string }) =>
    page.evaluate(
      ({ kind, file }) => {
        const bytes = Uint8Array.from(atob(file.b64), (c) => c.charCodeAt(0));
        const dt = new DataTransfer();
        dt.items.add(new File([bytes], file.name, { type: file.type }));
        const target = document.querySelector('.ProseMirror')!;
        const rect = target.getBoundingClientRect();
        const ev =
          kind === 'paste'
            ? new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
            : new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: rect.left + 40, clientY: rect.top + 20 });
        target.dispatchEvent(ev);
      },
      { kind, file },
    );

  const openNote = async (page: import('@playwright/test').Page, name: string, content: string) => {
    const file = path.join(vaultDir, `${name}.md`);
    writeFileSync(file, content);
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.locator('.ProseMirror')).toBeVisible();
    return file;
  };

  test('이미지 붙여넣기: attachments/에 저장되고 노트에는 상대 경로 이미지가 들어가 화면에 보인다', async () => {
    const page = await app.firstWindow();
    const file = await openNote(page, '첨부이미지', '# 첨부이미지\n\n끝\n');
    await page.locator('.ProseMirror p', { hasText: '끝' }).click();
    await page.waitForTimeout(150);
    await fire(page, 'paste', { name: 'diagram.png', type: 'image/png', b64: PNG_B64 });
    await expect.poll(() => existsSync(path.join(vaultDir, 'attachments/diagram.png')), { timeout: 5000 }).toBe(true);
    await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 5000 }).toContain('![diagram](attachments/diagram.png)');
    const img = page.locator('.ProseMirror img').first();
    await expect(img).toHaveAttribute('src', /^vault:\/\/[0-9a-f]{12}\/attachments\/diagram\.png$/);
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBeGreaterThan(0);
  });

  test('같은 이미지를 또 붙여넣어도 파일은 하나(내용이 같으면 재사용)', async () => {
    const page = await app.firstWindow();
    await openNote(page, '첨부중복', '# 첨부중복\n\n끝\n');
    await fire(page, 'paste', { name: 'diagram.png', type: 'image/png', b64: PNG_B64 });
    await expect(page.locator('.ProseMirror img')).toHaveCount(1);
    expect(readdirSync(path.join(vaultDir, 'attachments')).filter((f) => f.startsWith('diagram'))).toEqual(['diagram.png']);
  });

  test('이름만 같고 내용이 다르면 번호를 붙여 저장한다', async () => {
    const page = await app.firstWindow();
    await openNote(page, '첨부이름', '# 첨부이름\n\n끝\n');
    const other = Buffer.from(PNG_B64, 'base64');
    other[other.length - 20] ^= 0xff; // 내용이 달라지도록 한 바이트 변경
    await fire(page, 'paste', { name: 'diagram.png', type: 'image/png', b64: other.toString('base64') });
    await expect.poll(() => existsSync(path.join(vaultDir, 'attachments/diagram 1.png')), { timeout: 5000 }).toBe(true);
  });

  test('PDF를 끌어다 놓으면 저장되고 ![[파일]] 칩이 생긴다', async () => {
    const page = await app.firstWindow();
    const file = await openNote(page, '첨부파일', '# 첨부파일\n\n끝\n');
    await fire(page, 'drop', { name: '보고서.pdf', type: 'application/pdf', b64: Buffer.from('%PDF-1.4 test').toString('base64') });
    await expect.poll(() => existsSync(path.join(vaultDir, 'attachments/보고서.pdf')), { timeout: 5000 }).toBe(true);
    await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 5000 }).toContain('![[보고서.pdf]]');
    await expect(page.locator('.nops-embed__chip', { hasText: '보고서.pdf' })).toBeVisible();
  });

  test('![[이미지|크기]] 임베드는 그림으로 보이고 크기가 적용된다', async () => {
    const page = await app.firstWindow();
    mkdirSync(path.join(vaultDir, 'attachments'), { recursive: true });
    writeFileSync(path.join(vaultDir, 'attachments/pic.png'), Buffer.from(PNG_B64, 'base64'));
    await openNote(page, '첨부임베드', '# 첨부임베드\n\n![[pic.png|120]] ![[없는파일.png]]\n');
    const img = page.locator('img.nops-embed__img');
    await expect(img).toHaveAttribute('src', /attachments\/pic\.png$/, { timeout: 5000 });
    await expect(img).toHaveCSS('width', '120px');
    await expect(page.locator('.nops-embed__chip.is-missing')).toContainText('없는파일.png');
  });

  test('이미지 대체 텍스트: 더블클릭하면 입력창이 뜨고(prompt 없이) 저장된다', async () => {
    const page = await app.firstWindow();
    const file = await openNote(page, '첨부대체텍스트', '# 첨부대체텍스트\n\n![](attachments/pic.png)\n');
    await page.locator('.ProseMirror img').dblclick();
    const input = page.locator('.nops-prompt input');
    await expect(input).toBeVisible();
    await input.fill('빨간 점');
    await input.press('Enter');
    await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 5000 }).toContain('![빨간 점](attachments/pic.png)');
  });

  test('vault:// 는 볼트 밖과 앱 내부 폴더를 열어 주지 않는다', async () => {
    const page = await app.firstWindow();
    const results = await page.evaluate(async () => {
      const id = (document.querySelector('.ProseMirror img') as HTMLImageElement).src.split('/')[2]!;
      const load = (src: string) =>
        new Promise<string>((resolve) => {
          const i = new Image();
          i.onload = () => resolve('loaded');
          i.onerror = () => resolve('blocked');
          i.src = src;
        });
      return {
        ok: await load(`vault://${id}/attachments/pic.png`),
        internal: await load(`vault://${id}/.nopsidian/config.json`),
        traversal: await load(`vault://${id}/%2e%2e/%2e%2e/etc/hosts`),
        otherVault: await load(`vault://000000000000/attachments/pic.png`),
      };
    });
    expect(results).toEqual({ ok: 'loaded', internal: 'blocked', traversal: 'blocked', otherVault: 'blocked' });
  });
});

test.describe('소스 모드와 코드 강조', () => {
  const openNote = async (page: import('@playwright/test').Page, name: string, content: string) => {
    const file = path.join(vaultDir, `${name}.md`);
    writeFileSync(file, content);
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.locator('.ProseMirror')).toBeVisible();
    return file;
  };

  test('소스 모드: 프런트매터를 포함한 원문이 보이고, 고치면 저장되며 편집 모드에도 반영된다', async () => {
    const page = await app.firstWindow();
    const original = '---\nid: SRC1\ntags: [a]\n---\n\n# 소스\n\n본문 **굵게**\n';
    const file = await openNote(page, '소스', original);
    await page.getByRole('button', { name: '소스 모드' }).click();
    const cm = page.locator('.cm-content');
    await expect(cm).toBeVisible({ timeout: 10000 });
    await expect(cm).toContainText('id: SRC1');
    await expect(cm).toContainText('본문 **굵게**');
    await expect(page.locator('.ProseMirror')).toBeHidden();

    await cm.click();
    await page.keyboard.press('ControlOrMeta+ArrowDown');
    await page.keyboard.type('\n소스에서 쓴 줄 [[링크]]\n');
    await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 5000 }).toBe(original + '\n소스에서 쓴 줄 [[링크]]\n');

    await page.getByRole('button', { name: '편집 모드' }).click();
    await expect(page.locator('.ProseMirror')).toContainText('소스에서 쓴 줄');
    await expect(page.locator('.nops-wikilink', { hasText: '링크' })).toBeVisible();
    expect(readFileSync(file, 'utf8')).toBe(original + '\n소스에서 쓴 줄 [[링크]]\n');
  });

  test('⌘E로 모드를 전환하고, 편집 모드에서 고친 내용이 소스에 그대로 보인다', async () => {
    const page = await app.firstWindow();
    const file = await openNote(page, '소스전환', '# 소스전환\n\n처음\n');
    await page.locator('.ProseMirror p', { hasText: '처음' }).click();
    await page.waitForTimeout(150);
    await page.keyboard.press('End');
    await page.keyboard.type(' 추가');
    await page.keyboard.press('ControlOrMeta+e');
    await expect(page.locator('.cm-content')).toContainText('처음 추가', { timeout: 10000 });
    expect(await page.locator('.cm-content').innerText()).toContain('# 소스전환');
    await page.keyboard.press('ControlOrMeta+e');
    await expect(page.locator('.ProseMirror')).toBeVisible();
    await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 5000 }).toBe('# 소스전환\n\n처음 추가\n');
  });

  test('각주도 소스 모드에서 손실 없이 고칠 수 있다', async () => {
    const page = await app.firstWindow();
    const file = await openNote(page, '소스각주', '# 소스각주\n\n본문[^1]\n\n[^1]: 각주 내용\n');
    await expect(page.locator('.nops-footnote-ref').first()).toHaveText('1');
    await expect(page.getByTestId('footnotes').locator('textarea').first()).toHaveValue('각주 내용');
    await page.getByRole('button', { name: '소스 모드' }).click();
    const cm = page.locator('.cm-content');
    await expect(cm).toContainText('[^1]: 각주 내용', { timeout: 10000 });
    await cm.click();
    await page.keyboard.press('ControlOrMeta+ArrowDown');
    await page.keyboard.type('\n[^2]: 둘째 각주\n');
    await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 5000 }).toBe('# 소스각주\n\n본문[^1]\n\n[^1]: 각주 내용\n\n[^2]: 둘째 각주\n');
    await page.getByRole('button', { name: '편집 모드' }).click();
    await expect(page.getByTestId('footnotes')).toContainText('[^2]');
    expect(readFileSync(file, 'utf8')).toBe('# 소스각주\n\n본문[^1]\n\n[^1]: 각주 내용\n\n[^2]: 둘째 각주\n');
  });

  test('소스 모드에서도 한글 조합 입력이 된다', async () => {
    const page = await app.firstWindow();
    const file = await openNote(page, '소스한글', '# 소스한글\n\n끝');
    await page.getByRole('button', { name: '소스 모드' }).click();
    const cm = page.locator('.cm-content');
    await expect(cm).toBeVisible({ timeout: 10000 });
    await cm.click();
    await page.keyboard.press('ControlOrMeta+ArrowDown');
    const cdp = await page.context().newCDPSession(page);
    for (const text of ['ㅎ', '하', '한']) {
      await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
    }
    await cdp.send('Input.insertText', { text: '한' });
    for (const text of ['ㄱ', '그', '글']) {
      await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
    }
    await cdp.send('Input.insertText', { text: '글' });
    await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 5000 }).toBe('# 소스한글\n\n끝한글');
  });

  test('소스 모드에서 보는 중에 파일이 밖에서 바뀌면 소스도 갱신된다', async () => {
    const page = await app.firstWindow();
    const file = await openNote(page, '소스리로드', '# 소스리로드\n\n처음\n');
    await page.getByRole('button', { name: '소스 모드' }).click();
    await expect(page.locator('.cm-content')).toContainText('처음', { timeout: 10000 });
    writeFileSync(file, '# 소스리로드\n\n밖에서 바뀜\n');
    await expect(page.locator('.cm-content')).toContainText('밖에서 바뀜', { timeout: 5000 });
  });

  test('코드 블록은 언어별로 색이 입혀지고, 저장되는 마크다운에는 영향이 없다', async () => {
    const page = await app.firstWindow();
    const src = '# 코드강조\n\n```ts\nconst x: number = 1; // 주석\n```\n\n```python\ndef f():\n    return 1\n```\n';
    const file = await openNote(page, '코드강조', src);
    await expect.poll(() => page.locator('.ProseMirror pre .nops-tok').count(), { timeout: 10000 }).toBeGreaterThan(5);
    const colors = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.ProseMirror pre .nops-tok')].map((el) => getComputedStyle(el).color),
    );
    expect(new Set(colors).size).toBeGreaterThan(2); // 여러 색
    await expect(page.locator('.ProseMirror pre').first()).toHaveText('const x: number = 1; // 주석');
    await page.waitForTimeout(800);
    expect(readFileSync(file, 'utf8')).toBe(src);
  });
});

test.describe('링크 코어', () => {
  const note = (name: string, content: string) => {
    const file = path.join(vaultDir, `${name}.md`);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
    return file;
  };
  const open = async (page: import('@playwright/test').Page, title: string) => {
    await page.getByRole('button', { name: title, exact: true }).first().click();
    await expect(page.locator('.ProseMirror')).toBeVisible();
  };

  test('Mermaid 코드 펜스는 SVG로 그리고, 오류는 원문과 함께 보여 준다', async () => {
    const page = await app.firstWindow();
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    const src = '# Mermaid호환\n\n```mermaid\nflowchart TD\n  A --> B\n```\n';
    const file = note('Mermaid호환', src);
    await open(page, 'Mermaid호환');
    const svg = page.locator('.nops-mermaid__render svg');
    await expect(svg).toBeVisible({ timeout: 20000 });
    expect(await svg.locator('text').count()).toBeGreaterThan(0); // 정화 후에도 라벨이 남는다
    expect(readFileSync(file, 'utf8')).toBe(src);
    expect(requests.some((u) => u.startsWith('http://') || u.startsWith('https://'))).toBe(false);
    // 테마가 바뀌면 Mermaid SVG도 다시 그린다.
    const lightSvg = await svg.innerHTML();
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await expect.poll(() => svg.innerHTML(), { timeout: 10000 }).not.toBe(lightSvg);
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });

    note('Mermaid오류', '# Mermaid오류\n\n```mermaid\nflowchart TD\n  A -->\n```\n');
    await open(page, 'Mermaid오류');
    await expect(page.locator('.nops-mermaid.is-error')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('.nops-mermaid pre')).toContainText('flowchart TD');

    // 악성 라벨·htmlLabels/securityLevel 우회·javascript: 클릭도 DOM 에 위험 요소를 남기지 않는다.
    note(
      'Mermaid악성',
      '# Mermaid악성\n\n```mermaid\nflowchart TD\n  A["<script>alert(1)</script>"] --> B\n  click A "javascript:alert(1)"\n```\n\n```mermaid\n%%{init: {"securityLevel": "loose", "htmlLabels": true}}%%\nflowchart TD\n  A["<img src=x onerror=alert(1)>"] --> B\n```\n',
    );
    await open(page, 'Mermaid악성');
    await expect(page.locator('.nops-mermaid').nth(1)).toBeVisible({ timeout: 20000 });
    const danger = await page.evaluate(() => ({
      scripts: document.querySelectorAll('.nops-mermaid__render script').length,
      handlers: document.querySelectorAll('.nops-mermaid__render [onerror], .nops-mermaid__render [onclick]').length,
      jsLinks: [...document.querySelectorAll<HTMLAnchorElement>('.nops-mermaid__render a')].filter((a) => a.getAttribute('href')?.startsWith('javascript:')).length,
      foreign: document.querySelectorAll('.nops-mermaid__render foreignObject').length,
    }));
    expect(danger).toEqual({ scripts: 0, handlers: 0, jsLinks: 0, foreign: 0 });
  });

  test('각주: 위첨자·아래 각주 영역·정의 편집이 원문 위치를 유지한다', async () => {
    const page = await app.firstWindow();
    const src = '# 각주호환\n\n본문[^1]과 ^[인라인]\n\n[^1]: 첫째\n\n끝 문단\n';
    const file = note('각주호환', src);
    await open(page, '각주호환');
    await expect(page.locator('.nops-footnote-ref').first()).toHaveText('1');
    const panel = page.getByTestId('footnotes');
    const area = panel.locator('textarea').first();
    await expect(area).toHaveValue('첫째');
    await area.fill('고친 정의');
    await area.blur();
    await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 5000 }).toBe('# 각주호환\n\n본문[^1]과 ^[인라인]\n\n[^1]: 고친 정의\n\n끝 문단\n');
  });

  test('백링크 패널: 이 노트를 가리키는 노트와 링크가 놓인 문맥이 보인다', async () => {
    const page = await app.firstWindow();
    note('독서/클린 코드', '---\naliases: [Clean Code]\ntags: [독서/개발]\n---\n# 클린 코드\n\n읽기 쉬운 코드\n');
    note('독서/리팩터링', '# 리팩터링\n\n함께 읽을 책은 [[클린 코드#1장|1장]]이다 #개발\n\n별칭으로도: [[Clean Code]]\n');
    await open(page, '클린 코드');
    await openDock(page);
    await page.getByRole('tab', { name: /백링크/ }).click();
    const panel = page.getByTestId('panel-backlinks');
    await expect(panel.getByRole('button', { name: '리팩터링', exact: true })).toBeVisible({ timeout: 8000 });
    await expect(panel).toContainText('함께 읽을 책은');
    await expect(panel).toContainText('별칭으로도');
    await expect(page.getByRole('tab', { name: /백링크/ })).toContainText('2');
    // 스니펫을 누르면 그 노트로 이동
    await panel.getByRole('button', { name: /함께 읽을 책은/ }).click();
    await expect(page.locator('.ProseMirror h1')).toHaveText('리팩터링');
  });

  test('나가는 링크: 해석된 링크는 이동 버튼, 없는 노트는 미해결 표시', async () => {
    const page = await app.firstWindow();
    note('나가는링크', '# 나가는링크\n\n[[클린 코드]] 와 [[아직 없는 노트]]\n');
    await open(page, '나가는링크');
    await page.getByRole('tab', { name: /나가는 링크/ }).click();
    const panel = page.getByTestId('panel-outgoing');
    await expect(panel.getByRole('button', { name: '클린 코드' })).toBeVisible({ timeout: 8000 });
    await expect(panel.locator('.unresolved')).toHaveText('아직 없는 노트');
  });

  test('링크 안 된 언급: 링크 없이 제목이 나온 곳(한글 조사 포함)을 찾는다', async () => {
    const page = await app.firstWindow();
    note('멘션글', '# 멘션글\n\n요즘 클린 코드를 다시 읽는다. 코드 안의 `클린 코드`는 제외.\n');
    await open(page, '클린 코드');
    await page.getByRole('tab', { name: /링크 안 된 언급/ }).click();
    const panel = page.getByTestId('panel-unlinked');
    await expect(panel).toContainText('요즘 클린 코드를 다시 읽는다', { timeout: 8000 });
    await expect(panel.getByRole('button', { name: '멘션글', exact: true })).toBeVisible();
    // 이미 링크한 노트(리팩터링)는 나오지 않는다
    await expect(panel.getByRole('button', { name: '리팩터링', exact: true })).toHaveCount(0);
  });

  test('태그 패널: 개수와 중첩 태그, 누르면 노트 목록', async () => {
    const page = await app.firstWindow();
    await page.getByRole('tab', { name: '태그' }).click();
    const tags = page.getByTestId('tag-panel');
    await expect(tags).toContainText('#개발', { timeout: 8000 });
    await tags.getByRole('button', { name: /#개발/ }).first().click();
    await expect(tags.getByRole('button', { name: '클린 코드' }).or(tags.getByRole('button', { name: '리팩터링' })).first()).toBeVisible();
    await page.getByRole('tab', { name: '파일', exact: true }).click();
  });

  test('빠른 전환기(⌘O): 한글 초성으로 찾아 열고, 없으면 새 노트를 만든다', async () => {
    const page = await app.firstWindow();
    await page.keyboard.press('ControlOrMeta+o');
    const input = page.getByPlaceholder(/노트 이름·별칭/);
    await expect(input).toBeVisible();
    await input.fill('ㅋㄹㅋㄷ');
    await expect(page.locator('.switcher__item.is-active')).toContainText('클린 코드');
    await page.keyboard.press('Enter');
    await expect(page.locator('.ProseMirror h1')).toHaveText('클린 코드');

    await page.keyboard.press('ControlOrMeta+o');
    await page.getByPlaceholder(/노트 이름·별칭/).fill('cleancode');
    await expect(page.locator('.switcher__item.is-active')).toContainText('클린 코드'); // 별칭 Clean Code 퍼지
    await page.keyboard.press('Escape');

    await page.keyboard.press('ControlOrMeta+o');
    await page.getByPlaceholder(/노트 이름·별칭/).fill('전환기로 만든 노트');
    await expect(page.locator('.switcher__item.is-active')).toContainText('새 노트 만들기');
    await page.keyboard.press('Enter');
    await expect.poll(() => existsSync(path.join(vaultDir, '전환기로 만든 노트.md')), { timeout: 5000 }).toBe(true);
  });

  test('[[ 자동완성: 후보를 고르면 위키링크가 들어가고 파일에 저장된다', async () => {
    const page = await app.firstWindow();
    const file = note('자동완성', '# 자동완성\n\n시작\n');
    await open(page, '자동완성');
    await page.locator('.ProseMirror p', { hasText: '시작' }).click();
    await page.waitForTimeout(150);
    await page.keyboard.press('End');
    await page.keyboard.type(' 참고: [[ㅋㄹ');
    const popup = page.locator('.nops-link-suggest');
    await expect(popup).toBeVisible();
    await expect(popup.locator('.is-active')).toContainText('클린 코드');
    await page.keyboard.press('Enter');
    await expect(page.locator('.nops-wikilink', { hasText: '클린 코드' })).toBeVisible();
    await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 5000 }).toBe('# 자동완성\n\n시작 참고: [[클린 코드]]\n');
    // 제목 자동완성: [[클린 코드#
    await page.keyboard.type(' 또 [[클린 코드#');
    await expect(popup).toBeVisible({ timeout: 5000 });
  });

  test('이름 변경(F2): 링크 갱신 미리보기를 확인하고 바꾸면 모든 링크가 따라가며, 되돌릴 수 있다', async () => {
    const page = await app.firstWindow();
    note('옛이름', '# 옛이름\n\n본문\n');
    note('참조A', '# 참조A\n\n[[옛이름]] 그리고 [[옛이름#소제목|보기]]\n');
    note('참조B', '---\n관련: ["[[옛이름]]"]\n---\n# 참조B\n\n`[[옛이름]]`은 코드라 그대로\n');
    await open(page, '옛이름');
    await openDock(page);
    await expect(page.getByRole('tab', { name: /백링크/ })).toContainText('3', { timeout: 8000 });

    await page.keyboard.press('F2');
    const input = page.locator('.nops-prompt input');
    await expect(input).toHaveValue('옛이름');
    await input.fill('폴더/새이름');
    await input.press('Enter');
    const dialog = page.getByRole('dialog', { name: '이름을 바꾸고 링크도 함께 고칠까요?' });
    await expect(dialog).toContainText('3개');
    await expect(dialog).toContainText('2개 노트');
    await dialog.getByRole('button', { name: '바꾸기' }).click();

    await expect.poll(() => existsSync(path.join(vaultDir, '폴더/새이름.md')), { timeout: 8000 }).toBe(true);
    expect(existsSync(path.join(vaultDir, '옛이름.md'))).toBe(false);
    expect(readFileSync(path.join(vaultDir, '참조A.md'), 'utf8')).toBe('# 참조A\n\n[[새이름]] 그리고 [[새이름#소제목|보기]]\n');
    expect(readFileSync(path.join(vaultDir, '참조B.md'), 'utf8')).toBe('---\n관련: ["[[새이름]]"]\n---\n# 참조B\n\n`[[옛이름]]`은 코드라 그대로\n');
    await expect(page.locator('.toast')).toContainText('링크 3개를 고쳤어요');

    await page.locator('.toast').getByRole('button', { name: '되돌리기' }).click();
    await expect.poll(() => existsSync(path.join(vaultDir, '옛이름.md')), { timeout: 8000 }).toBe(true);
    expect(existsSync(path.join(vaultDir, '폴더'))).toBe(false);
    expect(readFileSync(path.join(vaultDir, '참조A.md'), 'utf8')).toBe('# 참조A\n\n[[옛이름]] 그리고 [[옛이름#소제목|보기]]\n');
  });

  test('템플릿 삽입: 슬래시로 템플릿을 골라 변수를 채워 넣는다', async () => {
    const page = await app.firstWindow();
    note('템플릿/회의록', '---\ntags: [meeting]\n---\n## 회의 {{title}}\n\n- 날짜: {{date:YYYY년 M월 D일 (ddd)}}\n- [ ] 안건\n');
    const file = note('템플릿대상', '# 템플릿대상\n\n시작\n');
    await open(page, '템플릿대상');
    const expectedDate = await page.evaluate(() => {
      const d = new Date();
      return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${'일월화수목금토'[d.getDay()]})`;
    });
    await page.locator('.ProseMirror p', { hasText: '시작' }).click();
    await page.waitForTimeout(150);
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/ㅌㅍㄹ');
    await expect(page.locator('.oh-editor__slash-item', { hasText: '템플릿 삽입' }).first()).toBeVisible();
    await page.keyboard.press('Enter');
    const picker = page.getByRole('dialog', { name: '템플릿 삽입' });
    await expect(picker).toBeVisible();
    await expect(picker).toContainText('회의록', { timeout: 5000 });
    // 슬래시 메뉴가 에디터로 포커스를 되돌린 뒤 피커 입력창이 다시 포커스를 잡을 때까지 기다린다
    await expect(picker.locator('input')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('.ProseMirror h2')).toHaveText('회의 템플릿대상');
    await expect
      .poll(() => readFileSync(file, 'utf8'), { timeout: 5000 })
      .toContain(`## 회의 템플릿대상\n\n- 날짜: ${expectedDate}\n- [ ] 안건`);
    // 템플릿의 프런트매터는 넣지 않는다
    expect(readFileSync(file, 'utf8')).not.toContain('meeting');
  });

  test('데일리 노트 템플릿: 볼트 설정의 템플릿 변수를 채운다', async () => {
    const page = await app.firstWindow();
    note('템플릿/일일', '# {{date:YYYY년 M월 D일}} 일기\n\n- 요일: {{date:dddd}}\n');
    mkdirSync(path.join(vaultDir, '.nopsidian'), { recursive: true });
    writeFileSync(path.join(vaultDir, '.nopsidian/config.json'), JSON.stringify({ version: 1, dailyTemplate: '템플릿/일일.md' }));
    const r = await page.evaluate(() => window.nops.daily.open({ date: '2031-05-17' }));
    expect(r).toEqual({ path: '일기/2031-05-17.md', created: true });
    expect(readFileSync(path.join(vaultDir, '일기/2031-05-17.md'), 'utf8')).toBe('# 2031년 5월 17일 일기\n\n- 요일: 토요일\n');
    writeFileSync(path.join(vaultDir, '.nopsidian/config.json'), JSON.stringify({ version: 1 }));
  });

  test('링크 안 된 언급 → 링크로 변환', async () => {
    const page = await app.firstWindow();
    note('변환대상', '# 변환대상 노트\n\n본문\n');
    const mention = note('변환멘션', '# 변환멘션\n\n오늘은 변환대상 노트를 정리했다. 변환대상 노트는 두 번 나온다.\n');
    await open(page, '변환대상 노트');
    await openDock(page);
    await page.getByRole('tab', { name: /링크 안 된 언급/ }).click();
    const panel = page.getByTestId('panel-unlinked');
    await expect(panel).toContainText('오늘은 변환대상 노트를 정리했다', { timeout: 8000 });
    await panel.locator('.linkpanel__mention').first().hover();
    await panel.getByRole('button', { name: '링크로 변환' }).first().click();
    await expect
      .poll(() => readFileSync(mention, 'utf8'), { timeout: 8000 })
      // 링크 대상은 파일 이름(변환대상), 본문에 보이던 글자(제목)는 별칭으로 남는다
      .toBe('# 변환멘션\n\n오늘은 [[변환대상|변환대상 노트]]를 정리했다. 변환대상 노트는 두 번 나온다.\n');
    // 이제 이 노트를 가리키는 링크가 생겼으므로 언링크드 목록에서 사라진다
    await expect(panel).toContainText('언급된 곳이 없어요', { timeout: 8000 });
    await page.getByRole('tab', { name: /백링크/ }).click();
    await expect(page.getByTestId('panel-backlinks')).toContainText('변환멘션', { timeout: 8000 });
  });

  test('그래프: 전역·로컬 그래프와 설정 저장', async () => {
    const page = await app.firstWindow();
    note('그래프A', '# 그래프A\n\n[[그래프B]] 와 [[없는그래프노트]] #그래프태그\n');
    note('그래프B', '# 그래프B\n\n본문\n');
    // 질의: 해석된 링크는 엣지, 미해결·태그는 옵션일 때만
    await expect
      .poll(() => page.evaluate(() => window.nops.graph.global({}).then((g) => g.edges.filter((e) => e.source === '그래프A.md').map((e) => e.target))), { timeout: 8000 })
      .toEqual(['그래프B.md']);
    const full = await page.evaluate(() => window.nops.graph.global({ includeTags: true, includeUnresolved: true }));
    expect(full.nodes.map((n) => n.id)).toEqual(expect.arrayContaining(['#그래프태그', '?없는그래프노트']));
    const local = await page.evaluate(() => window.nops.graph.local({ path: '그래프A.md', depth: 1, direction: 'out' }));
    expect(local.nodes.map((n) => n.id).sort()).toEqual(['그래프A.md', '그래프B.md']);

    // 로컬 그래프: 오른쪽 패널의 탭
    await open(page, '그래프A');
    await openDock(page);
    await page.getByRole('tab', { name: '로컬 그래프' }).click();
    await expect(page.getByTestId('graph-local-stats')).toContainText('2개 노드', { timeout: 8000 });
    await expect(page.getByTestId('graph-local').locator('canvas').first()).toBeAttached();

    // 전역 그래프: 열기 → 필터 입력이 .nopsidian/graph.json 에 저장 → Esc 로 닫기
    await page.getByRole('button', { name: '그래프', exact: true }).click();
    await expect(page.getByTestId('graph-screen')).toBeVisible();
    await expect(page.getByTestId('graph-global-stats')).toContainText('개 노드', { timeout: 8000 });
    // 캔버스가 컨테이너보다 반 픽셀만 커도 .content 에 스크롤바가 생겨 폭이 줄고(윈도우·리눅스의 일반 스크롤바), 그래프가 계속 다시 맞춰지며 흔들린다
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => {
      const c = document.querySelector('.content')!;
      return [c.scrollWidth - c.clientWidth, c.scrollHeight - c.clientHeight];
    })).toEqual([0, 0]);
    await page.getByLabel('그래프 필터').fill('tag:#그래프태그');
    await expect
      .poll(
        () => {
          try {
            return JSON.parse(readFileSync(path.join(vaultDir, '.nopsidian/graph.json'), 'utf8')).filter;
          } catch {
            return null;
          }
        },
        { timeout: 5000 },
      )
      .toBe('tag:#그래프태그');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('graph-screen')).toHaveCount(0);
  });

  test('동기화: 설정 대화상자에서 클라이언트를 저장하고, 연결 전에는 켤 수 없다', async () => {
    const page = await app.firstWindow();
    // 꺼짐 + idle 에서는 사이드바 하단 버튼을 렌더하지 않는다. 진입점은 설정이다.
    await expect(page.getByTestId('sync-bar')).toHaveCount(0);
    await page.keyboard.press('Meta+,');
    await page.getByRole('dialog', { name: '설정' }).getByRole('button', { name: /Google Drive 동기화/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Google Drive 동기화' });
    await expect(dialog).toBeVisible();
    const diagnostics = dialog.getByTestId('sync-diagnostics');
    const syncStatus = await page.evaluate(() => window.nops.sync.status());
    if (syncStatus.clientSource === 'builtin') {
      // 사용자 전용 빌드: 클라이언트 입력 없이 로그인부터 시작한다.
      await expect(dialog).toContainText('앱에 내장된 Google 클라이언트');
      await expect(dialog.getByRole('button', { name: 'Google로 로그인' })).toBeEnabled();
      await expect(dialog.getByLabel('클라이언트 ID')).toBeHidden();
      await expect(dialog.getByRole('checkbox')).toBeDisabled();
      await expect(diagnostics).toContainText('앱에 내장됨 (…ltin)', { timeout: 8000 });
      await expect(dialog.getByTestId('sync-check')).toBeDisabled();
      await dialog.getByTestId('sync-copy-diagnostics').click();
      await expect(dialog).toContainText('복사했어요');
      // 내장 → 직접 입력 → 내장 전환. 어느 쪽도 다른 클라이언트 토큰을 재사용하지 않는다.
      await dialog.getByText('고급: 다른 클라이언트 쓰기').click();
      await dialog.getByLabel('클라이언트 ID').fill('1234567890-customclient.apps.googleusercontent.com');
      await dialog.getByRole('button', { name: '저장' }).click();
      await expect(dialog).toContainText('직접 입력한 클라이언트를 사용하고 있어요', { timeout: 8000 });
      await dialog.getByRole('button', { name: '앱 내장 클라이언트로' }).click();
      await expect(dialog).toContainText('앱에 내장된 Google 클라이언트', { timeout: 8000 });
      expect(syncStatus).toMatchObject({ configured: true, connected: false, enabled: false, state: 'off' });
      await expect(page.evaluate(() => window.nops.sync.plan())).rejects.toThrow(/연결되지 않았어요/);
      expect(existsSync(path.join(vaultDir, '.nopsidian', 'sync-auth.json'))).toBe(false);
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      return;
    }

    await expect(dialog.getByRole('button', { name: 'Google 계정 연결' })).toBeDisabled();
    await expect(dialog.getByRole('checkbox')).toBeDisabled();
    await expect(diagnostics).toContainText('등록 안 됨');
    await expect(diagnostics).toContainText('연결 안 됨');
    await expect(dialog.getByTestId('sync-check')).toBeDisabled();
    await dialog.getByLabel('클라이언트 ID').fill('1234567890-abcdefghijk.apps.googleusercontent.com');
    await dialog.getByRole('button', { name: '저장' }).click();
    await expect(dialog.getByRole('button', { name: 'Google 계정 연결' })).toBeEnabled({ timeout: 8000 });
    await expect(dialog).toContainText('클라이언트 ID가 저장돼 있어요');
    await expect(diagnostics).toContainText('…hijk', { timeout: 8000 });
    await expect(dialog.getByTestId('sync-check')).toBeDisabled();
    await dialog.getByTestId('sync-copy-diagnostics').click();
    await expect(dialog).toContainText('복사했어요');
    expect(await page.evaluate(() => window.nops.sync.status())).toMatchObject({ configured: true, connected: false, enabled: false, state: 'off' });
    // 아직 연결 전이니 계획을 세울 수 없다
    await expect(page.evaluate(() => window.nops.sync.plan())).rejects.toThrow(/연결되지 않았어요/);
    // 볼트 안에 로그인 정보가 새지 않았다
    expect(existsSync(path.join(vaultDir, '.nopsidian', 'sync-auth.json'))).toBe(false);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });

  test('데이터베이스: 만들기·속성·행·셀 편집·외부 편집·보드·필터·속성 이름 변경', async () => {
    const page = await app.firstWindow();
    const dbDir = path.join(vaultDir, '할일');

    // 1) 새 데이터베이스
    await page.getByRole('tab', { name: 'DB' }).click();
    await page.getByRole('button', { name: '+ 새 데이터베이스' }).click();
    await page.getByLabel('데이터베이스 이름').fill('할일');
    await page.getByLabel('데이터베이스 이름').press('Enter');
    const screen = page.getByTestId('db-screen');
    await expect(screen).toBeVisible();
    expect(readFileSync(path.join(dbDir, '_db.yaml'), 'utf8')).toContain('title: 할일');

    // 2) 속성 추가 — 상태(상태형), 점수(숫자)
    await screen.getByRole('button', { name: '속성', exact: true }).click();
    const props = page.getByRole('dialog', { name: '속성 관리' });
    await props.getByLabel('새 속성 이름').fill('상태');
    await props.getByLabel('새 속성 형식').selectOption('status');
    await props.getByLabel('새 속성 옵션').fill('할 일, 진행, 완료');
    await props.getByRole('button', { name: '추가' }).click();
    await expect(props.getByLabel('상태 형식')).toBeVisible();
    await props.getByLabel('새 속성 이름').fill('점수');
    await props.getByLabel('새 속성 형식').selectOption('number');
    await props.getByRole('button', { name: '추가' }).click();
    await expect(props.getByLabel('점수 형식')).toBeVisible();
    const yaml1 = readFileSync(path.join(dbDir, '_db.yaml'), 'utf8');
    expect(yaml1).toContain('상태:');
    expect(yaml1).toContain('점수:');
    await screen.getByRole('button', { name: '속성', exact: true }).click();

    // 3) 새 행
    await screen.getByRole('button', { name: '+ 새 행' }).click();
    await page.getByLabel('새 행 제목').fill('첫 할일');
    await page.getByLabel('새 행 제목').press('Enter');
    await expect(page.getByTestId('db-table')).toContainText('첫 할일');
    const first = path.join(dbDir, '첫 할일.md');
    expect(readFileSync(first, 'utf8')).toMatch(/^---\ncreated: /);

    // 4) 셀 편집: 상태 선택 → 프런트매터에 그 키만 쓰인다
    const row = page.locator('.dbtable__row', { hasText: '첫 할일' });
    await row.getByRole('combobox').selectOption('진행');
    await expect.poll(() => readFileSync(first, 'utf8'), { timeout: 5000 }).toContain('상태: 진행');
    // 점수(숫자): 셀을 눌러 입력
    await row.locator('.dbtable__td').nth(2).click();
    await row.locator('input[type=text]').fill('42');
    await row.locator('input[type=text]').press('Enter');
    await expect.poll(() => readFileSync(first, 'utf8'), { timeout: 5000 }).toMatch(/점수: 42/);

    // 5) 외부 편집: 파일을 직접 만들면 표에 나타난다
    writeFileSync(path.join(dbDir, '밖에서 만든.md'), '---\n상태: 완료\n점수: 7\n---\n본문\n');
    await expect(page.getByTestId('db-table')).toContainText('밖에서 만든', { timeout: 8000 });

    // 5-2) 열 머리 메뉴: 점수로 오름차순 → 7(밖에서 만든)이 먼저, 해제하면 원래대로. 숨기기도 된다
    const table = page.getByTestId('db-table');
    await clickColumnMenu(page, table, '점수', '오름차순 정렬');
    await expect(table.locator('.dbtable__row').first()).toContainText('밖에서 만든', { timeout: 5000 });
    await clickColumnMenu(page, table, '점수', '정렬 해제');
    await clickColumnMenu(page, table, '상태', '이 열 숨기기');
    await expect(table.getByTestId('th-상태')).toHaveCount(0);
    await page.getByRole('button', { name: '되돌리기' }).click();
    await expect(table.getByTestId('th-상태')).toHaveCount(1);
    const drag = (selFrom: string, selTo: string) =>
      page.evaluate(
        async ([from, to]) => {
          const tick = () => new Promise((r) => setTimeout(r, 50));
          const a = document.querySelector(from!)!;
          const b = document.querySelector(to!)!;
          const dt = new DataTransfer();
          const fire = (el: Element, type: string) => el.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
          fire(a, 'dragstart');
          await tick();
          fire(b, 'dragover');
          await tick();
          fire(b, 'drop');
          await tick();
          fire(a, 'dragend');
        },
        [selFrom, selTo],
      );
    // 열 머리를 끌어 순서 바꾸기: 점수를 상태 앞으로
    const heads = () => table.locator('.dbtable__th').allTextContents();
    expect((await heads()).map((t) => t.trim())).toEqual(['제목', '상태', '점수']);
    await drag('[data-testid="th-점수"]', '[data-testid="th-상태"]');
    await expect.poll(async () => (await heads()).map((t) => t.trim())).toEqual(['제목', '점수', '상태']);
    // 열 머리 메뉴로 필터 추가 → 필터 창이 열린다
    await clickColumnMenu(page, table, '점수', '이 열로 필터 추가');
    await expect(page.getByRole('dialog', { name: '필터' })).toBeVisible();
    // 행 손잡이를 끌어 행 순서 바꾸기
    await page.getByRole('button', { name: '되돌리기' }).click();
    const firstTitle = () => table.locator('.dbtable__row').first().locator('.dbtable__title').innerText();
    const firstBefore = await firstTitle();
    await drag('.dbtable__row:nth-of-type(2) .dbtable__rowgrip', '.dbtable__row:nth-of-type(1)');
    await expect.poll(firstTitle).not.toBe(firstBefore);
    await page.getByRole('button', { name: '되돌리기' }).click();

    // 6) 보드 뷰: 상태별 열, 카드를 다른 열로 끌면 값이 바뀐다
    await screen.getByLabel('보기 형태').selectOption('board');
    await screen.getByRole('button', { name: /^그룹/ }).click();
    await page.getByLabel('그룹 속성').selectOption('상태');
    const board = page.getByTestId('db-board');
    await expect(board.getByTestId('board-col-진행')).toContainText('첫 할일');
    await expect(board.getByTestId('board-col-완료')).toContainText('밖에서 만든');
    // 네이티브 끌기는 창 포커스에 좌우되므로 같은 DataTransfer 로 끌기 이벤트를 직접 보낸다.
    await page.evaluate(async () => {
      const tick = () => new Promise((r) => setTimeout(r, 50));
      const card = [...document.querySelectorAll('.dbcard')].find((c) => c.textContent?.includes('첫 할일'))!;
      const col = document.querySelector('[data-testid="board-col-완료"]')!;
      const dt = new DataTransfer();
      const fire = (el: Element, type: string) => el.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
      fire(card, 'dragstart');
      await tick();
      fire(col, 'dragover');
      await tick();
      fire(col, 'drop');
      await tick();
      fire(card, 'dragend');
    });
    await expect.poll(() => readFileSync(first, 'utf8'), { timeout: 5000 }).toContain('상태: 완료');
    // 같은 열 안에서 카드를 다른 카드 앞에 놓으면 순서가 바뀐다(직접 정한 순서)
    const titles = () => page.locator('[data-testid="board-col-완료"] .dbcard__title').allTextContents();
    await expect.poll(titles).toHaveLength(2);
    const before = await titles();
    await page.evaluate(async () => {
      const tick = () => new Promise((r) => setTimeout(r, 50));
      const cards = [...document.querySelectorAll('[data-testid="board-col-완료"] .dbcard')];
      const [a, b] = [cards[0]!, cards[1]!];
      const dt = new DataTransfer();
      const fire = (el: Element, type: string) => el.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
      fire(b, 'dragstart');
      await tick();
      fire(a, 'dragover');
      await tick();
      fire(a, 'drop');
      await tick();
      fire(b, 'dragend');
    });
    await expect.poll(titles).toEqual([before[1], before[0]]);

    // 7) 필터를 걸면 잠시 뒤 _db.yaml 의 뷰에 자동 저장된다
    await screen.getByLabel('보기 형태').selectOption('table');
    await screen.getByRole('button', { name: /^필터/ }).click();
    await page.getByRole('button', { name: '+ 조건 추가' }).click();
    const filter = page.getByRole('dialog', { name: '필터' });
    await filter.getByLabel('속성', { exact: true }).selectOption('점수');
    await filter.getByLabel('조건', { exact: true }).selectOption('>=');
    await filter.getByLabel('값', { exact: true }).fill('10');
    await expect(page.getByTestId('db-table')).toContainText('첫 할일');
    await expect(page.getByTestId('db-table')).not.toContainText('밖에서 만든');
    await expect(screen.getByTestId('view-save-state')).toContainText('보기 저장됨', { timeout: 5000 });
    await expect.poll(() => readFileSync(path.join(dbDir, '_db.yaml'), 'utf8'), { timeout: 5000 }).toContain('>=');
    expect(readFileSync(path.join(dbDir, '_db.yaml'), 'utf8')).toContain('manualOrder');

    // 8) 속성 이름 변경은 모든 행의 키도 바꾼다
    await screen.getByRole('button', { name: '속성', exact: true }).click();
    await page.getByRole('dialog', { name: '속성 관리' }).getByRole('button', { name: '점수' }).first().click();
    const rename = page.getByLabel('새 이름');
    await rename.fill('우선순위');
    await rename.press('Enter');
    await expect.poll(() => readFileSync(first, 'utf8'), { timeout: 8000 }).toMatch(/우선순위: 42/);
    expect(readFileSync(path.join(dbDir, '밖에서 만든.md'), 'utf8')).toContain('우선순위: 7');
    expect(readFileSync(path.join(dbDir, '_db.yaml'), 'utf8')).not.toContain('점수');
    expect(readFileSync(path.join(dbDir, '_db.yaml'), 'utf8')).toContain('우선순위');

    // Esc 는 하위 속성 창만 먼저 닫고, 한 번 더 누르면 DB 화면이 닫힌다
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: '속성 관리' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(screen).toHaveCount(0);
    await page.getByRole('tab', { name: '파일', exact: true }).click();
  });

  test('데이터베이스: 0행 필터에서도 표 헤더와 열 메뉴가 남는다', async () => {
    const page = await app.firstWindow();
    const put = (rel: string, body: string) => {
      mkdirSync(path.dirname(path.join(vaultDir, rel)), { recursive: true });
      writeFileSync(path.join(vaultDir, rel), body);
    };
    put(
      '빈표/_db.yaml',
      `title: 빈표
properties:
  점수: { type: number }
views:
  - id: t
    name: 표
    type: table
    filter:
      and:
        - { prop: 점수, op: '>=', value: 999 }
`,
    );
    put('빈표/하나.md', '---\n점수: 1\n---\n');
    put('빈표/둘.md', '---\n점수: 2\n---\n');

    await page.getByRole('tab', { name: 'DB', exact: true }).click();
    const dbEntry = page.getByTestId('db-panel').getByRole('button', { name: /빈표/ });
    await expect(dbEntry).toBeVisible({ timeout: 10_000 });
    await dbEntry.click();
    const screen = page.getByTestId('db-screen');
    const table = page.getByTestId('db-table');

    // 0행이어도 헤더가 남고, EmptyState는 그 아래 본문에 있다
    await expect(table).toBeVisible();
    await expect(table.locator('.dbtable__head')).toHaveCount(1);
    await expect(table.getByTestId('th-점수')).toBeVisible();
    await expect(table.locator('.dbtable__row')).toHaveCount(0);
    await expect(screen.getByText('조건에 맞는 결과가 없어요')).toBeVisible();
    await expect(screen.getByRole('button', { name: /조건 빼기/ })).toContainText('2개');

    // 헤더 메뉴·정렬도 0행에서 실제 좌표 클릭으로 동작한다
    await clickColumnMenu(page, table, '점수', '오름차순 정렬');
    await expect(table.getByTestId('th-점수')).toContainText('↑');
    await expect(table.getByTestId('th-점수')).toBeFocused();

    const menu = page.locator('.dbtable__menu');
    const head = table.getByTestId('th-점수');

    // 바깥 클릭으로 닫힌다(DB 화면 유지)
    await head.click();
    await expect(menu).toBeVisible();
    await page.mouse.click(700, 700);
    await expect(menu).toHaveCount(0);
    await expect(screen).toBeVisible();

    // Esc는 메뉴만 닫고 초점을 열 머리로 돌린다
    await head.focus();
    await page.keyboard.press('Enter');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem').first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(screen).toBeVisible();
    await expect(head).toBeFocused();

    // 키보드: 첫 항목 → ↓ 이동 → Enter 실행 → 머리 복귀
    await page.keyboard.press('Enter');
    await expect(menu.getByRole('menuitem').first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem').nth(1)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(menu).toHaveCount(0);
    await expect(head).toContainText('↓');
    await expect(head).toBeFocused();
    await expect(screen).toBeVisible();

    // Tab은 메뉴를 닫고 머리로 돌린다
    await page.keyboard.press('Enter');
    await expect(menu).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(menu).toHaveCount(0);
    await expect(head).toBeFocused();

    // 필터를 풀어도 헤더는 하나이고, 행이 같은 헤더 아래에 나타난다
    await screen.getByRole('button', { name: '필터 모두 지우기' }).click();
    await expect(table.locator('.dbtable__row')).toHaveCount(2);
    await expect(table).toContainText('하나');
    await expect(table.locator('.dbtable__head')).toHaveCount(1);
    await expect(screen.getByText('조건에 맞는 결과가 없어요')).toHaveCount(0);

    // 행이 있는 표에서도 Esc는 메뉴만 닫고 DB 화면을 유지한다
    await head.focus();
    await page.keyboard.press('Enter');
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(screen).toBeVisible();
    await expect(head).toBeFocused();

    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: '파일', exact: true }).click();
  });

  test('데이터베이스: 0행에서도 보드·캘린더·목록 크롬이 남는다', async () => {
    const page = await app.firstWindow();
    const put = (rel: string, body: string) => {
      mkdirSync(path.dirname(path.join(vaultDir, rel)), { recursive: true });
      writeFileSync(path.join(vaultDir, rel), body);
    };
    const zero = `    filter:
      and:
        - { prop: 점수, op: '>=', value: 999 }
`;
    put(
      '빈뷰/_db.yaml',
      `title: 빈뷰
properties:
  상태: { type: status, options: [ { name: 진행, group: doing }, { name: 완료, group: done } ] }
  마감: { type: date }
  점수: { type: number, format: number }
views:
  - id: t
    name: 표
    type: table
${zero}  - id: b
    name: 보드
    type: board
    groupBy: 상태
${zero}  - id: c
    name: 캘린더
    type: calendar
    dateProp: 마감
${zero}  - id: l
    name: 목록
    type: list
${zero}`,
    );
    put('빈뷰/하나.md', '---\n상태: 진행\n마감: 2026-11-10\n점수: 1\n---\n');
    put('빈뷰/둘.md', '---\n상태: 완료\n마감: 2026-11-20\n점수: 2\n---\n');

    await page.getByRole('tab', { name: 'DB', exact: true }).click();
    const dbEntry = page.getByTestId('db-panel').getByRole('button', { name: /빈뷰/ });
    await expect(dbEntry).toBeVisible({ timeout: 10_000 });
    await dbEntry.click();
    const screen = page.getByTestId('db-screen');
    const emptyBox = async () => {
      const box = await page.locator('.emptystate').boundingBox();
      if (!box) throw new Error('EmptyState가 없어요');
      return box.y;
    };
    const near = (y: number, base: number) => expect(Math.abs(y - base)).toBeLessThanOrEqual(8);

    // 표 기준선
    await expect(page.getByTestId('db-table').locator('.dbtable__head')).toHaveCount(1);
    const tableY = await emptyBox();

    // 보드: 열 머리·+ 새 행·EmptyState
    await screen.getByRole('tab', { name: '보드', exact: true }).click();
    const board = page.getByTestId('db-board');
    await expect(board.locator('.dbboard__col')).toHaveCount(2);
    await expect(board.locator('.dbboard__col h4').first()).toContainText('진행');
    await expect(board.getByRole('button', { name: '+ 새 행' })).toHaveCount(2);
    // 0행에서도 열의 + 새 행이 실제로 새 행 입력을 연다
    await board.getByRole('button', { name: '+ 새 행' }).first().click();
    await expect(screen.getByRole('form', { name: '새 행' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(screen.getByRole('form', { name: '새 행' })).toHaveCount(0);
    // 보드는 96px 열 + 16px gap을 지키면 표보다 EmptyState가 아래로 내려간다(시각 요구 우선)
    const boardY = await emptyBox();
    const boardChrome = await page.evaluate(() => {
      const cols = [...document.querySelectorAll('.dbboard__col')];
      const empty = document.querySelector('.emptystate');
      return {
        heights: cols.map((c) => c.getBoundingClientRect().height),
        gap: empty && cols.length ? empty.getBoundingClientRect().top - Math.max(...cols.map((c) => c.getBoundingClientRect().bottom)) : null,
      };
    });
    expect(Math.min(...boardChrome.heights)).toBeGreaterThanOrEqual(96);
    expect(boardChrome.gap).toBeGreaterThanOrEqual(16);
    expect(boardY).toBeGreaterThan(tableY);

    // 캘린더: 월 이동 바·요일 줄 유지, 실제 마우스 클릭으로 월 이동
    await screen.getByRole('tab', { name: '캘린더', exact: true }).click();
    const cal = page.getByTestId('db-calendar');
    await expect(cal.locator('.dbcal__bar')).toBeVisible();
    await expect(cal.locator('.dbcal__dow')).toHaveCount(7);
    near(await emptyBox(), tableY);
    const month = cal.locator('.dbcal__bar strong');
    const beforeMonth = await month.innerText();
    const prev = await cal.getByRole('button', { name: '이전' }).boundingBox();
    if (!prev) throw new Error('이전 버튼이 없어요');
    await page.mouse.click(prev.x + prev.width / 2, prev.y + prev.height / 2);
    await expect(month).not.toHaveText(beforeMonth);

    // 목록: EmptyState 위치가 표와 같고, 가로 스크롤이 없다
    await screen.getByRole('tab', { name: '목록', exact: true }).click();
    await expect(page.getByTestId('db-list')).toBeVisible();
    near(await emptyBox(), tableY);

    // 920에서 세 뷰 모두 가로 스크롤이 생기지 않는다
    await page.setViewportSize({ width: 920, height: 760 });
    for (const tab of ['보드', '캘린더', '목록']) {
      await screen.getByRole('tab', { name: tab, exact: true }).click();
      await expect(page.getByTestId(tab === '보드' ? 'db-board' : tab === '캘린더' ? 'db-calendar' : 'db-list')).toBeVisible();
      const widths = await page.evaluate((name) => {
        const body = document.querySelector<HTMLElement>('.dbscreen__body');
        const view = name === '보드' ? document.querySelector<HTMLElement>('.dbboard') : name === '캘린더' ? document.querySelector<HTMLElement>('.dbcal__grid') : document.querySelector<HTMLElement>('.dblist');
        return {
          doc: [document.documentElement.clientWidth, document.documentElement.scrollWidth],
          body: body ? [body.clientWidth, body.scrollWidth] : null,
          view: view ? [view.clientWidth, view.scrollWidth] : null,
        };
      }, tab);
      expect(widths.doc[1]).toBe(widths.doc[0]);
      expect(widths.body?.[1]).toBeLessThanOrEqual(widths.body?.[0] ?? Infinity);
      expect(widths.view?.[1]).toBeLessThanOrEqual(widths.view?.[0] ?? Infinity);
    }
    await page.setViewportSize({ width: 1440, height: 900 });

    // 필터를 풀면 각 뷰의 크롬은 그대로이고 내용만 돌아온다
    await screen.getByRole('tab', { name: '목록', exact: true }).click();
    await screen.getByRole('button', { name: '필터 모두 지우기' }).click();
    await expect(page.getByTestId('db-list').locator('.dblist__row')).toHaveCount(2);
    await expect(page.locator('.emptystate')).toHaveCount(0);

    await screen.getByRole('tab', { name: '보드', exact: true }).click();
    await expect(board.locator('.dbboard__col')).toHaveCount(2);
    await screen.getByRole('button', { name: '필터 모두 지우기' }).click();
    await expect(board.locator('.dbcard')).toHaveCount(2);
    await expect(page.locator('.emptystate')).toHaveCount(0);
    await expect(page.locator('.dbboard--empty')).toHaveCount(0);

    await screen.getByRole('tab', { name: '캘린더', exact: true }).click();
    await expect(cal.locator('.dbcal__bar')).toBeVisible();
    await screen.getByRole('button', { name: '필터 모두 지우기' }).click();
    await expect(cal.locator('.dbcal__chip')).toHaveCount(2);
    await expect(page.locator('.emptystate')).toHaveCount(0);

    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: '파일', exact: true }).click();
  });

  test('데이터베이스: CSV 가져오기(열 형식 추정)와 내보내기', async () => {
    const page = await app.firstWindow();
    const tmp = mkdtempSync(path.join(tmpdir(), 'nops-csv-'));
    const csv = path.join(tmp, '도서.csv');
    const out = path.join(tmp, '내보냄.csv');
    writeFileSync(
      csv,
      '\uFEFF제목,저자,평점,읽음,시작일\n클린 코드,"마틴, 로버트",5,true,2026-10-01\n리팩터링,파울러,4,false,2026/10/05\n"줄\n바꿈",누군가,3,yes,2026-10-07\n',
    );
    await app.evaluate(({ dialog }, f) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] });
    }, csv);
    await page.getByRole('tab', { name: 'DB' }).click();
    await page.getByRole('button', { name: 'CSV 가져오기' }).click();
    const importer = page.getByRole('dialog', { name: 'CSV 가져오기' });
    await expect(importer).toContainText('3행');
    await expect(importer.getByLabel('평점 형식')).toHaveValue('number');
    await expect(importer.getByLabel('읽음 형식')).toHaveValue('checkbox');
    await importer.getByRole('button', { name: '가져오기', exact: true }).click();
    await expect(importer).toContainText('3개 행을 가져왔어요');
    await importer.getByRole('button', { name: '데이터베이스 열기' }).click();
    const table = page.getByTestId('db-table');
    await expect(table).toContainText('클린 코드', { timeout: 8000 });
    await expect(table).toContainText('리팩터링');
    const dir = path.join(vaultDir, '도서');
    const yaml = readFileSync(path.join(dir, '_db.yaml'), 'utf8');
    expect(yaml).toMatch(/평점:\s*\{?\s*type: number/);
    expect(yaml).toMatch(/읽음:[\s\S]*?type: checkbox/);
    expect(yaml).toMatch(/시작일:[\s\S]*?type: date/);
    const note = readFileSync(path.join(dir, '클린 코드.md'), 'utf8');
    expect(note).toContain('저자: 마틴, 로버트');
    expect(note).toContain('평점: 5');
    expect(note).toContain('읽음: true');
    expect(readFileSync(path.join(dir, '리팩터링.md'), 'utf8')).toContain('시작일: 2026-10-05'); // 슬래시 날짜도 정규화

    await app.evaluate(({ dialog }, f) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: f });
    }, out);
    await page.getByRole('button', { name: 'CSV 내보내기' }).click();
    await expect.poll(() => existsSync(out), { timeout: 5000 }).toBe(true);
    const text = readFileSync(out, 'utf8');
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain('클린 코드,"마틴, 로버트",5,true,2026-10-01');
    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: '파일', exact: true }).click();
  });

  test('데이터베이스 고급: 관계·롤업·수식, 양방향 관계, 캘린더·타임라인', async () => {
    const page = await app.firstWindow();
    const put = (rel: string, body: string) => {
      mkdirSync(path.dirname(path.join(vaultDir, rel)), { recursive: true });
      writeFileSync(path.join(vaultDir, rel), body);
    };
    put(
      '과제/_db.yaml',
      `title: 과제
properties:
  마감: { type: date }
  단계: { type: relation, target: 단계, twoWay: true, reverse: 과제 }
  단계 수: { type: rollup, relation: 단계, property: title, fn: count }
  비용합: { type: rollup, relation: 단계, property: 비용, fn: sum }
  요약: { type: formula, expr: 'prop("title") + ": " + prop("비용합") + "원"' }
  깨짐: { type: formula, expr: '1 / 0' }
views:
  - { id: t, name: 표, type: table }
`,
    );
    put('단계/_db.yaml', 'title: 단계\nproperties:\n  비용: { type: number }\n  과제: { type: relation, target: 과제, twoWay: true, reverse: 단계 }\nviews:\n  - { id: t, type: table }\n');
    put('과제/보고서.md', '---\n마감: 2026-10-14\n단계: ["[[기획]]", "[[집필]]"]\n---\n');
    put('과제/발표.md', '---\n마감: 2026-10-20\n---\n');
    put('단계/기획.md', '---\n비용: 30\n---\n');
    put('단계/집필.md', '---\n비용: 70\n---\n');
    put('단계/검토.md', '---\n비용: 5\n---\n');

    await page.getByRole('tab', { name: 'DB' }).click();
    const dbEntry = page.getByTestId('db-panel').getByRole('button', { name: /과제/ });
    await expect(dbEntry).toBeVisible({ timeout: 10_000 });
    await dbEntry.click();
    const screen = page.getByTestId('db-screen');
    const table = page.getByTestId('db-table');

    // 롤업·수식 계산
    const row = table.locator('.dbtable__row', { hasText: '보고서' });
    await expect(row).toContainText('2', { timeout: 8000 }); // 단계 수
    await expect(row).toContainText('100'); // 비용 합
    await expect(row).toContainText('보고서: 100원'); // 수식
    await expect(row.locator('.cell__error')).toContainText('0으로 나눌 수 없어요'); // 수식 오류

    // 수식 편집: 잘못된 식은 위치와 함께 막고, 올바른 식은 적용
    await screen.getByRole('button', { name: '속성', exact: true }).click();
    const props = page.getByRole('dialog', { name: '속성 관리' });
    await props.getByRole('button', { name: '요약 설정' }).click();
    await props.getByLabel('요약 수식').fill('prop("비용합") +');
    await expect(props.getByRole('alert')).toContainText('⚠');
    await expect(props.getByRole('button', { name: '수식 적용' })).toBeDisabled();
    await props.getByLabel('요약 수식').fill('round(prop("비용합") / 3, 1)');
    await props.getByRole('button', { name: '수식 적용' }).click();
    await expect.poll(() => readFileSync(path.join(vaultDir, '과제/_db.yaml'), 'utf8'), { timeout: 5000 }).toContain('round(');
    await expect(row).toContainText('33.3', { timeout: 8000 });
    await screen.getByRole('button', { name: '속성', exact: true }).click();

    // 양방향 관계: 발표에 단계 '검토' 를 연결하면 단계/검토.md 의 과제에도 되돌아오는 링크가 생긴다
    const talk = table.locator('.dbtable__row', { hasText: '발표' });
    await talk.getByLabel('관계 노트 검색').fill('검토');
    await page.getByRole('option', { name: /검토/ }).click();
    await expect.poll(() => readFileSync(path.join(vaultDir, '과제/발표.md'), 'utf8'), { timeout: 5000 }).toContain('[[검토]]');
    await expect.poll(() => readFileSync(path.join(vaultDir, '단계/검토.md'), 'utf8'), { timeout: 8000 }).toMatch(/과제:[\s\S]*\[\[발표\]\]/);
    await expect(talk).toContainText('5', { timeout: 8000 }); // 롤업(비용합)이 따라 바뀜

    // 캘린더: 마감일 칩이 그 날짜 칸에 있고, 다른 날로 끌면 날짜가 바뀐다
    await screen.getByLabel('보기 형태').selectOption('calendar');
    await screen.getByLabel('날짜 속성').selectOption('마감');
    const cal = page.getByTestId('db-calendar');
    await expect(cal).toBeVisible();
    // 보고서(2026-10-14) 가 보이는 달로 이동한다
    for (let i = 0; i < 24 && !(await cal.locator('[data-date="2026-10-14"]').count()); i++) {
      await cal.getByRole('button', { name: /이전|다음/ }).first().click();
    }
    const dayChip = cal.locator('[data-date="2026-10-14"] .dbcal__chip', { hasText: '보고서' });
    await expect(dayChip).toBeVisible();
    await page.evaluate(async () => {
      const tick = () => new Promise((r) => setTimeout(r, 50));
      const chip = document.querySelector('[data-date="2026-10-14"] .dbcal__chip')!;
      const target = document.querySelector('[data-date="2026-10-16"]')!;
      const dt = new DataTransfer();
      const fire = (el: Element, type: string) => el.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
      fire(chip, 'dragstart');
      await tick();
      fire(target, 'dragover');
      await tick();
      fire(target, 'drop');
      await tick();
      fire(chip, 'dragend');
    });
    await expect.poll(() => readFileSync(path.join(vaultDir, '과제/보고서.md'), 'utf8'), { timeout: 5000 }).toContain('마감: 2026-10-16');
    // 칩 끝의 손잡이를 다른 날로 끌면 종료일이 늘어난다
    await expect(cal.locator('[data-date="2026-10-16"] [data-testid="cal-resize"]')).toBeVisible({ timeout: 8000 });
    await page.evaluate(async () => {
      const tick = () => new Promise((r) => setTimeout(r, 50));
      const handle = document.querySelector('[data-date="2026-10-16"] [data-testid="cal-resize"]')!;
      const target = document.querySelector('[data-date="2026-10-18"]')!;
      const dt = new DataTransfer();
      const fire = (el: Element, type: string) => el.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
      fire(handle, 'dragstart');
      await tick();
      fire(target, 'dragover');
      await tick();
      fire(target, 'drop');
      await tick();
      fire(handle, 'dragend');
    });
    await expect.poll(() => readFileSync(path.join(vaultDir, '과제/보고서.md'), 'utf8'), { timeout: 5000 }).toMatch(/2026-10-16[\s\S]*2026-10-18/);
    await expect(cal.locator('[data-date="2026-10-17"] .dbcal__chip', { hasText: '보고서' })).toBeVisible({ timeout: 8000 });

    // 타임라인
    await screen.getByLabel('보기 형태').selectOption('timeline');
    await expect(page.getByTestId('db-timeline').locator('.dbtl__barx')).toHaveCount(2);

    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: '파일', exact: true }).click();
  });

  test('미뤄 둔 기능: 폴더 이름 변경·중첩 필터·옆 창·제목 이름 변경·템플릿·CSV 기존 DB·노트 안의 데이터베이스 뷰', async () => {
    const page = await app.firstWindow();
    const put = (rel: string, body: string) => {
      mkdirSync(path.dirname(path.join(vaultDir, rel)), { recursive: true });
      writeFileSync(path.join(vaultDir, rel), body);
    };
    put('옛폴더/_db.yaml', 'title: 책장\nproperties:\n  상태: { type: select, options: [{name: 읽음}, {name: 안읽음}] }\n  쪽수: { type: number }\nviews:\n  - { id: t, name: 표, type: table }\n  - { id: b, name: 보드, type: board, groupBy: 상태 }\n');
    put('옛폴더/가.md', '---\n상태: 읽음\n쪽수: 100\n---\n가 본문\n');
    put('옛폴더/나.md', '---\n상태: 안읽음\n쪽수: 300\n---\n');
    put('옛폴더/다.md', '---\n상태: 읽음\n쪽수: 500\n---\n');
    put('템플릿/책.md', '---\n상태: 안읽음\n---\n## 메모\n\n{{title}} 을 읽고\n');
    put('보는곳.md', '# 보는곳\n\n```dbview\ndb: 책장\nview: 표\n```\n');

    // 1) 폴더 이름 변경 — 열린 데이터베이스와 행 경로가 따라간다
    await page.getByRole('tab', { name: '파일', exact: true }).click();
    const summary = page.locator('summary', { hasText: '옛폴더' });
    await summary.hover();
    await page.getByRole('button', { name: '옛폴더 폴더 이름 변경' }).click();
    const prompt = page.getByRole('dialog').locator('input');
    await prompt.fill('새폴더');
    await prompt.press('Enter');
    await expect.poll(() => existsSync(path.join(vaultDir, '새폴더/_db.yaml')), { timeout: 8000 }).toBe(true);
    expect(existsSync(path.join(vaultDir, '옛폴더'))).toBe(false);

    // 2) 노트 안의 데이터베이스 뷰(```dbview) — 값 편집이 파일에 쓰인다
    await page.getByRole('button', { name: '보는곳', exact: true }).first().click();
    const embed = page.getByTestId('db-embed');
    await expect(embed).toContainText('책장', { timeout: 8000 });
    await expect(embed).toContainText('가');
    await embed.locator('.dbtable__row', { hasText: '나' }).getByRole('combobox').selectOption('읽음');
    await expect.poll(() => readFileSync(path.join(vaultDir, '새폴더/나.md'), 'utf8'), { timeout: 5000 }).toContain('상태: 읽음');
    // 설정 편집 토글로 YAML 이 보이고, 문법이 틀리면 알린다
    await page.locator('.nops-dbview').hover();
    await page.locator('.nops-dbview__bar button').click();
    await expect(page.locator('.nops-dbview__src')).toBeVisible();

    // 3) 데이터베이스 화면: 중첩 필터(상태=읽음 AND (쪽수<=100 OR 쪽수>=500))
    await page.getByRole('tab', { name: 'DB' }).click();
    const dbEntry = page.getByTestId('db-panel').getByRole('button', { name: /책장/ });
    await expect(dbEntry).toBeVisible({ timeout: 10_000 });
    await dbEntry.click();
    const screen = page.getByTestId('db-screen');
    await screen.getByRole('button', { name: /^필터/ }).click();
    const fd = page.getByRole('dialog', { name: '필터' });
    await fd.getByRole('button', { name: '+ 조건 추가' }).first().click();
    await fd.getByLabel('속성', { exact: true }).last().selectOption('상태');
    await fd.getByLabel('값', { exact: true }).last().selectOption('읽음');
    await fd.getByRole('button', { name: '+ 그룹 추가' }).first().click();
    const orGroup = fd.getByLabel('조건 결합').last();
    await orGroup.selectOption('or');
    const props = fd.getByLabel('속성', { exact: true });
    await props.last().selectOption('쪽수');
    await fd.getByLabel('조건', { exact: true }).last().selectOption('<=');
    await fd.getByLabel('값', { exact: true }).last().fill('100');
    // 안쪽 그룹의 버튼이 DOM 에서 루트의 것보다 앞에 있다
    await fd.getByRole('button', { name: '+ 조건 추가' }).first().click();
    await fd.getByLabel('속성', { exact: true }).last().selectOption('쪽수');
    await fd.getByLabel('조건', { exact: true }).last().selectOption('>=');
    await fd.getByLabel('값', { exact: true }).last().fill('500');
    const tbl = page.getByTestId('db-table');
    await expect(tbl).toContainText('가');
    await expect(tbl).toContainText('다');
    await expect(tbl.locator('.dbtable__row')).toHaveCount(2);
    await screen.getByRole('button', { name: /^필터/ }).click();

    // 4) 옆 창으로 행 열기 + 제목 두 번 눌러 이름 바꾸기
    await screen.getByLabel('행 열기 방식').selectOption('side');
    await tbl.getByRole('button', { name: '가', exact: true }).click();
    await expect(page.getByTestId('db-peek')).toContainText('가 본문', { timeout: 8000 });
    await page.getByTestId('db-peek').getByRole('button', { name: '닫기' }).click();
    await tbl.getByRole('button', { name: '가', exact: true }).dblclick();
    await page.getByLabel('제목 바꾸기').fill('가나');
    await page.getByLabel('제목 바꾸기').press('Enter');
    await expect.poll(() => existsSync(path.join(vaultDir, '새폴더/가나.md')), { timeout: 8000 }).toBe(true);
    expect(existsSync(path.join(vaultDir, '새폴더/가.md'))).toBe(false);
    await screen.getByLabel('행 열기 방식').selectOption('full');

    // 5) 템플릿: 등록하고 기본으로 지정하면 새 행이 템플릿 본문·속성으로 만들어진다
    await screen.getByRole('button', { name: '템플릿', exact: true }).click();
    const tp = page.getByRole('dialog', { name: '템플릿' });
    await tp.getByLabel('템플릿 노트 검색').fill('책');
    await tp.getByRole('button', { name: /템플릿\/책\.md/ }).click();
    await expect.poll(() => readFileSync(path.join(vaultDir, '새폴더/_db.yaml'), 'utf8'), { timeout: 5000 }).toContain('defaultTemplate');
    await screen.getByRole('button', { name: '템플릿', exact: true }).click();
    await screen.getByRole('button', { name: '+ 새 행' }).click();
    await page.getByLabel('새 행 제목').fill('템플릿행');
    await page.getByLabel('새 행 제목').press('Enter');
    await expect.poll(() => existsSync(path.join(vaultDir, '새폴더/템플릿행.md')), { timeout: 8000 }).toBe(true);
    const made = readFileSync(path.join(vaultDir, '새폴더/템플릿행.md'), 'utf8');
    expect(made).toContain('상태: 안읽음');
    expect(made).toContain('템플릿행 을 읽고');

    // 6) CSV 를 기존 데이터베이스에 더하기(이름이 같은 속성은 기존 형식을 따른다)
    const csv = path.join(mkdtempSync(path.join(tmpdir(), 'nops-csv2-')), '추가.csv');
    writeFileSync(csv, '제목,상태,쪽수\n추가1,읽음,42\n추가2,안읽음,x\n');
    await app.evaluate(({ dialog }, f) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] });
    }, csv);
    await screen.getByRole('button', { name: 'CSV 가져오기' }).click();
    const imp = page.getByRole('dialog', { name: 'CSV 가져오기' });
    await imp.getByLabel('기존 데이터베이스에 추가').check();
    await imp.getByRole('button', { name: '가져오기', exact: true }).click();
    await expect(imp).toContainText('2개 행을 가져왔어요');
    await expect(imp).toContainText('읽을 수 없는 값'); // 쪽수 'x'
    await imp.getByRole('button', { name: '데이터베이스 열기' }).click();
    expect(readFileSync(path.join(vaultDir, '새폴더/추가1.md'), 'utf8')).toContain('쪽수: 42');

    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: '파일', exact: true }).click();
  });

  test('블록 메뉴: 키보드로 열고(⌘/) 방향키로 고르고, 여러 블록 선택은 묶음으로 처리한다', async () => {
    const page = await app.firstWindow();
    const file = note('다중블록', '# 다중블록\n\n첫째\n\n둘째\n\n셋째\n');
    await open(page, '다중블록');
    await page.locator('.ProseMirror p', { hasText: '첫째' }).click();
    await page.waitForTimeout(150);
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+ArrowDown'); // 첫째 ~ 둘째 에 걸친 선택
    await page.waitForTimeout(150); // 선택 변경을 에디터가 읽을 시간
    await page.keyboard.press('Control+/');
    const menu = page.locator('.nops-block-menu');
    await expect(menu).toBeVisible();
    await expect(menu).toContainText('블록 2개 선택됨');
    // 키보드로 열면 첫 항목(복제)에 포커스가 있고, ↓ 로 옮길 수 있다
    await expect(menu.locator('button').first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.locator('button').nth(1)).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter'); // 복제
    await expect(menu).toHaveCount(0);
    await expect
      .poll(() => readFileSync(file, 'utf8'), { timeout: 8000 })
      .toBe('# 다중블록\n\n첫째\n\n둘째\n\n첫째\n\n둘째\n\n셋째\n');

    // Esc 로 메뉴를 닫으면 에디터로 포커스가 돌아온다
    await page.locator('.ProseMirror p', { hasText: '셋째' }).click();
    await page.keyboard.press('Control+/');
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
  });

  test('블록 링크: 메뉴로 복사하고, [[노트#^ 자동완성으로 넣고, 링크를 열면 그 블록으로 간다', async () => {
    const page = await app.firstWindow();
    const target = note('블록대상', '# 블록대상\n\n첫 문단\n\n복사할 문단\n\n마지막 문단\n');
    const plain = note('아이디없음', '# 아이디없음\n\n붙일 문단 하나\n');
    const source = note('블록출발', '# 블록출발\n\n시작\n');

    // 1) 메뉴 → 블록 링크 복사
    await open(page, '블록대상');
    const para = page.locator('.ProseMirror p', { hasText: '복사할 문단' });
    await para.hover();
    await expect(page.locator('.nops-handle')).toBeVisible();
    await page.locator('.nops-handle__grip').click();
    await page.locator('.nops-block-menu button', { hasText: '블록 링크 복사' }).click();
    await expect(page.locator('.note-editor__notice')).toContainText('복사했어요', { timeout: 5000 });
    const clip = await app.evaluate(({ clipboard }) => clipboard.readText());
    const m = /^\[\[블록대상#\^([a-z0-9]{6})\]\]$/.exec(clip);
    expect(m, clip).not.toBeNull();
    const id = m![1]!;
    await expect.poll(() => readFileSync(target, 'utf8'), { timeout: 5000 }).toBe(`# 블록대상\n\n첫 문단\n\n복사할 문단 ^${id}\n\n마지막 문단\n`);

    // 2) 다른 노트에서 [[블록대상#^ 자동완성 (이미 ID가 있는 블록)
    await open(page, '블록출발');
    await page.locator('.ProseMirror p', { hasText: '시작' }).click();
    await page.waitForTimeout(150);
    await page.keyboard.press('End');
    await page.keyboard.type(' 참고: [[블록대상#^복사');
    const popup = page.locator('.nops-link-suggest');
    await expect(popup.locator('.is-active')).toContainText('복사할 문단');
    await expect(popup.locator('.is-active')).toContainText(`^${id}`);
    await page.keyboard.press('Enter');
    await expect.poll(() => readFileSync(source, 'utf8'), { timeout: 5000 }).toContain(`[[블록대상#^${id}]]`);

    // 3) ID가 없는 블록을 고르면 대상 노트에 ID가 새로 붙는다
    await page.keyboard.type(' 또 [[아이디없음#^붙일');
    await expect(popup.locator('.is-active')).toContainText('붙일 문단 하나');
    await expect(popup.locator('.is-active')).toContainText('ID를 새로');
    await page.keyboard.press('Enter');
    await expect
      .poll(() => readFileSync(plain, 'utf8'), { timeout: 8000 })
      .toMatch(/^# 아이디없음\n\n붙일 문단 하나 \^[a-z0-9]{6}\n$/);
    await expect.poll(() => readFileSync(source, 'utf8'), { timeout: 5000 }).toMatch(/\[\[아이디없음#\^[a-z0-9]{6}\]\]/);

    // 4) 블록 링크를 클릭하면 그 노트로 가서 해당 블록을 강조한다
    await page.locator('.nops-wikilink', { hasText: '블록대상' }).click();
    await expect(page.locator('.ProseMirror h1')).toHaveText('블록대상');
    await expect(page.locator('.nops-flash')).toContainText('복사할 문단', { timeout: 5000 });
  });

  test('접이식 제목·링크 호버 미리보기·노트 블록 임베드·북마크', async () => {
    const page = await app.firstWindow();
    const src = note('발췌원본', '# 발췌원본\n\n소개 문단\n\n## 세부 {.toggle}\n\n세부 내용 하나\n\n세부 내용 둘\n\n## 다음 절\n\n다음 절 내용\n\n인용할 문장 ^quote1\n');
    const user = note('발췌사용', '# 발췌사용\n\n미리보기: [[발췌원본#^quote1]]\n\n![[발췌원본#^quote1]]\n\n![[발췌원본#세부]]\n');

    // 1) 접이식 제목: 화살표를 누르면 다음 같은 단계 제목 전까지 숨고, 파일에는 접힘이 남지 않는다
    await open(page, '발췌원본');
    const arrow = page.getByTestId('toggle-heading-arrow');
    await expect(arrow).toBeVisible();
    await expect(page.locator('.ProseMirror p', { hasText: '세부 내용 하나' })).toBeVisible();
    await arrow.click();
    await expect(page.locator('.ProseMirror p', { hasText: '세부 내용 하나' })).toBeHidden();
    await expect(page.locator('.ProseMirror p', { hasText: '다음 절 내용' })).toBeVisible();
    await arrow.click();
    await expect(page.locator('.ProseMirror p', { hasText: '세부 내용 둘' })).toBeVisible();
    expect(readFileSync(src, 'utf8')).toContain('## 세부 {.toggle}\n');

    // 2) 슬래시로 토글 제목을 만들면 ` {.toggle}` 가 붙어 저장된다
    await page.locator('.ProseMirror p', { hasText: '소개 문단' }).click();
    await page.waitForTimeout(150);
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/토글제목2');
    await page.keyboard.press('Enter');
    await page.keyboard.type('새 접이식');
    await expect.poll(() => readFileSync(src, 'utf8'), { timeout: 5000 }).toContain('## 새 접이식 {.toggle}');

    // 3) 위키링크에 마우스를 올리면 대상 블록의 발췌가 뜬다
    await open(page, '발췌사용');
    await page.locator('.ProseMirror p .nops-wikilink').first().hover();
    const card = page.getByTestId('link-preview');
    await expect(card).toContainText('인용할 문장', { timeout: 5000 });
    await expect(card).toContainText('발췌원본');
    await page.locator('.ProseMirror h1').hover();
    await expect(card).toHaveCount(0);

    // 4) ![[노트#^블록]] / ![[노트#제목]] 임베드는 발췌를 인용 상자로 보여 준다
    const embeds = page.getByTestId('note-embed');
    await expect(embeds).toHaveCount(2);
    await expect(embeds.first()).toContainText('인용할 문장');
    await expect(embeds.nth(1)).toContainText('세부 내용 하나');
    await expect(embeds.nth(1)).not.toContainText('다음 절 내용');
    expect(readFileSync(user, 'utf8')).toContain('![[발췌원본#^quote1]]');

    // 5) 북마크: ⌘⇧B 로 현재 노트를 추가·해제하고, 별 탭에서 열 수 있으며 .nopsidian/bookmarks.json 에 저장된다
    await page.keyboard.press('ControlOrMeta+Shift+B');
    await page.getByRole('tab', { name: '★' }).click();
    const marks = page.getByTestId('bookmarks');
    await expect(marks).toContainText('발췌사용');
    await expect.poll(() => readFileSync(path.join(vaultDir, '.nopsidian/bookmarks.json'), 'utf8'), { timeout: 5000 }).toContain('발췌사용.md');
    await marks.locator('.marks__open', { hasText: '발췌사용' }).click();
    await expect(page.locator('.ProseMirror h1')).toHaveText('발췌사용');
    await page.getByTestId('bookmark-toggle').click();
    await expect(marks).not.toContainText('발췌사용');
    await expect.poll(() => readFileSync(path.join(vaultDir, '.nopsidian/bookmarks.json'), 'utf8'), { timeout: 5000 }).not.toContain('발췌사용.md');
    await page.getByRole('tab', { name: '파일', exact: true }).click();
  });

  test('버전 기록: 저장할 때마다 이전 버전이 남고, 현재와 비교해 복원할 수 있다', async () => {
    const page = await app.firstWindow();
    const file = note('기록노트', '# 기록노트\n\n처음 내용\n');
    await open(page, '기록노트');
    const para = page.locator('.ProseMirror p', { hasText: '처음 내용' });
    await para.click();
    await page.waitForTimeout(150);
    await page.keyboard.press('End');
    await page.keyboard.type(' 고침1');
    await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 5000 }).toContain('고침1');
    await page.keyboard.type(' 고침2');
    await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 5000 }).toContain('고침2');

    await openDock(page);
    await page.getByRole('tab', { name: '기록', exact: true }).click();
    const panel = page.getByTestId('panel-history');
    await expect(panel.getByTestId('history-entry')).not.toHaveCount(0, { timeout: 8000 });
    // 가장 오래된 기록 = 처음 내용 그대로
    await panel.getByTestId('history-entry').last().click();
    await expect(panel.getByTestId('history-diff')).toContainText('처음 내용');
    await panel.getByTestId('history-restore').click();
    await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 8000 }).toBe('# 기록노트\n\n처음 내용\n');
    await expect(page.locator('.ProseMirror p', { hasText: '처음 내용' })).not.toContainText('고침', { timeout: 8000 });
    await page.getByRole('tab', { name: '링크', exact: true }).click();
  });

  test('명령 팔레트(⌘P)와 내보내기: 노트 HTML·PDF, 볼트 전체 사이트', async () => {
    const page = await app.firstWindow();
    note('내보낼노트', '# 내보낼노트\n\n본문 [[내보낼대상]] ==강조== 입니다\n\n> [!tip] 팁\n> 콜아웃 내용\n');
    note('내보낼대상', '# 내보낼대상\n\n대상 내용\n');
    await open(page, '내보낼노트');

    // 팔레트: 초성으로 찾아 실행
    await page.keyboard.press('ControlOrMeta+p');
    const palette = page.getByTestId('command-palette');
    await expect(palette).toBeVisible();
    await palette.locator('input').fill('ㅂㅋㅁ');
    await expect(palette.getByRole('option').first()).toContainText('북마크');
    await palette.locator('input').fill('북마크 목록');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('bookmarks')).toBeVisible();
    await page.getByRole('tab', { name: '파일', exact: true }).click();

    // 저장 대화상자는 테스트에서 고정 경로로 대신한다
    const outDir = mkdtempSync(path.join(tmpdir(), 'nops-e2e-export-'));
    const htmlOut = path.join(outDir, '노트.html');
    const pdfOut = path.join(outDir, '노트.pdf');
    await app.evaluate(({ dialog }, [h, p]) => {
      let n = 0;
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: n++ === 0 ? h : p })) as typeof dialog.showSaveDialog;
    }, [htmlOut, pdfOut]);
    for (const label of ['HTML', 'PDF']) {
      await page.keyboard.press('ControlOrMeta+p');
      await palette.locator('input').fill(`현재 노트를 ${label}`);
      await page.keyboard.press('Enter');
      await expect.poll(() => existsSync(label === 'HTML' ? htmlOut : pdfOut), { timeout: 20000 }).toBe(true);
    }
    const html = readFileSync(htmlOut, 'utf8');
    expect(html).toContain('<mark>강조</mark>');
    expect(html).toContain('callout-tip');
    expect(html).toContain('class="wikilink"');
    expect(readFileSync(pdfOut).subarray(0, 5).toString()).toBe('%PDF-');

    // 볼트 전체: 폴더 선택도 대신한다
    const siteBase = mkdtempSync(path.join(tmpdir(), 'nops-e2e-site-'));
    await app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dir] })) as typeof dialog.showOpenDialog;
    }, siteBase);
    await page.keyboard.press('ControlOrMeta+p');
    await palette.locator('input').fill('볼트 전체');
    await page.keyboard.press('Enter');
    await expect.poll(() => readdirSync(siteBase).length, { timeout: 20000 }).toBe(1);
    const site = readdirSync(siteBase).map((d) => path.join(siteBase, d))[0]!;
    await expect.poll(() => existsSync(path.join(site, 'index.html')), { timeout: 10000 }).toBe(true);
    expect(readFileSync(path.join(site, '내보낼노트.html'), 'utf8')).toContain('href="%EB%82%B4%EB%B3%B4%EB%82%BC%EB%8C%80%EC%83%81.html"');
    expect(existsSync(path.join(site, 'index.html'))).toBe(true);
  });

  test('Notion 가져오기: ZIP → 새 폴더, 링크·데이터베이스 변환', async () => {
    const page = await app.firstWindow();
    const id1 = '0123456789abcdef0123456789abcdef';
    const id2 = 'fedcba9876543210fedcba9876543210';
    const zip = zipSync({
      [`노션 허브 ${id1}.md`]: strToU8(`# 노션 허브\n\n[하위](노션%20허브%20${id1}/하위%20${id2}.md)\n`),
      [`노션 허브 ${id1}/하위 ${id2}.md`]: strToU8('# 하위\n\n하위 내용\n'),
      [`노션 표 ${id2}.csv`]: strToU8('Name,Status\n행하나,진행\n행둘,완료\n'),
      [`노션 표 ${id2}/행하나 ${id1}.md`]: strToU8('# 행하나\n\nStatus: 진행\n\n행 본문\n'),
    });
    const zipFile = path.join(mkdtempSync(path.join(tmpdir(), 'nops-e2e-zip-')), 'notion.zip');
    writeFileSync(zipFile, zip);
    await app.evaluate(({ dialog }, f) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [f] })) as typeof dialog.showOpenDialog;
    }, zipFile);
    await page.keyboard.press('ControlOrMeta+p');
    await page.getByTestId('command-palette').locator('input').fill('Notion에서 가져오기');
    await page.keyboard.press('Enter');
    await expect(page.locator('.toast')).toContainText('Notion에서', { timeout: 15000 });
    const folder = readdirSync(vaultDir).find((d) => d.startsWith('Notion 가져오기'))!;
    expect(readFileSync(path.join(vaultDir, folder, '노션 허브.md'), 'utf8')).toContain('[[하위]]');
    expect(readFileSync(path.join(vaultDir, folder, '노션 표/_db.yaml'), 'utf8')).toContain('Status');
    expect(readFileSync(path.join(vaultDir, folder, '노션 표/행하나.md'), 'utf8')).toContain('Status: 진행');
    await expect(page.getByRole('button', { name: '노션 허브', exact: true })).toBeVisible({ timeout: 10000 });
  });

  test('탭·분할·새 창: 탭 쌓기, 오른쪽 분할, 배치 저장, 새 창에서 편집이 다른 창에 반영', async () => {
    const page = await app.firstWindow();
    const fa = note('탭A', '# 탭A\n\n에이 내용\n');
    note('탭B', '# 탭B\n\n비 내용\n');
    note('탭C', '# 탭C\n\n씨 내용\n');
    await open(page, '탭A');
    // 가운데 버튼 클릭이면 새 탭(⌘/Ctrl 클릭은 여러 개 선택에 쓴다)
    await page.getByRole('button', { name: '탭B', exact: true }).first().click({ button: 'middle' });
    await expect(page.locator('.ProseMirror h1')).toHaveText('탭B');
    const tabs = page.getByTestId('note-tab');
    await expect(tabs).toHaveCount(2);
    await tabs.filter({ hasText: '탭A' }).click();
    await expect(page.locator('.ProseMirror h1')).toHaveText('탭A');

    // 오른쪽 분할: 새 칸이 활성이고, 거기로 노트가 열린다
    await page.keyboard.press('ControlOrMeta+p');
    await page.getByTestId('command-palette').locator('input').fill('오른쪽으로 분할');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('pane-1')).toBeVisible();
    await page.getByRole('button', { name: '탭C', exact: true }).first().click();
    await expect(page.getByTestId('pane-1').locator('.ProseMirror h1')).toHaveText('탭C');
    await expect(page.getByTestId('pane-0').locator('.ProseMirror h1')).toHaveText('탭A');
    await expect.poll(() => readFileSync(path.join(vaultDir, '.nopsidian/workspace.json'), 'utf8'), { timeout: 5000 }).toContain('탭C.md');

    // 같은 노트를 다른 칸에서 열려 하면 그 칸으로 간다(한 노트는 한 곳에서만 편집)
    await page.getByRole('button', { name: '탭A', exact: true }).first().click();
    await expect(page.getByTestId('pane-0').locator('.ProseMirror h1')).toHaveText('탭A');

    // 새 창에서 열기 → 거기서 고친 내용이 이 창에도 반영된다
    await page.keyboard.press('ControlOrMeta+p');
    await page.getByTestId('command-palette').locator('input').fill('새 창에서 열기');
    await page.keyboard.press('Enter');
    await expect.poll(() => app.windows().length, { timeout: 10000 }).toBe(2);
    const second = app.windows().find((w) => w !== page)!;
    await expect(second.locator('.ProseMirror h1')).toHaveText('탭A', { timeout: 15000 });
    await second.locator('.ProseMirror p', { hasText: '에이 내용' }).click();
    await second.waitForTimeout(150);
    await second.keyboard.press('End');
    await second.keyboard.type(' 둘째창');
    await expect.poll(() => readFileSync(fa, 'utf8'), { timeout: 5000 }).toContain('둘째창');
    await expect(page.locator('.ProseMirror p', { hasText: '에이 내용' })).toContainText('둘째창', { timeout: 8000 });
    await second.close();
    await expect.poll(() => app.windows().length).toBe(1);

    // 분할 칸의 마지막 탭을 닫으면 분할이 풀린다
    await page.getByTestId('pane-1').getByRole('button', { name: '탭C 탭 닫기' }).click();
    await expect(page.getByTestId('pane-1')).toHaveCount(0);
  });

  test('노트 안에서 새 데이터베이스 만들기(/데이터베이스): 표·보드 보기 전환과 새 행', async () => {
    const page = await app.firstWindow();
    const file = note('디비노트', '# 디비노트\n\n앞 문단\n');
    await open(page, '디비노트');
    await page.locator('.ProseMirror p', { hasText: '앞 문단' }).click();
    await page.waitForTimeout(300);
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/데이터베이스');
    await page.keyboard.press('Enter');
    const dialogInput = page.locator('input').last();
    await dialogInput.fill('인라인할일');
    await dialogInput.press('Enter');
    await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 8000 }).toContain('db: 인라인할일');
    expect(readFileSync(path.join(vaultDir, '인라인할일/_db.yaml'), 'utf8')).toContain('보드');
    const embed = page.getByTestId('db-embed');
    await expect(embed).toBeVisible();
    await embed.getByTestId('embed-add-row').click();
    await expect(embed.locator('.dbtable__row')).toHaveCount(1, { timeout: 8000 });
    // 새 행은 곧바로 제목을 입력하는 상태로 시작한다(노션처럼). 그대로 두면 "제목 없음" 이 유지된다
    await expect(embed.getByLabel('제목 바꾸기')).toBeVisible({ timeout: 8000 });
    await embed.getByLabel('제목 바꾸기').press('Escape');
    // 노트 안의 표도 열 머리 메뉴로 열을 숨길 수 있다(저장하지 않는 임시 보기)
    await clickColumnMenu(page, embed, '날짜', '이 열 숨기기');
    await expect(embed.getByTestId('th-날짜')).toHaveCount(0, { timeout: 8000 });
    // 새 행은 첫 상태 옵션('할 일')으로 시작하고, 보드로 바꾸면 그 열에 보인다
    await embed.getByRole('tab', { name: '보드' }).click();
    await expect(embed.getByLabel('커버 속성')).toHaveCount(0); // 커버 속성 선택은 데이터베이스 화면의 도구 막대에 있다
    await expect(embed.getByTestId('board-col-할 일')).toContainText('제목 없음', { timeout: 8000 });

    // 본문 첫 이미지는 보드 카드의 커버가 된다
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    writeFileSync(path.join(vaultDir, '커버.png'), png);
    const rowFile = path.join(vaultDir, '인라인할일/제목 없음.md');
    writeFileSync(rowFile, `${readFileSync(rowFile, 'utf8')}\n![[커버.png]]\n`);
    await expect(embed.locator('.dbcard__cover').first()).toBeVisible({ timeout: 15000 });

    // 행을 열면 제목 아래에 속성 패널이 있고, 값을 고치면 프런트매터에 쓰인다
    await embed.getByRole('tab', { name: '표' }).click();
    await embed.getByRole('button', { name: '제목 없음' }).first().click();
    const props = page.getByTestId('row-props-panel');
    await expect(props).toBeVisible({ timeout: 8000 });
    await expect(props.locator('[data-prop="상태"]')).toContainText('할 일');
    await props.locator('[data-prop="상태"] .rowprops__cell').click();
    await props.locator('[data-prop="상태"] select').selectOption('완료');
    await expect.poll(() => readFileSync(path.join(vaultDir, '인라인할일/제목 없음.md'), 'utf8'), { timeout: 8000 }).toContain('상태: 완료');
    await expect(props.locator('[data-prop="상태"]')).toContainText('완료', { timeout: 8000 });

    // + 속성 추가: 행 패널에서 새 속성을 만들면 _db.yaml 에 생기고 바로 편집할 수 있다
    await props.getByTestId('row-prop-add').click();
    await props.getByLabel('새 속성 이름').fill('메모');
    await props.getByLabel('새 속성 형식').selectOption('text');
    await props.getByRole('button', { name: '추가', exact: true }).click();
    await expect.poll(() => readFileSync(path.join(vaultDir, '인라인할일/_db.yaml'), 'utf8'), { timeout: 8000 }).toContain('메모');
    await expect(props.locator('[data-prop="메모"]')).toBeVisible({ timeout: 8000 });
  });

  test('수식(KaTeX)·자동 목차·PDF 뷰어·동기화 블록(임베드에서 원본 편집)', async () => {
    const page = await app.firstWindow();
    const pdf = `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]>>endobj\ntrailer<</Root 1 0 R/Size 4>>\n%%EOF`;
    writeFileSync(path.join(vaultDir, '뷰어.pdf'), pdf);
    // 첨부 목록(인덱스)에 올라온 뒤에 열어야 임베드가 파일을 찾는다
    await expect.poll(() => page.evaluate(() => window.nops.asset.list().then((a) => a.some((x) => x.path === '뷰어.pdf'))), { timeout: 10000 }).toBe(true);
    const origin = note('동기원본', '# 동기원본\n\n고칠 문장입니다 ^sync1\n');
    note('동기사용', '# 동기사용\n\n수식 $a^2+b^2$ 입니다\n\n$$\n\\frac{1}{2}\n$$\n\n```toc\n```\n\n## 둘째 제목\n\n![[뷰어.pdf]]\n\n![[동기원본#^sync1]]\n');
    await open(page, '동기사용');

    // 수식은 MathML 로 그려진다
    await expect(page.locator('.nops-math math').first()).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.nops-mathblock__render math')).toBeVisible();
    // 목차는 제목들을 나열한다
    await expect(page.getByTestId('toc')).toContainText('둘째 제목');
    // PDF: 펼치면 뷰어 프레임이 생긴다
    await page.getByTestId('pdf-toggle').click();
    await expect(page.getByTestId('pdf-frame')).toBeVisible();

    // 동기화 블록: 임베드에서 고치면 원본 노트의 그 블록이 바뀐다(^id 유지)
    const embed = page.getByTestId('note-embed');
    await expect(embed).toContainText('고칠 문장입니다', { timeout: 8000 });
    await embed.hover();
    await page.getByTestId('note-embed-edit').click();
    const input = page.getByTestId('note-embed-input');
    await input.fill('여기서 고친 문장 **굵게**');
    await input.press('ControlOrMeta+Enter');
    await expect.poll(() => readFileSync(origin, 'utf8'), { timeout: 8000 }).toBe('# 동기원본\n\n여기서 고친 문장 **굵게** ^sync1\n');
    await expect(page.getByTestId('note-embed')).toContainText('여기서 고친 문장', { timeout: 8000 });
  });

  test('삭제(휴지통)와 이름만 바꾸기: 우클릭 삭제 → 되돌리기, F2 는 폴더를 유지한다', async () => {
    const page = await app.firstWindow();
    const keep = note('정리/유지', '# 유지\n');
    const doomed = note('정리/삭제대상', '# 삭제대상\n\n내용\n');
    await expect(page.getByRole('button', { name: '삭제대상', exact: true }).first()).toBeVisible({ timeout: 8000 });

    // 이름만 입력해도 같은 폴더 안에서 바뀐다
    await open(page, '유지');
    await page.keyboard.press('F2');
    const input = page.locator('.nops-prompt input');
    await expect(input).toHaveValue('유지'); // 폴더 없이 이름만 보인다
    await input.fill('새이름');
    await input.press('Enter');
    await expect.poll(() => existsSync(path.join(vaultDir, '정리/새이름.md')), { timeout: 8000 }).toBe(true);
    expect(existsSync(keep)).toBe(false);

    // 우클릭 → 삭제 → 확인: 휴지통으로 가고 탭이 닫힌다
    await page.getByRole('button', { name: '삭제대상', exact: true }).first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: '삭제' }).click();
    await page.getByRole('dialog').getByRole('button', { name: '삭제' }).click();
    await expect.poll(() => existsSync(doomed), { timeout: 8000 }).toBe(false);
    expect(readdirSync(path.join(vaultDir, '.nopsidian/trash')).some((f) => f.endsWith('삭제대상.md'))).toBe(true);
    await expect(page.getByTestId('note-tab').filter({ hasText: '삭제대상' })).toHaveCount(0);

    // 되돌리기
    await page.getByRole('button', { name: '되돌리기' }).click();
    await expect.poll(() => existsSync(doomed), { timeout: 8000 }).toBe(true);
  });

  test('문서 아이콘(이모지)과 사이드바 끌어서 옮기기', async () => {
    const page = await app.firstWindow();
    const file = note('아이콘노트', '# 아이콘노트\n\n본문\n');
    note('옮길곳/안쪽', '# 안쪽\n');
    const mover = note('옮길노트', '# 옮길노트\n');
    await open(page, '아이콘노트');

    // 이모지 고르기: 검색해서 고르면 프런트매터 icon 이 쓰이고 사이드바·탭에 보인다
    await page.getByTestId('note-icon-add').click({ force: true });
    const picker = page.getByTestId('emoji-picker');
    await expect(picker).toBeVisible();
    await picker.getByLabel('이모지 검색').fill('로켓');
    await picker.getByRole('option', { name: '로켓', exact: true }).click();
    await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 8000 }).toMatch(/^---\nicon: 🚀\n---\n# 아이콘노트/);
    await expect(page.getByTestId('note-icon')).toHaveText('🚀', { timeout: 8000 });
    await expect(page.locator('.tree .row.active')).toContainText('🚀');
    await expect(page.getByTestId('note-tab').first()).toContainText('🚀');
    // 바꾸기 → 제거
    await page.getByTestId('note-icon').click();
    await page.getByTestId('emoji-picker').getByRole('button', { name: '제거' }).click();
    await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 8000 }).not.toContain('icon:');

    // 사이드바에서 노트를 폴더 위로 끌어 놓으면 이동한다
    await expect(page.locator('summary', { hasText: '옮길곳' })).toBeVisible({ timeout: 8000 });
    await page.evaluate(async () => {
      const tick = () => new Promise((r) => setTimeout(r, 50));
      const row = [...document.querySelectorAll('.tree .row')].find((b) => b.textContent === '옮길노트')!;
      const folder = [...document.querySelectorAll('.tree summary')].find((b) => b.textContent?.includes('옮길곳'))!;
      const dt = new DataTransfer();
      // 폴더의 가운데에 놓으면 '폴더 안으로'(가장자리면 앞/뒤로 순서만 바뀐다)
      const mid = folder.getBoundingClientRect();
      const fire = (el: Element, type: string, y = 0) => el.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true, clientX: mid.left + 20, clientY: y }));
      fire(row, 'dragstart');
      await tick();
      fire(folder, 'dragover', mid.top + mid.height / 2);
      await tick();
      fire(folder, 'drop', mid.top + mid.height / 2);
      await tick();
      fire(row, 'dragend');
    });
    await expect.poll(() => existsSync(path.join(vaultDir, '옮길곳/옮길노트.md')), { timeout: 8000 }).toBe(true);
    expect(existsSync(mover)).toBe(false);
  });

  test('사이드바에서 끌어 순서 바꾸기: 같은 폴더 안에서도 옮겨지고, 놓을 자리에 선이 보이며, 다른 폴더로 가면 그 자리에 끼워진다', async () => {
    const page = await app.firstWindow();
    note('정렬/순서가', '# 순서가\n');
    note('정렬/순서나', '# 순서나\n');
    note('정렬/순서다', '# 순서다\n');
    note('정렬밖', '# 정렬밖\n');
    await expect(page.getByRole('button', { name: '순서다', exact: true }).first()).toBeVisible({ timeout: 8000 });
    const names = () =>
      page.evaluate(() => {
        const li = [...document.querySelectorAll('.tree li')].find((l) => l.querySelector(':scope > details > summary > span')?.textContent === '정렬');
        return [...(li?.querySelectorAll(':scope > details > ul > li > .row') ?? [])].map((b) => b.textContent);
      });
    await expect.poll(names).toEqual(['순서가', '순서나', '순서다']);

    // 드래그 도우미: 대상 행의 위(앞)/아래(뒤) 가장자리에 놓는다. `hold` 면 놓지 않고 선 표시만 확인한다.
    const drag = (fromSel: string, toSel: string, at: 'top' | 'bottom', hold = false) =>
      page.evaluate(
        async ([fromS, toS, where, hold]) => {
          const tick = () => new Promise((r) => setTimeout(r, 40));
          const rows = [...document.querySelectorAll('.tree .row')];
          const from = rows.find((b) => b.textContent === fromS)!;
          const to = rows.find((b) => b.textContent === toS)!;
          const r = to.getBoundingClientRect();
          const y = where === 'top' ? r.top + r.height * 0.15 : r.bottom - r.height * 0.15;
          const dt = new DataTransfer();
          const fire = (el: Element, type: string) => el.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.left + 20, clientY: y }));
          fire(from, 'dragstart');
          await tick();
          fire(to, 'dragover');
          await tick();
          const mark = to.closest('li')!.className;
          if (hold) {
            fire(from, 'dragend');
            return mark;
          }
          fire(to, 'drop');
          await tick();
          fire(from, 'dragend');
          return mark;
        },
        [fromSel, toSel, at, hold] as const,
      );

    // 선 표시: 위쪽 가장자리면 앞, 아래쪽이면 뒤
    expect(await drag('순서다', '순서가', 'top', true)).toContain('drop-before');
    expect(await drag('순서다', '순서가', 'bottom', true)).toContain('drop-after');
    await expect(page.locator('.tree li.drop-before, .tree li.drop-after')).toHaveCount(0); // 끝나면 선이 사라진다

    // 같은 폴더 안: '순서다' 를 '순서가' 앞으로 → 파일은 그대로, 순서만 저장된다
    await drag('순서다', '순서가', 'top');
    await expect.poll(names, { timeout: 5000 }).toEqual(['순서다', '순서가', '순서나']);
    expect(existsSync(path.join(vaultDir, '정렬/순서다.md'))).toBe(true);
    await expect.poll(() => JSON.parse(readFileSync(path.join(vaultDir, '.nopsidian/order.json'), 'utf8'))['정렬'], { timeout: 5000 }).toEqual(['순서다.md', '순서가.md', '순서나.md']);
    // 뒤로: '순서다' 를 '순서나' 뒤로
    await drag('순서다', '순서나', 'bottom');
    await expect.poll(names, { timeout: 5000 }).toEqual(['순서가', '순서나', '순서다']);

    // 다른 폴더에서 가져오기: 폴더 밖의 '정렬밖' 을 '순서나' 앞으로 → 폴더로 옮겨지고 그 자리에 끼워진다
    await drag('정렬밖', '순서나', 'top');
    await expect.poll(() => existsSync(path.join(vaultDir, '정렬/정렬밖.md')), { timeout: 8000 }).toBe(true);
    expect(existsSync(path.join(vaultDir, '정렬밖.md'))).toBe(false);
    await expect.poll(names, { timeout: 5000 }).toEqual(['순서가', '정렬밖', '순서나', '순서다']);
  });

  test('사이드바 여러 개 선택: ⌘/⇧ 클릭, 키보드 이동, 한꺼번에 끌어 순서 바꾸기·옮기기·삭제', async () => {
    const page = await app.firstWindow();
    for (const n of ['M1', 'M2', 'M3', 'M4']) note(`다중/${n}`, `# ${n}\n`);
    note('다중도착/안쪽', '# 안쪽\n');
    const row = (name: string) => page.locator('.tree .row', { hasText: new RegExp(`^${name}$`) });
    await expect(row('M4')).toBeVisible({ timeout: 8000 });
    const names = () =>
      page.evaluate(() => {
        const li = [...document.querySelectorAll('.tree li')].find((l) => l.querySelector(':scope > details > summary > span')?.textContent === '다중');
        return [...(li?.querySelectorAll(':scope > details > ul > li > .row') ?? [])].map((b) => b.textContent);
      });
    const picked = () => page.locator('.tree .row.picked').allTextContents();
    await expect.poll(names).toEqual(['M1', 'M2', 'M3', 'M4']);

    // ⌘/Ctrl 클릭: 열려 있던 노트까지 함께 골라진다. ⇧ 클릭: 범위
    await row('M1').click();
    await expect(page.locator('.ProseMirror h1')).toHaveText('M1', { timeout: 8000 });
    await row('M3').click({ modifiers: ['ControlOrMeta'] });
    expect((await picked()).sort()).toEqual(['M1', 'M3']);
    await expect(page.locator('.ProseMirror h1')).toHaveText('M1'); // 선택만 바뀌고 노트는 그대로
    await row('M2').click({ modifiers: ['Shift'] });
    expect((await picked()).sort()).toEqual(['M2', 'M3']);

    // 키보드: 화살표로 이동하고 ⇧ 화살표로 늘린다
    await row('M1').click();
    expect(await picked()).toEqual([]);
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.tree .row.cursor')).toHaveText('M2');
    await expect(page.locator('.tree .row.cursor')).toBeFocused();
    await page.keyboard.press('Shift+ArrowDown');
    expect((await picked()).sort()).toEqual(['M2', 'M3']);
    await page.keyboard.press('Escape');
    expect(await picked()).toEqual([]);

    // 여러 개를 한 덩어리로 끌어 'M1' 앞으로: 순서만 바뀌고 파일은 그대로
    const drag = (names: string[], toText: string, where: 'top' | 'bottom' | 'middle', toFolder = false) =>
      page.evaluate(
        async ([names, toText, where, toFolder]) => {
          const tick = () => new Promise((r) => setTimeout(r, 40));
          const from = [...document.querySelectorAll('.tree .row')].find((b) => b.textContent === names[0])!;
          const to = toFolder
            ? [...document.querySelectorAll('.tree summary')].find((b) => b.querySelector('span')?.textContent === toText)!
            : [...document.querySelectorAll('.tree .row')].find((b) => b.textContent === toText)!;
          const r = to.getBoundingClientRect();
          const y = where === 'top' ? r.top + r.height * 0.15 : where === 'bottom' ? r.bottom - r.height * 0.15 : r.top + r.height / 2;
          const dt = new DataTransfer();
          const fire = (el: Element, type: string) => el.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.left + 20, clientY: y }));
          fire(from, 'dragstart');
          await tick();
          fire(to, 'dragover');
          await tick();
          fire(to, 'drop');
          await tick();
          fire(from, 'dragend');
        },
        [names, toText, where, toFolder] as const,
      );
    await row('M4').click();
    await row('M2').click({ modifiers: ['ControlOrMeta'] });
    expect((await picked()).sort()).toEqual(['M2', 'M4']);
    await drag(['M2'], 'M1', 'top');
    await expect.poll(names, { timeout: 5000 }).toEqual(['M2', 'M4', 'M1', 'M3']);
    expect(existsSync(path.join(vaultDir, '다중/M4.md'))).toBe(true);

    // 폴더 가운데에 놓으면 모두 그 폴더 안으로(확인창 없이 한 번에), 되돌리기는 한 번에
    await drag(['M2'], '다중도착', 'middle', true);
    await expect.poll(() => existsSync(path.join(vaultDir, '다중도착/M2.md')) && existsSync(path.join(vaultDir, '다중도착/M4.md')), { timeout: 8000 }).toBe(true);
    expect(existsSync(path.join(vaultDir, '다중/M2.md'))).toBe(false);
    await page.getByRole('button', { name: '되돌리기' }).click();
    await expect.poll(() => existsSync(path.join(vaultDir, '다중/M2.md')) && existsSync(path.join(vaultDir, '다중/M4.md')), { timeout: 8000 }).toBe(true);

    // Delete 키: 여러 개 삭제 확인 → 휴지통 → 되돌리기
    await row('M1').click();
    await row('M3').click({ modifiers: ['ControlOrMeta'] });
    await page.keyboard.press('Delete');
    const dlg = page.getByRole('dialog');
    await expect(dlg).toContainText('2개 항목을 삭제할까요?');
    await dlg.getByRole('button', { name: '삭제' }).click();
    await expect.poll(() => existsSync(path.join(vaultDir, '다중/M1.md')) || existsSync(path.join(vaultDir, '다중/M3.md')), { timeout: 8000 }).toBe(false);
    await page.getByRole('button', { name: '되돌리기' }).click();
    await expect.poll(() => existsSync(path.join(vaultDir, '다중/M1.md')) && existsSync(path.join(vaultDir, '다중/M3.md')), { timeout: 8000 }).toBe(true);
  });

  test('AI 에이전트(MCP): 설정에 연결 방법이 나오고, 번들된 서버로 에이전트가 쓴 노트가 앱에 바로 나타나며 기록되고, 허용 밖은 거부된다', async () => {
    const page = await app.firstWindow();
    await page.keyboard.press('ControlOrMeta+,');
    const settings = page.getByRole('dialog', { name: '설정' });
    await settings.getByRole('tab', { name: 'Claude Code' }).click();
    const cli = settings.getByTestId('mcp-cli');
    // 패키징된 앱은 Node.js 없이 앱 실행 파일 자체가 `--mcp-stdio` 로 MCP 서버가 된다(#8)
    await expect(cli).toContainText('--mcp-stdio', { timeout: 8000 });
    await expect(cli).not.toContainText('-- node ');
    await expect(cli).toContainText(vaultDir);
    await expect(cli).not.toContainText('--write');
    await settings.getByLabel('에이전트가 노트 쓰기 허용').check();
    await expect(cli).toContainText('--write');
    await expect(cli).toContainText('--write-folder "AI"');
    const shown = (await cli.innerText()).match(/^claude mcp add -s user ([^ ]+) -- "([^"]+)" (.*?--mcp-stdio)/)!;
    expect(shown[1]).toMatch(/^lasagna-/);
    const exe = shown[2]!;
    const launchArgs = shown[3]!.split(' ');
    expect(existsSync(exe)).toBe(true);
    // 쓰기를 켠 채로 연결한다(앱 정책 파일도 write=true). 스위치를 끄는 동작은 아래 정책 테스트가 맡는다.
    await page.keyboard.press('Escape');

    // 앱이 안내한 실행 파일·인자를 그대로 실행해 MCP(stdio)로 붙는다(별도 Node.js 없이)
    const client = new Client({ name: 'e2e-agent', version: '1' });
    await client.connect(new StdioClientTransport({ command: exe, args: [...launchArgs, '--vault', vaultDir, '--write'], stderr: 'ignore' }));
    try {
      const tools = (await client.listTools()).tools.map((t) => t.name);
      expect(tools).toEqual(expect.arrayContaining(['search_notes', 'create_note', 'append_to_note', 'edit_note', 'list_databases', 'query_database', 'add_database_row', 'update_database_row', 'append_to_daily_note']));
      const text = (r: unknown) => (r as { content: { text: string }[] }).content[0]!.text;
      // 읽기: 앱에 있는 노트를 검색한다
      expect(text(await client.callTool({ name: 'search_notes', arguments: { query: 'Nopsidian' } }))).toContain('프로젝트/Nopsidian.md');
      // 쓰기: AI/ 폴더에 새 노트 → 앱 사이드바에 바로 나타난다
      const created = await client.callTool({ name: 'create_note', arguments: { path: 'AI/에이전트노트', title: '에이전트노트', content: '에이전트가 쓴 첫 문장', tags: ['ai'] } });
      expect(created.isError).toBeFalsy();
      await expect(page.getByRole('button', { name: '에이전트노트', exact: true }).first()).toBeVisible({ timeout: 10000 });
      await page.getByRole('button', { name: '에이전트노트', exact: true }).first().click();
      await expect(page.locator('.ProseMirror')).toContainText('에이전트가 쓴 첫 문장');
      // 열려 있는 노트에 덧붙이면 편집기가 바로 갱신된다
      await client.callTool({ name: 'append_to_note', arguments: { path: 'AI/에이전트노트.md', content: '덧붙인 둘째 문장' } });
      await expect(page.locator('.ProseMirror')).toContainText('덧붙인 둘째 문장', { timeout: 10000 });
      // 허용 폴더 밖은 거부되고 파일이 생기지 않는다
      const denied = await client.callTool({ name: 'create_note', arguments: { path: '프로젝트/몰래', content: 'x' } });
      expect(denied.isError).toBe(true);
      expect(existsSync(path.join(vaultDir, '프로젝트/몰래.md'))).toBe(false);
    } finally {
      await client.close();
    }

    // 설정의 "최근 에이전트 작업" 에 남는다
    await page.keyboard.press('ControlOrMeta+,');
    const audit = page.getByRole('dialog', { name: '설정' }).getByTestId('mcp-audit');
    await expect(audit).toContainText('AI/에이전트노트.md', { timeout: 8000 });
    await expect(audit).toContainText('e2e-agent');
    await expect(audit.locator('li.denied')).toContainText('프로젝트/몰래.md');

    // 되돌리기: 덧붙인 것을 되돌리면 이전 내용으로, 새로 만든 노트를 되돌리면 휴지통으로
    const note = path.join(vaultDir, 'AI/에이전트노트.md');
    expect(readFileSync(note, 'utf8')).toContain('덧붙인 둘째 문장');
    const dlg = page.getByRole('dialog', { name: '설정' });
    // 만든 기록은 그 뒤로 바뀌었으므로 먼저 되돌리면 거부된다
    await audit.locator('li', { hasText: '새로 만듦' }).getByTestId('mcp-revert').click();
    await audit.locator('li', { hasText: '새로 만듦' }).getByTestId('mcp-revert-confirm').click();
    await expect(dlg.getByTestId('mcp-revert-msg')).toContainText('또 바뀌었어요');
    expect(existsSync(note)).toBe(true);
    await audit.locator('li', { hasText: '덧붙임' }).getByTestId('mcp-revert').click();
    await audit.locator('li', { hasText: '덧붙임' }).getByTestId('mcp-revert-confirm').click();
    await expect(dlg.getByTestId('mcp-revert-msg')).toContainText('이전 내용으로 되돌렸어요');
    await expect.poll(() => readFileSync(note, 'utf8'), { timeout: 8000 }).not.toContain('덧붙인 둘째 문장');
    expect(readFileSync(note, 'utf8')).toContain('에이전트가 쓴 첫 문장');
    await expect(audit.locator('li.reverted')).toHaveCount(1);
    await audit.locator('li', { hasText: '새로 만듦' }).getByTestId('mcp-revert').click();
    await audit.locator('li', { hasText: '새로 만듦' }).getByTestId('mcp-revert-confirm').click();
    await expect(dlg.getByTestId('mcp-revert-msg')).toContainText('휴지통으로 옮겼어요');
    await expect.poll(() => existsSync(note), { timeout: 8000 }).toBe(false);
    await expect(audit.locator('li', { hasText: '되돌림' }).first()).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('AI 에이전트(MCP): 앱 스위치를 끄면 이미 연결된 세션의 다음 쓰기가 거부되고 다시 켜면 복구된다', async () => {
    const page = await app.firstWindow();
    await page.keyboard.press('ControlOrMeta+,');
    const settings = page.getByRole('dialog', { name: '설정' });
    const write = settings.getByLabel('에이전트가 노트 쓰기 허용');
    const policyFile = path.join(vaultDir, '.nopsidian', 'mcp-policy.json');
    const policyWrite = () => {
      try {
        return (JSON.parse(readFileSync(policyFile, 'utf8')) as { write?: boolean }).write ?? null;
      } catch {
        return null;
      }
    };
    // 이전 테스트가 꺼 두었을 수 있으므로 한 번 껐다 켜서 정책 파일을 확실히 만든다.
    if (await write.isChecked()) await write.uncheck();
    await write.check();
    await expect.poll(policyWrite).toBe(true);

    const client = new Client({ name: 'policy-e2e', version: '1' });
    await client.connect(
      new StdioClientTransport({ command: executable, args: ['--mcp-stdio', '--vault', vaultDir, '--write', '--write-folder', 'AI'], stderr: 'ignore' }),
    );
    const callText = async (name: string, args: Record<string, unknown>) => {
      const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
      return { isError: !!r.isError, text: r.content[0]!.text };
    };
    try {
      expect((await callText('create_note', { path: 'AI/policy-live', content: '켜짐' })).isError).toBe(false);
      await write.uncheck();
      await expect.poll(policyWrite).toBe(false);
      const denied = await callText('create_note', { path: 'AI/policy-blocked', content: 'x' });
      expect(denied.isError).toBe(true);
      expect(denied.text).toContain('policy-disabled');
      expect(existsSync(path.join(vaultDir, 'AI/policy-blocked.md'))).toBe(false);
      await write.check();
      await expect.poll(policyWrite).toBe(true);
      expect((await callText('create_note', { path: 'AI/policy-recovered', content: '다시 켜짐' })).isError).toBe(false);
    } finally {
      await client.close();
      await write.uncheck();
      await expect.poll(policyWrite).toBe(false);
      await page.keyboard.press('Escape');
    }
    const audit = readFileSync(path.join(vaultDir, '.nopsidian', 'mcp-audit.jsonl'), 'utf8');
    expect(audit).toContain('policy-disabled');
  });

  test('노트 커버: 그라디언트·업로드한 이미지를 고르고, 바꾸고, 제거한다', async () => {
    const page = await app.firstWindow();
    const file = note('커버노트', '# 커버노트\n\n본문\n');
    await open(page, '커버노트');
    await expect(page.getByTestId('note-cover')).toHaveCount(0);

    // 그라디언트
    await page.getByTestId('note-cover-add').click({ force: true });
    const picker = page.getByTestId('cover-picker');
    await expect(picker).toBeVisible();
    await picker.getByRole('tab', { name: '그라디언트' }).click();
    await picker.getByTestId('gradient-ocean').click();
    await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 8000 }).toBe('---\ncover: gradient:ocean\n---\n# 커버노트\n\n본문\n');
    await expect(page.getByTestId('note-cover')).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId('note-cover')).toHaveCSS('background-image', /linear-gradient/);
    await expect(page.locator('.ProseMirror')).toContainText('본문');

    // 이미지 올리기: 볼트에 저장되고 그 이름이 cover 가 된다
    await page.getByTestId('note-cover').hover();
    await page.getByTestId('note-cover-change').click();
    await page.getByTestId('cover-picker').getByRole('tab', { name: '이미지' }).click();
    await page.getByTestId('cover-picker').getByTestId('cover-upload-input').setInputFiles({ name: '표지.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64') });
    await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 10000 }).toMatch(/^---\ncover: .*표지.*\.png\n---\n# 커버노트/);
    const img = page.getByTestId('note-cover').locator('img');
    await expect(img).toBeVisible({ timeout: 8000 });
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 8000 }).toBeGreaterThan(0);

    // 제거: 프런트매터가 비면 통째로 없어진다
    await page.getByTestId('note-cover').hover();
    await page.getByTestId('note-cover-remove').click();
    await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 8000 }).toBe('# 커버노트\n\n본문\n');
    await expect(page.getByTestId('note-cover')).toHaveCount(0);
  });

  test('댓글: 남기고(선택한 글 인용), 해결하고, 노트 이름을 바꿔도 따라가며, 에이전트가 단 댓글도 보인다', async () => {
    const page = await app.firstWindow();
    note('댓글노트', '# 댓글노트\n\n인용할 문장입니다\n');
    await open(page, '댓글노트');
    await openDock(page);
    const dockTab = page.locator('.dockbody__tabs').getByRole('tab', { name: /^댓글/ });
    await dockTab.click();
    const panel = page.getByTestId('comments');
    await expect(panel).toContainText('아직 댓글이 없어요');

    // 선택한 글을 인용해 남긴다
    await page.locator('.ProseMirror p', { hasText: '인용할 문장입니다' }).click({ clickCount: 3 });
    await panel.getByRole('button', { name: '선택한 글 인용' }).click();
    await expect(panel.locator('.comments__new .comment__quote')).toContainText('인용할 문장입니다');
    await panel.getByLabel('댓글 내용').fill('이 문장을 다듬자');
    await panel.getByRole('button', { name: '남기기' }).click();
    const item = panel.getByTestId('comment').first();
    await expect(item).toContainText('이 문장을 다듬자');
    await expect(item.locator('.comment__quote')).toContainText('인용할 문장입니다');
    await expect(dockTab).toHaveText('댓글 1');
    const dir = path.join(vaultDir, '.nopsidian/comments');
    expect(readdirSync(dir).length).toBe(1);

    // 노트 이름을 바꿔도 댓글이 따라간다
    await page.keyboard.press('F2');
    const input = page.locator('.nops-prompt input');
    await input.fill('댓글노트이름바꿈');
    await input.press('Enter');
    await expect(page.getByTestId('note-tab').filter({ hasText: '댓글노트이름바꿈' })).toHaveCount(1, { timeout: 8000 });
    await expect(panel.getByTestId('comment')).toHaveCount(1, { timeout: 8000 });

    // 에이전트(MCP)가 단 댓글도 보인다: 창에 돌아올 때 다시 읽는다
    // 앞선 앱 정책 테스트가 쓰기를 꺼 두었을 수 있으므로 이 테스트는 쓰기 허용 정책을 명시한다.
    mkdirSync(path.join(vaultDir, '.nopsidian'), { recursive: true });
    writeFileSync(
      path.join(vaultDir, '.nopsidian/mcp-policy.json'),
      JSON.stringify({ version: 1, write: true, writeFolders: ['AI'], maxWritesPerMinute: 30 }),
    );
    const script = path.join(packagedResourcesDir(), 'nopsidian-mcp.mjs');
    const client = new Client({ name: 'review-agent', version: '1' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [script, '--vault', vaultDir, '--write'], stderr: 'ignore' }));
    try {
      const r = (await client.callTool({ name: 'add_comment', arguments: { path: '댓글노트이름바꿈.md', text: '검토했어요: 좋아요' } })) as { isError?: boolean };
      expect(r.isError).toBeFalsy();
      const l = (await client.callTool({ name: 'list_comments', arguments: { path: '댓글노트이름바꿈.md' } })) as { content: { text: string }[] };
      expect(l.content[0]!.text).toContain('이 문장을 다듬자');
    } finally {
      await client.close();
    }
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(panel.getByTestId('comment')).toHaveCount(2, { timeout: 8000 });
    await expect(panel).toContainText('review-agent');

    // 해결 → 접힌 목록으로, 삭제
    await panel.getByTestId('comment').first().hover();
    await panel.getByTestId('comment').first().getByRole('button', { name: '해결' }).click();
    await expect(panel.locator('.comments__done')).toContainText('해결된 댓글 1개');
    await expect(dockTab).toHaveText('댓글 1');
    await panel.getByTestId('comment').first().hover();
    await panel.getByTestId('comment').first().getByRole('button', { name: '댓글 삭제' }).click();
    await expect(panel.getByTestId('comment')).toHaveCount(1);
    await expect(panel).not.toContainText('review-agent'); // 열린 목록의 첫 댓글(에이전트가 단 것)이 지워졌다
    await expect(panel.locator('.comments__done')).toContainText('이 문장을 다듬자'); // 해결한 댓글은 남아 있다
  });

  test('@ 로 날짜 넣기: @내일 → 그 날짜의 노트 링크, @+3 은 사흘 뒤, 잘못된 날짜는 후보가 없다', async () => {
    const page = await app.firstWindow();
    const file = note('날짜멘션', '# 날짜멘션\n\n시작\n');
    await open(page, '날짜멘션');
    const iso = (offset: number) => {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    await page.locator('.ProseMirror p').last().click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('약속 @내');
    const menu = page.locator('.nops-date-suggest');
    await expect(menu).toBeVisible({ timeout: 5000 });
    await expect(menu.locator('.nops-date-suggest__item')).toHaveCount(1);
    await expect(menu).toContainText(iso(1));
    await page.keyboard.press('Enter');
    await expect(menu).toBeHidden();
    await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 8000 }).toContain(`시작약속 [[${iso(1)}]]`);
    // 며칠 뒤
    await page.keyboard.type(' 마감 @+3');
    await expect(menu).toContainText(`3일 뒤 · ${iso(3)}`);
    await page.keyboard.press('Tab');
    await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 8000 }).toContain(`마감 [[${iso(3)}]]`);
    // 없는 날짜·모르는 말은 메뉴가 뜨지 않고, 이메일 주소의 @ 는 건드리지 않는다
    await page.keyboard.type(' @2026-02-30');
    await expect(menu).toBeHidden();
    await page.keyboard.type(' me@example.com');
    await expect(menu).toBeHidden();
    expect(readFileSync(file, 'utf8')).not.toContain('[[2026-02-30]]');
  });

  test('오늘의 노트: 한 번 누르면 일기/날짜.md를 만들고 열며, 다시 누르면 같은 노트', async () => {
    const page = await app.firstWindow();
    const today = await page.evaluate(() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });
    await page.getByRole('button', { name: '오늘', exact: true }).click();
    await expect(page.locator('.ProseMirror h1')).toHaveText(today, { timeout: 8000 });
    const file = path.join(vaultDir, '일기', `${today}.md`);
    expect(readFileSync(file, 'utf8')).toBe(`# ${today}\n\n`);
    await page.locator('.ProseMirror').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('오늘 한 일');
    await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 5000 }).toContain('오늘 한 일');
    await page.getByRole('button', { name: '오늘', exact: true }).click();
    await expect(page.locator('.ProseMirror')).toContainText('오늘 한 일');
  });

  test('새 폴더·폴더 안 새 노트·휴지통 보기(복원·영구 삭제)·창 제목', async () => {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: '새 폴더', exact: true }).click();
    const input = page.locator('.nops-prompt input');
    await input.fill('빈폴더');
    await input.press('Enter');
    await expect.poll(() => existsSync(path.join(vaultDir, '빈폴더')), { timeout: 8000 }).toBe(true);
    // 노트가 없어도 사이드바에 보이고, 우클릭으로 안에 노트를 만든다
    const folder = page.locator('.tree summary', { hasText: '빈폴더' });
    await expect(folder).toBeVisible({ timeout: 8000 });
    await folder.click({ button: 'right' });
    await page.getByRole('menuitem', { name: '여기에 새 노트' }).click();
    // 이름을 묻지 않고 '제목 없음'으로 만들어 제목에 커서를 둔다 → 제목을 쓰고 떠나면 파일 이름이 된다
    await expect.poll(() => existsSync(path.join(vaultDir, '빈폴더/제목 없음.md')), { timeout: 8000 }).toBe(true);
    await expect(page.locator('.ProseMirror h1.nops-empty-title')).toBeVisible({ timeout: 8000 });
    await page.keyboard.type('폴더안노트');
    await expect.poll(() => readFileSync(path.join(vaultDir, '빈폴더/제목 없음.md'), 'utf8'), { timeout: 8000 }).toBe('# 폴더안노트\n');
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const inner = path.join(vaultDir, '빈폴더/폴더안노트.md');
    await expect.poll(() => existsSync(inner), { timeout: 8000 }).toBe(true);
    await expect(page.locator('.ProseMirror h1')).toHaveText('폴더안노트', { timeout: 8000 });
    await expect.poll(() => page.title(), { timeout: 5000 }).toBe('폴더안노트 — Lasagna');

    // 삭제 → 휴지통에서 복원
    await page.getByRole('button', { name: '폴더안노트', exact: true }).first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: '삭제' }).click();
    await page.getByRole('dialog').getByRole('button', { name: '삭제' }).click();
    await expect.poll(() => existsSync(inner), { timeout: 8000 }).toBe(false);
    await page.getByRole('button', { name: '휴지통', exact: true }).click();
    const trash = page.getByRole('dialog', { name: '휴지통' });
    const row = trash.locator('li', { hasText: '빈폴더/폴더안노트' });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: '복원' }).click();
    await expect.poll(() => existsSync(inner), { timeout: 8000 }).toBe(true);
    await expect(row).toHaveCount(0);
    await trash.getByRole('button', { name: '닫기' }).click();

    // 다시 지우고 영구 삭제하면 목록과 휴지통 폴더에서 사라진다
    await page.getByRole('button', { name: '폴더안노트', exact: true }).first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: '삭제' }).click();
    await page.getByRole('dialog').getByRole('button', { name: '삭제' }).click();
    await expect.poll(() => existsSync(inner), { timeout: 8000 }).toBe(false);
    await page.getByRole('button', { name: '휴지통', exact: true }).click();
    await trash.locator('li', { hasText: '빈폴더/폴더안노트' }).getByRole('button', { name: '영구 삭제' }).click();
    await expect(trash.locator('li', { hasText: '빈폴더/폴더안노트' })).toHaveCount(0);
    expect(readdirSync(path.join(vaultDir, '.nopsidian/trash')).some((f) => f.endsWith('폴더안노트.md'))).toBe(false);
    await page.keyboard.press('Escape');
    await expect(trash).toHaveCount(0);
  });

  test('노트 안 찾기·바꾸기(⌘F)와 단축키 목록(F1)', async () => {
    const page = await app.firstWindow();
    const file = note('찾기노트', '# 찾기노트\n\n사과 바나나 사과\n\n포도 사과\n');
    await open(page, '찾기노트');
    await page.locator('.ProseMirror p').first().click();
    await page.keyboard.press('ControlOrMeta+f');
    const bar = page.getByTestId('find-bar');
    await expect(bar).toBeVisible();
    await bar.getByLabel('찾을 말').fill('사과');
    await expect(bar.getByTestId('find-count')).toHaveText(/^[123]\/3$/);
    await expect(page.locator('.ProseMirror-search-match, .ProseMirror-active-search-match')).toHaveCount(3);
    const before = await bar.getByTestId('find-count').textContent();
    await bar.getByLabel('찾을 말').press('Enter');
    await expect(bar.getByTestId('find-count')).not.toHaveText(before!);
    await bar.getByLabel('찾을 말').fill('없는말');
    await expect(bar.getByTestId('find-count')).toHaveText('없음');
    await bar.getByLabel('찾을 말').fill('사과');
    // 바꾸기: 모두 바꾸기 → 파일에 반영
    await bar.getByRole('button', { name: '바꾸기 열기' }).click();
    await bar.getByLabel('바꿀 말').fill('배');
    await bar.getByRole('button', { name: '모두 바꾸기' }).click();
    await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 8000 }).toBe('# 찾기노트\n\n배 바나나 배\n\n포도 배\n');
    await expect(bar.getByTestId('find-count')).toHaveText('없음');
    await bar.getByLabel('찾을 말').press('Escape');
    await expect(bar).toHaveCount(0);
    await expect(page.locator('.ProseMirror-search-match')).toHaveCount(0);

    // F1: 단축키 목록(맥은 ⌘ 표기)
    await page.keyboard.press('F1');
    const dlg = page.getByRole('dialog', { name: '단축키' });
    await expect(dlg).toBeVisible();
    await expect(dlg).toContainText(process.platform === 'darwin' ? '⌘O' : 'Ctrl+O');
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
  });

  test('노션처럼 새 노트: 제목 없음으로 바로 열고, 제목을 쓰고 떠나면 파일 이름이 따라가며, F2 이름 변경은 제목도 바꾼다', async () => {
    const page = await app.firstWindow();
    await page.getByRole('tab', { name: '파일', exact: true }).click();
    await page.getByRole('button', { name: '새 노트', exact: true }).click();
    const untitled = path.join(vaultDir, '제목 없음.md');
    await expect.poll(() => existsSync(untitled), { timeout: 8000 }).toBe(true);
    await expect(page.locator('.ProseMirror h1.nops-empty-title')).toBeVisible({ timeout: 8000 });
    // 커서가 제목에 있으므로 바로 쓴다
    await page.keyboard.type('주간 회의');
    await page.keyboard.press('Enter');
    await page.keyboard.type('안건 정리');
    await expect.poll(() => readFileSync(untitled, 'utf8'), { timeout: 8000 }).toBe('# 주간 회의\n\n안건 정리\n');
    // 쓰는 동안에는 이름을 바꾸지 않는다
    expect(existsSync(path.join(vaultDir, '주간 회의.md'))).toBe(false);
    // 노트를 떠나면(초점이 밖으로) 파일 이름이 제목을 따라간다
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const renamed = path.join(vaultDir, '주간 회의.md');
    await expect.poll(() => existsSync(renamed), { timeout: 8000 }).toBe(true);
    expect(existsSync(untitled)).toBe(false);
    expect(readFileSync(renamed, 'utf8')).toBe('# 주간 회의\n\n안건 정리\n');
    await expect(page.getByTestId('note-tab').filter({ hasText: '주간 회의' })).toHaveCount(1);
    await expect(page.locator('.ProseMirror')).toContainText('안건 정리');

    // F2 로 이름을 바꾸면 제목(H1)도 따라 바뀐다
    await page.keyboard.press('F2');
    const input = page.locator('.nops-prompt input');
    await expect(input).toHaveValue('주간 회의');
    await input.fill('월간 회의');
    await input.press('Enter');
    const monthly = path.join(vaultDir, '월간 회의.md');
    await expect.poll(() => existsSync(monthly) && readFileSync(monthly, 'utf8'), { timeout: 8000 }).toBe('# 월간 회의\n\n안건 정리\n');
    await expect(page.locator('.ProseMirror h1')).toHaveText('월간 회의', { timeout: 8000 });
  });

  test('데이터베이스: 보기 자동 저장·되돌리기, 행 우클릭 메뉴(복제·삭제·되돌리기)와 여러 행 선택', async () => {
    const page = await app.firstWindow();
    const dir = path.join(vaultDir, '행관리');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, '_db.yaml'), 'title: 행관리\nproperties:\n  점수: { type: number }\n  마감: { type: date }\nviews:\n  - { id: t, name: 표, type: table }\n');
    for (const [n, v] of [['일', 1], ['이', 2], ['삼', 3]] as const) writeFileSync(path.join(dir, `${n}.md`), `---\n점수: ${v}\n---\n# ${n}\n`);
    await page.getByRole('tab', { name: 'DB' }).click();
    const dbEntry = page.getByTestId('db-panel').getByRole('button', { name: /행관리/ });
    await expect(dbEntry).toBeVisible({ timeout: 10_000 });
    await dbEntry.click();
    const screen = page.getByTestId('db-screen');
    const table = screen.getByTestId('db-table');
    await expect(table.locator('.dbtable__row')).toHaveCount(3, { timeout: 8000 });

    // 보기 설정은 저장 버튼 없이 자동 저장되고, 되돌리기로 돌아간다
    await clickColumnMenu(page, table, '점수', '내림차순 정렬');
    await expect(screen.getByTestId('view-save-state')).toContainText('보기 저장됨', { timeout: 5000 });
    await expect.poll(() => readFileSync(path.join(dir, '_db.yaml'), 'utf8')).toContain('desc');
    await screen.getByTestId('view-save-state').getByRole('button', { name: '되돌리기' }).click();
    await expect.poll(() => readFileSync(path.join(dir, '_db.yaml'), 'utf8'), { timeout: 5000 }).not.toContain('desc');

    // 우클릭 → 복제
    await table.locator('.dbtable__row', { hasText: '일' }).first().click({ button: 'right', position: { x: 200, y: 10 } });
    await page.getByRole('menuitem', { name: '복제' }).click();
    await expect.poll(() => existsSync(path.join(dir, '일 (사본).md')), { timeout: 8000 }).toBe(true);
    expect(readFileSync(path.join(dir, '일 (사본).md'), 'utf8')).toBe('---\n점수: 1\n---\n# 일 (사본)\n');
    await expect(table.locator('.dbtable__row')).toHaveCount(4, { timeout: 8000 });

    // 여러 행 선택 → 삭제 → 되돌리기
    await table.getByLabel('이 선택').check();
    await table.getByLabel('삼 선택').check();
    const bar = page.getByTestId('db-selbar');
    await expect(bar).toContainText('2개 선택됨');
    await bar.getByRole('button', { name: '삭제' }).click();
    await expect.poll(() => existsSync(path.join(dir, '이.md')) || existsSync(path.join(dir, '삼.md')), { timeout: 8000 }).toBe(false);
    await expect(table.locator('.dbtable__row')).toHaveCount(2, { timeout: 8000 });
    await screen.getByRole('button', { name: '삭제 되돌리기' }).click();
    await expect.poll(() => existsSync(path.join(dir, '이.md')) && existsSync(path.join(dir, '삼.md')), { timeout: 8000 }).toBe(true);
    await expect(table.locator('.dbtable__row')).toHaveCount(4, { timeout: 8000 });
    // 날짜 셀: 달력에서 고른다(오늘)
    const today = await page.evaluate(() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });
    const dueCell = table.locator('.dbtable__row', { hasText: '삼' }).first().locator('.dbtable__td').nth(2);
    await dueCell.click();
    const picker = page.getByTestId('date-picker');
    await expect(picker).toBeVisible();
    await picker.getByRole('button', { name: '오늘' }).click();
    await expect.poll(() => readFileSync(path.join(dir, '삼.md'), 'utf8'), { timeout: 8000 }).toContain(`마감: ${today}`);
    await picker.getByRole('button', { name: '닫기' }).click();
    await expect(picker).toHaveCount(0);

    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: '파일', exact: true }).click();
  });

  test('설정(⌘,)·개요 패널·폴더 접힘 기억·그래프 노드 찾기', async () => {
    const page = await app.firstWindow();
    note('개요노트', '# 개요노트\n\n## 첫째\n\n본문\n\n### 둘째\n\n끝\n');
    note('접기/안쪽노트', '# 안쪽노트\n');
    await open(page, '개요노트');

    // 설정: 글자 크기·본문 너비·제목 동기화(이 기기에만 저장)
    await page.keyboard.press('ControlOrMeta+,');
    const settings = page.getByRole('dialog', { name: '설정' });
    await expect(settings).toBeVisible();
    await settings.getByLabel('본문 글자 크기').selectOption('18');
    await expect.poll(() => page.locator('.oh-editor .ProseMirror').first().evaluate((el) => getComputedStyle(el).fontSize)).toBe('18px');
    await settings.getByRole('radio', { name: '넓게' }).click();
    expect(await page.evaluate(() => document.documentElement.dataset.width)).toBe('wide');
    await settings.getByLabel('제목을 바꾸면 파일 이름도 맞추기').uncheck();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('nops.prefs') ?? '{}'))).toEqual({ fontSize: 18, width: 'wide', titleSync: false });
    // 원래대로
    await settings.getByLabel('본문 글자 크기').selectOption('16');
    await settings.getByRole('radio', { name: '보통' }).click();
    await settings.getByLabel('제목을 바꾸면 파일 이름도 맞추기').check();
    await page.keyboard.press('Escape');
    await expect(settings).toHaveCount(0);

    // 개요: 제목 목록, 누르면 그 제목으로 이동, 편집하면 바로 반영
    await openDock(page);
    await page.getByRole('tab', { name: '개요', exact: true }).click();
    const outline = page.getByTestId('outline');
    await expect(outline.getByRole('button')).toHaveText(['개요노트', '첫째', '둘째'], { timeout: 8000 });
    await outline.getByRole('button', { name: '둘째' }).click();
    await expect.poll(() => page.evaluate(() => window.getSelection()?.anchorNode?.parentElement?.closest('h3')?.textContent ?? null)).toBe('둘째');
    // 초점을 막 받은 직후(약 0.2초)에는 ProseMirror 가 DOM 선택 변화를 무시하므로 잠깐 기다린다
    await page.waitForTimeout(300);
    await page.locator('.ProseMirror p', { hasText: '끝' }).click();
    await page.waitForTimeout(200);
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('## 셋째');
    await expect(outline.getByRole('button')).toHaveText(['개요노트', '첫째', '둘째', '셋째'], { timeout: 8000 });
    await openDock(page);
    await page.getByRole('tab', { name: '링크', exact: true }).click();

    // 폴더를 접으면 안을 그리지 않고, 접은 상태를 기억한다
    const folder = page.locator('.tree summary', { hasText: '접기' });
    await expect(page.getByRole('button', { name: '안쪽노트', exact: true })).toBeVisible({ timeout: 8000 });
    await folder.click();
    await expect(page.getByRole('button', { name: '안쪽노트', exact: true })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('nops.tree.') && JSON.parse(localStorage.getItem(k) ?? '{}')['접기'] === false))).toBe(true);
    await folder.click();
    await expect(page.getByRole('button', { name: '안쪽노트', exact: true })).toBeVisible();

    // 그래프 노드 찾기
    await page.getByRole('button', { name: '그래프', exact: true }).click();
    await expect(page.getByTestId('graph-global-stats')).toContainText('개 노드', { timeout: 8000 });
    await page.getByLabel('노드 찾기').fill('개요노');
    await page.getByRole('listbox', { name: '찾은 노드' }).getByRole('option', { name: /개요노트/ }).click();
    await expect(page.getByLabel('노드 찾기')).toHaveValue('');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('graph-screen')).toHaveCount(0);
  });

  // 노트가 300개를 넘으면 폴더가 접힌 채 시작하므로 이 테스트는 맨 끝에 둔다
  test('아주 많은 노트가 든 폴더는 처음 300개만 그리고 "더 보기"로 늘린다', async () => {
    const page = await app.firstWindow();
    const dir = path.join(vaultDir, '대량');
    mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 350; i++) writeFileSync(path.join(dir, `대량노트${String(i).padStart(3, '0')}.md`), `# 대량노트${i}\n`);
    const summary = page.locator('.tree summary', { hasText: '대량' });
    await expect(summary).toBeVisible({ timeout: 15000 });
    await expect.poll(() => page.evaluate(() => window.nops.note.list().then((l) => l.filter((n) => n.path.startsWith('대량/')).length)), { timeout: 20000 }).toBe(350);
    // 큰 볼트(>300)는 폴더가 접힌 채 시작한다(사이드바가 노트 수를 따라잡으면 접힌다)
    await expect(page.locator('.tree details', { has: page.locator(':scope > summary', { hasText: '대량' }) })).not.toHaveAttribute('open', '', { timeout: 15000 });
    await expect(page.locator('.tree .row', { hasText: '대량노트000' })).toHaveCount(0);
    await summary.click();
    const rows = page.locator('.tree .row', { hasText: /^대량노트/ });
    await expect(rows).toHaveCount(300, { timeout: 8000 });
    await page.getByTestId('tree-more').click();
    await expect(rows).toHaveCount(350);
    await expect(page.getByTestId('tree-more')).toHaveCount(0);
    rmSync(dir, { recursive: true, force: true });
  });
});

test('계약에 없는 채널은 호출할 수 없다', async () => {
  const page = await app.firstWindow();
  const keys = await page.evaluate(() => Object.keys(window.nops).sort());
  expect(keys).toEqual(['app', 'asset', 'bookmarks', 'comment', 'daily', 'db', 'export', 'folder', 'graph', 'history', 'import', 'link', 'mcp', 'note', 'on', 'order', 'pathForFile', 'search', 'sync', 'tag', 'template', 'trash', 'vault', 'window', 'workspace']);
});

test('앱 URL이 app:// 오리진이다', async () => {
  const page = await app.firstWindow();
  expect(page.url()).toBe('app://nopsidian/index.html');
});
