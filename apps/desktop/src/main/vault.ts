import { app, dialog, BrowserWindow } from 'electron';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { VaultInfo } from '@nopsidian/ipc-contract';
import { IndexClient } from './index-client';

const MAX_RECENT = 10;
const recentFile = () => path.join(app.getPath('userData'), 'recent-vaults.json');

export const vaultIdFor = (root: string) =>
  createHash('sha256').update(root).digest('hex').slice(0, 12);

function readRecent(): VaultInfo[] {
  try {
    const list = JSON.parse(readFileSync(recentFile(), 'utf8')) as VaultInfo[];
    return list.filter((v) => existsSync(v.path));
  } catch {
    return [];
  }
}

function pushRecent(v: VaultInfo) {
  const next = [v, ...readRecent().filter((r) => r.id !== v.id)].slice(0, MAX_RECENT);
  writeFileSync(recentFile(), JSON.stringify(next, null, 2));
}

export interface OpenVault {
  info: VaultInfo;
  index: IndexClient;
}

let current: OpenVault | null = null;
let broadcast: (name: 'note.changed' | 'index.progress', payload: unknown) => void = () => {};

export function setBroadcaster(fn: typeof broadcast) {
  broadcast = fn;
}

export const listRecent = readRecent;
export const getCurrent = () => current;
export const getVaultRoot = (id: string) => (current?.info.id === id ? current.info.path : undefined);

export function requireVault(): OpenVault {
  if (!current) throw new Error('열린 볼트가 없음');
  return current;
}

export async function openVaultAt(root: string): Promise<VaultInfo> {
  const real = path.resolve(root);
  if (!statSync(real).isDirectory()) throw new Error('폴더가 아님');
  const dotDir = path.join(real, '.nopsidian');
  mkdirSync(dotDir, { recursive: true });
  const cfg = path.join(dotDir, 'config.json');
  if (!existsSync(cfg)) writeFileSync(cfg, JSON.stringify({ version: 1 }, null, 2));

  await current?.index.close();
  current = null;

  const info: VaultInfo = { id: vaultIdFor(real), name: path.basename(real), path: real };
  const index = new IndexClient(real, (e) => broadcast(e.name, e.payload));
  current = { info, index };
  pushRecent(info);
  return info;
}

export async function openRecent(id: string): Promise<VaultInfo> {
  const found = readRecent().find((v) => v.id === id);
  if (!found) throw new Error('최근 볼트에 없음');
  return openVaultAt(found.path);
}

export async function pickAndOpen(parent: BrowserWindow | null): Promise<VaultInfo | null> {
  const opts = {
    title: '볼트 폴더 선택',
    properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[],
  };
  const r = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts);
  const dir = r.filePaths[0];
  if (r.canceled || !dir) return null;
  return openVaultAt(dir);
}
