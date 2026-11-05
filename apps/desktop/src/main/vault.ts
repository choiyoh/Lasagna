import { getLocale, t, translate } from '@nopsidian/i18n';
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
  /** 자기 쓰기를 한 창(웹콘텐츠 id) — 다른 창에는 외부 변경처럼 알려 다시 불러오게 한다 */
  selfOrigins: Map<string, number>;
}

/** 동기화 같은 부가 기능이 볼트 수명주기에 끼어드는 지점 */
export const vaultHooks: {
  opened?: (info: VaultInfo) => void | Promise<void>;
  closing?: () => void | Promise<void>;
  changed?: () => void;
} = {};

let current: OpenVault | null = null;
/** `exceptOrigin` 창(웹콘텐츠 id)에는 `external: false`, 나머지 창에는 `external: true` 로 보낸다(자기 쓰기 알림용). */
let broadcast: (name: EventName, payload: unknown, selfOrigin?: number) => void = () => {};

export function setBroadcaster(fn: typeof broadcast) {
  broadcast = fn;
}

export const listRecent = readRecent;
export const getCurrent = () => current;
export const getVaultRoot = (id: string) => (current?.info.id === id ? current.info.path : undefined);

export function requireVault(): OpenVault {
  if (!current) throw new Error('열린 볼트가 없어요');
  return current;
}

export async function openVaultAt(root: string): Promise<VaultInfo> {
  const real = path.resolve(root);
  if (!statSync(real).isDirectory()) throw new Error('폴더가 아님');
  const dotDir = path.join(real, '.nopsidian');
  mkdirSync(dotDir, { recursive: true });
  const cfg = path.join(dotDir, 'config.json');
  if (!existsSync(cfg)) writeFileSync(cfg, JSON.stringify({ version: 1 }, null, 2));

  await vaultHooks.closing?.();
  await current?.index.close();
  current = null;

  const info: VaultInfo = { id: vaultIdFor(real), name: path.basename(real), path: real };
  const bases = new Map<string, { hash: string; content: string }>();
  const selfWrites = new Map<string, string>();
  const selfOrigins = new Map<string, number>();
  const index = new IndexClient(real, (e) => {
    // 감시 오류는 IPC 계약에 없는 이벤트라 렌더러로 보내지 않고 로그로만 남긴다
    if (e.name === 'index.watchError') {
      console.warn(`[index] 파일 감시 오류: ${e.payload.message}`);
      return;
    }
    if (e.name === 'note.changed' || e.name === 'asset.changed') vaultHooks.changed?.();
    if (e.name === 'note.changed') {
      const mine = e.payload.hash !== undefined && selfWrites.get(e.payload.path) === e.payload.hash;
      const origin = selfOrigins.get(e.payload.path);
      if (mine) {
        selfWrites.delete(e.payload.path);
        selfOrigins.delete(e.payload.path);
      }
      broadcast(e.name, { path: e.payload.path, kind: e.payload.kind, external: !mine }, mine ? origin : undefined);
    } else {
      broadcast(e.name, e.payload);
    }
  });
  current = { info, index, bases, selfWrites, selfOrigins };
  pushRecent(info);
  await vaultHooks.opened?.(info);
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

/**
 * 설정에 폴더가 없을 때 쓸 이름. 지금 언어 이름이 있으면 그것, 없으면 다른 언어(ko/en)의 같은 기본값 이름
 * (기존 볼트 인식), 둘 다 없으면 지금 언어 기본값으로 새로 만든다 — 언어를 바꿔도 중복 폴더가 생기지 않는다.
 */
function existingFolder(root: string, key: 'default.dailyFolder' | 'default.templatesFolder'): string {
  const names = [t(key), translate(getLocale() === 'ko' ? 'en' : 'ko', key)];
  return names.find((name) => existsSync(path.join(root, name))) ?? names[0]!;
}

export function readVaultConfig(root: string): VaultConfig {
  // 설정이 없으면 이미 있는 폴더를 먼저 인식한다(앱 언어와 무관): 지금 언어 이름 → 다른 언어 이름 → 없으면 지금 언어 기본값.
  // 영어로 만든 볼트를 한국어로 열어도 Journal/Templates 를 그대로 쓰고, 중복 폴더를 새로 만들지 않는다.
  const dailyName = existingFolder(root, 'default.dailyFolder');
  const templatesName = existingFolder(root, 'default.templatesFolder');
  const fallback: VaultConfig = { version: 1, attachmentFolder: 'attachments', dailyFolder: dailyName, dailyTemplate: null, templatesFolder: templatesName };
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
