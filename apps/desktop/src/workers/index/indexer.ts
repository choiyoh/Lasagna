import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  NO_INLINE_SCAN,
  createLinkResolver,
  maskInlineCode,
  mimeFromName,
  parseNote,
  type ParsedNote,
} from '@nopsidian/core';

export const SCHEMA_VERSION = 3;

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
    this.syncAssets();
    return { changed, removed };
  }

  /** 첨부 목록을 디스크와 맞춘다(경로·크기만 저장 — 내용 해시는 저장할 때만 필요하다). */
  syncAssets() {
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
      `INSERT INTO links(src_page, src_block, dst_raw, dst_heading, dst_block, kind, line, is_resolved)
       VALUES(?,?,?,?,?,?,?,0)`,
    );
    for (const l of meta.links) {
      const srcBlock = blocks.find((b) => l.line >= b.lineStart && l.line <= b.lineEnd)?.blockId ?? null;
      insLink.run(id, srcBlock, l.target, l.heading ?? null, l.block ?? null, l.kind, l.line);
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
   * 이 노트의 제목·별칭이 다른 노트 본문에 링크 없이 글자 그대로 나온 자리(언링크드 멘션).
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
      .prepare(`SELECT id, path, title, mtime, size FROM pages ORDER BY path COLLATE NOCASE`)
      .all() as { id: number; path: string; title: string; mtime: number; size: number }[];
    const aliases = new Map<number, string[]>();
    for (const a of this.db.prepare(`SELECT page_id AS pageId, alias FROM aliases`).all() as {
      pageId: number;
      alias: string;
    }[]) {
      const list = aliases.get(a.pageId);
      if (list) list.push(a.alias);
      else aliases.set(a.pageId, [a.alias]);
    }
    return rows.map(({ id, ...r }) => ({ ...r, aliases: aliases.get(id) ?? [] }));
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
