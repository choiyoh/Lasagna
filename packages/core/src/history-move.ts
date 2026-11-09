import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';

/** 노트 경로 → 이력 폴더 키(자동 이력·스냅샷 공통). */
export function historyKey(rel: string): string {
  return createHash('sha1').update(rel).digest('hex').slice(0, 12);
}

/**
 * 한 종류의 이력 폴더(`.nopsidian/<kind>/<key>`)를 새 경로 키로 옮긴다.
 * 새 키 폴더가 이미 있으면 **병합**하고 같은 파일 이름은 덮어쓰지 않는다. 옮길 것이 없으면 아무 것도 하지 않는다.
 */
export function moveKeyedDir(root: string, kind: 'history' | 'snapshots', from: string, to: string): void {
  const oldKey = historyKey(from);
  const newKey = historyKey(to);
  if (oldKey === newKey) return;
  const base = path.join(root, '.nopsidian', kind);
  const oldDir = path.join(base, oldKey);
  const newDir = path.join(base, newKey);
  if (!existsSync(oldDir)) return;
  mkdirSync(newDir, { recursive: true });
  for (const name of readdirSync(oldDir)) {
    const src = path.join(oldDir, name);
    const dest = path.join(newDir, name);
    if (existsSync(dest)) {
      // 새 경로에 같은 이름이 있으면 덮어쓰지 않는다. 내용까지 같으면 중복만 지운다.
      try {
        if (readFileSync(src).equals(readFileSync(dest))) unlinkSync(src);
      } catch {
        // 비교·삭제에 실패하면 옛 폴더에 그대로 둔다.
      }
      continue;
    }
    renameSync(src, dest);
  }
  try {
    if (readdirSync(oldDir).length === 0) rmdirSync(oldDir);
  } catch {
    // 비우지 못해도 무해하다(빈 폴더만 남는다).
  }
}

/** 노트 이름 바꾸기·이동 뒤 자동 이력과 스냅샷을 새 경로 키로 따라가게 한다. 실패는 조용히 무시한다. */
export function moveNoteHistory(root: string, from: string, to: string): void {
  for (const kind of ['history', 'snapshots'] as const) {
    try {
      moveKeyedDir(root, kind, from, to);
    } catch {
      // 이력 이동 실패가 노트 이름 바꾸기 자체를 막지 않는다.
    }
  }
}
