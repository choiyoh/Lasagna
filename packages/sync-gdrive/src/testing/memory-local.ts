/**
 * 로컬 파일시스템 가짜 구현. 기기마다 하나씩 만들어 3자(A·B·Drive) 시나리오를 짠다.
 * `edit`/`remove` 는 사용자가 편집기에서 직접 만진 것이라 `writes`/`trashed` 에 남지 않는다.
 */

import { sha256Hex, text, toBytes } from '../hash.js';
import type { LocalFile, LocalStore, SyncPath } from '../types.js';

/** 경로순 비교(코드 유닛 기준, 로케일 무관) */
const byPath = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const toLocal = (path: SyncPath, bytes: Uint8Array): LocalFile => ({ path, hash: sha256Hex(bytes), size: bytes.length });

export class MemoryLocal implements LocalStore {
  /** 휴지통으로 간 파일 기록(내용까지 보관) */
  readonly trashed: { path: SyncPath; content: Uint8Array }[] = [];
  /** `write` 로 쓴 경로 순서 */
  readonly writes: string[] = [];

  private readonly files = new Map<SyncPath, Uint8Array>();

  async scan(): Promise<LocalFile[]> {
    return this.paths().map((path) => toLocal(path, this.get(path)));
  }

  async read(path: SyncPath): Promise<Uint8Array> {
    return this.get(path).slice();
  }

  async write(path: SyncPath, bytes: Uint8Array): Promise<LocalFile> {
    const copy = bytes.slice();
    this.files.set(path, copy);
    this.writes.push(path);
    return toLocal(path, copy);
  }

  async trash(path: SyncPath): Promise<void> {
    const content = this.files.get(path);
    if (!content) throw new Error(`없는 경로: ${path}`);
    this.trashed.push({ path, content: content.slice() });
    this.files.delete(path);
  }

  async move(from: SyncPath, to: SyncPath): Promise<void> {
    const content = this.files.get(from);
    if (!content) throw new Error(`없는 경로: ${from}`);
    if (from === to) return; // 제자리 이동 — 덮어쓸 게 없다
    if (this.files.has(to)) throw new Error(`이미 있는 경로: ${to}`);
    this.files.delete(from);
    this.files.set(to, content);
  }

  async exists(path: SyncPath): Promise<boolean> {
    return this.files.has(path);
  }

  // ── 테스트 도우미 ────────────────────────────────────────────────

  /** 사용자가 편집기에서 저장한 것처럼(쓰기 기록 없이 내용 설정) */
  edit(path: SyncPath, content: string | Uint8Array): void {
    this.files.set(path, toBytes(content));
  }

  /** 사용자가 지운 것처럼(휴지통 기록 없이 제거) */
  remove(path: SyncPath): void {
    if (!this.files.delete(path)) throw new Error(`없는 경로: ${path}`);
  }

  contentOf(path: SyncPath): string | undefined {
    const bytes = this.files.get(path);
    return bytes ? text(bytes) : undefined;
  }

  /** 현재 경로 목록(정렬) */
  paths(): string[] {
    return [...this.files.keys()].sort(byPath);
  }

  private get(path: SyncPath): Uint8Array {
    const bytes = this.files.get(path);
    if (!bytes) throw new Error(`없는 경로: ${path}`);
    return bytes;
  }
}
