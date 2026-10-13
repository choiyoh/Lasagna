import { app, BrowserWindow, dialog, safeStorage, session, shell } from 'electron';
import { createHash } from 'node:crypto';
import { applyRename, planRename, undoRename } from './rename';
import { linkMention } from '../workers/index/mention-link';
import { expandTemplate } from '../workers/index/templates';
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
} from '@nopsidian/core';
import { existsSync, readFileSync } from 'node:fs';
import { events, graphSettings, type EventName } from '@nopsidian/ipc-contract';
import { configureIpc, handle, registerWebContents } from './ipc';
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
import { exportVaultSite, renderNoteDocument, type ExportContext } from './export';
import { addRow, createDatabase, editSchema, exportCsv, importCsvApply, importCsvPreview, updateCell } from './db';

// Forge Vite 플러그인이 주입하는 전역
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

const devServerUrl =
  typeof MAIN_WINDOW_VITE_DEV_SERVER_URL === 'string' ? MAIN_WINDOW_VITE_DEV_SERVER_URL : undefined;

/** 기본 앱으로 열어도 안전한 문서·미디어 형식 */
const OPENABLE = /\.(pdf|txt|csv|png|jpe?g|gif|webp|svg|avif|bmp|mp3|m4a|wav|ogg|flac|mp4|webm|mov|m4v|docx?|xlsx?|pptx?|hwp|hwpx|rtf)$/i;

registerSchemes();

if (!app.requestSingleInstanceLock()) app.quit();

function createWindow() {
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
    },
  });
  registerWebContents(win.webContents);
  hardenWebContents(win.webContents, devServerUrl);
  win.once('ready-to-show', () => win.show());
  void win.loadURL(devServerUrl ?? `${APP_ORIGIN}/index.html`);
  if (!app.isPackaged && process.env.NOPS_DEVTOOLS === '1') win.webContents.openDevTools({ mode: 'detach' });
  return win;
}

function broadcast(name: EventName, payload: unknown) {
  const parsed = events[name].parse(payload);
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(name, parsed);
}

/** 이름 변경 계획을 세우려고 볼트의 모든 노트 내용과 첨부 목록을 읽는다. */
async function snapshotVault(v: ReturnType<typeof requireVault>) {
  const list = await v.index.list();
  const notes = list.map((n) => ({ path: n.path, content: readFileSync(resolveInVault(v.info.path, n.path), 'utf8') }));
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
    if (!openExternalSafe(url)) throw new Error('허용되지 않은 URL');
    void shell.openExternal(url);
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
  handle('note.save', ({ path: rel, content, baseHash }) => {
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
    return result;
  });
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
    // 앱이 기억하던 노트 내용(3-way 병합의 기준)은 이동·갱신 뒤에는 무효다
    v.bases.clear();
    v.selfWrites.clear();
    return { moves, edits: plan.edits.map((e) => ({ path: e.path, newPath: e.newPath, changes: e.changes })), totalChanges: plan.totalChanges, undoId };
  });
  handle('note.undoRename', ({ undoId }) => {
    const v = requireVault();
    const r = undoRename(v.info.path, undoId);
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
    if (!r) throw new Error('그 줄에서 블록을 찾지 못했습니다');
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
    if (!target) throw new Error('대상 노트를 찾을 수 없습니다');
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
    return (await v.index.list()).filter((n) => n.path.startsWith(`${folder}/`)).map((n) => ({ path: n.path, title: n.title }));
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
      title: format === 'pdf' ? 'PDF로 내보내기' : 'HTML로 내보내기',
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
  handle('export.vault', async (_i, e) => {
    const v = requireVault();
    await v.index.ready;
    const parent = BrowserWindow.fromWebContents(e.sender);
    const opts = { title: '내보낼 폴더 선택', properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[] };
    const r = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts);
    const dir = r.filePaths[0];
    if (r.canceled || !dir) return { dir: null, notes: 0, assets: 0 };
    const out = path.join(dir, `${v.info.name} (HTML)`);
    return { dir: out, ...exportVaultSite(await exportContext(v), out) };
  });
  handle('history.list', ({ path: rel }) => listHistory(requireVault().info.path, rel));
  handle('history.read', ({ path: rel, id }) => ({ content: readHistory(requireVault().info.path, rel, id) }));
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
  handle('sync.enable', ({ enabled }) => syncController.setEnabled(enabled));
  handle('sync.plan', () => syncController.plan());
  handle('sync.run', ({ force }) => syncController.run(force ?? false));
  handle('db.list', async () => {
    const v = requireVault();
    await v.index.ready;
    return v.index.query('databases');
  });
  handle('db.query', async (input) => {
    const v = requireVault();
    await v.index.ready;
    return v.index.query('queryDatabase', input) as never;
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
    if (!openExternalSafe(url)) throw new Error('허용되지 않은 URL');
    return undefined;
  });
}

app.whenReady().then(() => {
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
app.on('before-quit', () => {
  void syncController.detachVault();
  void getCurrent()?.index.close();
});
