import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
