import type { MessageKey } from '@nopsidian/i18n';
import { PolicyError } from './folders.js';
import { tr, trIn, type Params } from './i18n.js';
import { existsSync, readFileSync } from 'node:fs';
import { addComment, parseNote, resolveInVault, saveNote, sha256, splitFrontmatter, type Comment } from '@nopsidian/core';
import { stringify } from 'yaml';
import { appendAudit, type AuditEntry } from './audit.js';
import { canWrite, validateNotePath, type McpPolicy } from './policy.js';

type DenyReason = string | { key: MessageKey; params?: Params };

export type WriteErrorCode =
  | 'read-only'
  | 'forbidden-folder'
  | 'exists'
  | 'not-found'
  | 'stale'
  | 'rate-limit'
  | 'too-large'
  | 'bad-heading'
  | 'bad-input'
  | 'partial'
  | 'no-match'
  | 'ambiguous-match'
  | 'policy-disabled'
  | 'policy-invalid';

/** read_note 가 노트의 일부만 돌려줬을 때 hash 앞에 붙는 접두사 */
export const PARTIAL_HASH_PREFIX = 'partial:';

export class WriteError extends Error {
  constructor(
    readonly code: WriteErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface WriteResult {
  path: string;
  hash: string;
  bytes: number;
  /** 저장 중 파일이 바뀌어 합쳤다면 'merged' / 'conflict' */
  status: 'saved' | 'merged' | 'conflict';
}

interface TextMatch {
  start: number;
  end: number;
}

/** oldText 의 표기 변형(CRLF/LF, NFC/NFD)을 찾아 서로 같은 위치는 한 번만 센다. */
function findTextMatches(content: string, oldText: string): TextMatch[] {
  const nfc = oldText.normalize('NFC');
  const nfd = nfc.normalize('NFD');
  const variants = new Set<string>();
  const add = (text: string) => {
    if (!text) return;
    variants.add(text);
    const lf = text.replace(/\r\n/g, '\n');
    variants.add(lf);
    variants.add(lf.replace(/\n/g, '\r\n'));
  };
  add(oldText);
  add(nfc);
  if (nfd !== nfc) add(nfd);

  const found = new Map<string, TextMatch>();
  for (const text of variants) {
    let at = content.indexOf(text);
    while (at !== -1) {
      const key = `${at}:${at + text.length}`;
      if (!found.has(key)) found.set(key, { start: at, end: at + text.length });
      at = content.indexOf(text, at + 1);
    }
  }
  return [...found.values()].sort((a, b) => a.start - b.start);
}

/** 새 텍스트의 표기를 매치된 구간에 맞춘다. 구간에 NFD 한글이 없으면 NFC 를 기본으로 쓴다. */
function adaptReplacement(text: string, content: string, match: TextMatch): string {
  const matched = content.slice(match.start, match.end);
  // 매치 구간에 한글이 없으면 NFC 를 기본으로 쓴다(다른 곳의 NFD 글자에 끌려가지 않게).
  const nfd = /[\u1100-\u11FF\u3131-\u318E\uA960-\uA97F\uAC00-\uD7A3\uD7B0-\uD7FF]/.test(matched) && matched !== matched.normalize('NFC');
  let out = text.normalize(nfd ? 'NFD' : 'NFC');
  out = content.includes('\r\n') ? out.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n') : out.replace(/\r\n/g, '\n');
  return out;
}

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * 본문 끝에 `text` 를 덧붙인다. `heading` 이 있으면 그 제목 구역(같거나 높은 단계의 다음 제목 직전)의 끝에 넣는다.
 * 앞뒤는 빈 줄 하나로 띄운다.
 */
export function appendText(content: string, text: string, heading?: string): string {
  const add = text.replace(/\s+$/, '');
  if (!add) throw new WriteError('bad-input', tr('mcpW.err.emptyAppend'));
  if (!heading) {
    const base = content.replace(/\s+$/, '');
    return `${base ? `${base}\n\n` : ''}${add}\n`;
  }
  const headings = parseNote(content).meta.headings;
  const h = headings.find((x) => norm(x.text) === norm(heading));
  if (!h) {
    const list = headings.map((x) => `${'#'.repeat(x.level)} ${x.text}`).join(', ') || tr('mcpDb.noHeading');
    throw new WriteError('bad-heading', tr('mcpW.err.headingNotFound', { heading, list }));
  }
  const lines = content.split('\n');
  const next = headings.find((x) => x.line > h.line && x.level <= h.level);
  let insertAt = next ? next.line - 1 : lines.length;
  while (insertAt - 1 > h.line - 1 && lines[insertAt - 1]!.trim() === '') insertAt--;
  const after = lines.slice(insertAt);
  return [...lines.slice(0, insertAt), '', ...add.split('\n'), ...(after.length ? after : [''])].join('\n');
}

/** 새 노트 내용: (제목) + (프런트매터) + 본문 */
export function composeNote(content: string, opts: { title?: string; tags?: string[]; properties?: Record<string, unknown> }): string {
  const hasFm = splitFrontmatter(content) !== null;
  const props: Record<string, unknown> = { ...(opts.properties ?? {}) };
  const tags = (opts.tags ?? []).map((t) => t.replace(/^#/, '').trim()).filter(Boolean);
  if (tags.length) props.tags = tags;
  const wantsFm = Object.keys(props).length > 0;
  if (wantsFm && hasFm) throw new WriteError('bad-input', tr('mcpW.err.frontmatterTwice'));
  let body = content;
  if (opts.title && !hasFm && !/^\s*#\s/.test(body)) body = `# ${opts.title.trim()}\n\n${body}`;
  const fm = wantsFm ? `---\n${stringify(props)}---\n` : '';
  return `${fm}${fm ? '\n' : ''}${body.replace(/\s+$/, '')}\n`;
}

/** 에이전트의 쓰기. 정책(켜짐·폴더·횟수·크기)을 지키고, 저장은 앱과 같은 경로(역사 스냅샷·원자적 쓰기)로 하며, 모두 감사 기록에 남긴다. */
export class NoteWriter {
  private stamps: number[] = [];

  constructor(
    private policy: McpPolicy,
    private readonly client: () => string | undefined = () => undefined,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** 서버가 매 요청마다 정책 파일을 반영할 때 쓴다. */
  setPolicy(policy: McpPolicy): void {
    this.policy = policy;
  }

  create(tool: string, rawPath: string, content: string, opts: { title?: string; tags?: string[]; properties?: Record<string, unknown> } = {}): WriteResult {
    const rel = this.guard(tool, rawPath);
    if (existsSync(resolveInVault(this.policy.root, rel))) this.deny(tool, rel, 'exists', { key: 'mcpW.err.noteExistsHint', params: { path: rel } });
    const text = composeNote(content, opts);
    return this.commit(tool, 'create', rel, text, null);
  }

  append(tool: string, rawPath: string, text: string, heading?: string): WriteResult {
    const rel = this.guard(tool, rawPath);
    const disk = this.readDisk(tool, rel);
    const next = appendText(disk, text, heading);
    return this.commit(tool, 'append', rel, next, disk);
  }

  update(tool: string, rawPath: string, content: string, baseHash: string): WriteResult {
    const rel = this.guard(tool, rawPath);
    const disk = this.readDisk(tool, rel);
    // read_note 가 일부만 돌려준 경우 hash 에 "partial:" 이 붙어 있다. 낡음 검사는 전체 내용 해시로 똑같이 한다.
    const partial = baseHash.startsWith(PARTIAL_HASH_PREFIX);
    const expected = partial ? baseHash.slice(PARTIAL_HASH_PREFIX.length) : baseHash;
    if (sha256(disk) !== expected) this.deny(tool, rel, 'stale', { key: 'mcpW.err.stale' });
    const text = content.replace(/\s+$/, '') + '\n';
    // 일부만 읽고 받은 hash 로 노트를 통째로 바꾸면, 잘려 나간 뒷부분을 모르는 채 지워 버릴 수 있다.
    // 디스크에서 방금 읽은 내용보다 짧아지면 거부한다(전체를 읽고 받은 hash 는 그대로 허용 — 기존 동작).
    if (partial && text.length < disk.length) {
      this.deny(
        tool,
        rel,
        'partial',
        `You sent ${text.length} characters but the note on disk has ${disk.length}; a "partial:" hash only allows update_note when the new content is not shorter than the current note. Read all pages with read_note (follow offset/next_offset) and send the complete note, or use append_to_note.`,
      );
    }
    return this.commit(tool, 'update', rel, text, disk);
  }

  /**
   * 노트 안에서 정확히 한 번 나오는 `oldText`만 `newText`로 바꾼다.
   * CRLF/LF 와 NFC/NFD 표기가 달라도 같은 글로 보고, 파일의 표기 방식을 유지한다.
   */
  edit(tool: string, rawPath: string, oldText: string, newText: string, baseHash: string): WriteResult {
    const rel = this.guard(tool, rawPath);
    const disk = this.readDisk(tool, rel);
    const partial = baseHash.startsWith(PARTIAL_HASH_PREFIX);
    const expected = partial ? baseHash.slice(PARTIAL_HASH_PREFIX.length) : baseHash;
    if (sha256(disk) !== expected) this.deny(tool, rel, 'stale', { key: 'mcpW.err.stale' });

    const matches = findTextMatches(disk, oldText);
    if (matches.length !== 1) {
      const message =
        matches.length === 0
          ? 'old_text was not found in the note (0 occurrences). Nothing was changed.'
          : `old_text must occur exactly once in the note; found ${matches.length} occurrences. Nothing was changed.`;
      this.deny(tool, rel, matches.length === 0 ? 'no-match' : 'ambiguous-match', message);
    }
    const match = matches[0]!;
    const replacement = adaptReplacement(newText, disk, match);
    const next = `${disk.slice(0, match.start)}${replacement}${disk.slice(match.end)}`;
    return this.commit(tool, 'update', rel, next, disk);
  }

  /** 서버가 정책 파일 때문에 거부할 때 감사 기록을 남기고 던진다. */
  denyRequest(tool: string, rawPath: string, code: WriteErrorCode, reason: DenyReason): never {
    let rel = rawPath;
    try {
      rel = validateNotePath(rawPath);
    } catch {
      /* 경로가 이미 잘못됐어도 감사 기록에는 원문을 남긴다 */
    }
    this.deny(tool, rel, code, reason);
  }

  /** 이미 완성된 노트 전문을 그대로 새 노트로 쓴다(데이터베이스 행처럼 프런트매터를 직접 만든 경우). 있으면 실패. */
  createExact(tool: string, rawPath: string, text: string): WriteResult {
    const rel = this.guard(tool, rawPath);
    if (existsSync(resolveInVault(this.policy.root, rel))) this.deny(tool, rel, 'exists', { key: 'mcpW.err.noteExists', params: { path: rel } });
    return this.commit(tool, 'create', rel, text, null);
  }

  /** 기존 노트의 현재 내용을 읽어 `mutate` 로 바꾼 결과를 쓴다. 결과가 같으면 쓰지 않고 그대로 돌려준다. */
  modify(tool: string, rawPath: string, mutate: (disk: string) => string): WriteResult {
    const rel = this.guard(tool, rawPath);
    const disk = this.readDisk(tool, rel);
    const next = mutate(disk);
    if (next === disk) {
      // 파일은 건드리지 않지만 시도는 한도에 센다 — 같은 값으로 반복 호출해 볼트 재스캔을 일으키는 것을 막는다.
      this.countAttempt();
      return { path: rel, hash: sha256(disk), bytes: Buffer.byteLength(disk), status: 'saved' };
    }
    return this.commit(tool, 'update', rel, next, disk);
  }

  /**
   * 노트에 댓글을 단다(노트 본문은 건드리지 않는다). 쓰기가 켜져 있으면 허용 폴더 밖의 노트에도 달 수 있다 —
   * 댓글은 검토 의견을 남기는 통로이고 노트를 바꾸지 않는다. 횟수 한도와 감사 기록은 똑같이 적용한다.
   */
  comment(tool: string, rawPath: string, text: string, quote?: string): Comment {
    let rel: string;
    try {
      rel = validateNotePath(rawPath);
    } catch (e) {
      // 감사 note 는 언어와 무관하게 base(ko) — 응답만 지금 언어로.
      const base = e instanceof PolicyError && e.code ? trIn('ko', e.code as never, e.params) : e instanceof Error ? e.message : String(e);
      this.log({ action: 'denied', tool, path: rawPath, note: base });
      throw new WriteError('bad-input', e instanceof Error ? e.message : String(e));
    }
    if (!this.policy.write) this.deny(tool, rel, 'read-only', { key: 'mcpW.err.readOnlyComment' });
    if (!existsSync(resolveInVault(this.policy.root, rel))) this.deny(tool, rel, 'not-found', { key: 'mcpW.err.noteMissing', params: { path: rel } });
    const now = this.now().getTime();
    this.stamps = this.stamps.filter((s) => now - s < 60_000);
    if (this.stamps.length >= this.policy.maxWritesPerMinute) this.deny(tool, rel, 'rate-limit', { key: 'mcpW.err.rateLimit', params: { max: this.policy.maxWritesPerMinute } });
    let c: Comment;
    try {
      c = addComment(this.policy.root, rel, { author: this.client() ?? trIn('ko', 'mcpW.aiAgent'), text, quote }, this.now());
    } catch (e) {
      throw new WriteError('bad-input', e instanceof Error ? e.message : String(e));
    }
    this.stamps.push(now);
    this.log({ action: 'comment', tool, path: rel, bytes: Buffer.byteLength(text), note: c.id });
    return c;
  }

  /** 쓰기 전 공통 검사: 켜짐·경로·폴더·횟수 */
  private guard(tool: string, rawPath: string): string {
    let rel: string;
    try {
      rel = validateNotePath(rawPath);
    } catch (e) {
      const base = e instanceof PolicyError && e.code ? trIn('ko', e.code as never, e.params) : e instanceof Error ? e.message : String(e);
      this.log({ action: 'denied', tool, path: rawPath, note: base });
      throw new WriteError('bad-input', e instanceof Error ? e.message : String(e));
    }
    if (!this.policy.write) this.deny(tool, rel, 'read-only', { key: 'mcpW.err.readOnlyWrite' });
    if (!canWrite(this.policy, rel)) {
      const where = this.policy.writeFolders.map((f) => f || tr('mcpCli.wholeVault')).join(', ');
      this.deny(tool, rel, 'forbidden-folder', { key: 'mcpW.err.forbiddenFolder', params: { folders: where } });
    }
    const t = this.now().getTime();
    this.stamps = this.stamps.filter((s) => t - s < 60_000);
    if (this.stamps.length >= this.policy.maxWritesPerMinute) this.deny(tool, rel, 'rate-limit', { key: 'mcpW.err.rateLimit', params: { max: this.policy.maxWritesPerMinute } });
    return rel;
  }

  private readDisk(tool: string, rel: string): string {
    const full = resolveInVault(this.policy.root, rel);
    if (!existsSync(full)) this.deny(tool, rel, 'not-found', { key: 'mcpW.err.noteMissingCreate', params: { path: rel } });
    return readFileSync(full, 'utf8');
  }

  private commit(tool: string, action: 'create' | 'append' | 'update', rel: string, text: string, disk: string | null): WriteResult {
    const bytes = Buffer.byteLength(text);
    if (bytes > this.policy.maxBytes) this.deny(tool, rel, 'too-large', { key: 'mcpW.err.tooLarge', params: { bytes, max: this.policy.maxBytes } });
    const r = saveNote({ root: this.policy.root, rel, content: text, baseHash: disk === null ? null : sha256(disk), ...(disk !== null ? { baseContent: disk } : {}), now: this.now() });
    this.countAttempt();
    const status = r.status === 'merged' ? 'merged' : r.status === 'conflict' || r.status === 'copy' ? 'conflict' : 'saved';
    this.log({ action, tool, path: rel, hashBefore: disk === null ? null : sha256(disk), hashAfter: r.hash, bytes, ...(status !== 'saved' ? { note: status } : {}) });
    return { path: rel, hash: r.hash, bytes, status };
  }

  /** 쓰기 시도 한 건을 한도에 기록한다. `guard()` 의 검사와 짝을 이룬다(실제로 쓰지 않은 no-op 도 센다). */
  private countAttempt(): void {
    this.stamps.push(this.now().getTime());
  }

  private deny(tool: string, rel: string, code: WriteErrorCode, reason: DenyReason): never {
    // 감사 기록은 언어와 무관하게 base(ko) 값으로, 응답은 지금 언어로 — 두 용도를 분리한다.
    const base = typeof reason === 'string' ? reason : trIn('ko', reason.key, reason.params);
    const text = typeof reason === 'string' ? reason : tr(reason.key, reason.params);
    this.log({ action: 'denied', tool, path: rel, note: `${code}: ${base}` });
    throw new WriteError(code, text);
  }

  private log(e: Omit<AuditEntry, 't' | 'client'>): void {
    try {
      appendAudit(this.policy.root, { t: this.now().toISOString(), client: this.client(), ...e });
    } catch {
      // 기록 실패가 쓰기 자체를 막지는 않는다
    }
  }
}
