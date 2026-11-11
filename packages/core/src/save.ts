import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { t } from '@nopsidian/i18n';
import path from 'node:path';
import { pruneHistory } from './history.js';
import { merge3 } from './merge3.js';
import { resolveInVault } from './vault-path.js';

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Windows 에서 대상 파일이 백신·검색 인덱서·클라우드에 열려 있을 때 나는 rename 오류 */
const RETRYABLE_RENAME = new Set(['EPERM', 'EBUSY', 'EACCES']);
/** 재시도 사이 대기(ms). 성공 경로에서는 한 번도 쓰지 않는다(macOS 지연 0). */
export const RENAME_RETRY_DELAYS_MS = [20, 50, 100, 200, 400] as const;

function sleepSync(ms: number) {
  // 동기 저장 경로라 busy-loop 대신 스레드를 잠깐 재운다(짧은 값만 쓴다).
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * rename 재시도(Windows 전용 상황 대비). 코드가 RETRYABLE_RENAME 일 때만 짧게 물러났다 다시 한다.
 * 다른 오류·마지막 실패는 그대로 던져 호출자가 임시 파일을 정리하고 원래 오류를 보여 준다.
 */
export function renameWithRetry(
  rename: (from: string, to: string) => void,
  from: string,
  to: string,
  opts: { sleep?: (ms: number) => void; delays?: readonly number[] } = {},
): void {
  const delays = opts.delays ?? RENAME_RETRY_DELAYS_MS;
  const sleep = opts.sleep ?? sleepSync;
  for (let attempt = 0; ; attempt += 1) {
    try {
      rename(from, to);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (!code || !RETRYABLE_RENAME.has(code) || attempt >= delays.length) throw e;
      sleep(delays[attempt]!);
    }
  }
}

/** 임시 파일 → fsync → rename. 중간에 죽어도 원본이 반쯤 쓰인 상태로 남지 않는다. */
export function atomicWrite(file: string, data: string | Uint8Array) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.nops-tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const fd = openSync(tmp, 'w');
  try {
    if (typeof data === 'string') {
      writeSync(fd, data);
    } else {
      // 큰 바이너리는 한 번에 다 쓰이지 않을 수 있으므로 끝까지 반복한다
      for (let off = 0; off < data.length; ) off += writeSync(fd, data, off, data.length - off);
    }
    fsyncSync(fd);
  } catch (e) {
    closeSync(fd);
    try {
      unlinkSync(tmp);
    } catch {
      // 이미 없으면 무시
    }
    throw e;
  }
  closeSync(fd);
  try {
    renameWithRetry(renameSync, tmp, file);
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      // 이미 없으면 무시
    }
    throw e;
  }
}

/** 덮어쓰기 전 이전 내용을 `.nopsidian/history/`에 남긴다. 직전 스냅샷과 같으면 건너뛴다. */
export function snapshot(root: string, rel: string, content: string, now = new Date()) {
  const dir = path.join(root, '.nopsidian', 'history', createHash('sha1').update(rel).digest('hex').slice(0, 12));
  const h = sha256(content).slice(0, 8);
  mkdirSync(dir, { recursive: true });
  const existing = readdirSync(dir).sort();
  if (existing.at(-1)?.endsWith(`-${h}.md`)) return;
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  atomicWrite(path.join(dir, `${stamp}-${h}.md`), content);
  pruneHistory(root, rel, now);
}

function dateStamp(d: Date) {
  return d.toISOString().slice(0, 10);
}

/** `이름 (충돌 2026-10-12).md`, 이미 있으면 ` 2`, ` 3` … */
export function conflictCopyPath(full: string, now = new Date()): string {
  const ext = path.extname(full);
  const stem = full.slice(0, full.length - ext.length);
  let candidate = t('default.conflictName', { stem, date: dateStamp(now), ext });
  for (let n = 2; existsSync(candidate); n++) candidate = t('default.conflictNameN', { stem, date: dateStamp(now), n, ext });
  return candidate;
}

export interface SaveOptions {
  root: string;
  rel: string;
  /** 앱이 저장하려는 내용 */
  content: string;
  /** 앱이 마지막으로 읽거나 저장한 디스크 내용의 해시. 새 파일이면 null */
  baseHash: string | null;
  /** baseHash에 해당하는 내용(3-way 병합의 공통 조상). 없으면 충돌 시 사본을 만든다 */
  baseContent?: string;
  now?: Date;
}

export type SaveStatus = 'saved' | 'merged' | 'conflict' | 'copy';

export interface SaveResult {
  status: SaveStatus;
  /** 저장 후 디스크에 있는 내용과 그 해시 */
  content: string;
  hash: string;
  /** status === 'copy'일 때 앱 편집본을 저장한 파일(볼트 기준 상대 경로) */
  copyPath?: string;
}

export function saveNote(opts: SaveOptions): SaveResult {
  const full = resolveInVault(opts.root, opts.rel);
  const now = opts.now ?? new Date();

  const write = (content: string, status: SaveStatus, prev?: string): SaveResult => {
    if (prev !== undefined && prev !== content) snapshot(opts.root, opts.rel, prev, now);
    if (prev !== content) atomicWrite(full, content);
    return { status, content, hash: sha256(content) };
  };

  if (!existsSync(full)) return write(opts.content, 'saved');

  const disk = readFileSync(full, 'utf8');
  const diskHash = sha256(disk);

  if (opts.baseHash !== null && diskHash === opts.baseHash) return write(opts.content, 'saved', disk);

  // 디스크가 앱이 알던 내용과 다르다(외부 편집) 또는 새 파일 이름이 이미 쓰이고 있다.
  if (disk === opts.content) return { status: 'saved', content: disk, hash: diskHash };

  if (opts.baseHash !== null && opts.baseContent !== undefined && sha256(opts.baseContent) === opts.baseHash) {
    const merged = merge3(opts.baseContent, opts.content, disk);
    return write(merged.text, merged.clean ? 'merged' : 'conflict', disk);
  }

  const copy = conflictCopyPath(full, now);
  atomicWrite(copy, opts.content);
  return {
    status: 'copy',
    content: disk,
    hash: diskHash,
    copyPath: path.posix.join(path.posix.dirname(opts.rel), path.basename(copy)).replace(/^\.\//, ''),
  };
}
