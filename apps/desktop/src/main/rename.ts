import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { atomicWrite, planMoves, resolveInVault, sha256, type Move, type MovePlan, relocateComments } from '@nopsidian/core';

/** 볼트 안의 이동 대상(파일 하나 또는 폴더 안의 모든 파일)을 파일 단위 이동 목록으로 펼친다. */
export function expandMoves(root: string, from: string, to: string): Move[] {
  const fromFull = resolveInVault(root, from);
  const isDir = existsSync(fromFull) && statSync(fromFull).isDirectory();
  // 노트는 확장자를 생략해도 .md를 유지한다
  const target = !isDir && from.toLowerCase().endsWith('.md') && !to.toLowerCase().endsWith('.md') ? `${to}.md` : to;
  if (!existsSync(fromFull)) throw new Error(`없는 경로: ${from}`);
  if (from === target) throw new Error('이름이 같아요');
  const toFull = resolveInVault(root, target);
  if (existsSync(toFull) && from.toLowerCase() !== target.toLowerCase()) throw new Error(`이미 있는 경로: ${target}`);
  if (isDir && (target + '/').startsWith(from + '/')) throw new Error('폴더를 자기 자신 안으로는 옮길 수 없어요');
  if (target.split('/').some((s) => s.startsWith('.') || s === '')) throw new Error('점(.)으로 시작하는 이름이나 빈 이름은 쓸 수 없어요');

  if (!isDir) return [{ from, to: target }];
  const moves: Move[] = [];
  const walk = (dir: string, rel: string) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (ent.name.startsWith('.')) continue;
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) walk(path.join(dir, ent.name), r);
      else if (ent.isFile()) moves.push({ from: `${from}/${r}`, to: `${target}/${r}` });
    }
  };
  walk(fromFull, '');
  return moves;
}

export interface VaultSnapshot {
  notes: { path: string; content: string }[];
  assets: string[];
}

export function planRename(root: string, snapshot: VaultSnapshot, from: string, to: string): { plan: MovePlan; moves: Move[] } {
  const moves = expandMoves(root, from, to);
  return { plan: planMoves({ notes: snapshot.notes, assets: snapshot.assets, moves }), moves };
}

interface UndoRecord {
  moves: Move[];
  edits: { path: string; newPath: string; before: string; afterHash: string }[];
  createdDirs: string[];
}

const undoPath = (root: string, id: string) => path.join(root, '.nopsidian', 'ops', `rename-${id}.json`);

function newUndoId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** 파일 이동 → 링크가 바뀐 노트 쓰기. 중간에 실패하면 지금까지 한 일을 되돌린다. */
export function applyRename(root: string, moves: Move[], plan: MovePlan): { undoId: string } {
  const undoId = newUndoId();
  const record: UndoRecord = {
    moves,
    edits: plan.edits.map((e) => ({
      path: e.path,
      newPath: e.newPath,
      before: readFileSync(resolveInVault(root, e.path), 'utf8'),
      afterHash: sha256(e.content),
    })),
    createdDirs: [],
  };
  // 실행 전에 기록부터 남긴다(도중에 앱이 죽어도 복구할 수 있게)
  mkdirSync(path.dirname(undoPath(root, undoId)), { recursive: true });
  writeFileSync(undoPath(root, undoId), JSON.stringify(record));

  const done: Move[] = [];
  try {
    for (const m of moves) {
      const dest = resolveInVault(root, m.to);
      const dir = path.dirname(dest);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
        record.createdDirs.push(dir);
      }
      renameSync(resolveInVault(root, m.from), dest);
      done.push(m);
    }
    for (const e of plan.edits) atomicWrite(resolveInVault(root, e.newPath), e.content);
  } catch (err) {
    // 롤백: 이동을 거꾸로, 내용은 기록해 둔 원본으로
    for (const m of done.reverse()) {
      try {
        renameSync(resolveInVault(root, m.to), resolveInVault(root, m.from));
      } catch {
        // 최선을 다한다
      }
    }
    for (const e of record.edits) {
      try {
        atomicWrite(resolveInVault(root, e.path), e.before);
      } catch {
        // 최선을 다한다
      }
    }
    pruneEmptyDirs(record.createdDirs);
    throw err;
  }
  writeFileSync(undoPath(root, undoId), JSON.stringify(record));
  // 폴더 이동으로 비게 된 원래 폴더를 정리한다
  pruneEmptyDirs([...new Set(moves.map((m) => path.dirname(resolveInVault(root, m.from))))]);
  return { undoId };
}

function pruneEmptyDirs(dirs: string[]) {
  for (const d of dirs.sort((a, b) => b.length - a.length)) {
    let cur = d;
    for (let i = 0; i < 20; i++) {
      try {
        if (readdirSync(cur).length > 0) break;
        rmdirSync(cur);
        cur = path.dirname(cur);
      } catch {
        break;
      }
    }
  }
}

/** 이름 변경을 되돌린다. 그 뒤에 사용자가 같은 노트를 또 고쳤다면 그 노트의 내용은 덮어쓰지 않고 건너뛴다. */
export function undoRename(root: string, id: string): { restored: number; skipped: string[] } {
  const file = undoPath(root, id);
  if (!existsSync(file)) throw new Error('되돌릴 기록이 없어요');
  const record = JSON.parse(readFileSync(file, 'utf8')) as UndoRecord;
  const skipped: string[] = [];
  let restored = 0;

  // 내용 복원(현재 내용이 우리가 쓴 그대로일 때만)
  for (const e of record.edits) {
    const cur = resolveInVault(root, e.newPath);
    if (existsSync(cur) && sha256(readFileSync(cur, 'utf8')) === e.afterHash) {
      atomicWrite(cur, e.before);
      restored++;
    } else {
      skipped.push(e.newPath);
    }
  }
  // 이동 되돌리기
  for (const m of [...record.moves].reverse()) {
    const from = resolveInVault(root, m.to);
    const to = resolveInVault(root, m.from);
    if (!existsSync(from) || existsSync(to)) {
      skipped.push(m.to);
      continue;
    }
    mkdirSync(path.dirname(to), { recursive: true });
    renameSync(from, to);
  }
  for (const m of [...record.moves].reverse()) relocateComments(root, m.to, m.from); // 댓글도 원래 이름으로
  pruneEmptyDirs([...new Set(record.moves.map((m) => path.dirname(resolveInVault(root, m.to))))]);
  writeFileSync(file, JSON.stringify({ ...record, undone: true }));
  return { restored, skipped };
}
