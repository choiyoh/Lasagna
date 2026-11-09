import squirrelStartup from 'electron-squirrel-startup';
import { app, BrowserWindow, dialog, safeStorage, session, shell } from 'electron';
import { createHash } from 'node:crypto';
import { applyRename, planRename, undoRename } from './rename';
import { linkMention } from '../workers/index/mention-link';
import path from 'node:path';
import {
  atomicWrite,
  ensureBlockIdAt,
  isGenericName,
  listHistory,
  readHistory,
  linkNameFor,
  splitFrontmatter,
  pastedName,
  mimeFromName,
  resolveInVault,
  sanitizeAttachmentName,
  saveNote,
  sha256,
  uniqueName,
  expandTemplate,
  addComment,
  listComments,
  relocateComments,
  removeComment,
  setCommentResolved,
  SELF_AUTHOR,
  isWorkTemplatePath,
} from '@nopsidian/core';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { readAudit } from '@nopsidian/mcp/audit';
import { RevertError, applyRestore, logRevert, planRevert } from '@nopsidian/mcp/revert';
import { readPolicyFile, writePolicyFile } from '@nopsidian/mcp/policy-file';
import { events, graphLayout, graphSettings, workspaceLayout, type AppLanguage, type EventName } from '@nopsidian/ipc-contract';
import { resolveLocale, setLocale, t } from '@nopsidian/i18n';
import { AppSettingsStore, readAppSettings } from './app-settings';
import { WriterStatsStore } from './writer-stats-store';
import { deleteSnapshot, listSnapshots, moveNoteHistory, readSnapshot, renameSnapshot, saveSnapshot } from '@nopsidian/core';
import { detectWorkRoots, summarizeWorks } from '@nopsidian/core';
import { countMarkdown } from '@nopsidian/core';
import { configureIpc, handle, registerWebContents } from './ipc';
import { isMcpStdioInvocation, mcpLaunchArgs, mcpScriptPath, mcpStdioArgs } from './mcp-cli';
import { e2eBackground } from './e2e-mode';
import { presentBackgroundWindow } from './e2e-window';
import { runMcpStdio } from './mcp-stdio';
import { installProtocols, registerSchemes } from './protocols';
import {
  APP_ORIGIN,
  SECURE_WEB_PREFERENCES,
  buildCsp,
  hardenWebContents,
  installSessionPolicy,
  openExternalSafe,
} from './security';
import {
  getCurrent,
  getVaultRoot,
  listRecent,
  openRecent,
  pickAndOpen,
  readVaultConfig,
  requireVault,
  setBroadcaster,
  vaultHooks,
  type OpenVault,
} from './vault';
import { readFile } from 'node:fs/promises';
import { CredentialStore, SyncController } from './sync';
import { createFolder, listFolders, listTrash, moveToTrash, purgeTrash, restoreFromTrash, duplicateNote } from './trash';
import { importMarkdownInto } from './markdown-import';
import { importNotionInto, readZipEntries } from './notion-import';
import { exportVaultSite, renderNoteDocument, type ExportContext } from './export';
import { addRow, createDatabase, editSchema, exportCsv, importCsvApply, importCsvPreview, updateCell } from './db';

// Forge Vite 플러그인이 주입하는 전역
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

const devServerUrl =
  typeof MAIN_WINDOW_VITE_DEV_SERVER_URL === 'string' ? MAIN_WINDOW_VITE_DEV_SERVER_URL : undefined;

/** 기본 앱으로 열어도 안전한 문서·미디어 형식 */
const OPENABLE = /\.(pdf|txt|csv|png|jpe?g|gif|webp|svg|avif|bmp|mp3|m4a|wav|ogg|flac|mp4|webm|mov|m4v|docx?|xlsx?|pptx?|hwp|hwpx|rtf)$/i;

// 앱 이름을 Nopsidian → Lasagna 로 바꾸면서 userData 기본 경로(<appData>/<앱 이름>)도 달라진다.
// 기존 사용자의 최근 볼트·동기화 인증이 사라지지 않게, 예전 폴더가 있고 새 폴더가 없으면 예전 폴더를 계속 쓴다.
{
  const legacyUserData = path.join(app.getPath('appData'), 'Nopsidian');
  if (existsSync(legacyUserData) && !existsSync(app.getPath('userData'))) app.setPath('userData', legacyUserData);
}

// Windows 설치·업데이트·제거 중에 Squirrel 이 앱을 잠깐 띄운다. 바로가기를 만들고 종료한다.
if (process.platform === 'win32' && squirrelStartup) app.quit();

// `<앱 실행 파일> --mcp-stdio …` 이면 앱이 아니라 번들된 MCP 서버(stdio)로만 동작한다.
// RunAsNode 퓨즈를 켜지 않고(보안) Node.js 가 없는 PC 에서도 에이전트가 붙게 하는 통로다.
// 창·트레이·프로토콜·IPC를 만들지 않고, 싱글 인스턴스 잠금도 잡지 않는다.
const mcpStdio = isMcpStdioInvocation(process.argv);
if (mcpStdio) {
  app.dock?.hide(); // macOS: 독 아이콘이 떴다 사라지지 않게
  // 창을 만들지 않으므로 GPU 가 필요 없다. 디스플레이가 없는 리눅스에서 GPU 초기화 오류를 피한다.
  // (화면 플랫폼은 이 코드보다 먼저 정해져서 여기서 바꿀 수 없다 → 리눅스 스니펫은 `--ozone-platform=headless` 를 앞에 붙인다. mcpLaunchArgs 참고)
  app.disableHardwareAcceleration();
  void runMcpStdio(mcpStdioArgs(process.argv), { packaged: app.isPackaged, resourcesPath: process.resourcesPath, appPath: app.getAppPath() }).then((code) => app.exit(code));
}

/** 테스트 빌드에서만 켜지는 '창을 띄우지 않는' 모드(배포 앱은 항상 false). */
const BACKGROUND_E2E = e2eBackground();

if (!mcpStdio) {
  registerSchemes();

  // macOS: 테스트 중에는 독 아이콘·전면 앱 전환도 하지 않는다(사용자 화면을 건드리지 않게).
  if (BACKGROUND_E2E) {
    app.dock?.hide();
    app.setActivationPolicy?.('accessory');
    // 투명·비활성 창은 Chromium 이 백그라운드로 보고 렌더·타이머를 늦춘다 → e2e 에서만 끈다.
    app.commandLine.appendSwitch('disable-renderer-backgrounding');
    app.commandLine.appendSwitch('disable-background-timer-throttling');
    app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  }

  if (!app.requestSingleInstanceLock()) app.quit();
}

function createWindow(openPath?: string) {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 640,
    minHeight: 400,
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      ...SECURE_WEB_PREFERENCES,
      preload: path.join(__dirname, 'preload.cjs'),
      // e2e 백그라운드(투명·비활성) 창도 렌더·타이머가 느려지지 않게 한다(배포 앱은 기본값).
      ...(BACKGROUND_E2E ? { backgroundThrottling: false } : {}),
    },
  });
  registerWebContents(win.webContents);
  hardenWebContents(win.webContents, devServerUrl);
  win.once('ready-to-show', () => {
    if (!BACKGROUND_E2E) {
      win.show();
      return;
    }
    // e2e: 투명 + 클릭 통과 + 포커스 불가 + 비활성 표시(사용자 화면·클릭을 방해하지 않는다).
    presentBackgroundWindow(win);
  });
  const query = openPath ? `?open=${encodeURIComponent(openPath)}` : '';
  void win.loadURL(`${devServerUrl ?? `${APP_ORIGIN}/index.html`}${query}`);
  if (!app.isPackaged && process.env.NOPS_DEVTOOLS === '1') win.webContents.openDevTools({ mode: 'detach' });
  return win;
}

function broadcast(name: EventName, payload: unknown, selfOrigin?: number) {
  const parsed = events[name].parse(payload);
  for (const w of BrowserWindow.getAllWindows()) {
    // 자기 쓰기는 쓴 창에만 "다시 불러올 필요 없음", 다른 창에는 외부 변경으로 알린다
    const out = selfOrigin !== undefined && name === 'note.changed' ? { ...(parsed as object), external: w.webContents.id !== selfOrigin } : parsed;
    w.webContents.send(name, out);
  }
}

/** 이름 변경 계획을 세우려고 볼트의 모든 노트 내용과 첨부 목록을 읽는다. */
async function snapshotVault(v: ReturnType<typeof requireVault>) {
  const list = await v.index.list();
  // 인덱스가 아직 따라오지 못한 경우(방금 이름을 바꾼 파일 등) 디스크에 없는 노트는 건너뛴다
  const notes = list.flatMap((n) => {
    try {
      return [{ path: n.path, content: readFileSync(resolveInVault(v.info.path, n.path), 'utf8') }];
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw e;
    }
  });
  const assets = (await v.index.assets()).map((a) => a.path);
  return { notes, assets };
}

const localDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** 데일리 노트 내용: 템플릿 노트가 있으면 변수를 채워 쓰고(프런트매터 포함 그대로), 없으면 제목만. */
function dailyTemplate(root: string, templatePath: string | null, day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const now = new Date();
  now.setFullYear(y, m - 1, d); // 날짜는 요청한 날, 시각은 지금
  if (templatePath) {
    try {
      return expandTemplate(readFileSync(resolveInVault(root, templatePath), 'utf8'), { now, title: day });
    } catch {
      // 템플릿을 못 읽으면 기본 내용으로
    }
  }
  return `# ${day}\n\n`;
}

const syncController = new SyncController({
  credentials: new CredentialStore(path.join(app.getPath('userData'), 'sync-auth.json'), {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (data) => safeStorage.decryptString(data),
  }),
  workerFile: path.join(__dirname, 'sync-worker.cjs'),
  openExternal: (url) => {
    if (!openExternalSafe(url)) throw new Error(t('main.err.badUrl'));
  },
  broadcast: (status) => broadcast('sync.changed', status),
});
vaultHooks.opened = (info) => syncController.attachVault(info.path, info.name);
vaultHooks.closing = () => syncController.detachVault();
vaultHooks.changed = () => syncController.notifyLocalChange();

async function exportContext(v: OpenVault): Promise<ExportContext> {
  const [notes, assets] = await Promise.all([v.index.list(), v.index.assets()]);
  return {
    root: v.info.path,
    notes: notes.map((n) => ({ path: n.path, title: n.title, aliases: n.aliases })),
    assets: assets.map((a) => a.path),
  };
}

/** 정적 HTML 을 보이지 않는 창(스크립트·네트워크 없음)에 띄워 PDF 로 만든다. */
async function htmlToPdf(doc: string): Promise<Uint8Array> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false, webSecurity: true },
  });
  try {
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    await win.loadURL(`data:text/html;charset=utf-8;base64,${Buffer.from(doc, 'utf8').toString('base64')}`);
    return await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
  } finally {
    win.destroy();
  }
}

function registerHandlers() {
  handle('vault.listRecent', () => listRecent());
  handle('vault.current', () => getCurrent()?.info ?? null);
  handle('vault.pick', (_i, e) => pickAndOpen(BrowserWindow.fromWebContents(e.sender)));
  handle('vault.open', ({ id }) => openRecent(id));

  handle('note.list', async () => {
    const v = requireVault();
    await v.index.ready;
    return v.index.list();
  });
  handle('note.read', async ({ path: rel }) => {
    const v = requireVault();
    const content = await readFile(resolveInVault(v.info.path, rel), 'utf8');
    const hash = sha256(content);
    v.bases.set(rel, { hash, content });
    return { content, hash };
  });
  handle('note.save', ({ path: rel, content, baseHash }, e) => {
    const v = requireVault();
    const base = v.bases.get(rel);
    const result = saveNote({
      root: v.info.path,
      rel,
      content,
      baseHash,
      ...(base && base.hash === baseHash ? { baseContent: base.content } : {}),
    });
    // 디스크에 실제로 있는 내용이 새 공통 조상이 된다(copy면 디스크는 그대로)
    v.bases.set(rel, { hash: result.hash, content: result.content });
    v.selfWrites.set(rel, result.hash);
    v.selfOrigins.set(rel, e.sender.id);
    return result;
  });
  handle('note.trash', ({ path: rel }) => {
    const v = requireVault();
    v.bases.delete(rel);
    return moveToTrash(v.info.path, rel);
  });
  handle('note.duplicate', ({ path: rel }) => ({ path: duplicateNote(requireVault().info.path, rel) }));
  handle('folder.list', () => listFolders(requireVault().info.path));
  handle('note.workList', async () => {
    const v = requireVault();
    const folders = listFolders(v.info.path);
    const roots = detectWorkRoots(folders);
    if (roots.length === 0) return [];
    // 색인 준비를 기다리지 않고 파일 시스템에서 직접 센다(앱을 막 열었을 때도 카드가 바로 보인다).
    const stats = new Map<string, { chars: number; charsNoSpace: number }>();
    const all: string[] = [];
    for (const root of roots) {
      for (const folder of root.episodeFolders) {
        for (const rel of walkMarkdown(v.info.path, folder)) {
          all.push(rel);
          try {
            const full = resolveInVault(v.info.path, rel);
            const st = statSync(full);
            const cached = workCharCache.get(rel);
            if (cached && cached.mtime === st.mtimeMs && cached.size === st.size) {
              stats.set(rel, { chars: cached.chars, charsNoSpace: cached.charsNoSpace });
              continue;
            }
            const counted = countMarkdown(readFileSync(full, 'utf8'));
            workCharCache.set(rel, { mtime: st.mtimeMs, size: st.size, chars: counted.chars, charsNoSpace: counted.charsNoSpace });
            stats.set(rel, counted);
          } catch {
            // 읽기 실패(삭제 경합 등)는 이번 계산에서만 건너뛴다.
          }
        }
      }
      // 캐릭터·설정집 수도 색인 없이 파일 시스템에서 센다.
      for (const folder of [...root.characterFolders, ...root.storyBibleFolders]) all.push(...walkMarkdown(v.info.path, folder));
    }
    return summarizeWorks(roots, all, stats);
  });
  handle('folder.create', ({ path: rel }) => ({ path: createFolder(requireVault().info.path, rel) }));
  handle('trash.list', () => listTrash(requireVault().info.path));
  handle('trash.purge', ({ trashId }) => ({ removed: purgeTrash(requireVault().info.path, trashId) }));
  handle('note.restore', ({ trashId }) => ({ path: restoreFromTrash(requireVault().info.path, trashId) }));
  handle('note.renamePlan', async ({ from, to }) => {
    const v = requireVault();
    await v.index.ready;
    const { plan, moves } = planRename(v.info.path, await snapshotVault(v), from, to);
    return { moves, edits: plan.edits.map((e) => ({ path: e.path, newPath: e.newPath, changes: e.changes })), totalChanges: plan.totalChanges };
  });
  handle('note.rename', async ({ from, to }) => {
    const v = requireVault();
    await v.index.ready;
    const { plan, moves } = planRename(v.info.path, await snapshotVault(v), from, to);
    const { undoId } = applyRename(v.info.path, moves, plan);
    // 이름·폴더가 바뀐 노트의 자동 이력·스냅샷도 새 경로 키로 따라간다(실패해도 이름 바꾸기는 성공).
    for (const m of moves) moveNoteHistory(v.info.path, m.from, m.to);
    for (const m of moves) relocateComments(v.info.path, m.from, m.to);
    // 앱이 기억하던 노트 내용(3-way 병합의 기준)은 이동·갱신 뒤에는 무효다
    v.bases.clear();
    v.selfWrites.clear();
    return { moves, edits: plan.edits.map((e) => ({ path: e.path, newPath: e.newPath, changes: e.changes })), totalChanges: plan.totalChanges, undoId };
  });
  handle('note.undoRename', ({ undoId }) => {
    const v = requireVault();
    const r = undoRename(v.info.path, undoId);
    // 이름 바꾸기를 되돌리면 이력·스냅샷도 원래 경로 키로 돌아간다(실패해도 undo 자체는 성공).
    for (const m of r.moves) moveNoteHistory(v.info.path, m.to, m.from);
    v.bases.clear();
    v.selfWrites.clear();
    return r;
  });
  handle('link.backlinks', async ({ path: rel }) => {
    const v = requireVault();
    await v.index.ready;
    return v.index.query('backlinkContexts', rel);
  });
  handle('link.outgoing', async ({ path: rel }) => {
    const v = requireVault();
    await v.index.ready;
    return v.index.query('outgoingLinks', rel);
  });
  handle('link.unlinked', async ({ path: rel }) => {
    const v = requireVault();
    await v.index.ready;
    return v.index.query('unlinkedMentions', rel);
  });
  handle('link.headings', async ({ path: rel }) => {
    const v = requireVault();
    await v.index.ready;
    return v.index.query('headingsOf', rel);
  });
  handle('link.blocks', async ({ path: rel }) => {
    const v = requireVault();
    await v.index.ready;
    return v.index.query('blocksOf', rel);
  });
  handle('link.ensureBlockId', ({ path: rel, line }) => {
    const v = requireVault();
    const content = readFileSync(resolveInVault(v.info.path, rel), 'utf8');
    const r = ensureBlockIdAt(content, line);
    if (!r) throw new Error(t('main.err.blockNotFound'));
    if (r.changed) {
      // 대상 노트가 편집기에 열려 있어도 외부 편집과 같은 경로(3-way 병합)로 합쳐진다
      saveNote({ root: v.info.path, rel, content: r.content, baseHash: sha256(content), baseContent: content });
    }
    return { id: r.id, changed: r.changed };
  });
  handle('link.convertMention', async ({ path: rel, line, targetPath }) => {
    const v = requireVault();
    await v.index.ready;
    const notes = await v.index.list();
    const target = notes.find((n) => n.path === targetPath);
    if (!target) throw new Error(t('main.err.targetNoteNotFound'));
    // 목록(`unlinkedMentions`)과 같은 기준: 2글자 이하 말은 쓰지 않는다
    const terms = [target.title, ...target.aliases].filter((t) => [...t].length > 2);
    const content = readFileSync(resolveInVault(v.info.path, rel), 'utf8');
    const r = linkMention(content, { line, terms, target: linkNameFor(targetPath, notes.map((n) => n.path)) });
    if (r.changed) saveNote({ root: v.info.path, rel, content: r.content, baseHash: sha256(content), baseContent: content });
    return { changed: r.changed, ...(r.replaced ? { replaced: r.replaced } : {}) };
  });
  handle('template.list', async () => {
    const v = requireVault();
    await v.index.ready;
    const folder = readVaultConfig(v.info.path).templatesFolder;
    // 볼트 공용 템플릿 + 작품별 `<작품>/템플릿/…` 노트를 함께 보여 준다(W2).
    return (await v.index.list())
      .filter((n) => n.path.startsWith(`${folder}/`) || isWorkTemplatePath(n.path))
      .map((n) => ({ path: n.path, title: n.title }));
  });
  handle('template.read', ({ path: rel, title }) => {
    const v = requireVault();
    const raw = readFileSync(resolveInVault(v.info.path, rel), 'utf8');
    const fm = splitFrontmatter(raw);
    // 이미 있는 노트에 끼워 넣는 용도이므로 템플릿의 프런트매터는 뺀다
    const body = fm ? raw.slice(fm.end) : raw;
    return { content: expandTemplate(body, { now: new Date(), title }).replace(/^\s*\n/, '') };
  });
  handle('graph.global', async (opts) => {
    const v = requireVault();
    await v.index.ready;
    return v.index.query('globalGraph', opts);
  });
  handle('graph.local', async ({ path: rel, depth, direction, ...opts }) => {
    const v = requireVault();
    await v.index.ready;
    return v.index.query('localGraph', rel, { ...opts, depth, direction });
  });
  handle('export.note', async ({ path: rel, format }, e) => {
    const v = requireVault();
    await v.index.ready;
    const ctx = await exportContext(v);
    const title = ctx.notes.find((n) => n.path === rel)?.title ?? rel;
    const parent = BrowserWindow.fromWebContents(e.sender);
    const opts = {
      title: format === 'pdf' ? t('main.dialog.exportPdf') : t('main.dialog.exportHtml'),
      defaultPath: `${title.replace(/[\\/:*?"<>|]/g, '_')}.${format}`,
      filters: [format === 'pdf' ? { name: 'PDF', extensions: ['pdf'] } : { name: 'HTML', extensions: ['html'] }],
    };
    const r = parent ? await dialog.showSaveDialog(parent, opts) : await dialog.showSaveDialog(opts);
    if (r.canceled || !r.filePath) return { saved: null };
    const content = readFileSync(resolveInVault(v.info.path, rel), 'utf8');
    const doc = renderNoteDocument(ctx, rel, content, { inlineAssets: true, siteLinks: false });
    if (format === 'html') atomicWrite(r.filePath, doc);
    else atomicWrite(r.filePath, await htmlToPdf(doc));
    return { saved: r.filePath };
  });
  handle('import.notion', async (_i, e) => {
    const v = requireVault();
    const parent = BrowserWindow.fromWebContents(e.sender);
    const opts = { title: t('main.dialog.notionZip'), properties: ['openFile' as const], filters: [{ name: 'ZIP', extensions: ['zip'] }] };
    const r = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts);
    const file = r.filePaths[0];
    if (r.canceled || !file) return { folder: null, notes: 0, databases: 0, rows: 0, assets: 0, unresolvedLinks: 0, issues: [] };
    const res = importNotionInto(v.info.path, readZipEntries(readFileSync(file)));
    return {
      folder: res.folder,
      notes: res.stats.notes,
      databases: res.stats.databases,
      rows: res.stats.rows,
      assets: res.stats.assets,
      unresolvedLinks: res.stats.unresolvedLinks,
      issues: res.issues.slice(0, 30),
    };
  });
  handle('import.markdown', async (input, e) => {
    const v = requireVault();
    let paths = input.paths ?? [];
    if (input.mode !== 'paths') {
      const parent = BrowserWindow.fromWebContents(e.sender);
      const opts =
        input.mode === 'files'
          ? { title: t('main.dialog.importFiles'), properties: ['openFile' as const, 'multiSelections' as const], filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }] }
          : { title: t('main.dialog.importFolder'), properties: ['openDirectory' as const, 'multiSelections' as const] };
      const r = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts);
      if (r.canceled) return { notes: 0, assets: 0, renamed: 0, imported: [], skipped: [] };
      paths = r.filePaths;
    }
    return importMarkdownInto(v.info.path, paths, input.into);
  });
  handle('export.vault', async (_i, e) => {
    const v = requireVault();
    await v.index.ready;
    const parent = BrowserWindow.fromWebContents(e.sender);
    const opts = { title: t('main.dialog.exportFolder'), properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[] };
    const r = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts);
    const dir = r.filePaths[0];
    if (r.canceled || !dir) return { dir: null, notes: 0, assets: 0 };
    const out = path.join(dir, `${v.info.name} (HTML)`);
    return { dir: out, ...exportVaultSite(await exportContext(v), out) };
  });
  handle('workspace.get', () => {
    const v = requireVault();
    try {
      const parsed = workspaceLayout.safeParse(JSON.parse(readFileSync(path.join(v.info.path, '.nopsidian', 'workspace.json'), 'utf8')));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  });
  handle('workspace.set', (layout) => {
    const v = requireVault();
    atomicWrite(path.join(v.info.path, '.nopsidian', 'workspace.json'), JSON.stringify(layout));
    return undefined;
  });
  handle('window.new', ({ path: rel }) => {
    requireVault();
    createWindow(rel);
    return undefined;
  });
  handle('history.list', ({ path: rel }) => listHistory(requireVault().info.path, rel));
  handle('history.read', ({ path: rel, id }) => ({ content: readHistory(requireVault().info.path, rel, id) }));
  handle('history.snapshotList', ({ path: rel }) => listSnapshots(requireVault().info.path, rel));
  handle('history.snapshotSave', ({ path: rel, name, content }) => saveSnapshot(requireVault().info.path, rel, name, content));
  handle('history.snapshotRead', ({ path: rel, id }) => {
    const s = readSnapshot(requireVault().info.path, rel, id);
    return { name: s.name, time: s.time, content: s.content };
  });
  handle('history.snapshotRename', ({ path: rel, id, name }) => renameSnapshot(requireVault().info.path, rel, id, name));
  handle('history.snapshotDelete', ({ path: rel, id }) => {
    deleteSnapshot(requireVault().info.path, rel, id);
    return { ok: true };
  });
  handle('bookmarks.get', () => {
    const v = requireVault();
    try {
      const raw: unknown = JSON.parse(readFileSync(path.join(v.info.path, '.nopsidian', 'bookmarks.json'), 'utf8'));
      return Array.isArray(raw) ? raw.filter((p): p is string => typeof p === 'string') : [];
    } catch {
      return [];
    }
  });
  handle('bookmarks.set', (paths) => {
    const v = requireVault();
    atomicWrite(path.join(v.info.path, '.nopsidian', 'bookmarks.json'), JSON.stringify(paths, null, 2));
    return undefined;
  });
  handle('comment.list', ({ path: rel }) => listComments(requireVault().info.path, rel));
  handle('comment.add', ({ path: rel, text, quote }) => addComment(requireVault().info.path, rel, { author: SELF_AUTHOR, text, quote }));
  handle('comment.resolve', ({ path: rel, id, resolved }) => ({ ok: setCommentResolved(requireVault().info.path, rel, id, resolved) }));
  handle('comment.remove', ({ path: rel, id }) => ({ ok: removeComment(requireVault().info.path, rel, id) }));
  handle('mcp.info', () => {
    const v = requireVault();
    // 패키징된 앱은 resources/ 에, 개발 중에는 저장소의 빌드 결과를 쓴다
    const script = mcpScriptPath({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, appPath: app.getAppPath() });
    // 패키징된 앱은 이 실행 파일 자체가 `--mcp-stdio` 로 MCP 서버가 된다(Node.js 불필요)
    return {
      script: existsSync(script) ? script : null,
      vault: v.info.path,
      vaultName: v.info.name,
      vaultId: v.info.id,
      dailyFolder: readVaultConfig(v.info.path).dailyFolder,
      executable: process.execPath,
      packaged: app.isPackaged,
      launchArgs: mcpLaunchArgs(process.platform),
    };
  });
  handle('mcp.policyGet', () => {
    const v = requireVault();
    const read = readPolicyFile(v.info.path);
    if (read.kind === 'ok') return { exists: true, policy: read.policy, error: null };
    if (read.kind === 'missing') return { exists: false, policy: null, error: null };
    return { exists: true, policy: null, error: read.error, errorCode: read.code, ...(read.params ? { errorParams: read.params } : {}) };
  });
  handle('mcp.policySet', ({ write, writeFolders, maxWritesPerMinute }) => {
    const v = requireVault();
    return writePolicyFile(v.info.path, { version: 1, write, writeFolders, maxWritesPerMinute });
  });
  handle('mcp.revert', ({ t, path: rel }) => {
    const v = requireVault();
    try {
      const { entry, plan } = planRevert(v.info.path, t, rel);
      v.bases.delete(rel);
      if (plan.action === 'trash') {
        const r = moveToTrash(v.info.path, rel);
        logRevert(v.info.path, entry, undefined);
        return { kind: 'trashed' as const, trashId: r.trashId };
      }
      applyRestore(v.info.path, entry, plan.content);
      return { kind: 'restored' as const };
    } catch (e) {
      // 되돌릴 수 없는 이유는 코드로 넘겨 화면이 지금 언어로 안내하게 한다(그 밖의 오류는 그대로).
      if (e instanceof RevertError) return { kind: 'failed' as const, code: e.code, message: e.message };
      throw e;
    }
  });
  handle('mcp.audit', ({ limit }) => readAudit(requireVault().info.path, limit));
  handle('order.get', () => {
    const v = requireVault();
    try {
      const raw: unknown = JSON.parse(readFileSync(path.join(v.info.path, '.nopsidian', 'order.json'), 'utf8'));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
      const out: Record<string, string[]> = {};
      for (const [k, list] of Object.entries(raw)) if (Array.isArray(list)) out[k] = list.filter((n): n is string => typeof n === 'string');
      return out;
    } catch {
      return {};
    }
  });
  handle('order.set', (order) => {
    const v = requireVault();
    atomicWrite(path.join(v.info.path, '.nopsidian', 'order.json'), JSON.stringify(order, null, 2));
    return undefined;
  });
  handle('graph.getSettings', async () => {
    const v = requireVault();
    try {
      const parsed = graphSettings.safeParse(JSON.parse(readFileSync(path.join(v.info.path, '.nopsidian', 'graph.json'), 'utf8')));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  });
  handle('graph.setSettings', async (settings) => {
    const v = requireVault();
    atomicWrite(path.join(v.info.path, '.nopsidian', 'graph.json'), JSON.stringify(settings, null, 2));
    return undefined;
  });
  handle('graph.getLayout', async () => {
    const v = requireVault();
    try {
      const parsed = graphLayout.safeParse(JSON.parse(readFileSync(path.join(v.info.path, '.nopsidian', 'graph-layout.json'), 'utf8')));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  });
  handle('graph.setLayout', async (layout) => {
    const v = requireVault();
    atomicWrite(path.join(v.info.path, '.nopsidian', 'graph-layout.json'), JSON.stringify(layout));
    return undefined;
  });
  handle('sync.status', () => syncController.status());
  handle('sync.setClient', ({ clientId, clientSecret }) => {
    syncController.setClient(clientId.trim(), clientSecret?.trim());
    return syncController.status();
  });
  handle('sync.connect', () => syncController.connect());
  handle('sync.disconnect', async () => {
    await syncController.disconnect();
    return syncController.status();
  });
  handle('sync.useBuiltin', () => syncController.useBuiltinClient());
  handle('sync.enable', ({ enabled }) => syncController.setEnabled(enabled));
  handle('sync.plan', () => syncController.plan());
  handle('sync.run', ({ force }) => syncController.run(force ?? false));
  handle('sync.diagnostics', () => syncController.diagnostics());
  handle('sync.check', () => syncController.check());
  handle('db.list', async () => {
    const v = requireVault();
    await v.index.ready;
    // 제목 없는(root) 데이터베이스의 기본 이름도 앱 언어를 따르게 locale 을 함께 넘긴다.
    return v.index.query('databases', currentLanguage().locale) as never;
  });
  handle('db.row', async ({ path: rel }) => {
    const v = requireVault();
    await v.index.ready;
    // 행 노트 패널(속성·수식 오류)의 문구도 앱 언어를 따르게 locale 을 함께 넘긴다.
    return v.index.query('rowDatabase', rel, currentLanguage().locale) as never;
  });
  handle('db.query', async (input) => {
    const v = requireVault();
    await v.index.ready;
    // index worker 는 별도 스레드라, 그 스레드가 만드는 문구(스키마 문제·기본 제목)도 앱 언어를 따르게 넘긴다.
    return v.index.query('queryDatabase', { ...input, locale: currentLanguage().locale }) as never;
  });
  handle('db.updateCell', async ({ path: rel, prop, value }) => {
    await updateCell(requireVault(), rel, prop, value);
    return undefined;
  });
  handle('db.addRow', async ({ folder, title, values, template }) => ({ path: await addRow(requireVault(), folder, title, values, template) }));
  handle('db.editSchema', async ({ folder, op }) => ({ touchedRows: await editSchema(requireVault(), folder, op) }));
  handle('db.create', async ({ folder, title }) => ({ folder: await createDatabase(requireVault(), folder, title) }));
  handle('db.exportCsv', ({ folder, viewId }) => exportCsv(requireVault(), folder, viewId));
  handle('db.importCsvPreview', () => importCsvPreview());
  handle('db.importCsvApply', ({ token, target, columns }) => importCsvApply(requireVault(), token, target, columns));
  handle('tag.list', async () => {
    const v = requireVault();
    await v.index.ready;
    return v.index.query('tags');
  });
  handle('tag.notes', async ({ tag }) => {
    const v = requireVault();
    await v.index.ready;
    return v.index.query('notesByTag', tag.replace(/^#/, ''));
  });
  handle('daily.open', ({ date }) => {
    const v = requireVault();
    const cfg = readVaultConfig(v.info.path);
    const day = date ?? localDate(new Date());
    const rel = `${cfg.dailyFolder}/${day}.md`;
    const full = resolveInVault(v.info.path, rel);
    if (existsSync(full)) return { path: rel, created: false };
    atomicWrite(full, dailyTemplate(v.info.path, cfg.dailyTemplate, day));
    return { path: rel, created: true };
  });
  handle('search.query', async ({ q, limit }) => {
    const v = requireVault();
    await v.index.ready;
    return v.index.search(q, limit ?? 50);
  });
  handle('asset.list', async () => {
    const v = requireVault();
    await v.index.ready;
    return v.index.assets();
  });
  handle('asset.save', ({ name, data }) => {
    const v = requireVault();
    const folder = readVaultConfig(v.info.path).attachmentFolder;
    let clean = sanitizeAttachmentName(name);
    if (isGenericName(clean)) clean = pastedName(mimeFromName(clean));
    const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    const digest = createHash('sha256').update(bytes).digest('hex');
    let reused = false;
    const final = uniqueName(clean, (candidate) => {
      const full = resolveInVault(v.info.path, `${folder}/${candidate}`);
      if (!existsSync(full)) return false;
      // 같은 이름에 같은 내용이면 새로 만들지 않고 재사용한다
      if (createHash('sha256').update(readFileSync(full)).digest('hex') === digest) {
        reused = true;
        return false;
      }
      return true;
    });
    const rel = `${folder}/${final}`;
    if (!reused) atomicWrite(resolveInVault(v.info.path, rel), bytes);
    return { path: rel, reused };
  });
  handle('asset.open', async ({ path: rel }) => {
    const v = requireVault();
    const full = resolveInVault(v.info.path, rel);
    // 실행될 수 있는 형식(.app, .command, .sh …)은 열지 않고 위치만 보여 준다
    if (!OPENABLE.test(rel)) {
      shell.showItemInFolder(full);
      return 'revealed' as const;
    }
    const err = await shell.openPath(full);
    if (err) {
      shell.showItemInFolder(full);
      return 'revealed' as const;
    }
    return 'opened' as const;
  });
  handle('app.openExternal', ({ url }) => {
    if (!openExternalSafe(url)) throw new Error(t('main.err.badUrl'));
    return undefined;
  });
  handle('settings.language', () => currentLanguage());
  handle('settings.writerToday', ({ vaultId }) => writerStatsStore().todayStats(vaultId));
  handle('settings.writerAddDelta', ({ vaultId, path: notePath, delta }) => writerStatsStore().add(vaultId, notePath, delta));
  handle('settings.setLanguage', ({ language, writerMode, writerSpacing, writerDailyGoal }) => {
    if (language !== undefined) settingsStore().setLanguage(language);
    if (writerMode !== undefined || writerSpacing !== undefined || writerDailyGoal !== undefined) {
      settingsStore().setWriter({
        ...(writerMode === undefined ? {} : { mode: writerMode }),
        ...(writerSpacing === undefined ? {} : { spacing: writerSpacing }),
        ...(writerDailyGoal === undefined ? {} : { dailyGoal: writerDailyGoal }),
      });
    }
    const current = currentLanguage();
    // 메인에서 만드는 기본값(새 행 제목·볼트 기본 폴더 등)도 앱 언어를 따르게 한다.
    setLocale(current.locale);
    // 색인 워커도 자기 언어로 문구를 만든다(열린 볼트의 워커에 알린다).
    getCurrent()?.index.setLocale(current.locale);
    broadcast('language.changed', current);
    return current;
  });
}


/** 볼트 안 폴더의 마크다운 노트 경로(하위 폴더 포함, 숨김 제외). */
function walkMarkdown(root: string, relDir: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    let entries;
    try {
      entries = readdirSync(resolveInVault(root, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.name.startsWith('.') || ent.name === 'node_modules') continue;
      const child = `${rel}/${ent.name}`;
      if (ent.isDirectory()) walk(child);
      else if (/\.md$/i.test(ent.name)) out.push(child);
    }
  };
  walk(relDir);
  return out;
}

let settings: AppSettingsStore | null = null;
/** 작품 카드 글자수 캐시(노트 경로 → mtime·size·글자수). 파일이 바뀌면 그 노트만 다시 센다. */
const workCharCache = new Map<string, { mtime: number; size: number; chars: number; charsNoSpace: number }>();

const settingsFile = () => path.join(app.getPath('userData'), 'app-settings.json');

/** 첫 사용(창이 뜬 뒤)에 파일을 읽는다. 쓰기 실패는 던져서 IPC 오류로 렌더러에 전달된다. */
function settingsStore(): AppSettingsStore {
  settings ??= new AppSettingsStore(settingsFile(), readAppSettings(settingsFile()));
  return settings;
}

/**
 * OS 언어. e2e 는 기존 한국어 셀렉터가 흔들리지 않도록 ko 로 고정하고,
 * 언어 전환 테스트만 NOPS_E2E_LANG 로 덮어쓴다.
 */
function systemLanguages(): readonly string[] {
  if (process.env.NOPS_E2E === '1') return [process.env.NOPS_E2E_LANG === 'en' ? 'en' : 'ko'];
  return app.getPreferredSystemLanguages();
}

function currentLanguage(): AppLanguage {
  const { language, writerMode, writerSpacing, writerDailyGoal } = settingsStore().value;
  return { setting: language, locale: resolveLocale(language, systemLanguages()), writerMode, writerSpacing, writerDailyGoal: writerDailyGoal ?? null };
}

/** 작가 모드 통계(오늘 쓴 글자수) — userData 에만 쓰고 볼트는 건드리지 않는다. */
let writerStats: WriterStatsStore | null = null;
function writerStatsStore(): WriterStatsStore {
  writerStats ??= new WriterStatsStore(path.join(app.getPath('userData'), 'writer-stats.json'));
  return writerStats;
}

app.whenReady().then(() => {
  if (mcpStdio) return; // MCP 서버 모드: 창·프로토콜·IPC를 만들지 않는다
  // 이 프로세스에서 만드는 기본값도 앱 언어를 따른다(렌더러와 별개 컨텍스트).
  setLocale(currentLanguage().locale);
  installSessionPolicy(devServerUrl);
  if (devServerUrl) {
    // 개발 서버는 HMR 때문에 완화된 CSP를 쓴다. 운영 CSP는 app:// 응답 헤더로 강제된다.
    session.defaultSession.webRequest.onHeadersReceived((d, cb) => {
      cb({ responseHeaders: { ...d.responseHeaders, 'Content-Security-Policy': [buildCsp(true)] } });
    });
  }
  installProtocols({
    rendererRoot: devServerUrl
      ? undefined
      : path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}`),
    getVaultRoot,
  });
  configureIpc({ devServerUrl });
  setBroadcaster(broadcast);
  registerHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
let quitting = false;
app.on('before-quit', (event) => {
  if (quitting) return;
  quitting = true;
  // 워커의 @parcel/watcher unsubscribe 가 끝나기 전에 프로세스가 내려가면 SIGABRT 가 난다.
  // 종료를 잠시 붙잡고 색인 워커를 정상 종료시킨 뒤 다시 종료한다.
  event.preventDefault();
  void (async () => {
    await syncController.detachVault().catch(() => undefined);
    await getCurrent()?.index.close().catch(() => undefined);
    app.quit();
  })();
});
