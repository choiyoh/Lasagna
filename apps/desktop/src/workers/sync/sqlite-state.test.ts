import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SyncEntry } from '@nopsidian/sync-gdrive/types';
import { SqliteSyncState } from './sqlite-state';

const utf8 = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array) => new TextDecoder().decode(b);

const entry = (p: string, over: Partial<SyncEntry> = {}): SyncEntry => ({
  path: p,
  driveId: `id-${p}`,
  hash: `hash-${p}`,
  revision: `rev-${p}`,
  ...over,
});

let dir: string;
let state: SqliteSyncState;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'nops-sync-state-'));
  state = new SqliteSyncState({
    dbPath: path.join(dir, 'db', 'sync.sqlite'),
    baseDir: path.join(dir, 'base'),
  });
});

afterEach(() => {
  try {
    state.close();
  } catch {
    // 재오픈 테스트가 이미 닫았을 수 있다
  }
  rmSync(dir, { recursive: true, force: true });
});

describe('entries', () => {
  it('경로순으로 돌려준다', async () => {
    await state.put(entry('c.md'));
    await state.put(entry('a.md'));
    await state.put(entry('한글/노트.md'));
    await expect(state.entries()).resolves.toEqual([
      entry('a.md'),
      entry('c.md'),
      entry('한글/노트.md'),
    ]);
  });

  it('같은 경로는 UPSERT 로 덮어쓴다', async () => {
    await state.put(entry('a.md'));
    await state.put(entry('a.md', { driveId: 'id-2', hash: 'hash-2', revision: 'rev-2' }));
    await expect(state.entries()).resolves.toEqual([
      { path: 'a.md', driveId: 'id-2', hash: 'hash-2', revision: 'rev-2' },
    ]);
  });

  it('remove 는 없는 경로여도 조용히 넘어간다', async () => {
    await state.put(entry('a.md'));
    await state.put(entry('b.md'));
    await state.remove('a.md');
    await state.remove('여긴.md');
    await expect(state.entries()).resolves.toEqual([entry('b.md')]);
  });
});

describe('meta', () => {
  it('없으면 null, 넣으면 갱신된다', () => {
    expect(state.getMeta('lastSync')).toBeNull();
    state.setMeta('lastSync', '2026-10-12T20:09:24Z');
    expect(state.getMeta('lastSync')).toBe('2026-10-12T20:09:24Z');
    state.setMeta('lastSync', '2026-10-12T21:00:00Z');
    expect(state.getMeta('lastSync')).toBe('2026-10-12T21:00:00Z');
  });
});

describe('base 스냅샷', () => {
  it('왕복하고, 없으면 null, 지우면 다시 null', async () => {
    await state.putBase('폴더/note.md', utf8('기준 본문'));
    expect(text((await state.getBase('폴더/note.md'))!)).toBe('기준 본문');
    expect(await state.getBase('none.md')).toBeNull();

    await state.removeBase('폴더/note.md');
    expect(await state.getBase('폴더/note.md')).toBeNull();
    await expect(state.removeBase('폴더/note.md')).resolves.toBeUndefined(); // 없는 것도 성공
  });

  it('탈출 시도는 거부한다', async () => {
    await expect(state.putBase('../밖.md', utf8('x'))).rejects.toThrow(/벗어나는/);
    await expect(state.getBase('../밖.md')).rejects.toThrow(/벗어나는/);
    await expect(state.getBase('/etc/passwd')).rejects.toThrow(/벗어나는/);
    await expect(state.removeBase('..')).rejects.toThrow(/벗어나는/);
  });
});

describe('저장', () => {
  it('DB 상위 폴더를 만든다', () => {
    expect(existsSync(path.join(dir, 'db', 'sync.sqlite'))).toBe(true);
  });

  it('닫았다 다시 열어도 기록이 남는다', async () => {
    await state.put(entry('a.md'));
    await state.putBase('a.md', utf8('기준'));
    state.setMeta('lastSync', '2026-10-12T20:09:24Z');
    state.close();

    const reopened = new SqliteSyncState({
      dbPath: path.join(dir, 'db', 'sync.sqlite'),
      baseDir: path.join(dir, 'base'),
    });
    state = reopened; // afterEach 가 새 인스턴스를 닫도록
    await expect(reopened.entries()).resolves.toEqual([entry('a.md')]);
    expect(text((await reopened.getBase('a.md'))!)).toBe('기준');
    expect(reopened.getMeta('lastSync')).toBe('2026-10-12T20:09:24Z');
  });
});
