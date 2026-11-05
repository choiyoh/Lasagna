import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { atomicWrite } from './save.js';

/** 노트에 다는 댓글. 볼트의 `.nopsidian/comments/<경로 해시>.json` 에 노트마다 한 파일로 둔다(드라이브 동기화 대상). */
/** 앱이 스스로 쓴 댓글의 저장 작성자 값(표시는 언어에 따라 다르다). */
export const SELF_AUTHOR = '나';

export interface Comment {
  id: string;
  /** 쓴 사람: 앱에서는 "나", 에이전트는 클라이언트 이름 */
  author: string;
  text: string;
  /** 노트의 어느 글에 대한 댓글인지(선택, 짧은 인용) */
  quote?: string;
  /** ISO 시각 */
  createdAt: string;
  resolved?: boolean;
}

interface CommentFile {
  /** 노트의 볼트 상대 경로(해시 충돌·이름 변경 확인용) */
  path: string;
  comments: Comment[];
}

export const COMMENTS_DIR = '.nopsidian/comments';
export const MAX_COMMENT_CHARS = 5000;
export const MAX_QUOTE_CHARS = 300;

const hashOf = (rel: string) => createHash('sha1').update(rel.normalize('NFC')).digest('hex').slice(0, 12);
const fileOf = (root: string, rel: string) => path.join(root, COMMENTS_DIR, `${hashOf(rel)}.json`);

function load(root: string, rel: string): CommentFile {
  try {
    const raw = JSON.parse(readFileSync(fileOf(root, rel), 'utf8')) as Partial<CommentFile>;
    if (raw.path === rel.normalize('NFC') && Array.isArray(raw.comments)) {
      return {
        path: raw.path,
        comments: raw.comments.filter((c): c is Comment => !!c && typeof c.id === 'string' && typeof c.text === 'string' && typeof c.createdAt === 'string'),
      };
    }
  } catch {
    /* 없거나 깨졌으면 빈 목록 */
  }
  return { path: rel.normalize('NFC'), comments: [] };
}

function save(root: string, file: CommentFile): void {
  const full = fileOf(root, file.path);
  if (file.comments.length === 0) {
    try {
      unlinkSync(full);
    } catch {
      /* 이미 없다 */
    }
    return;
  }
  mkdirSync(path.dirname(full), { recursive: true });
  atomicWrite(full, `${JSON.stringify(file, null, 2)}\n`);
}

/** 노트의 댓글(오래된 것부터) */
export function listComments(root: string, rel: string): Comment[] {
  return load(root, rel).comments;
}

export function addComment(root: string, rel: string, input: { author: string; text: string; quote?: string }, now = new Date()): Comment {
  const text = input.text.trim();
  if (!text) throw new Error('댓글 내용이 비어 있어요');
  if (text.length > MAX_COMMENT_CHARS) throw new Error(`댓글이 너무 길어요(최대 ${MAX_COMMENT_CHARS}자)`);
  const quote = input.quote?.trim().replace(/\s+/g, ' ').slice(0, MAX_QUOTE_CHARS);
  const c: Comment = { id: randomUUID().slice(0, 8), author: input.author.trim().slice(0, 60) || SELF_AUTHOR, text, ...(quote ? { quote } : {}), createdAt: now.toISOString() };
  const f = load(root, rel);
  f.comments.push(c);
  save(root, f);
  return c;
}

/** 해결/다시 열기. 없는 댓글이면 false */
export function setCommentResolved(root: string, rel: string, id: string, resolved: boolean): boolean {
  const f = load(root, rel);
  const c = f.comments.find((x) => x.id === id);
  if (!c) return false;
  if (resolved) c.resolved = true;
  else delete c.resolved;
  save(root, f);
  return true;
}

export function removeComment(root: string, rel: string, id: string): boolean {
  const f = load(root, rel);
  const next = f.comments.filter((x) => x.id !== id);
  if (next.length === f.comments.length) return false;
  f.comments = next;
  save(root, f);
  return true;
}

/** 노트·폴더 이름 변경/이동에 따라 댓글 파일의 경로를 옮긴다(폴더면 안의 노트 전부). 옮긴 개수를 돌려준다. */
export function relocateComments(root: string, from: string, to: string): number {
  const dir = path.join(root, COMMENTS_DIR);
  if (!existsSync(dir)) return 0;
  const f = from.normalize('NFC');
  const t = to.normalize('NFC');
  let moved = 0;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    let file: CommentFile;
    try {
      file = JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as CommentFile;
    } catch {
      continue;
    }
    if (typeof file.path !== 'string' || !(file.path === f || file.path.startsWith(`${f}/`))) continue;
    const newPath = `${t}${file.path.slice(f.length)}`;
    const old = path.join(dir, name);
    const next: CommentFile = { ...file, path: newPath };
    atomicWrite(fileOf(root, newPath), `${JSON.stringify(next, null, 2)}\n`);
    if (path.join(dir, `${hashOf(newPath)}.json`) !== old) renameSafeRemove(old);
    moved++;
  }
  return moved;
}

function renameSafeRemove(file: string) {
  try {
    unlinkSync(file);
  } catch {
    /* 이미 없다 */
  }
}
