import { app, dialog, BrowserWindow } from 'electron';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { EventName, VaultInfo } from '@nopsidian/ipc-contract';
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
  /** 앱이 마지막으로 읽거나 저장한 노트별 디스크 내용 — 3-way 병합의 공통 조상 */
  bases: Map<string, { hash: string; content: string }>;
  /** 앱이 방금 쓴 파일의 해시 — 감시 이벤트가 자기 쓰기인지 구분하는 데 쓴다 */
  selfWrites: Map<string, string>;
}

let current: OpenVault | null = null;
let broadcast: (name: EventName, payload: unknown) => void = () => {};

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
  const bases = new Map<string, { hash: string; content: string }>();
  const selfWrites = new Map<string, string>();
  const index = new IndexClient(real, (e) => {
    if (e.name === 'note.changed') {
      const mine = e.payload.hash !== undefined && selfWrites.get(e.payload.path) === e.payload.hash;
      if (mine) selfWrites.delete(e.payload.path);
      broadcast(e.name, { path: e.payload.path, kind: e.payload.kind, external: !mine });
    } else {
      broadcast(e.name, e.payload);
    }
  });
  current = { info, index, bases, selfWrites };
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

export interface VaultConfig {
  version: number;
  /** 새 첨부를 저장할 폴더(볼트 기준) */
  attachmentFolder: string;
  /** 데일리 노트 폴더와, 새 데일리 노트에 쓸 템플릿 노트(볼트 기준 경로, 없으면 null) */
  dailyFolder: string;
  dailyTemplate: string | null;
  /** "템플릿 삽입"이 찾는 폴더 */
  templatesFolder: string;
}

export function readVaultConfig(root: string): VaultConfig {
  const fallback: VaultConfig = { version: 1, attachmentFolder: 'attachments', dailyFolder: '일기', dailyTemplate: null, templatesFolder: '템플릿' };
  try {
    const raw = JSON.parse(readFileSync(path.join(root, '.nopsidian', 'config.json'), 'utf8')) as Partial<VaultConfig>;
    const folder = typeof raw.attachmentFolder === 'string' ? raw.attachmentFolder.replace(/^\/+|\/+$/g, '') : '';
    const daily = typeof raw.dailyFolder === 'string' ? raw.dailyFolder.replace(/^\/+|\/+$/g, '') : '';
    return {
      ...fallback,
      ...raw,
      attachmentFolder: folder && !folder.startsWith('.') ? folder : fallback.attachmentFolder,
      dailyFolder: daily && !daily.startsWith('.') && !daily.includes('..') ? daily : fallback.dailyFolder,
      templatesFolder:
        typeof raw.templatesFolder === 'string' && raw.templatesFolder && !raw.templatesFolder.startsWith('.') && !raw.templatesFolder.includes('..')
          ? raw.templatesFolder.replace(/^\/+|\/+$/g, '')
          : fallback.templatesFolder,
      dailyTemplate: typeof raw.dailyTemplate === 'string' && raw.dailyTemplate ? raw.dailyTemplate : null,
    };
  } catch {
    return fallback;
  }
}
