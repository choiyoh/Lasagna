import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveInVault } from '@nopsidian/core';

const TRASH = ['.nopsidian', 'trash'];

export interface TrashResult {
  trashId: string;
  /** 지운 것이 폴더였는가 */
  isFolder: boolean;
}

const stamp = (d: Date) => d.toISOString().replace(/[:.]/g, '-');

function move(from: string, to: string) {
  try {
    renameSync(from, to);
  } catch {
    // 다른 드라이브·권한 문제 등: 복사 후 삭제
    cpSync(from, to, { recursive: true });
    rmSync(from, { recursive: true, force: true });
  }
}

/** 노트(또는 폴더)를 볼트의 `.nopsidian/trash/` 로 옮긴다. 원래 경로는 옆에 적어 둬 되돌릴 수 있다. */
export function moveToTrash(root: string, rel: string, now = new Date()): TrashResult {
  const src = resolveInVault(root, rel);
  if (!existsSync(src)) throw new Error('이미 없는 항목이에요');
  const isFolder = statSync(src).isDirectory();
  const dir = path.join(root, ...TRASH);
  mkdirSync(dir, { recursive: true });
  const base = path.posix.basename(rel);
  let id = `${stamp(now)}-${base}`;
  for (let n = 2; existsSync(path.join(dir, id)); n++) id = `${stamp(now)}-${n}-${base}`;
  move(src, path.join(dir, id));
  writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ path: rel, isFolder, at: now.toISOString() }));
  return { trashId: id, isFolder };
}

/** 휴지통에서 원래 자리로 되돌린다. 그 자리에 이미 다른 것이 있으면 ` (복원)` 을 붙인다. 돌려주는 값은 되돌린 경로. */
export function restoreFromTrash(root: string, trashId: string): string {
  if (!/^[\w.\- 가-힣()]+$/u.test(trashId) || trashId.includes('..')) throw new Error('잘못된 휴지통 항목이에요');
  const dir = path.join(root, ...TRASH);
  const item = path.join(dir, trashId);
  const meta = JSON.parse(readFileSync(path.join(dir, `${trashId}.json`), 'utf8')) as { path: string; isFolder: boolean };
  let target = meta.path;
  const ext = meta.isFolder ? '' : path.posix.extname(target);
  const stem = ext ? target.slice(0, -ext.length) : target;
  for (let n = 1; existsSync(resolveInVault(root, target)); n++) target = `${stem} (복원${n > 1 ? ` ${n}` : ''})${ext}`;
  const dest = resolveInVault(root, target);
  mkdirSync(path.dirname(dest), { recursive: true });
  move(item, dest);
  rmSync(path.join(dir, `${trashId}.json`), { force: true });
  return target;
}

export interface TrashItem {
  trashId: string;
  path: string;
  isFolder: boolean;
  at: string;
}

/** 휴지통 항목(메타 파일이 있는 것만), 최근 순 */
export function listTrash(root: string): TrashItem[] {
  const dir = path.join(root, ...TRASH);
  if (!existsSync(dir)) return [];
  const out: TrashItem[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const id = f.slice(0, -5);
    if (!existsSync(path.join(dir, id))) continue;
    try {
      const meta = JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as { path: string; isFolder: boolean; at: string };
      out.push({ trashId: id, path: meta.path, isFolder: !!meta.isFolder, at: meta.at });
    } catch {
      /* 깨진 메타는 건너뛴다 */
    }
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : -1));
}

/** 휴지통에서 영구 삭제. id 가 없으면 전부. 지운 개수 */
export function purgeTrash(root: string, trashId?: string): number {
  const items = listTrash(root).filter((t) => !trashId || t.trashId === trashId);
  const dir = path.join(root, ...TRASH);
  for (const t of items) {
    rmSync(path.join(dir, t.trashId), { recursive: true, force: true });
    rmSync(path.join(dir, `${t.trashId}.json`), { force: true });
  }
  return items.length;
}

/** 볼트 안 폴더 목록(숨김 폴더·`.nopsidian`·`node_modules` 제외) */
export function listFolders(root: string): string[] {
  const out: string[] = [];
  const walk = (rel: string, depth: number) => {
    if (depth > 30) return;
    for (const ent of readdirSync(path.join(root, rel), { withFileTypes: true })) {
      if (!ent.isDirectory() || ent.name.startsWith('.') || ent.name === 'node_modules') continue;
      const child = rel ? `${rel}/${ent.name}` : ent.name;
      out.push(child);
      walk(child, depth + 1);
    }
  };
  walk('', 0);
  return out.sort();
}

/** 새 폴더. 같은 이름이 있으면 ` 2`, ` 3`… */
export function createFolder(root: string, rel: string): string {
  let target = rel;
  for (let n = 2; existsSync(resolveInVault(root, target)); n++) target = `${rel} ${n}`;
  mkdirSync(resolveInVault(root, target), { recursive: true });
  return target;
}
