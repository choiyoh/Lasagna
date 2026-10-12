import { app, BrowserWindow, session, shell } from 'electron';
import { createHash } from 'node:crypto';
import { applyRename, planRename, undoRename } from './rename';
import path from 'node:path';
import {
  atomicWrite,
  isGenericName,
  pastedName,
  mimeFromName,
  resolveInVault,
  sanitizeAttachmentName,
  saveNote,
  sha256,
  uniqueName,
} from '@nopsidian/core';
import { existsSync, readFileSync } from 'node:fs';
import { events, type EventName } from '@nopsidian/ipc-contract';
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
} from './vault';
import { readFile } from 'node:fs/promises';

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

/** 데일리 노트 내용: 템플릿 노트가 있으면 `{{date}}`·`{{title}}`을 채워 쓰고, 없으면 제목만. */
function dailyTemplate(root: string, templatePath: string | null, day: string): string {
  if (templatePath) {
    try {
      const raw = readFileSync(resolveInVault(root, templatePath), 'utf8');
      return raw.replace(/\{\{\s*(date|title)\s*\}\}/g, day);
    } catch {
      // 템플릿을 못 읽으면 기본 내용으로
    }
  }
  return `# ${day}\n\n`;
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
  installSessionPolicy();
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
  void getCurrent()?.index.close();
});
