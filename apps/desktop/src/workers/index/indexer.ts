import { existsSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import Database from 'better-sqlite3';
import { buildIndexRecord, firstImage, type IndexRecord } from './index-record';
import type { ParseRequest, ParseResponse } from './parse-worker';
import { databaseRowPaths, dbFolders, listDatabases, queryDatabase, rowDatabase, type DbQueryParams } from './db-queries';
import { globalGraph, localGraph, type GlobalGraphOptions, type LocalGraphOptions } from './graph-queries';
import {
  NO_INLINE_SCAN,
  createLinkResolver,
  maskInlineCode,
  mimeFromName,
  parseNote,
} from '@nopsidian/core';

export const SCHEMA_VERSION = 5;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS pages (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  folder TEXT NOT NULL,
  mtime REAL NOT NULL,
  size INTEGER NOT NULL,
  hash TEXT NOT NULL,
  note_id TEXT,
  frontmatter TEXT,
  cover TEXT
);
CREATE INDEX IF NOT EXISTS idx_pages_path ON pages(path);
CREATE TABLE IF NOT EXISTS aliases (page_id INTEGER NOT NULL, alias TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS headings (page_id INTEGER NOT NULL, level INTEGER NOT NULL, text TEXT NOT NULL, slug TEXT NOT NULL, line INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS blocks (id TEXT, page_id INTEGER NOT NULL, type TEXT NOT NULL, parent_id TEXT, ord INTEGER NOT NULL, text TEXT, heading_level INTEGER, line_start INTEGER, line_end INTEGER);
CREATE TABLE IF NOT EXISTS links (
  src_page INTEGER NOT NULL, src_block TEXT, dst_page INTEGER, dst_raw TEXT NOT NULL,
  dst_heading TEXT, dst_block TEXT, kind TEXT NOT NULL, is_resolved INTEGER NOT NULL DEFAULT 0,
  line INTEGER
);
CREATE INDEX IF NOT EXISTS idx_links_dst ON links(dst_page);
CREATE INDEX IF NOT EXISTS idx_links_src ON links(src_page);
CREATE TABLE IF NOT EXISTS tags (page_id INTEGER NOT NULL, tag TEXT NOT NULL, source TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag);
CREATE TABLE IF NOT EXISTS assets (path TEXT PRIMARY KEY, sha256 TEXT, mime TEXT, size INTEGER);
CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(title, body, tokenize='trigram');
`;

export interface NoteRow {
  path: string;
  title: string;
  /** 프런트매터 `icon`(이모지 등 짧은 글자). 없으면 null */
  icon: string | null;
  aliases: string[];
  mtime: number;
  size: number;
}
export interface Hit {
  path: string;
  title: string;
  snippet: string;
}
/** 이 노트를 가리키는 링크 하나와, 그 링크가 놓인 블록의 문맥 */
export interface BacklinkContext {
  path: string;
  title: string;
  kind: string;
  line: number;
  snippet: string;
}
/** 이 노트가 가진 링크 하나(미해결 포함) */
export interface OutgoingLink {
  target: string;
  resolvedPath: string | null;
  kind: string;
  heading: string | null;
  block: string | null;
  line: number;
}
/** 대상 노트의 제목·별칭이 링크 없이 나온 자리 */
export interface UnlinkedMention {
  path: string;
  title: string;
  line: number;
  snippet: string;
}

interface Found {
  rel: string;
  mtime: number;
  size: number;
}

const IGNORED_DIRS = new Set(['node_modules']);

function walkFiles(root: string, include: (name: string) => boolean): Found[] {
  const out: Found[] = [];
  const visit = (dir: string) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (ent.name.startsWith('.') || IGNORED_DIRS.has(ent.name)) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) visit(full);
      else if (ent.isFile() && include(ent.name)) {
        const st = statSync(full);
        out.push({
          rel: path.relative(root, full).split(path.sep).join('/'),
          mtime: st.mtimeMs,
          size: st.size,
        });
      }
    }
  };
  visit(root);
  return out;
}

const isMarkdown = (name: string) => name.toLowerCase().endsWith('.md');

const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;

/** 블록 텍스트를 한 줄로 정리하고 160자를 넘으면 자른다(문맥 미리보기용). */
function cleanSnippet(text: string | null | undefined): string {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  const chars = [...flat];
  return chars.length > 160 ? `${chars.slice(0, 160).join('')}…` : flat;
}

/** 위키링크·임베드·마크다운 링크 구간을 같은 길이의 공백으로 가린다(인라인 코드는 파서와 같은 규칙). */
function maskLinkedSpans(src: string): string {
  const blank = (m: string) => ' '.repeat(m.length);
  return maskInlineCode(src)
    .replace(/!?\[\[[^[\]\n]*\]\]/g, blank)
    .replace(/!?\[[^[\]\n]*\]\([^()\n]*\)/g, blank);
}

/**
 * 멘션 판정 정규식: 앞은 시작이나 글자·숫자가 아닌 문자, 뒤는 끝이나 글자·숫자가 아닌 문자 또는 한글(조사).
 * 대소문자는 구분하지 않는다.
 */
function mentionRe(term: string): RegExp {
  const escaped = term.replace(REGEX_SPECIALS, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?!(?!\\p{Script=Hangul})[\\p{L}\\p{N}])`, 'iu');
}

/** 볼트 안의 .md 파일을 모은다. 점(.)으로 시작하는 폴더(.nopsidian, .git 등)는 건너뛴다. */
export const walkMarkdown = (root: string): Found[] => walkFiles(root, isMarkdown);

/** 볼트 안의 첨부(.md가 아닌 모든 파일) */
export const walkAssets = (root: string): Found[] => walkFiles(root, (n) => !isMarkdown(n) && !n.includes('.nops-tmp-'));

/** 제목 우선순위: 프런트매터 title → 첫 H1 → 파일명 */
export function deriveTitle(rel: string, content: string): string {
  return parseNote(content).meta.title || path.posix.basename(rel, path.posix.extname(rel));
}

export { firstImage };

export class Indexer {
  readonly db: Database.Database;
  private resolveDirty = true;
  /** 인덱스 내용이 바뀔 때마다 늘어난다(계산 결과 캐시의 키) */
  generation = 0;

  constructor(
    private readonly root: string,
    dbPath = path.join(root, '.nopsidian', 'index.sqlite'),
  ) {
    if (dbPath !== ':memory:') mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.init();
  }

  /** 자주 쓰는 SQL 은 한 번만 준비해 재사용한다(1만 개를 색인하면 준비만 수십만 번이라 비용이 크다). */
  private readonly stmtCache = new Map<string, Database.Statement<unknown[]>>();
  private st(sql: string) {
    let s = this.stmtCache.get(sql);
    if (!s) {
      s = this.db.prepare<unknown[]>(sql);
      this.stmtCache.set(sql, s);
    }
    return s;
  }

  /** 인덱스는 파생 데이터이므로 스키마 버전이 다르면 마이그레이션 대신 비우고 재구축한다. */
  private init() {
    let current: string | undefined;
    try {
      current = (
        this.db.prepare(`SELECT value FROM meta WHERE key='schema_version'`).get() as
          | { value: string }
          | undefined
      )?.value;
    } catch {
      current = undefined;
    }
    if (current !== undefined && current !== String(SCHEMA_VERSION)) {
      const tables = this.db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
        .all() as { name: string }[];
      for (const t of tables) this.db.exec(`DROP TABLE IF EXISTS "${t.name}"`);
    }
    this.db.exec(SCHEMA);
    this.db
      .prepare(`INSERT OR REPLACE INTO meta(key,value) VALUES('schema_version', ?)`)
      .run(String(SCHEMA_VERSION));
  }

  /** 디스크와 인덱스를 견줘 새로 읽어야 할 파일을 고른다 */
  private plan() {
    const found = walkMarkdown(this.root);
    const known = new Map(
      (
        this.db.prepare(`SELECT path, mtime, size FROM pages`).all() as { path: string; mtime: number; size: number }[]
      ).map((r) => [r.path, r]),
    );
    const todo = found.filter((f) => {
      const k = known.get(f.rel);
      return !k || k.mtime !== f.mtime || k.size !== f.size;
    });
    return { found, known, todo };
  }

  /** 스캔의 마무리: 사라진 파일 정리, 링크 해석, 첨부 목록, (대량이면) 메모리 반환 */
  private finishScan(found: { rel: string }[], known: Map<string, unknown>, changed: number) {
    const seen = new Set(found.map((f) => f.rel));
    let removed = 0;
    for (const p of known.keys()) {
      if (!seen.has(p)) {
        this.removeFile(p);
        removed++;
      }
    }
    this.resolveLinks();
    this.syncAssets();
    if (changed > 500) {
      // 대량 인덱싱 뒤에는 WAL 을 비우고 SQLite 가 쥔 캐시를 돌려준다
      this.db.pragma('wal_checkpoint(TRUNCATE)');
      this.db.pragma('shrink_memory');
    }
    return { changed, removed };
  }

  /** mtime+size가 같은 파일은 건너뛰고, 사라진 파일은 지운다. 바뀐 파일 수를 돌려준다. (한 스레드에서 차례로) */
  scan(onProgress?: (done: number, total: number) => void): { changed: number; removed: number } {
    const { found, known, todo } = this.plan();
    const skipped = found.length - todo.length;
    let changed = 0;
    let done = skipped;
    // 파일마다 따로 커밋하면 디스크 동기화가 파일 수만큼 일어난다 → 250개씩 묶어 커밋한다
    let pending = 0;
    const commit = () => {
      if (this.db.inTransaction) this.db.exec('COMMIT');
      pending = 0;
    };
    try {
      for (const f of todo) {
        if (!this.db.inTransaction) this.db.exec('BEGIN');
        if (this.indexFile(f.rel)) changed++;
        if (++pending >= 250) commit();
        onProgress?.(++done, found.length);
      }
    } finally {
      commit();
    }
    if (!todo.length) onProgress?.(found.length, found.length);
    return this.finishScan(found, known, changed);
  }

  /**
   * `scan` 과 같은 일을 하되, 파일이 많으면(기본 400개 이상) 파싱을 여러 스레드에 나눠 맡긴다.
   * 파싱이 색인 시간의 절반 넘게 차지하고, 파싱 쓰레기는 스레드가 끝나면 통째로 운영체제에 돌아간다.
   * 파서 스레드 파일이 없거나(테스트) 스레드가 실패하면 `scan` 으로 마저 처리한다.
   */
  async scanParallel(
    onProgress?: (done: number, total: number) => void,
    opts: { workerFile?: string; threads?: number; threshold?: number } = {},
  ): Promise<{ changed: number; removed: number }> {
    const { found, known, todo } = this.plan();
    const workerFile = opts.workerFile ?? path.join(__dirname, 'parse-worker.cjs');
    if (todo.length < (opts.threshold ?? 400) || !existsSync(workerFile)) return this.scan(onProgress);

    const threads = Math.max(1, Math.min(opts.threads ?? 4, os.cpus().length - 1, Math.ceil(todo.length / 64)));
    const BATCH = 64;
    const batches: string[][] = [];
    for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH).map((f) => f.rel));
    const workers = Array.from({ length: threads }, () => new Worker(workerFile, { resourceLimits: { maxOldGenerationSizeMb: 192 } }));
    let changed = 0;
    let done = found.length - todo.length;
    let next = 0;
    try {
      await new Promise<void>((resolve, reject) => {
        let finished = 0;
        const dispatch = (w: Worker) => {
          if (next < batches.length) {
            const id = next++;
            w.postMessage({ id, root: this.root, rels: batches[id]! } satisfies ParseRequest);
          }
        };
        for (const w of workers) {
          w.on('error', reject);
          w.on('message', (res: ParseResponse) => {
            try {
              this.db.exec('BEGIN');
              try {
                res.records.forEach((rec, i) => {
                  if (rec) {
                    this.writeRecord(rec);
                    changed++;
                  } else this.removeFile(batches[res.id]![i]!);
                });
                this.db.exec('COMMIT');
              } catch (e) {
                if (this.db.inTransaction) this.db.exec('ROLLBACK');
                throw e;
              }
              done += res.records.length;
              onProgress?.(done, found.length);
              dispatch(w);
              if (++finished === batches.length) resolve();
            } catch (e) {
              reject(e);
            }
          });
          dispatch(w);
        }
      });
    } catch {
      // 스레드 문제(메모리 한도 등)는 한 스레드 스캔으로 이어서 한다. 이미 쓴 파일은 mtime 이 같아 건너뛴다.
      await Promise.all(workers.map((w) => w.terminate().catch(() => undefined)));
      return this.scan(onProgress);
    }
    await Promise.all(workers.map((w) => w.terminate().catch(() => undefined)));
    onProgress?.(found.length, found.length);
    return this.finishScan(found, known, changed);
  }

  /** 첨부 목록을 디스크와 맞춘다(경로·크기만 저장 — 내용 해시는 저장할 때만 필요하다). */
  syncAssets() {
    this.generation++;
    const found = walkAssets(this.root);
    const known = new Set(
      (this.db.prepare(`SELECT path FROM assets`).all() as { path: string }[]).map((r) => r.path),
    );
    const upsert = this.db.prepare(
      `INSERT INTO assets(path, sha256, mime, size) VALUES(?, NULL, ?, ?)
       ON CONFLICT(path) DO UPDATE SET mime=excluded.mime, size=excluded.size`,
    );
    this.db.transaction(() => {
      const seen = new Set<string>();
      for (const f of found) {
        seen.add(f.rel);
        upsert.run(f.rel, mimeFromName(f.rel), f.size);
      }
      for (const p of known) if (!seen.has(p)) this.db.prepare(`DELETE FROM assets WHERE path=?`).run(p);
    })();
  }

  /** 첨부 하나의 변화를 반영한다. 파일이 없으면 지우고 false. */
  syncAssetFile(rel: string): boolean {
    this.generation++;
    try {
      const st = statSync(path.join(this.root, rel));
      if (!st.isFile()) throw new Error('not a file');
      this.db
        .prepare(
          `INSERT INTO assets(path, sha256, mime, size) VALUES(?, NULL, ?, ?)
           ON CONFLICT(path) DO UPDATE SET mime=excluded.mime, size=excluded.size`,
        )
        .run(rel, mimeFromName(rel), st.size);
      return true;
    } catch {
      this.db.prepare(`DELETE FROM assets WHERE path=?`).run(rel);
      return false;
    }
  }

  listAssets(): { path: string; size: number }[] {
    return this.db.prepare(`SELECT path, size FROM assets ORDER BY path COLLATE NOCASE`).all() as {
      path: string;
      size: number;
    }[];
  }

  /** 단일 파일 (재)인덱싱. 파일이 없으면 제거하고 false. */
  indexFile(rel: string): boolean {
    const rec = buildIndexRecord(this.root, rel);
    if (!rec) {
      this.removeFile(rel);
      return false;
    }
    this.writeRecord(rec);
    return true;
  }

  /** 파싱이 끝난 레코드를 SQLite 에 쓴다(페이지·FTS·제목·블록·태그·링크). */
  writeRecord(rec: IndexRecord) {
    this.db.transaction(() => {
      const existing = this.st(`SELECT id FROM pages WHERE path=?`).get(rec.rel) as { id: number } | undefined;
      let id: number;
      if (existing) {
        id = existing.id;
        this.st(`UPDATE pages SET title=?, folder=?, mtime=?, size=?, hash=?, note_id=?, frontmatter=?, cover=? WHERE id=?`).run(
          rec.title, rec.folder, rec.mtime, rec.size, rec.hash, rec.noteId, rec.frontmatter, rec.cover, id,
        );
        this.clearDerived(id);
      } else {
        id = Number(
          this.st(`INSERT INTO pages(path,title,folder,mtime,size,hash,note_id,frontmatter,cover) VALUES(?,?,?,?,?,?,?,?,?)`).run(
            rec.rel, rec.title, rec.folder, rec.mtime, rec.size, rec.hash, rec.noteId, rec.frontmatter, rec.cover,
          ).lastInsertRowid,
        );
      }
      this.st(`INSERT INTO fts(rowid,title,body) VALUES(?,?,?)`).run(id, rec.title, rec.content);
      this.storeDerived(id, rec);
    })();
    this.resolveDirty = true;
    this.generation++;
  }

  private clearDerived(id: number) {
    for (const t of ['aliases', 'headings', 'blocks', 'tags']) this.st(`DELETE FROM ${t} WHERE page_id=?`).run(id);
    this.st(`DELETE FROM links WHERE src_page=?`).run(id);
    this.st(`DELETE FROM fts WHERE rowid=?`).run(id);
  }

  private storeDerived(id: number, rec: IndexRecord) {
    const insAlias = this.st(`INSERT INTO aliases(page_id, alias) VALUES(?,?)`);
    for (const a of rec.aliases) insAlias.run(id, a);
    const insHeading = this.st(`INSERT INTO headings(page_id, level, text, slug, line) VALUES(?,?,?,?,?)`);
    for (const h of rec.headings) insHeading.run(id, h.level, h.text, h.slug, h.line);
    const insBlock = this.st(`INSERT INTO blocks(id, page_id, type, parent_id, ord, text, heading_level, line_start, line_end) VALUES(?,?,?,NULL,?,?,?,?,?)`);
    for (const b of rec.blocks) insBlock.run(b.blockId, id, b.kind, b.index, b.text, b.headingLevel, b.lineStart, b.lineEnd);
    const insTag = this.st(`INSERT INTO tags(page_id, tag, source) VALUES(?,?,?)`);
    for (const t of rec.tags) insTag.run(id, t.tag, t.source);
    const insLink = this.st(`INSERT INTO links(src_page, src_block, dst_raw, dst_heading, dst_block, kind, line, is_resolved) VALUES(?,?,?,?,?,?,?,0)`);
    for (const l of rec.links) insLink.run(id, l.srcBlock, l.target, l.heading, l.block, l.kind, l.line);
  }

  /**
   * 링크 대상을 노트로 해석한다: 경로 정확 일치 → 파일명/제목 → 별칭 → 미해결.
   * 노트가 추가·삭제·변경될 때마다 다시 계산해야 하므로 변경이 있었을 때만 일괄 재해석한다.
   */
  resolveLinks() {
    if (!this.resolveDirty) return;
    this.resolveDirty = false;
    const pages = this.db.prepare(`SELECT id, path, title FROM pages`).all() as {
      id: number;
      path: string;
      title: string;
    }[];
    const aliases = this.db.prepare(`SELECT page_id AS pageId, alias FROM aliases`).all() as {
      pageId: number;
      alias: string;
    }[];
    const links = this.db
      .prepare(`SELECT rowid AS rid, src_page AS src, dst_raw AS raw, kind, dst_page AS cur FROM links`)
      .all() as { rid: number; src: number; raw: string; kind: string; cur: number | null }[];
    const srcPath = new Map(pages.map((p) => [p.id, p.path]));
    const resolver = createLinkResolver(pages, aliases);
    const upd = this.db.prepare(`UPDATE links SET dst_page=?, is_resolved=? WHERE rowid=?`);
    this.db.transaction(() => {
      for (const l of links) {
        // `[[#제목]]`처럼 대상이 비어 있으면 같은 노트를 가리킨다
        const dst = l.raw === '' ? l.src : resolver(l.raw, srcPath.get(l.src) ?? '');
        if ((dst ?? null) !== l.cur) upd.run(dst ?? null, dst === undefined ? 0 : 1, l.rid);
      }
    })();
  }

  removeFile(rel: string) {
    const row = this.db.prepare(`SELECT id FROM pages WHERE path=?`).get(rel) as
      | { id: number }
      | undefined;
    if (!row) return;
    this.db.transaction(() => {
      this.clearDerived(row.id);
      this.db.prepare(`DELETE FROM pages WHERE id=?`).run(row.id);
    })();
    this.resolveDirty = true;
    this.generation++;
  }

  /** 이 노트를 가리키는 링크(해석된 것만)의 경로·종류. 줄 번호·문맥은 backlinkContexts를 쓴다. */
  backlinks(rel: string): { path: string; kind: string }[] {
    this.resolveLinks();
    return this.db
      .prepare(
        `SELECT DISTINCT p.path AS path, l.kind AS kind
         FROM links l JOIN pages p ON p.id = l.src_page
         WHERE l.dst_page = (SELECT id FROM pages WHERE path=?) AND l.src_page != l.dst_page
         ORDER BY p.path`,
      )
      .all(rel) as { path: string; kind: string }[];
  }

  /** 이 노트를 가리키는 링크마다 그 링크가 놓인 블록의 문맥을 붙여 돌려준다(자기 자신 제외, path→line 순). */
  backlinkContexts(rel: string): BacklinkContext[] {
    this.resolveLinks();
    const rows = this.db
      .prepare(
        `SELECT p.path AS path, p.title AS title, l.kind AS kind, l.line AS line
         FROM links l JOIN pages p ON p.id = l.src_page
         WHERE l.dst_page = (SELECT id FROM pages WHERE path=?) AND l.src_page != l.dst_page
         ORDER BY p.path, l.line`,
      )
      .all(rel) as { path: string; title: string; kind: string; line: number }[];
    const findBlock = this.db.prepare(
      `SELECT b.text AS text FROM blocks b JOIN pages p ON p.id = b.page_id
       WHERE p.path = ? AND b.line_start <= ? AND b.line_end >= ?
       ORDER BY b.ord LIMIT 1`,
    );
    return rows.map((r) => {
      const block = findBlock.get(r.path, r.line, r.line) as { text: string | null } | undefined;
      return { ...r, snippet: cleanSnippet(block?.text) };
    });
  }

  /** 이 노트가 가진 모든 링크(미해결 포함)를 줄→대상 순으로 돌려준다. */
  outgoingLinks(rel: string): OutgoingLink[] {
    this.resolveLinks();
    return this.db
      .prepare(
        `SELECT l.dst_raw AS target, p.path AS resolvedPath, l.kind AS kind,
                l.dst_heading AS heading, l.dst_block AS block, l.line AS line
         FROM links l LEFT JOIN pages p ON p.id = l.dst_page
         WHERE l.src_page = (SELECT id FROM pages WHERE path=?)
         ORDER BY l.line, l.dst_raw`,
      )
      .all(rel) as OutgoingLink[];
  }

  /**
   * 이 노트의 제목·별칭이 다른 노트 본문에 링크 없이 글자 그대로 나온 자리(링크 안 된 언급).
   * 자기 자신·이미 이 노트로 링크한 노트·코드 블록·인라인 코드·이미 링크된 구간은 제외하고,
   * 같은 블록은 한 번만 센다(정렬 path→line, limit개까지).
   */
  unlinkedMentions(rel: string, limit = 200): UnlinkedMention[] {
    this.resolveLinks();
    const target = this.db.prepare(`SELECT id, title FROM pages WHERE path=?`).get(rel) as
      | { id: number; title: string }
      | undefined;
    // 2글자 이하 제목은 오탐이 많아 아예 찾지 않는다
    if (!target || [...target.title].length <= 2) return [];
    const aliases = this.db.prepare(`SELECT alias FROM aliases WHERE page_id=?`).all(target.id) as {
      alias: string;
    }[];
    const terms = [target.title, ...aliases.map((a) => a.alias)].filter((t) => [...t].length > 2);
    const patterns = terms.map((t) => mentionRe(t));

    const skip = new Set<number>([target.id]);
    for (const r of this.db
      .prepare(`SELECT DISTINCT src_page AS id FROM links WHERE dst_page=?`)
      .all(target.id) as { id: number }[])
      skip.add(r.id);

    // 후보 페이지는 blocks.text LIKE로 좁히고, 실제 판정은 원문을 다시 파싱해 블록 단위로 한다
    const findPages = this.db.prepare(
      `SELECT p.id AS id, p.path AS path, p.title AS title, f.body AS body
       FROM pages p JOIN fts f ON f.rowid = p.id
       WHERE p.id IN (SELECT DISTINCT page_id FROM blocks WHERE text LIKE ? ESCAPE '\\')`,
    );
    const candidates = new Map<number, { id: number; path: string; title: string; body: string }>();
    for (const term of terms) {
      const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      for (const r of findPages.all(like) as { id: number; path: string; title: string; body: string }[]) {
        candidates.set(r.id, r);
      }
    }

    const out: UnlinkedMention[] = [];
    for (const cand of candidates.values()) {
      if (skip.has(cand.id)) continue;
      const note = parseNote(cand.body);
      for (const b of note.blocks) {
        if (NO_INLINE_SCAN.has(b.kind)) continue;
        const masked = maskLinkedSpans(b.source);
        if (!patterns.some((re) => re.test(masked))) continue;
        out.push({ path: cand.path, title: cand.title, line: b.lineStart, snippet: cleanSnippet(b.text) });
      }
    }
    out.sort((a, b) => (a.path === b.path ? a.line - b.line : a.path < b.path ? -1 : 1));
    return out.slice(0, limit);
  }

  /** 노트의 블록 목록 — `[[노트#^` 자동완성용(코드·수식·HTML 제외, 텍스트는 정리해 80자까지) */
  blocksOf(rel: string): { id: string | null; text: string; line: number; type: string }[] {
    const rows = this.db
      .prepare(
        `SELECT b.id AS id, b.text AS text, b.line_start AS line, b.type AS type
         FROM blocks b JOIN pages p ON p.id = b.page_id
         WHERE p.path = ? AND b.type IN ('paragraph','heading','list','quote','callout','table')
         ORDER BY b.ord`,
      )
      .all(rel) as { id: string | null; text: string | null; line: number; type: string }[];
    return rows
      .map((r) => {
        // 목록에는 줄 끝의 ` ^id` 표기를 보이지 않는다(ID는 따로 돌려준다)
        const flat = (r.text ?? '').replace(/\s+/g, ' ').replace(/\s*\^[A-Za-z0-9-]+\s*$/, '').trim();
        return { id: r.id, text: flat.length > 80 ? `${flat.slice(0, 80)}…` : flat, line: r.line, type: r.type };
      })
      .filter((r) => r.text !== '' && !/^\^[A-Za-z0-9-]+$/.test(r.text));
  }

  /** 노트의 제목(헤딩) 목록 — `[[노트#` 자동완성용 */
  headingsOf(rel: string): { text: string; level: number; line: number }[] {
    return this.db
      .prepare(
        `SELECT h.text AS text, h.level AS level, h.line AS line FROM headings h JOIN pages p ON p.id = h.page_id
         WHERE p.path = ? ORDER BY h.line`,
      )
      .all(rel) as { text: string; level: number; line: number }[];
  }

  /** 태그와 그 하위 태그(a → a, a/b, a/b/c)를 가진 노트. 접두어만 같은 태그(ab)는 뺀다. */
  notesByTag(tag: string): { path: string; title: string }[] {
    const like = `${tag.replace(/[\\%_]/g, (c) => `\\${c}`)}/%`;
    return this.db
      .prepare(
        `SELECT DISTINCT p.path AS path, p.title AS title
         FROM tags t JOIN pages p ON p.id = t.page_id
         WHERE t.tag = ? OR t.tag LIKE ? ESCAPE '\\'
         ORDER BY p.path`,
      )
      .all(tag, like) as { path: string; title: string }[];
  }

  /** 데이터베이스(`_db.yaml` 이 있는 폴더) 목록 */
  databases() {
    return listDatabases(this.db, this.root);
  }

  databaseRowPaths(folder: string) {
    return databaseRowPaths(this.db, this.root, folder);
  }

  databaseFolders() {
    return dbFolders(this.db);
  }

  /** 데이터베이스 뷰 질의(필터·정렬·그룹·계산 행) */
  rowDatabase(notePath: string) {
    return rowDatabase(this.db, this.root, notePath, this.generation);
  }
  queryDatabase(params: DbQueryParams) {
    return queryDatabase(this.db, this.root, params, this.generation);
  }

  globalGraph(opts: GlobalGraphOptions = {}) {
    this.resolveLinks();
    return globalGraph(this.db, opts);
  }

  localGraph(rel: string, opts: LocalGraphOptions = {}) {
    this.resolveLinks();
    return localGraph(this.db, rel, opts);
  }

  unresolvedLinks(): { path: string; target: string }[] {
    this.resolveLinks();
    return this.db
      .prepare(
        `SELECT p.path AS path, l.dst_raw AS target FROM links l JOIN pages p ON p.id = l.src_page
         WHERE l.is_resolved = 0 AND l.kind IN ('wikilink','relation') ORDER BY p.path, l.dst_raw`,
      )
      .all() as { path: string; target: string }[];
  }

  tags(): { tag: string; count: number }[] {
    return this.db
      .prepare(`SELECT tag, COUNT(DISTINCT page_id) AS count FROM tags GROUP BY tag ORDER BY count DESC, tag`)
      .all() as { tag: string; count: number }[];
  }

  hashOf(rel: string): string | undefined {
    return (this.db.prepare(`SELECT hash FROM pages WHERE path=?`).get(rel) as { hash: string } | undefined)?.hash;
  }

  list(): NoteRow[] {
    const rows = this.db
      .prepare(`SELECT id, path, title, mtime, size, json_extract(frontmatter, '$.icon') AS icon FROM pages ORDER BY path COLLATE NOCASE`)
      .all() as { id: number; path: string; title: string; mtime: number; size: number; icon: unknown }[];
    const aliases = new Map<number, string[]>();
    for (const a of this.db.prepare(`SELECT page_id AS pageId, alias FROM aliases`).all() as {
      pageId: number;
      alias: string;
    }[]) {
      const list = aliases.get(a.pageId);
      if (list) list.push(a.alias);
      else aliases.set(a.pageId, [a.alias]);
    }
    return rows.map(({ id, icon, ...r }) => ({
      ...r,
      icon: typeof icon === 'string' && icon.trim() && icon.length <= 16 ? icon.trim() : null,
      aliases: aliases.get(id) ?? [],
    }));
  }

  /** 3글자 이상은 FTS5 trigram, 그보다 짧은 질의는 LIKE로 대체한다(한글 2글자 검색 등). */
  search(q: string, limit = 50): Hit[] {
    const query = q.trim();
    if (!query) return [];
    if ([...query].length >= 3) {
      const phrase = `"${query.replace(/"/g, '""')}"`;
      return this.db
        .prepare(
          `SELECT p.path AS path, p.title AS title,
                  snippet(fts, 1, '[', ']', '…', 12) AS snippet
           FROM fts JOIN pages p ON p.id = fts.rowid
           WHERE fts MATCH ? ORDER BY rank LIMIT ?`,
        )
        .all(phrase, limit) as Hit[];
    }
    const like = `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    return this.db
      .prepare(
        `SELECT p.path AS path, p.title AS title, substr(fts.body, 1, 80) AS snippet
         FROM fts JOIN pages p ON p.id = fts.rowid
         WHERE fts.title LIKE ? ESCAPE '\\' OR fts.body LIKE ? ESCAPE '\\' LIMIT ?`,
      )
      .all(like, like, limit) as Hit[];
  }

  close() {
    this.db.close();
  }
}
