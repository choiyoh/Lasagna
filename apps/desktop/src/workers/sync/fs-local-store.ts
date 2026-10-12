/**
 * 동기화 엔진용 실제 파일시스템 `LocalStore`.
 *
 * - 순회·읽기·해시는 `fs.promises`(비동기)만 쓴다 — 볼트가 커도 메인 이벤트 루프를 막지 않는다.
 *   (`atomicWrite` 만 예외: 동기 구현이지만 fsync 보장 때문에 그대로 쓴다.)
 * - 심볼릭 링크는 따라가지 않는다(볼트 밖 탈출·무한 순회 방지).
 * - 경로는 볼트 상대 슬래시 구분·NFC 로 다룬다. `..`/절대 경로 탈출은 `resolveInVault` 가 막는다.
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import { atomicWrite, resolveInVault } from '@nopsidian/core';
import type { LocalFile, LocalStore, SyncPath } from '@nopsidian/sync-gdrive/types';
import { isSyncablePath } from './syncable';

/** mtime+size 로 해시를 재사용하는 캐시(파일 내용을 다시 읽지 않게 한다). */
export interface HashCache {
  get(path: string): { mtimeMs: number; size: number; hash: string } | undefined;
  set(path: string, v: { mtimeMs: number; size: number; hash: string }): void;
  delete(path: string): void;
}

/** 경로순 비교(코드 유닛 기준, 로케일 무관) — 메모리 구현·상태 저장소와 같은 순서 */
const byPath = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const nfc = (p: string): string => p.normalize('NFC');

const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** 파일 내용 SHA-256 을 스트림으로 계산한다(큰 첨부도 메모리에 통째로 올리지 않는다). */
async function hashFile(abs: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(abs)) hash.update(chunk as Uint8Array);
  return hash.digest('hex');
}

/** 있으면 lstat(심볼릭 링크도 본다), 없으면 null */
async function lstatOrNull(abs: string) {
  try {
    return await fsp.lstat(abs);
  } catch {
    return null;
  }
}

/** 있으면 stat(링크를 따라간다), 없으면 null */
async function statOrNull(abs: string) {
  try {
    return await fsp.stat(abs);
  } catch {
    return null;
  }
}

/** 같은 이름이 이미 있으면 `이름 (2).md` 식으로 번호를 붙여 비켜 간다. */
async function freePath(file: string): Promise<string> {
  if (!(await lstatOrNull(file))) return file;
  const dir = path.dirname(file);
  const base = path.basename(file);
  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length);
  for (let n = 2; ; n++) {
    const candidate = path.join(dir, `${stem} (${n})${ext}`);
    if (!(await lstatOrNull(candidate))) return candidate;
  }
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** 휴지통 폴더 이름 `YYYYMMDD-HHmmss`(로컬 시간) */
function stamp(d: Date): string {
  return (
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}` +
    `-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
  );
}

export class FsLocalStore implements LocalStore {
  private readonly cache?: HashCache;
  private readonly now: () => Date;
  /** 지난 scan 에서 본 경로 — 사라진 경로의 캐시를 지우려고 들고 있는다(캐시에는 키 열거가 없다). */
  private seen = new Set<string>();

  constructor(
    private readonly root: string,
    opts: { cache?: HashCache; now?: () => Date } = {},
  ) {
    this.cache = opts.cache;
    this.now = opts.now ?? (() => new Date());
  }

  /** 볼트 전체를 재귀 순회한다. 제외 폴더는 들어가지도 않는다. 결과는 경로순. */
  async scan(): Promise<LocalFile[]> {
    const files: LocalFile[] = [];
    const seen = new Set<string>();
    await this.walk('', files, seen);
    for (const gone of this.seen) {
      if (!seen.has(gone)) this.cache?.delete(gone);
    }
    this.seen = seen;
    return files.sort((a, b) => byPath(a.path, b.path));
  }

  async read(p: SyncPath): Promise<Uint8Array> {
    return fsp.readFile(resolveInVault(this.root, p));
  }

  async write(p: SyncPath, bytes: Uint8Array): Promise<LocalFile> {
    const abs = resolveInVault(this.root, p);
    atomicWrite(abs, bytes);
    const st = await fsp.stat(abs);
    const hash = sha256Hex(bytes);
    this.cache?.set(nfc(p), { mtimeMs: st.mtimeMs, size: st.size, hash });
    return { path: nfc(p), hash, size: bytes.length };
  }

  /** `.nopsidian/trash/<YYYYMMDD-HHmmss>/<원래 경로>` 로 옮긴다(rename). 삭제가 아니라 보관이다. */
  async trash(p: SyncPath): Promise<void> {
    const abs = resolveInVault(this.root, p);
    const st = await lstatOrNull(abs);
    if (!st || st.isDirectory()) throw new Error(`없는 경로: ${p}`);
    const dest = resolveInVault(this.root, `.nopsidian/trash/${stamp(this.now())}/${nfc(p)}`);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.rename(abs, await freePath(dest));
  }

  async move(from: SyncPath, to: SyncPath): Promise<void> {
    const fromAbs = resolveInVault(this.root, from);
    const toAbs = resolveInVault(this.root, to);
    const st = await lstatOrNull(fromAbs);
    if (!st || st.isDirectory()) throw new Error(`없는 경로: ${from}`);
    if (from === to) return; // 제자리 이동 — 덮어쓸 게 없다
    if (await lstatOrNull(toAbs)) throw new Error(`이미 있는 경로: ${to}`);
    await fsp.mkdir(path.dirname(toAbs), { recursive: true });
    await fsp.rename(fromAbs, toAbs);
    // 빈 상위 폴더는 지우지 않는다(사용자가 보던 구조 그대로)
    this.cache?.delete(nfc(from));
  }

  /** 폴더가 아닌 것이 있는지(경로에 뭔가 있는지만 본다 — scan 과 달리 링크는 따라간다). */
  async exists(p: SyncPath): Promise<boolean> {
    return (await statOrNull(resolveInVault(this.root, p)))?.isDirectory() === false;
  }

  private async walk(dirRel: string, files: LocalFile[], seen: Set<string>): Promise<void> {
    const entries = await fsp.readdir(path.join(this.root, dirRel), { withFileTypes: true });
    for (const ent of entries) {
      if (ent.isSymbolicLink()) continue; // 따라가지 않는다
      const rel = dirRel === '' ? ent.name : `${dirRel}/${ent.name}`;
      const norm = nfc(rel);
      if (!isSyncablePath(norm)) continue; // 제외 폴더는 들어가지도 않는다
      if (ent.isDirectory()) {
        await this.walk(rel, files, seen);
        continue;
      }
      if (!ent.isFile()) continue; // 소켓·FIFO 등
      files.push(await this.hashOne(norm, path.join(this.root, rel)));
      seen.add(norm);
    }
  }

  private async hashOne(norm: string, abs: string): Promise<LocalFile> {
    const st = await fsp.stat(abs);
    const hit = this.cache?.get(norm);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
      return { path: norm, hash: hit.hash, size: st.size };
    }
    const hash = await hashFile(abs);
    this.cache?.set(norm, { mtimeMs: st.mtimeMs, size: st.size, hash });
    return { path: norm, hash, size: st.size };
  }
}
