/**
 * 동기화 엔진용 상태 저장소 — 기록은 SQLite(`entries`/`meta`), 3-way 병합용 base 스냅샷은 파일.
 *
 * base 는 동기화 대상이 아니라 기기 로컬 캐시라서 볼트 밖(`baseDir`)에 상대 경로 그대로 둔다.
 * 경로는 `..`/절대 경로 탈출을 거부한다.
 */

import { mkdirSync } from 'node:fs';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { PathEscapeError, atomicWrite } from '@nopsidian/core';
import type { SyncEntry, SyncPath, SyncState } from '@nopsidian/sync-gdrive/types';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS entries (
  path TEXT PRIMARY KEY,
  drive_id TEXT NOT NULL,
  hash TEXT NOT NULL,
  revision TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

interface EntryRow {
  path: string;
  drive_id: string;
  hash: string;
  revision: string;
}

/** 경로순 비교(코드 유닛 기준, 로케일 무관) — SQL 대신 JS 로 정렬해 메모리 구현과 순서를 맞춘다 */
const byPath = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export class SqliteSyncState implements SyncState {
  private readonly db: Database.Database;
  private readonly baseDir: string;
  private readonly selectEntries: Database.Statement;
  private readonly upsertEntry: Database.Statement;
  private readonly deleteEntry: Database.Statement;
  private readonly selectMeta: Database.Statement;
  private readonly upsertMeta: Database.Statement;

  constructor(opts: { dbPath: string; baseDir: string }) {
    if (opts.dbPath !== ':memory:') mkdirSync(path.dirname(opts.dbPath), { recursive: true });
    this.baseDir = opts.baseDir;
    this.db = new Database(opts.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.exec(SCHEMA);

    this.selectEntries = this.db.prepare(`SELECT path, drive_id, hash, revision FROM entries`);
    this.upsertEntry = this.db.prepare(
      `INSERT INTO entries(path, drive_id, hash, revision) VALUES(?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET
         drive_id = excluded.drive_id, hash = excluded.hash, revision = excluded.revision`,
    );
    this.deleteEntry = this.db.prepare(`DELETE FROM entries WHERE path = ?`);
    this.selectMeta = this.db.prepare(`SELECT value FROM meta WHERE key = ?`);
    this.upsertMeta = this.db.prepare(
      `INSERT INTO meta(key, value) VALUES(?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    );
  }

  async entries(): Promise<SyncEntry[]> {
    const rows = this.selectEntries.all() as EntryRow[];
    return rows
      .map((r) => ({ path: r.path, driveId: r.drive_id, hash: r.hash, revision: r.revision }))
      .sort((a, b) => byPath(a.path, b.path));
  }

  async put(entry: SyncEntry): Promise<void> {
    this.upsertEntry.run(entry.path, entry.driveId, entry.hash, entry.revision);
  }

  async remove(p: SyncPath): Promise<void> {
    this.deleteEntry.run(p);
  }

  getMeta(key: string): string | null {
    const row = this.selectMeta.get(key) as { value: string } | undefined;
    return row ? row.value : null;
  }

  setMeta(key: string, value: string): void {
    this.upsertMeta.run(key, value);
  }

  async getBase(p: SyncPath): Promise<Uint8Array | null> {
    try {
      return await fsp.readFile(this.basePath(p));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  async putBase(p: SyncPath, bytes: Uint8Array): Promise<void> {
    atomicWrite(this.basePath(p), bytes);
  }

  async removeBase(p: SyncPath): Promise<void> {
    try {
      await fsp.unlink(this.basePath(p));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; // 없어도 성공으로 본다
    }
  }

  close(): void {
    this.db.close();
  }

  /** baseDir 기준 상대 경로를 절대 경로로 풀되, 밖으로 나가면 예외. */
  private basePath(rel: SyncPath): string {
    if (rel === '' || rel.includes('\0') || path.isAbsolute(rel)) throw new PathEscapeError(rel);
    const abs = path.resolve(this.baseDir, rel);
    const back = path.relative(this.baseDir, abs);
    if (back === '' || back.startsWith('..') || path.isAbsolute(back))
      throw new PathEscapeError(rel);
    return abs;
  }
}
