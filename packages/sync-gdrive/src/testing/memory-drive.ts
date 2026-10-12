/**
 * Drive 가짜 구현. 테스트에서 기기 A·B·사람(Drive 웹) 을 흉내 낼 때 쓴다.
 * id 는 생성 순서대로 `f1`, `f2`…, revision 은 파일마다 `r1`, `r2`… (내용이 바뀔 때만 증가).
 */

import { sha256Hex, text, toBytes } from '../hash.js';
import type { DriveClient, RemoteFile, SyncPath } from '../types.js';
import { RevisionConflictError } from '../types.js';

interface Row {
  id: string;
  path: SyncPath;
  bytes: Uint8Array;
  revision: string;
  /** 내용이 바뀐 횟수 — 다음 revision 번호 */
  revSeq: number;
  trashed: boolean;
}

/** 경로순 비교(코드 유닛 기준, 로케일 무관) */
const byPath = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** 저장된 내용에서 항상 계산한 RemoteFile — hash 필드는 넘겨받은 값을 믿지 않는다. */
const toRemote = (row: Row): RemoteFile => ({
  id: row.id,
  path: row.path,
  hash: sha256Hex(row.bytes),
  revision: row.revision,
  size: row.bytes.length,
});

export class MemoryDrive implements DriveClient {
  /** 호출 순서 기록 — 엔진이 무엇을 했는지 확인용. offline 이면 기록하지 않는다. */
  readonly calls: string[] = [];
  /** true 면 모든 DriveClient 메서드가 Error('offline') 로 reject */
  offline = false;

  private readonly files = new Map<string, Row>();
  private nextId = 1;

  async list(): Promise<RemoteFile[]> {
    this.ensureOnline();
    this.calls.push('list');
    // 바깥 객체는 새로 만들지만 hash/size 는 계산값이라 따로 복사할 게 없다.
    return this.live().map(toRemote);
  }

  async download(id: string): Promise<Uint8Array> {
    this.ensureOnline();
    this.calls.push(`download:${id}`);
    return this.row(id).bytes.slice();
  }

  async upload(args: { path: SyncPath; bytes: Uint8Array; hash: string; existing?: { id: string; revision: string } }): Promise<RemoteFile> {
    this.ensureOnline();
    this.calls.push(`upload:${args.path}`);

    const computed = sha256Hex(args.bytes);
    if (computed !== args.hash) throw new Error(`hash 불일치: ${args.path}`);

    if (!args.existing) {
      // 같은 경로가 이미 있으면 덮어쓰지도, 중복 id 를 만들지도 않는다.
      if (this.findByPath(args.path)) throw new Error(`이미 있는 경로: ${args.path}`);
      const row: Row = { id: `f${this.nextId++}`, path: args.path, bytes: args.bytes.slice(), revision: 'r1', revSeq: 1, trashed: false };
      this.files.set(row.id, row);
      return toRemote(row);
    }

    const row = this.row(args.existing.id);
    if (row.revision !== args.existing.revision) throw new RevisionConflictError(args.path);
    row.revSeq += 1;
    row.revision = `r${row.revSeq}`;
    row.bytes = args.bytes.slice();
    return toRemote(row);
  }

  async move(id: string, to: SyncPath): Promise<RemoteFile> {
    this.ensureOnline();
    this.calls.push(`move:${id}:${to}`);
    const row = this.row(id);
    const occupant = this.findByPath(to);
    if (occupant && occupant.id !== id) throw new Error(`이미 있는 경로: ${to}`);
    row.path = to; // 내용이 그대로이므로 revision 은 유지한다
    return toRemote(row);
  }

  async trash(id: string): Promise<void> {
    this.ensureOnline();
    this.calls.push(`trash:${id}`);
    this.row(id).trashed = true;
  }

  // ── 테스트 도우미(Drive 웹에서 사람이 한 행동) ──────────────────────────────
  // 사람은 우리 클라이언트와 무관하게 움직이므로 offline 여부와 상관없이 동작하고 calls 에도 안 남긴다.

  /** Drive 웹에서 사람이 올리거나 고친 것처럼: 내용 교체(없으면 새 파일), 새 revision. */
  putExternal(path: SyncPath, content: string | Uint8Array): RemoteFile {
    const bytes = toBytes(content);
    const row = this.findByPath(path);
    if (!row) {
      const created: Row = { id: `f${this.nextId++}`, path, bytes, revision: 'r1', revSeq: 1, trashed: false };
      this.files.set(created.id, created);
      return toRemote(created);
    }
    row.revSeq += 1;
    row.revision = `r${row.revSeq}`;
    row.bytes = bytes;
    return toRemote(row);
  }

  /** Drive 웹에서 사람이 휴지통으로 보낸 것처럼. */
  removeExternal(path: SyncPath): void {
    const row = this.findByPath(path);
    if (!row) throw new Error(`없는 경로: ${path}`);
    row.trashed = true;
  }

  /** 현재 내용(UTF-8). 없으면 undefined */
  contentOf(path: SyncPath): string | undefined {
    const row = this.findByPath(path);
    return row ? text(row.bytes) : undefined;
  }

  /** 현재 경로 목록(정렬) */
  paths(): string[] {
    return this.live().map((r) => r.path);
  }

  private ensureOnline(): void {
    if (this.offline) throw new Error('offline');
  }

  /** 휴지통 제외, 경로순 */
  private live(): Row[] {
    return [...this.files.values()].filter((r) => !r.trashed).sort((a, b) => byPath(a.path, b.path));
  }

  private findByPath(path: SyncPath): Row | undefined {
    return this.live().find((r) => r.path === path);
  }

  private row(id: string): Row {
    const row = this.files.get(id);
    if (!row || row.trashed) throw new Error(`없는 파일: ${id}`);
    return row;
  }
}
