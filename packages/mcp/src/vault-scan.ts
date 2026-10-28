import { accessSync, closeSync, constants, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, type Stats } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import {
  createLinkResolver,
  parseNote,
  resolveInVault,
  sha256,
  type LinkResolver,
  type ParsedNote,
  type ResolvableAlias,
  type ResolvablePage,
} from '@nopsidian/core';

/**
 * MCP 서버용 볼트 스캐너.
 *
 * 볼트(마크다운 파일 폴더)가 진실이고 SQLite 인덱스는 앱이 켜져 있을 때만 갱신되므로,
 * 앱 없이 돌아야 하는 MCP 서버는 디스크를 직접 훑어 메모리에 캐시한다(볼트 1만 개 안팎 가정).
 * 읽기 전용이고, `list()`/`get()` 이 돌려주는 객체는 캐시를 그대로 가리키므로 수정하지 않는다.
 */

export interface ScannedLink {
  target: string;
  heading?: string;
  block?: string;
  kind: 'wikilink' | 'embed' | 'md' | 'relation';
  line: number;
  /** 해석된 노트의 볼트 상대 경로, 못 찾으면 null */
  resolved: string | null;
}

export interface ScannedNote {
  /** 볼트 상대 경로(슬래시, NFC), 예 `프로젝트/Nopsidian.md` */
  path: string;
  /** 프런트매터 title → 첫 H1 → 파일명(확장자 뺀) */
  title: string;
  aliases: string[];
  /** `#` 없이, 중복 제거, 프런트매터+본문 */
  tags: string[];
  headings: { level: number; text: string; line: number }[];
  links: ScannedLink[];
  mtimeMs: number;
  size: number;
  /** 파일 내용 sha256(hex) */
  hash: string;
  /** 프런트매터 data (없으면 {}) */
  properties: Record<string, unknown>;
}

export interface SearchHit {
  path: string;
  title: string;
  score: number;
  snippet: string;
  line: number | null;
}

export interface BacklinkHit {
  path: string;
  title: string;
  line: number;
  context: string;
}

/** 노트 한 개의 본문 사본 상한(문자 기준 200KB). 그 뒤는 검색·스니펫에서 보이지 않는다. */
const MAX_BODY_CHARS = 200 * 1024;
const SEARCH_DEFAULT_LIMIT = 20;
const SEARCH_MAX_LIMIT = 100;
/** 스니펫은 첫 토큰 앞뒤로 이만큼의 글자를 담는다. */
const SNIPPET_RADIUS = 60;
/** 백링크 문맥 줄 길이 상한. */
const CONTEXT_MAX_CHARS = 200;
/** 캐시 형식이 바뀌면 올린다. 다르면 캐시를 버리고 전체를 다시 읽는다. */
const CACHE_VERSION = 2;
/** 볼트의 `.nopsidian/` 아래에 두는 보조 캐시. 동기화 대상이 아니고, 점 폴더라 스캔에서도 빠진다. */
const CACHE_FILE = 'mcp-cache.json';

/** 캐시에 담는 노트 하나: 파싱 결과 + 검색·스니펫에 쓰는 본문 사본 */
interface CachedNote {
  note: ScannedNote;
  /** 내용 변경 시각. mtime 을 보존하는 백업·복사에서도 내용 변경을 잡는다. */
  ctimeMs: number;
  /** 본문(프런트매터 제외) 사본. 상한까지만 보관한다. */
  body: string;
  bodyLower: string;
  /** 줄 번호를 되짚기 위한 프런트매터 원문(프런트매터가 없으면 '') */
  frontmatter: string;
  /** 본문 첫 줄의 전체 파일 기준 줄 번호 - 1 (= 프런트매터가 차지한 줄 수) */
  lineBase: number;
}

/** 디스크에서 찾은 파일 하나 */
interface FoundFile {
  abs: string;
  mtimeMs: number;
  ctimeMs: number;
  size: number;
}

/** 검색 결과에 정렬 키(mtime)를 붙인 것 */
interface ScoredHit {
  hit: SearchHit;
  mtimeMs: number;
}

/** 디스크에 저장하는 링크: `resolved` 는 노트 집합이 정해진 뒤 계산하므로 캐시에는 넣지 않는다. */
type CacheLink = Omit<ScannedLink, 'resolved'>;

/** 캐시 파일의 노트 하나. 파싱 결과와 검색·스니펫에 필요한 본문 사본을 담는다. */
interface CacheEntry {
  path: string;
  mtimeMs: number;
  ctimeMs: number;
  size: number;
  title: string;
  aliases: string[];
  tags: string[];
  headings: ScannedNote['headings'];
  links: CacheLink[];
  hash: string;
  properties: Record<string, unknown>;
  /** 프런트매터를 뺀 본문(MAX_BODY_CHARS 까지) */
  body: string;
  /** 프런트매터 원문(줄 번호 계산용) */
  frontmatter: string;
}

interface CacheFile {
  version: number;
  /** 본문 보관 상한이 바뀌면 예전 캐시를 버린다 */
  bodyLimit: number;
  entries: CacheEntry[];
}

export interface VaultScannerOptions {
  /** false 면 캐시를 읽지도 쓰지도 않는다(테스트·진단용) */
  cache?: boolean;
  /** 캐시 파일 경로. 기본 `<볼트>/.nopsidian/mcp-cache.json` */
  cachePath?: string;
  /** 변경 뒤 캐시 저장까지 기다리는 시간(ms). 도구 응답 경로에서 저장을 빼기 위한 것. 기본 2000 */
  cacheSaveDelayMs?: number;
  /** 이보다 큰 캐시 파일은 읽지 않고 전체 스캔한다(기본 256MB). */
  cacheMaxBytes?: number;
}

/** 아직 저장하지 못한 스캐너. 프로세스가 정상 종료할 때 마지막으로 한 번 저장한다. */
const pendingCacheSaves = new Set<VaultScanner>();
let cacheExitFlushInstalled = false;

function trackPendingCacheSave(scanner: VaultScanner): void {
  pendingCacheSaves.add(scanner);
  if (cacheExitFlushInstalled) return;
  cacheExitFlushInstalled = true;
  const flush = () => {
    // 성공한 스캐너는 saveCache 가 스스로 뺀다. 실패한 것은 exit 에서 한 번 더 시도한다.
    for (const s of [...pendingCacheSaves]) s.flushCache();
  };
  // beforeExit 는 이벤트 루프가 빌 때, exit 는 process.exit·정상 종료 때 불린다.
  process.once('beforeExit', flush);
  process.once('exit', flush);
}

export class VaultScanner {
  private readonly root: string;
  /** 볼트 상대 경로(NFC) → 캐시 */
  private readonly notes = new Map<string, CachedNote>();
  /** 현재 리졸버의 pages (id → 경로 매핑) */
  private pages: ResolvablePage[] = [];
  private resolver: LinkResolver | null = null;
  /** 경로·제목·별칭 구성 지문 — 바뀌었을 때만 리졸버를 다시 만든다 */
  private resolutionKey = '';
  private readonly cachePath: string | null;
  private readonly cacheSaveDelayMs: number;
  private readonly cacheMaxBytes: number;
  /** 이번에 새로 파싱했거나 노트 집합이 바뀌어 캐시를 다시 써야 하는가 */
  private cacheDirty = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  /** 마지막 refresh() 결과(테스트·진단용) */
  readonly scanStats = { parsed: 0, reused: 0, cacheLoaded: 0, cacheSaved: false };

  constructor(root: string, opts: VaultScannerOptions = {}) {
    this.root = path.resolve(root);
    this.cachePath = opts.cache === false ? null : path.resolve(opts.cachePath ?? path.join(this.root, '.nopsidian', CACHE_FILE));
    this.cacheSaveDelayMs = opts.cacheSaveDelayMs ?? 2000;
    this.cacheMaxBytes = opts.cacheMaxBytes ?? 256 * 1024 * 1024;
    if (this.cachePath) this.loadCache();
  }

  /** 대기 중인 캐시 저장을 지금 실행한다(프로세스 종료·테스트용). */
  flushCache(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.cacheDirty) this.saveCache();
  }

  /** 캐시 저장을 도구 응답 경로 밖으로 미룬다. 삭제는 본문을 빨리 지우려고 바로 저장한다. */
  private scheduleCacheSave(immediate: boolean): void {
    if (!this.cachePath || !this.cacheDirty) return;
    if (immediate) {
      trackPendingCacheSave(this);
      this.flushCache();
      return;
    }
    if (this.saveTimer) return;
    trackPendingCacheSave(this);
    const timer = setTimeout(() => {
      this.saveTimer = null;
      this.saveCache();
    }, this.cacheSaveDelayMs);
    (timer as { unref?: () => void }).unref?.();
    this.saveTimer = timer;
  }

  /** 캐시가 있으면 메모리에 올린다. 없거나 깨졌으면 조용히 전체 스캔으로 돌아간다. */
  private loadCache(): void {
    if (!this.cachePath) return;
    let raw: string;
    try {
      if (statSync(this.cachePath).size > this.cacheMaxBytes) {
        this.cacheDirty = true; // 너무 큰 캐시는 읽지 않고 전체 스캔한다
        return;
      }
      raw = readFileSync(this.cachePath, 'utf8');
    } catch {
      return; // 캐시 없음
    }
    const entries = parseCacheFile(raw);
    if (!entries) {
      this.cacheDirty = true; // 깨졌거나 버전이 다르면 전체 스캔 후 새로 쓴다
      return;
    }
    for (const [rel, entry] of entries) this.notes.set(rel, entry);
    this.scanStats.cacheLoaded = entries.size;
  }

  /** 이번 스캔 결과를 원자적으로 캐시에 쓴다. `.nopsidian/`에 쓸 수 없으면 조용히 넘어간다. */
  private saveCache(): void {
    if (!this.cachePath || !this.cacheDirty) return;
    // `.nopsidian` 이 없거나 읽기 전용이면 여기서 빨리 실패하고, 캐시 없이 지금처럼 동작한다.
    // cacheDirty 를 남겨 두어 다음 refresh(또는 종료 flush)에서 다시 시도한다.
    if (!existsSync(this.root)) return; // 없는 볼트 폴더를 캐시가 만들지 않게 한다
    try {
      const dir = path.dirname(this.cachePath);
      mkdirSync(dir, { recursive: true });
      accessSync(dir, constants.W_OK); // 읽기 전용이면 큰 JSON 을 만들기 전에 실패한다
      const entries = [...this.notes.values()].sort((a, b) => compareStrings(a.note.path, b.note.path)).map(toCacheEntry);
      const data = JSON.stringify({ version: CACHE_VERSION, bodyLimit: MAX_BODY_CHARS, entries } satisfies CacheFile);
      if (Buffer.byteLength(data, 'utf8') > this.cacheMaxBytes) {
        this.cacheDirty = false; // 상한을 넘는 캐시는 쓰지 않는다(다음 실행도 전체 스캔)
        pendingCacheSaves.delete(this);
        return;
      }
      // 같은 파일을 쓰는 서버가 둘 이상이어도 각자 다른 임시 파일을 쓴 뒤 rename 하므로 반쯤 쓴 JSON 이 보이지 않는다.
      const tmp = `${this.cachePath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
      try {
        const fd = openSync(tmp, 'w', 0o600); // 노트 본문이 들어가므로 소유자만 읽게 한다
        try {
          writeFileSync(fd, data);
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
        renameSync(tmp, this.cachePath);
      } catch (e) {
        try {
          unlinkSync(tmp);
        } catch {
          /* 이미 없으면 무시 */
        }
        throw e;
      }
      this.cacheDirty = false;
      this.scanStats.cacheSaved = true;
      pendingCacheSaves.delete(this);
    } catch {
      // 일시 오류(Windows rename EPERM/EBUSY 등)는 다음 refresh 에서 다시 시도한다.
    }
  }

  /**
   * 디스크를 훑어 캐시를 맞춘다. mtime+size+ctime 이 같은 파일은 다시 읽지 않고, 사라진 파일은 캐시에서 뺀다.
   * 노트 집합(경로·제목·별칭)이 바뀌면 링크 리졸버를 다시 만들고 모든 링크를 다시 해석한다.
   */
  refresh(): void {
    this.scanStats.parsed = 0;
    this.scanStats.reused = 0;
    this.scanStats.cacheSaved = false;
    const found = walkMarkdownFiles(this.root);
    let changed = false;
    let removed = false;
    for (const rel of [...this.notes.keys()]) {
      if (!found.has(rel)) {
        this.notes.delete(rel);
        changed = true;
        removed = true;
      }
    }

    const reparsed: string[] = [];
    for (const [rel, file] of found) {
      const cached = this.notes.get(rel);
      if (cached && cached.note.mtimeMs === file.mtimeMs && cached.ctimeMs === file.ctimeMs && cached.note.size === file.size) {
        this.scanStats.reused++;
        continue;
      }
      const entry = readNote(rel, file);
      if (entry) {
        this.notes.set(rel, entry);
        reparsed.push(rel);
        this.scanStats.parsed++;
        changed = true;
      } else {
        // 읽을 수 없는 파일은 조용히 캐시에서 뺀다
        if (this.notes.delete(rel)) {
          changed = true;
          removed = true;
        }
      }
    }

    const entries = [...this.notes.values()].sort((a, b) => compareStrings(a.note.path, b.note.path));
    const pages: ResolvablePage[] = entries.map((cached, id) => ({ id, path: cached.note.path, title: cached.note.title }));
    const aliases: ResolvableAlias[] = [];
    entries.forEach((cached, id) => {
      for (const alias of cached.note.aliases) if (alias) aliases.push({ pageId: id, alias });
    });

    const key = resolutionKeyOf(pages, aliases);
    if (key !== this.resolutionKey || !this.resolver) {
      this.pages = pages;
      this.resolver = createLinkResolver(pages, aliases);
      this.resolutionKey = key;
      for (const cached of this.notes.values()) resolveLinks(this.resolver, this.pages, cached);
    } else {
      // 해석 입력이 그대로면 이번에 새로 파싱한 노트의 링크만 계산하면 된다.
      for (const rel of reparsed) {
        const cached = this.notes.get(rel);
        if (cached) resolveLinks(this.resolver, this.pages, cached);
      }
    }
    if (changed) this.cacheDirty = true;
    if (this.cacheDirty) this.scheduleCacheSave(removed);
  }

  /** 경로 정렬된 노트 목록. folder(하위 포함)·tag 로 거르기 */
  list(opts: { folder?: string; tag?: string } = {}): ScannedNote[] {
    const folder = normalizeFolder(opts.folder);
    const tag = normalizeTag(opts.tag);
    const out: ScannedNote[] = [];
    for (const cached of this.notes.values()) {
      if (folder !== null && !inFolder(cached.note.path, folder)) continue;
      if (tag !== null && !hasTag(cached.note.tags, tag)) continue;
      out.push(cached.note);
    }
    return out.sort((a, b) => compareStrings(a.path, b.path));
  }

  get(p: string): ScannedNote | undefined {
    return this.notes.get(pathKey(p))?.note;
  }

  /** 디스크에서 지금 내용을 읽는다(캐시 아님). 없거나 볼트 밖이면 null */
  read(p: string): { content: string; hash: string } | null {
    let abs: string;
    try {
      abs = resolveInVault(this.root, p.normalize('NFC'));
    } catch {
      return null; // 볼트 밖 경로(PathEscapeError)이거나 볼트 루트가 없음
    }
    try {
      const content = readFileSync(abs, 'utf8');
      return { content, hash: sha256(content) };
    } catch {
      return null; // 없거나 디렉터리라서 못 읽음
    }
  }

  /**
   * 질의를 공백으로 나눈 토큰이 모두 (제목+별칭+태그+제목들+본문) 소문자 텍스트에 부분 문자열로 있어야 하고(AND),
   * 점수는 토큰마다 제목 +10, 별칭 +6, 태그 +4, 제목들 +3, 본문 등장(최대 5회) +1 씩 더한다.
   * 동점이면 mtime 최신, 그다음 경로. 빈 질의는 빈 배열.
   */
  search(query: string, opts: { folder?: string; tag?: string; limit?: number } = {}): SearchHit[] {
    const tokens = query.toLowerCase().split(/\s+/).filter((t) => t.length > 0);
    if (tokens.length === 0) return [];
    const limit = clampLimit(opts.limit);
    const folder = normalizeFolder(opts.folder);
    const tag = normalizeTag(opts.tag);

    const scored: ScoredHit[] = [];
    for (const cached of this.notes.values()) {
      if (folder !== null && !inFolder(cached.note.path, folder)) continue;
      if (tag !== null && !hasTag(cached.note.tags, tag)) continue;
      const score = scoreNote(cached, tokens);
      if (score === null) continue;
      const { snippet, line } = snippetFor(cached, tokens[0]!);
      const hit: SearchHit = { path: cached.note.path, title: cached.note.title, score, snippet, line };
      scored.push({ hit, mtimeMs: cached.note.mtimeMs });
    }

    scored.sort(
      (a, b) => b.hit.score - a.hit.score || b.mtimeMs - a.mtimeMs || compareStrings(a.hit.path, b.hit.path),
    );
    return scored.slice(0, limit).map((s) => s.hit);
  }

  /** 이 노트를 가리키는 다른 노트의 링크. 자기 자신은 제외, 경로·줄 순 */
  backlinks(p: string): BacklinkHit[] {
    const target = pathKey(p);
    const out: BacklinkHit[] = [];
    for (const cached of this.notes.values()) {
      if (cached.note.path === target) continue;
      for (const link of cached.note.links) {
        if (link.resolved !== target) continue;
        out.push({
          path: cached.note.path,
          title: cached.note.title,
          line: link.line,
          context: lineText(cached, link.line),
        });
      }
    }
    return out.sort((a, b) => compareStrings(a.path, b.path) || a.line - b.line);
  }

  /** 태그별 노트 수. 개수 내림차순, 같으면 이름순. 대소문자가 다른 표기는 같은 태그로 묶는다. */
  tags(): { tag: string; count: number }[] {
    const counts = new Map<string, { tag: string; count: number }>();
    for (const cached of this.notes.values()) {
      const seen = new Set<string>(); // 한 노트는 태그당 한 번만 센다
      for (const tag of cached.note.tags) {
        const key = tag.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const current = counts.get(key);
        if (current) current.count++;
        else counts.set(key, { tag, count: 1 });
      }
    }
    return [...counts.values()].sort((a, b) => b.count - a.count || compareStrings(a.tag, b.tag));
  }
}

/** 볼트 아래 `.md` 파일을 재귀로 모은다. 점(.)으로 시작하는 이름, node_modules, 심볼릭 링크는 건너뛴다. */
function walkMarkdownFiles(root: string): Map<string, FoundFile> {
  const out = new Map<string, FoundFile>();
  const visit = (absDir: string, relDir: string): void => {
    let names: string[];
    try {
      names = readdirSync(absDir);
    } catch {
      return; // 읽을 수 없는 폴더는 조용히 건너뛴다
    }
    for (const name of names) {
      if (name.startsWith('.') || name === 'node_modules') continue;
      const abs = path.join(absDir, name);
      const stat = lstatOrNull(abs);
      if (!stat) continue;
      if (stat.isSymbolicLink()) continue; // 심볼릭 링크는 따라가지 않는다(루프·볼트 밖 유입 방지)
      const nfc = name.normalize('NFC');
      const rel = relDir ? `${relDir}/${nfc}` : nfc;
      if (stat.isDirectory()) {
        visit(abs, rel);
        continue;
      }
      if (!stat.isFile() || !isMarkdown(name)) continue;
      out.set(rel, { abs, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, size: stat.size });
    }
  };
  visit(root, '');
  return out;
}

function lstatOrNull(p: string): Stats | null {
  try {
    return lstatSync(p);
  } catch {
    return null;
  }
}

function readNote(rel: string, file: FoundFile): CachedNote | null {
  let content: string;
  try {
    content = readFileSync(file.abs, 'utf8');
  } catch {
    return null;
  }
  let parsed: ParsedNote;
  try {
    parsed = parseNote(content);
  } catch {
    return null; // 파서가 던지는 파일은 조용히 건너뛴다
  }
  const note = buildNote(rel, file, content, parsed);

  const frontmatterEnd = parsed.frontmatter?.end ?? 0;
  const frontmatter = content.slice(0, frontmatterEnd);
  const body = content.slice(frontmatterEnd, frontmatterEnd + MAX_BODY_CHARS);
  return { note, ctimeMs: file.ctimeMs, body, bodyLower: body.toLowerCase(), frontmatter, lineBase: countNewlines(frontmatter) };
}

function buildNote(rel: string, file: { mtimeMs: number; size: number }, content: string, parsed: ParsedNote): ScannedNote {
  const meta = parsed.meta;
  const tags: string[] = [];
  const seenTags = new Set<string>();
  for (const t of meta.tags) {
    const tag = t.tag.trim();
    if (!tag || seenTags.has(tag)) continue;
    seenTags.add(tag);
    tags.push(tag);
  }

  const links: ScannedLink[] = meta.links.map((link) => {
    const scanned: ScannedLink = {
      target: link.target,
      kind: link.kind,
      line: link.line,
      resolved: null, // refresh() 에서 채운다
    };
    if (link.heading !== undefined) scanned.heading = link.heading;
    if (link.block !== undefined) scanned.block = link.block;
    return scanned;
  });

  return {
    path: rel,
    title: meta.title || path.posix.basename(rel, path.posix.extname(rel)),
    aliases: [...meta.aliases],
    tags,
    headings: meta.headings.map((h) => ({ level: h.level, text: h.text, line: h.line })),
    links,
    mtimeMs: file.mtimeMs,
    size: file.size,
    hash: sha256(content),
    properties: parsed.frontmatter?.data ?? {},
  };
}

function resolveLinks(resolver: LinkResolver, pages: ResolvablePage[], cached: CachedNote): void {
  for (const link of cached.note.links) {
    const id = resolver(link.target, cached.note.path);
    link.resolved = id === undefined ? null : (pages[id]?.path ?? null);
  }
}

/** 리졸버 재생성 여부를 판단하는 지문: 순서대로 나열한 (경로, 제목) + (pageId, 별칭) */
function resolutionKeyOf(pages: ResolvablePage[], aliases: ResolvableAlias[]): string {
  const parts = pages.map((p) => `${p.path}\u0000${p.title}`);
  for (const a of aliases) parts.push(`${a.pageId}\u0000${a.alias}`);
  return parts.join('\u0001');
}

/** 캐시에 쓸 형태로 바꾼다. `resolved` 는 노트 집합이 정해질 때 다시 계산한다. */
function toCacheEntry(cached: CachedNote): CacheEntry {
  const { note } = cached;
  return {
    path: note.path,
    mtimeMs: note.mtimeMs,
    ctimeMs: cached.ctimeMs,
    size: note.size,
    title: note.title,
    aliases: note.aliases,
    tags: note.tags,
    headings: note.headings,
    links: note.links.map((link) => {
      const out: CacheLink = { target: link.target, kind: link.kind, line: link.line };
      if (link.heading !== undefined) out.heading = link.heading;
      if (link.block !== undefined) out.block = link.block;
      return out;
    }),
    hash: note.hash,
    properties: note.properties,
    body: cached.body,
    frontmatter: cached.frontmatter,
  };
}

/** 캐시 파일 전체를 읽는다. 형식·버전이 다르거나 한 항목이라도 깨졌으면 null(전체 스캔). */
function parseCacheFile(raw: string): Map<string, CachedNote> | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data) || data.version !== CACHE_VERSION || data.bodyLimit !== MAX_BODY_CHARS || !Array.isArray(data.entries)) return null;
  const out = new Map<string, CachedNote>();
  for (const rawEntry of data.entries) {
    const entry = parseCacheEntry(rawEntry);
    if (!entry) return null;
    if (out.has(entry.note.path)) return null;
    out.set(entry.note.path, entry);
  }
  return out;
}

function parseCacheEntry(raw: unknown): CachedNote | null {
  if (!isRecord(raw)) return null;
  const rel = raw.path;
  if (typeof rel !== 'string' || !isVaultNotePath(rel)) return null;
  const { mtimeMs, ctimeMs, size, title, hash, body, frontmatter } = raw;
  if (typeof mtimeMs !== 'number' || !Number.isFinite(mtimeMs) || mtimeMs < 0) return null;
  if (typeof ctimeMs !== 'number' || !Number.isFinite(ctimeMs) || ctimeMs < 0) return null;
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) return null;
  if (typeof title !== 'string' || typeof hash !== 'string' || typeof body !== 'string' || typeof frontmatter !== 'string') return null;
  const aliases = raw.aliases;
  const tags = raw.tags;
  if (!isStringArray(aliases) || !isStringArray(tags)) return null;
  if (!isRecord(raw.properties)) return null;
  const headings = parseCacheHeadings(raw.headings);
  if (!headings) return null;
  const links = parseCacheLinks(raw.links);
  if (!links) return null;

  const keptBody = body.slice(0, MAX_BODY_CHARS);
  return {
    note: { path: rel, title, aliases, tags, headings, links, mtimeMs, size, hash, properties: raw.properties },
    ctimeMs,
    body: keptBody,
    bodyLower: keptBody.toLowerCase(),
    frontmatter,
    lineBase: countNewlines(frontmatter),
  };
}

function parseCacheHeadings(raw: unknown): ScannedNote['headings'] | null {
  if (!Array.isArray(raw)) return null;
  const out: ScannedNote['headings'] = [];
  for (const h of raw) {
    if (!isRecord(h) || typeof h.level !== 'number' || !Number.isInteger(h.level) || typeof h.text !== 'string' || typeof h.line !== 'number' || !Number.isInteger(h.line)) {
      return null;
    }
    out.push({ level: h.level, text: h.text, line: h.line });
  }
  return out;
}

function parseCacheLinks(raw: unknown): ScannedLink[] | null {
  if (!Array.isArray(raw)) return null;
  const out: ScannedLink[] = [];
  for (const l of raw) {
    if (!isRecord(l) || typeof l.target !== 'string' || typeof l.line !== 'number' || !Number.isInteger(l.line)) return null;
    if (l.kind !== 'wikilink' && l.kind !== 'embed' && l.kind !== 'md' && l.kind !== 'relation') return null;
    if (l.heading !== undefined && typeof l.heading !== 'string') return null;
    if (l.block !== undefined && typeof l.block !== 'string') return null;
    const link: ScannedLink = { target: l.target, kind: l.kind, line: l.line, resolved: null };
    if (l.heading !== undefined) link.heading = l.heading;
    if (l.block !== undefined) link.block = l.block;
    out.push(link);
  }
  return out;
}

function isVaultNotePath(rel: string): boolean {
  if (!rel || rel.includes('\0') || rel.normalize('NFC') !== rel || rel.includes('\\') || path.isAbsolute(rel) || /^[A-Za-z]:/.test(rel) || !rel.toLowerCase().endsWith('.md')) return false;
  return rel.split('/').every((part) => part !== '' && part !== '.' && part !== '..' && !part.startsWith('.'));
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** 모든 토큰이 어딘가에 있어야 점수를 낸다(없으면 null). 본문은 캐시해 둔 소문자 본문을 쓴다. */
function scoreNote(cached: CachedNote, tokens: string[]): number | null {
  const note = cached.note;
  const title = note.title.toLowerCase();
  const aliases = note.aliases.map((a) => a.toLowerCase());
  const tags = note.tags.map((t) => t.toLowerCase());
  const headings = note.headings.map((h) => h.text.toLowerCase());

  let score = 0;
  for (const token of tokens) {
    let found = false;
    if (title.includes(token)) {
      score += 10;
      found = true;
    }
    if (aliases.some((a) => a.includes(token))) {
      score += 6;
      found = true;
    }
    if (tags.some((t) => t.includes(token))) {
      score += 4;
      found = true;
    }
    if (headings.some((h) => h.includes(token))) {
      score += 3;
      found = true;
    }
    const inBody = countOccurrences(cached.bodyLower, token);
    if (inBody > 0) {
      score += inBody; // 등장 횟수만큼(최대 5회) +1
      found = true;
    }
    if (!found) return null;
  }
  return score;
}

/** 최대 5까지만 센다(점수 상한과 같은 이유). */
function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let at = haystack.indexOf(needle);
  while (at !== -1 && count < 5) {
    count++;
    at = haystack.indexOf(needle, at + 1);
  }
  return count;
}

/**
 * 첫 토큰이 본문에서 처음 나온 자리의 앞뒤 60자. 줄바꿈은 공백으로 바꾸고, 잘린 쪽에 `…` 를 붙인다.
 * 본문에 없으면 제목을 쓰고 줄 번호는 null.
 */
function snippetFor(cached: CachedNote, token: string): { snippet: string; line: number | null } {
  const at = cached.bodyLower.indexOf(token);
  if (at < 0) return { snippet: cached.note.title, line: null };
  const start = Math.max(0, at - SNIPPET_RADIUS);
  const end = Math.min(cached.body.length, at + token.length + SNIPPET_RADIUS);
  let snippet = cached.body.slice(start, end).replace(/\r?\n/g, ' ');
  if (start > 0) snippet = `…${snippet}`;
  if (end < cached.body.length) snippet = `${snippet}…`;
  return { snippet, line: cached.lineBase + 1 + countNewlines(cached.body.slice(0, at)) };
}

/** 전체 파일 기준 줄 번호의 줄 텍스트(트림, 최대 200자). 모자라면 빈 문자열. */
function lineText(cached: CachedNote, line: number): string {
  const text = (cached.frontmatter + cached.body).split('\n')[line - 1] ?? '';
  return text.trim().slice(0, CONTEXT_MAX_CHARS);
}

/** limit 은 1~100 으로 자른다(기본 20). 숫자가 아니면 기본값. */
function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return SEARCH_DEFAULT_LIMIT;
  return Math.min(SEARCH_MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

/** 경로·이름 비교는 로케일과 무관하게 코드 유닛 기준으로 한다(테스트·플랫폼 간에 결과가 같도록). */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const isMarkdown = (name: string): boolean => name.toLowerCase().endsWith('.md');

/** 조회용 경로 키: NFC 로 정규화하고 맨 앞의 `./`·`/` 를 뗀다. */
const pathKey = (p: string): string => p.normalize('NFC').replace(/^\.?\//, '');

/** folder 필터: 빈 문자열·`'.'` 는 전체, 그 밖에는 그 폴더 하위(폴더 자체는 제외)만. */
function normalizeFolder(folder: string | undefined): string | null {
  if (folder === undefined) return null;
  const trimmed = folder.normalize('NFC').replace(/\/+$/, '').replace(/^\.\//, '');
  return trimmed === '' || trimmed === '.' ? null : trimmed;
}

const inFolder = (notePath: string, folder: string): boolean => notePath.startsWith(`${folder}/`);

/** tag 필터: 앞의 `#` 무시, 대소문자 무시. 중첩 태그 `a/b` 는 `a` 로도 걸린다. */
function normalizeTag(tag: string | undefined): string | null {
  if (tag === undefined) return null;
  const trimmed = tag.trim().replace(/^#/, '').toLowerCase();
  return trimmed === '' ? null : trimmed;
}

function hasTag(tags: readonly string[], filter: string): boolean {
  return tags.some((tag) => {
    const lower = tag.toLowerCase();
    return lower === filter || lower.startsWith(`${filter}/`);
  });
}

function countNewlines(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
}
