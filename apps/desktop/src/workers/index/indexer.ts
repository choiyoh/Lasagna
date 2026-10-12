import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createLinkResolver, parseNote, type ParsedNote } from '@nopsidian/core';

export const SCHEMA_VERSION = 2;

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
  note_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_pages_path ON pages(path);
CREATE TABLE IF NOT EXISTS aliases (page_id INTEGER NOT NULL, alias TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS headings (page_id INTEGER NOT NULL, level INTEGER NOT NULL, text TEXT NOT NULL, slug TEXT NOT NULL, line INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS blocks (id TEXT, page_id INTEGER NOT NULL, type TEXT NOT NULL, parent_id TEXT, ord INTEGER NOT NULL, text TEXT, heading_level INTEGER, line_start INTEGER, line_end INTEGER);
CREATE TABLE IF NOT EXISTS links (
  src_page INTEGER NOT NULL, src_block TEXT, dst_page INTEGER, dst_raw TEXT NOT NULL,
  dst_heading TEXT, dst_block TEXT, kind TEXT NOT NULL, is_resolved INTEGER NOT NULL DEFAULT 0
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
  mtime: number;
  size: number;
}
export interface Hit {
  path: string;
  title: string;
  snippet: string;
}

interface Found {
  rel: string;
  mtime: number;
  size: number;
}

const IGNORED_DIRS = new Set(['node_modules']);

/** 볼트 안의 .md 파일을 모은다. 점(.)으로 시작하는 폴더(.nopsidian, .git 등)는 건너뛴다. */
export function walkMarkdown(root: string): Found[] {
  const out: Found[] = [];
  const visit = (dir: string) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (ent.name.startsWith('.') || IGNORED_DIRS.has(ent.name)) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) visit(full);
      else if (ent.isFile() && ent.name.toLowerCase().endsWith('.md')) {
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

/** 제목 우선순위: 프런트매터 title → 첫 H1 → 파일명 */
export function deriveTitle(rel: string, content: string): string {
  return parseNote(content).meta.title || path.posix.basename(rel, path.posix.extname(rel));
}

export class Indexer {
  readonly db: Database.Database;
  private resolveDirty = true;

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

  /** mtime+size가 같은 파일은 건너뛰고, 사라진 파일은 지운다. 바뀐 파일 수를 돌려준다. */
  scan(onProgress?: (done: number, total: number) => void): { changed: number; removed: number } {
    const found = walkMarkdown(this.root);
    const known = new Map(
      (
        this.db.prepare(`SELECT path, mtime, size FROM pages`).all() as {
          path: string;
          mtime: number;
          size: number;
        }[]
      ).map((r) => [r.path, r]),
    );
    const seen = new Set<string>();
    let changed = 0;
    let done = 0;
    for (const f of found) {
      seen.add(f.rel);
      const k = known.get(f.rel);
      if (!k || k.mtime !== f.mtime || k.size !== f.size) {
        if (this.indexFile(f.rel)) changed++;
      }
      onProgress?.(++done, found.length);
    }
    let removed = 0;
    for (const p of known.keys()) {
      if (!seen.has(p)) {
        this.removeFile(p);
        removed++;
      }
    }
    this.resolveLinks();
    return { changed, removed };
  }

  /** 단일 파일 (재)인덱싱. 파일이 없으면 제거하고 false. */
  indexFile(rel: string): boolean {
    const full = path.join(this.root, rel);
    let content: string;
    let st;
    try {
      st = statSync(full);
      content = readFileSync(full, 'utf8');
    } catch {
      this.removeFile(rel);
      return false;
    }
    const hash = createHash('sha256').update(content).digest('hex');
    const note = parseNote(content);
    const title = note.meta.title || path.posix.basename(rel, path.posix.extname(rel));
    const folder = path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel);
    this.db.transaction(() => {
      const existing = this.db.prepare(`SELECT id FROM pages WHERE path=?`).get(rel) as
        | { id: number }
        | undefined;
      let id: number;
      if (existing) {
        id = existing.id;
        this.db
          .prepare(`UPDATE pages SET title=?, folder=?, mtime=?, size=?, hash=?, note_id=? WHERE id=?`)
          .run(title, folder, st.mtimeMs, st.size, hash, note.meta.id ?? null, id);
        this.clearDerived(id);
      } else {
        id = Number(
          this.db
            .prepare(`INSERT INTO pages(path,title,folder,mtime,size,hash,note_id) VALUES(?,?,?,?,?,?,?)`)
            .run(rel, title, folder, st.mtimeMs, st.size, hash, note.meta.id ?? null).lastInsertRowid,
        );
      }
      this.db.prepare(`INSERT INTO fts(rowid,title,body) VALUES(?,?,?)`).run(id, title, content);
      this.storeDerived(id, note);
    })();
    this.resolveDirty = true;
    return true;
  }

  private clearDerived(id: number) {
    for (const t of ['aliases', 'headings', 'blocks', 'tags'])
      this.db.prepare(`DELETE FROM ${t} WHERE page_id=?`).run(id);
    this.db.prepare(`DELETE FROM links WHERE src_page=?`).run(id);
    this.db.prepare(`DELETE FROM fts WHERE rowid=?`).run(id);
  }

  private storeDerived(id: number, note: ParsedNote) {
    const { meta, blocks } = note;
    const insAlias = this.db.prepare(`INSERT INTO aliases(page_id, alias) VALUES(?,?)`);
    for (const a of meta.aliases) insAlias.run(id, a);

    const insHeading = this.db.prepare(
      `INSERT INTO headings(page_id, level, text, slug, line) VALUES(?,?,?,?,?)`,
    );
    for (const h of meta.headings) insHeading.run(id, h.level, h.text, h.slug, h.line);

    const insBlock = this.db.prepare(
      `INSERT INTO blocks(id, page_id, type, parent_id, ord, text, heading_level, line_start, line_end)
       VALUES(?,?,?,NULL,?,?,?,?,?)`,
    );
    for (const b of blocks)
      insBlock.run(b.blockId ?? null, id, b.kind, b.index, b.text, b.headingLevel ?? null, b.lineStart, b.lineEnd);

    const insTag = this.db.prepare(`INSERT INTO tags(page_id, tag, source) VALUES(?,?,?)`);
    const seen = new Set<string>();
    for (const t of meta.tags) {
      const key = `${t.tag}\0${t.source}`;
      if (seen.has(key)) continue;
      seen.add(key);
      insTag.run(id, t.tag, t.source);
    }

    const insLink = this.db.prepare(
      `INSERT INTO links(src_page, src_block, dst_raw, dst_heading, dst_block, kind, is_resolved)
       VALUES(?,?,?,?,?,?,0)`,
    );
    for (const l of meta.links) {
      const srcBlock = blocks.find((b) => l.line >= b.lineStart && l.line <= b.lineEnd)?.blockId ?? null;
      insLink.run(id, srcBlock, l.target, l.heading ?? null, l.block ?? null, l.kind);
    }
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
  }

  /** 이 노트를 가리키는 링크(해석된 것만). 줄 번호·문맥 스니펫은 3단계에서 추가한다. */
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
    return this.db
      .prepare(`SELECT path, title, mtime, size FROM pages ORDER BY path COLLATE NOCASE`)
      .all() as NoteRow[];
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
