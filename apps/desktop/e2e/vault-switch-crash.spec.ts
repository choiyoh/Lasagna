import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// 볼트를 연 직후(대기 없이) 다른 볼트로 전환해도 앱이 살아 있어야 한다.
// 인덱스 워커가 @parcel/watcher 구독(subscribe) 도중에 종료하면 메인까지 SIGABRT 로 죽는 회귀를 고정한다.
function packagedExecutable(): string {
  const override = process.env.NOPS_E2E_EXECUTABLE;
  if (override) return override;
  const dir = path.join(__dirname, `../out/Lasagna-${process.platform}-${process.arch}`);
  if (process.platform === 'darwin') return path.join(dir, 'Lasagna.app/Contents/MacOS/Lasagna');
  return path.join(dir, process.platform === 'win32' ? 'lasagna.exe' : 'lasagna');
}

let app: ElectronApplication;
let base = '';
let vaultA = '';
let vaultB = '';

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
  return launched;
}

function makeVault(dir: string, name: string, notes: number): void {
  mkdirSync(path.join(dir, '작품', '회차'), { recursive: true });
  mkdirSync(path.join(dir, '작품', '캐릭터'), { recursive: true });
  for (let i = 0; i < notes; i += 1) {
    writeFileSync(path.join(dir, '작품', '회차', `${i}-${name}.md`), `# ${name} ${i}\n\n본문 ${i}\n`);
  }
  writeFileSync(path.join(dir, '메모.md'), `# ${name} 메모\n\n${name} 검색어\n`);
}

/** 대기 없이(인덱스 ready 를 기다리지 않고) 다른 볼트로 전환한다. */
async function switchTo(page: Page, id: string): Promise<void> {
  await page.evaluate(async (vaultId) => {
    await window.nops.vault.open({ id: vaultId });
  }, id);
}

test.beforeAll(async () => {
  test.setTimeout(240_000);
  base = mkdtempSync(path.join(tmpdir(), 'nops-switch-'));
  vaultA = path.join(base, 'VaultA');
  vaultB = path.join(base, 'VaultB');
  // 구독(subscribe) 창을 넓히려고 볼트를 크게 만든다(작은 볼트에서는 재현이 어렵다).
  makeVault(vaultA, '에이', 1200);
  makeVault(vaultB, '비', 1200);
  mkdirSync(path.join(base, 'userdata'), { recursive: true });
  app = await launch();
});

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  if (base) rmSync(base, { recursive: true, force: true });
});

test('볼트를 연 직후 대기 없이 전환해도 앱이 살아 있고 마지막 볼트가 정상이다', async () => {
  const page = await app.firstWindow();
  // 볼트 A 를 열자마자(ready·감시 준비를 기다리지 않고) 전환한다.
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dir] })) as typeof dialog.showOpenDialog;
  }, vaultA);
  const a = await page.evaluate(async () => (await window.nops.vault.pick())!);

  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dir] })) as typeof dialog.showOpenDialog;
  }, vaultB);
  const b = await page.evaluate(async () => (await window.nops.vault.pick())!);
  expect(b.id).not.toBe(a.id);

  // 이중 전환(두 전환을 동시에 요청) 을 20회 반복 — 각 회차마다 앱이 살아 있어야 한다.
  for (let i = 0; i < 20; i += 1) {
    const alive = await page.evaluate(
      async ([first, second]) => {
        await Promise.all([window.nops.vault.open({ id: first }), window.nops.vault.open({ id: second })]);
        return (await window.nops.vault.current())?.id ?? null;
      },
      [i % 2 === 0 ? a.id : b.id, i % 2 === 0 ? b.id : a.id],
    );
    expect(alive).not.toBeNull();
    // 창·렌더러가 살아 있는지(크래시면 evaluate 자체가 던진다).
    expect(await page.evaluate(() => document.title.length >= 0)).toBe(true);
  }

  // 마지막 볼트가 정상으로 열리고 검색이 동작한다.
  await switchTo(page, a.id);
  await expect.poll(async () => page.evaluate(async () => (await window.nops.vault.current())?.id)).toBe(a.id);
  const listed = await page.evaluate(async () => (await window.nops.note.list()).length);
  expect(listed).toBeGreaterThan(0);
  const hits = await page.evaluate(async () => (await window.nops.search.query({ q: '에이 메모', limit: 5 })).length);
  expect(hits).toBeGreaterThan(0);
  expect(await page.evaluate(async () => (await window.nops.vault.current())?.name)).toBe('VaultA');
});
