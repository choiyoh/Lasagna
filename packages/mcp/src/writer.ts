import { existsSync, readFileSync } from 'node:fs';
import { addComment, parseNote, resolveInVault, saveNote, sha256, splitFrontmatter, type Comment } from '@nopsidian/core';
import { stringify } from 'yaml';
import { appendAudit, type AuditEntry } from './audit.js';
import { canWrite, validateNotePath, type McpPolicy } from './policy.js';

export type WriteErrorCode = 'read-only' | 'forbidden-folder' | 'exists' | 'not-found' | 'stale' | 'rate-limit' | 'too-large' | 'bad-heading' | 'bad-input' | 'partial';

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

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * 본문 끝에 `text` 를 덧붙인다. `heading` 이 있으면 그 제목 구역(같거나 높은 단계의 다음 제목 직전)의 끝에 넣는다.
 * 앞뒤는 빈 줄 하나로 띄운다.
 */
export function appendText(content: string, text: string, heading?: string): string {
  const add = text.replace(/\s+$/, '');
  if (!add) throw new WriteError('bad-input', '덧붙일 내용이 비어 있어요');
  if (!heading) {
    const base = content.replace(/\s+$/, '');
    return `${base ? `${base}\n\n` : ''}${add}\n`;
  }
  const headings = parseNote(content).meta.headings;
  const h = headings.find((x) => norm(x.text) === norm(heading));
  if (!h) {
    const list = headings.map((x) => `${'#'.repeat(x.level)} ${x.text}`).join(', ') || '(제목 없음)';
    throw new WriteError('bad-heading', `“${heading}” 제목을 찾을 수 없어요. 있는 제목: ${list}`);
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
  if (wantsFm && hasFm) throw new WriteError('bad-input', '내용에 이미 프런트매터(---)가 있어요. tags·properties 는 쓰지 말고 내용 안에 함께 적어 주세요');
  let body = content;
  if (opts.title && !hasFm && !/^\s*#\s/.test(body)) body = `# ${opts.title.trim()}\n\n${body}`;
  const fm = wantsFm ? `---\n${stringify(props)}---\n` : '';
  return `${fm}${fm ? '\n' : ''}${body.replace(/\s+$/, '')}\n`;
}

/** 에이전트의 쓰기. 정책(켜짐·폴더·횟수·크기)을 지키고, 저장은 앱과 같은 경로(역사 스냅샷·원자적 쓰기)로 하며, 모두 감사 기록에 남긴다. */
export class NoteWriter {
  private stamps: number[] = [];

  constructor(
    private readonly policy: McpPolicy,
    private readonly client: () => string | undefined = () => undefined,
    private readonly now: () => Date = () => new Date(),
  ) {}

  create(tool: string, rawPath: string, content: string, opts: { title?: string; tags?: string[]; properties?: Record<string, unknown> } = {}): WriteResult {
    const rel = this.guard(tool, rawPath);
    if (existsSync(resolveInVault(this.policy.root, rel))) this.deny(tool, rel, 'exists', `이미 있는 노트예요: ${rel}. 내용을 덧붙이려면 append_to_note, 고치려면 read_note 로 hash 를 받아 update_note 를 쓰세요`);
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
    if (sha256(disk) !== expected) this.deny(tool, rel, 'stale', '노트가 읽은 뒤에 바뀌었어요. read_note 로 다시 읽고 최신 hash 로 시도하세요');
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

  /** 이미 완성된 노트 전문을 그대로 새 노트로 쓴다(데이터베이스 행처럼 프런트매터를 직접 만든 경우). 있으면 실패. */
  createExact(tool: string, rawPath: string, text: string): WriteResult {
    const rel = this.guard(tool, rawPath);
    if (existsSync(resolveInVault(this.policy.root, rel))) this.deny(tool, rel, 'exists', `이미 있는 노트예요: ${rel}`);
    return this.commit(tool, 'create', rel, text, null);
  }

  /** 기존 노트의 현재 내용을 읽어 `mutate` 로 바꾼 결과를 쓴다. 결과가 같으면 쓰지 않고 그대로 돌려준다. */
  modify(tool: string, rawPath: string, mutate: (disk: string) => string): WriteResult {
    const rel = this.guard(tool, rawPath);
    const disk = this.readDisk(tool, rel);
    const next = mutate(disk);
    if (next === disk) return { path: rel, hash: sha256(disk), bytes: Buffer.byteLength(disk), status: 'saved' };
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
      this.log({ action: 'denied', tool, path: rawPath, note: e instanceof Error ? e.message : String(e) });
      throw new WriteError('bad-input', e instanceof Error ? e.message : String(e));
    }
    if (!this.policy.write) this.deny(tool, rel, 'read-only', '이 서버는 읽기 전용이에요(--write 로 시작해야 댓글을 달 수 있어요)');
    if (!existsSync(resolveInVault(this.policy.root, rel))) this.deny(tool, rel, 'not-found', `없는 노트예요: ${rel}`);
    const t = this.now().getTime();
    this.stamps = this.stamps.filter((s) => t - s < 60_000);
    if (this.stamps.length >= this.policy.maxWritesPerMinute) this.deny(tool, rel, 'rate-limit', `1분에 ${this.policy.maxWritesPerMinute}번까지만 쓸 수 있어요. 잠시 뒤에 다시 시도하세요`);
    let c: Comment;
    try {
      c = addComment(this.policy.root, rel, { author: this.client() ?? 'AI 에이전트', text, quote }, this.now());
    } catch (e) {
      throw new WriteError('bad-input', e instanceof Error ? e.message : String(e));
    }
    this.stamps.push(t);
    this.log({ action: 'comment', tool, path: rel, bytes: Buffer.byteLength(text), note: c.id });
    return c;
  }

  /** 쓰기 전 공통 검사: 켜짐·경로·폴더·횟수 */
  private guard(tool: string, rawPath: string): string {
    let rel: string;
    try {
      rel = validateNotePath(rawPath);
    } catch (e) {
      this.log({ action: 'denied', tool, path: rawPath, note: e instanceof Error ? e.message : String(e) });
      throw new WriteError('bad-input', e instanceof Error ? e.message : String(e));
    }
    if (!this.policy.write) this.deny(tool, rel, 'read-only', '이 서버는 읽기 전용이에요(--write 로 시작해야 쓸 수 있어요)');
    if (!canWrite(this.policy, rel)) {
      const where = this.policy.writeFolders.map((f) => f || '볼트 전체').join(', ');
      this.deny(tool, rel, 'forbidden-folder', `이 폴더에는 쓸 수 없어요. 쓸 수 있는 폴더: ${where}`);
    }
    const t = this.now().getTime();
    this.stamps = this.stamps.filter((s) => t - s < 60_000);
    if (this.stamps.length >= this.policy.maxWritesPerMinute) this.deny(tool, rel, 'rate-limit', `1분에 ${this.policy.maxWritesPerMinute}번까지만 쓸 수 있어요. 잠시 뒤에 다시 시도하세요`);
    return rel;
  }

  private readDisk(tool: string, rel: string): string {
    const full = resolveInVault(this.policy.root, rel);
    if (!existsSync(full)) this.deny(tool, rel, 'not-found', `없는 노트예요: ${rel}. 새로 만들려면 create_note 를 쓰세요`);
    return readFileSync(full, 'utf8');
  }

  private commit(tool: string, action: 'create' | 'append' | 'update', rel: string, text: string, disk: string | null): WriteResult {
    const bytes = Buffer.byteLength(text);
    if (bytes > this.policy.maxBytes) this.deny(tool, rel, 'too-large', `내용이 너무 커요(${bytes}바이트, 한도 ${this.policy.maxBytes})`);
    const r = saveNote({ root: this.policy.root, rel, content: text, baseHash: disk === null ? null : sha256(disk), ...(disk !== null ? { baseContent: disk } : {}), now: this.now() });
    this.stamps.push(this.now().getTime());
    const status = r.status === 'merged' ? 'merged' : r.status === 'conflict' || r.status === 'copy' ? 'conflict' : 'saved';
    this.log({ action, tool, path: rel, hashBefore: disk === null ? null : sha256(disk), hashAfter: r.hash, bytes, ...(status !== 'saved' ? { note: status } : {}) });
    return { path: rel, hash: r.hash, bytes, status };
  }

  private deny(tool: string, rel: string, code: WriteErrorCode, message: string): never {
    this.log({ action: 'denied', tool, path: rel, note: `${code}: ${message}` });
    throw new WriteError(code, message);
  }

  private log(e: Omit<AuditEntry, 't' | 'client'>): void {
    try {
      appendAudit(this.policy.root, { t: this.now().toISOString(), client: this.client(), ...e });
    } catch {
      // 기록 실패가 쓰기 자체를 막지는 않는다
    }
  }
}
