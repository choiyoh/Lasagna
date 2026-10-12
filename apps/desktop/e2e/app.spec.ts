import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
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
      // 재빌드마다 달라지는 ad-hoc 서명이 실제 키체인 허용 대화상자를 띄우지 않도록 모의 키체인을 쓴다.
      args: ['--use-mock-keychain', `--user-data-dir=${path.join(base, `userdata-${attempt}`)}`],
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

  test('⋮⋮ 메뉴: 블록 변환(제목 2), 복제, 삭제가 파일에 반영된다', async () => {
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
    await page.keyboard.press('Meta+Shift+ArrowDown');
    await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 5000 }).toBe('# 핸들키\n\nB\n\nA\n');
    await page.keyboard.press('Meta+d');
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
    await page.keyboard.press('Meta+ArrowDown');
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
    await page.keyboard.press('Meta+e');
    await expect(page.locator('.cm-content')).toContainText('처음 추가', { timeout: 10000 });
    expect(await page.locator('.cm-content').innerText()).toContain('# 소스전환');
    await page.keyboard.press('Meta+e');
    await expect(page.locator('.ProseMirror')).toBeVisible();
    await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 5000 }).toBe('# 소스전환\n\n처음 추가\n');
  });

  test('에디터가 모르는 문법(각주)도 소스 모드에서 손실 없이 고칠 수 있다', async () => {
    const page = await app.firstWindow();
    const file = await openNote(page, '소스각주', '# 소스각주\n\n본문[^1]\n\n[^1]: 각주 내용\n');
    // 편집 모드에서는 원문 블록으로 보존된다
    await expect(page.locator('.nops-raw')).toContainText('[^1]: 각주 내용');
    await page.getByRole('button', { name: '소스 모드' }).click();
    const cm = page.locator('.cm-content');
    await expect(cm).toContainText('[^1]: 각주 내용', { timeout: 10000 });
    await cm.click();
    await page.keyboard.press('Meta+ArrowDown');
    await page.keyboard.type('\n[^2]: 둘째 각주\n');
    await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 5000 }).toBe('# 소스각주\n\n본문[^1]\n\n[^1]: 각주 내용\n\n[^2]: 둘째 각주\n');
    await page.getByRole('button', { name: '편집 모드' }).click();
    await expect(page.locator('.nops-raw').nth(1)).toContainText('[^2]: 둘째 각주');
    expect(readFileSync(file, 'utf8')).toBe('# 소스각주\n\n본문[^1]\n\n[^1]: 각주 내용\n\n[^2]: 둘째 각주\n');
  });

  test('소스 모드에서도 한글 조합 입력이 된다', async () => {
    const page = await app.firstWindow();
    const file = await openNote(page, '소스한글', '# 소스한글\n\n끝');
    await page.getByRole('button', { name: '소스 모드' }).click();
    const cm = page.locator('.cm-content');
    await expect(cm).toBeVisible({ timeout: 10000 });
    await cm.click();
    await page.keyboard.press('Meta+ArrowDown');
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

  test('백링크 패널: 이 노트를 가리키는 노트와 링크가 놓인 문맥이 보인다', async () => {
    const page = await app.firstWindow();
    note('독서/클린 코드', '---\naliases: [Clean Code]\ntags: [독서/개발]\n---\n# 클린 코드\n\n읽기 쉬운 코드\n');
    note('독서/리팩터링', '# 리팩터링\n\n함께 읽을 책은 [[클린 코드#1장|1장]]이다 #개발\n\n별칭으로도: [[Clean Code]]\n');
    await open(page, '클린 코드');
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

  test('언링크드 멘션: 링크 없이 제목이 나온 곳(한글 조사 포함)을 찾는다', async () => {
    const page = await app.firstWindow();
    note('멘션글', '# 멘션글\n\n요즘 클린 코드를 다시 읽는다. 코드 안의 `클린 코드`는 제외.\n');
    await open(page, '클린 코드');
    await page.getByRole('tab', { name: /언링크드/ }).click();
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
    await page.getByRole('tab', { name: '파일' }).click();
  });

  test('빠른 전환기(⌘O): 한글 초성으로 찾아 열고, 없으면 새 노트를 만든다', async () => {
    const page = await app.firstWindow();
    await page.keyboard.press('Meta+o');
    const input = page.getByPlaceholder(/노트 이름·별칭/);
    await expect(input).toBeVisible();
    await input.fill('ㅋㄹㅋㄷ');
    await expect(page.locator('.switcher__item.is-active')).toContainText('클린 코드');
    await page.keyboard.press('Enter');
    await expect(page.locator('.ProseMirror h1')).toHaveText('클린 코드');

    await page.keyboard.press('Meta+o');
    await page.getByPlaceholder(/노트 이름·별칭/).fill('cleancode');
    await expect(page.locator('.switcher__item.is-active')).toContainText('클린 코드'); // 별칭 Clean Code 퍼지
    await page.keyboard.press('Escape');

    await page.keyboard.press('Meta+o');
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
    await expect(page.getByRole('tab', { name: /백링크/ })).toContainText('3', { timeout: 8000 });

    await page.keyboard.press('F2');
    const input = page.locator('.nops-prompt input');
    await expect(input).toHaveValue('옛이름');
    await input.fill('폴더/새이름');
    await input.press('Enter');
    const dialog = page.getByRole('dialog', { name: '이름을 바꾸고 링크를 갱신할까요?' });
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

  test('언링크드 멘션 → 링크로 변환', async () => {
    const page = await app.firstWindow();
    note('변환대상', '# 변환대상 노트\n\n본문\n');
    const mention = note('변환멘션', '# 변환멘션\n\n오늘은 변환대상 노트를 정리했다. 변환대상 노트는 두 번 나온다.\n');
    await open(page, '변환대상 노트');
    await page.getByRole('tab', { name: /언링크드/ }).click();
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
    await page.getByRole('tab', { name: '로컬 그래프' }).click();
    await expect(page.getByTestId('graph-local-stats')).toContainText('2개 노드', { timeout: 8000 });
    await expect(page.getByTestId('graph-local').locator('canvas').first()).toBeAttached();

    // 전역 그래프: 열기 → 필터 입력이 .nopsidian/graph.json 에 저장 → Esc 로 닫기
    await page.getByRole('button', { name: '그래프', exact: true }).click();
    await expect(page.getByTestId('graph-screen')).toBeVisible();
    await expect(page.getByTestId('graph-global-stats')).toContainText('개 노드', { timeout: 8000 });
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
    await expect(page.getByTestId('sync-bar')).toContainText('동기화 꺼짐');
    await page.getByTestId('sync-bar').click();
    const dialog = page.getByRole('dialog', { name: 'Google Drive 동기화' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Google 계정 연결' })).toBeDisabled();
    await expect(dialog.getByRole('checkbox')).toBeDisabled();
    await dialog.getByLabel('클라이언트 ID').fill('1234567890-abcdefghijk.apps.googleusercontent.com');
    await dialog.getByRole('button', { name: '저장' }).click();
    await expect(dialog.getByRole('button', { name: 'Google 계정 연결' })).toBeEnabled({ timeout: 8000 });
    await expect(dialog).toContainText('클라이언트 ID가 저장돼 있어요');
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

    // 7) 필터를 걸고 보기를 저장하면 _db.yaml 의 뷰가 바뀐다
    await screen.getByLabel('보기 형태').selectOption('table');
    await screen.getByRole('button', { name: /^필터/ }).click();
    await page.getByRole('button', { name: '+ 조건 추가' }).click();
    const filter = page.getByRole('dialog', { name: '필터' });
    await filter.getByLabel('속성', { exact: true }).selectOption('점수');
    await filter.getByLabel('조건', { exact: true }).selectOption('>=');
    await filter.getByLabel('값', { exact: true }).fill('10');
    await expect(page.getByTestId('db-table')).toContainText('첫 할일');
    await expect(page.getByTestId('db-table')).not.toContainText('밖에서 만든');
    await screen.getByRole('button', { name: '보기 저장' }).click();
    await expect.poll(() => readFileSync(path.join(dbDir, '_db.yaml'), 'utf8'), { timeout: 5000 }).toContain('>=');

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

    // Esc 로 닫힌다(속성 창이 열려 있어도)
    await page.keyboard.press('Escape');
    await expect(screen).toHaveCount(0);
    await page.getByRole('tab', { name: '파일' }).click();
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
    await page.getByRole('tab', { name: '파일' }).click();
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
});

test('계약에 없는 채널은 호출할 수 없다', async () => {
  const page = await app.firstWindow();
  const keys = await page.evaluate(() => Object.keys(window.nops).sort());
  expect(keys).toEqual(['app', 'asset', 'daily', 'db', 'graph', 'link', 'note', 'on', 'search', 'sync', 'tag', 'template', 'vault']);
});

test('앱 URL이 app:// 오리진이다', async () => {
  const page = await app.firstWindow();
  expect(page.url()).toBe('app://nopsidian/index.html');
});
