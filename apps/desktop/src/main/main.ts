import { app, BrowserWindow, session } from 'electron';
import path from 'node:path';
import { resolveInVault } from '@nopsidian/core';
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
  requireVault,
  setBroadcaster,
} from './vault';
import { readFile } from 'node:fs/promises';

// Forge Vite 플러그인이 주입하는 전역
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

const devServerUrl =
  typeof MAIN_WINDOW_VITE_DEV_SERVER_URL === 'string' ? MAIN_WINDOW_VITE_DEV_SERVER_URL : undefined;

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
    const full = resolveInVault(v.info.path, rel);
    return { content: await readFile(full, 'utf8') };
  });
  handle('search.query', async ({ q, limit }) => {
    const v = requireVault();
    await v.index.ready;
    return v.index.search(q, limit ?? 50);
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
