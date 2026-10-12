/** 동기화 상태 가짜 구현. 기기마다 하나씩 만들고, 바이트는 복사해서 주고받는다. */

import type { SyncEntry, SyncPath, SyncState } from '../types.js';

/** 경로순 비교(코드 유닛 기준, 로케일 무관) */
const byPath = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export class MemoryState implements SyncState {
  private readonly byPathEntry = new Map<SyncPath, SyncEntry>();
  private readonly bases = new Map<SyncPath, Uint8Array>();

  async entries(): Promise<SyncEntry[]> {
    return [...this.byPathEntry.values()].map((e) => ({ ...e })).sort((a, b) => byPath(a.path, b.path));
  }

  async put(entry: SyncEntry): Promise<void> {
    this.byPathEntry.set(entry.path, { ...entry });
  }

  async remove(path: SyncPath): Promise<void> {
    this.byPathEntry.delete(path);
  }

  async getBase(path: SyncPath): Promise<Uint8Array | null> {
    const bytes = this.bases.get(path);
    return bytes ? bytes.slice() : null;
  }

  async putBase(path: SyncPath, bytes: Uint8Array): Promise<void> {
    this.bases.set(path, bytes.slice());
  }

  async removeBase(path: SyncPath): Promise<void> {
    this.bases.delete(path);
  }
}
