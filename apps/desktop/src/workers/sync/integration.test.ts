import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { merge3 } from '@nopsidian/core';
import { syncOnce, type SyncDeps } from '@nopsidian/sync-gdrive';
import { MemoryDrive } from '@nopsidian/sync-gdrive/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { FsLocalStore } from './fs-local-store';
import { SqliteSyncState } from './sqlite-state';
import { isSyncablePath } from './syncable';

/** 실제 폴더 + 실제 SQLite 상태 + 메모리 Drive: 진짜 저장소 구현이 엔진과 맞물리는지 본다. */
const open: SqliteSyncState[] = [];
afterEach(() => open.splice(0).forEach((s) => s.close()));

function vault() {
  const root = mkdtempSync(path.join(tmpdir(), 'nops-sync-int-'));
  mkdirSync(path.join(root, '.nopsidian'), { recursive: true });
  const state = new SqliteSyncState({ dbPath: path.join(root, '.nopsidian/sync/state.sqlite'), baseDir: path.join(root, '.nopsidian/sync/base') });
  open.push(state);
  const cache = new Map<string, { mtimeMs: number; size: number; hash: string }>();
  const write = (rel: string, text: string) => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text);
  };
  const read = (rel: string) => (existsSync(path.join(root, rel)) ? readFileSync(path.join(root, rel), 'utf8') : undefined);
  return { root, write, read, state, deps: (drive: MemoryDrive): SyncDeps => ({ drive, local: new FsLocalStore(root, { cache }), state, merge: merge3, isSyncable: isSyncablePath }) };
}

describe('실제 파일시스템·SQLite 와 엔진', () => {
  it('두 볼트가 Drive 를 통해 수렴한다(생성·수정·병합·삭제·이름 변경)', async () => {
    const drive = new MemoryDrive();
    const a = vault();
    const b = vault();
    a.write('노트/일.md', '# 일\n\n첫\n\n둘\n');
    a.write('.nopsidian/index.sqlite', 'ignored');
    a.write('.nopsidian/graph.json', '{"filter":""}');
    for (const n of 'abcdefghij') a.write(`${n}.md`, `# ${n}\n`);
    await syncOnce(a.deps(drive));
    expect(drive.paths()).toContain('노트/일.md');
    expect(drive.paths()).toContain('.nopsidian/graph.json');
    expect(drive.paths()).not.toContain('.nopsidian/index.sqlite');

    await syncOnce(b.deps(drive));
    expect(b.read('노트/일.md')).toBe('# 일\n\n첫\n\n둘\n');
    expect(b.read('.nopsidian/index.sqlite')).toBeUndefined();

    // 서로 다른 블록을 동시에 수정 → 병합
    a.write('노트/일.md', '# 일\n\n첫 (A)\n\n둘\n');
    b.write('노트/일.md', '# 일\n\n첫\n\n둘 (B)\n');
    await syncOnce(a.deps(drive));
    const rb = await syncOnce(b.deps(drive));
    expect(rb.report.merged).toBe(1);
    expect(b.read('노트/일.md')).toBe('# 일\n\n첫 (A)\n\n둘 (B)\n');
    await syncOnce(a.deps(drive));
    expect(a.read('노트/일.md')).toBe('# 일\n\n첫 (A)\n\n둘 (B)\n');

    // 이름 변경은 이동으로 전파 — 재업로드 없음
    const { renameSync } = await import('node:fs');
    renameSync(path.join(a.root, 'a.md'), path.join(a.root, 'z.md'));
    drive.calls.length = 0;
    await syncOnce(a.deps(drive));
    expect(drive.calls.filter((c) => c.startsWith('upload'))).toEqual([]);
    await syncOnce(b.deps(drive));
    expect(b.read('z.md')).toBe('# a\n');
    expect(b.read('a.md')).toBeUndefined();

    // 삭제는 상대 볼트의 휴지통으로
    const { rmSync } = await import('node:fs');
    rmSync(path.join(a.root, 'b.md'));
    await syncOnce(a.deps(drive));
    await syncOnce(b.deps(drive));
    expect(b.read('b.md')).toBeUndefined();
    const trashDirs = readdirSync(path.join(b.root, '.nopsidian/trash'));
    expect(readFileSync(path.join(b.root, '.nopsidian/trash', trashDirs[0]!, 'b.md'), 'utf8')).toBe('# b\n');

    // 모두 수렴하면 더는 할 일이 없다
    expect((await syncOnce(a.deps(drive))).plan.ops).toEqual([]);
    expect((await syncOnce(b.deps(drive))).plan.ops).toEqual([]);
  });
});
