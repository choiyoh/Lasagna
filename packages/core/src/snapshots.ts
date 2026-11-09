import { CodedError } from './errors.js';
import { atomicWrite } from './save.js';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';

/** 이름 붙인 스냅샷 한 건 — 사용자가 지울 때까지 남는다(자동 이력 prune 대상 아님). */
export interface SnapshotEntry {
  /** 파일 이름(`2026-11-09T05-20-00-000Z-ab12cd34.json`) */
  id: string;
  /** 사용자가 붙인 이름(비우면 시각 표기) */
  name: string;
  /** 만든 시각(ISO) */
  time: string;
  /** 내용 바이트 크기 */
  size: number;
}

interface SnapshotFile {
  version: 1;
  name: string;
  time: string;
  content: string;
}

/** 노트의 스냅샷 숨김 폴더 — 자동 이력과 같은 해시 키를 쓴다. */
export function snapshotsDir(root: string, rel: string): string {
  return path.join(root, '.nopsidian', 'snapshots', createHash('sha1').update(rel).digest('hex').slice(0, 12));
}

const ID_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f]{8}\.json$/;

/** 빈 이름이면 시각(`11. 09 14:20`)으로, 아니면 공백 정리·80자 제한. 슬래시 등은 파일 이름이 아니라 내용에만 쓴다. */
export function normalizeSnapshotName(raw: string, at: Date): string {
  // eslint-disable-next-line no-control-regex -- 제어 문자를 이름에서 지운다
  const name = raw.replace(/[\u0000-\u001f]/g, ' ').trim().replace(/\s+/g, ' ');
  if (!name) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(at.getMonth() + 1)}. ${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
  }
  return name.slice(0, 80);
}

function idFor(at: Date): string {
  return `${at.toISOString().replace(/[:.]/g, '-')}-${randomBytes(4).toString('hex')}.json`;
}

/** 내용을 이름·시각과 함께 원자적으로 저장한다(첫 저장 때만 폴더 생성). */
export function saveSnapshot(root: string, rel: string, name: string, content: string, at = new Date()): SnapshotEntry {
  const dir = snapshotsDir(root, rel);
  mkdirSync(dir, { recursive: true });
  const id = idFor(at);
  const data: SnapshotFile = { version: 1, name: normalizeSnapshotName(name, at), time: at.toISOString(), content };
  atomicWrite(path.join(dir, id), `${JSON.stringify(data, null, 2)}\n`);
  return { id, name: data.name, time: data.time, size: Buffer.byteLength(content, 'utf8') };
}

function readFile(root: string, rel: string, id: string): SnapshotFile {
  if (!ID_RE.test(id)) throw new CodedError('core.err.badHistoryName');
  const raw = readFileSync(path.join(snapshotsDir(root, rel), id), 'utf8');
  const data = JSON.parse(raw) as Partial<SnapshotFile>;
  return {
    version: 1,
    name: typeof data.name === 'string' ? data.name : '',
    time: typeof data.time === 'string' ? data.time : '',
    content: typeof data.content === 'string' ? data.content : '',
  };
}

/** 최신 순 목록. 손상 파일·다른 형식은 건너뛴다(빈 폴더면 []). */
export function listSnapshots(root: string, rel: string): SnapshotEntry[] {
  const dir = snapshotsDir(root, rel);
  if (!existsSync(dir)) return [];
  const out: SnapshotEntry[] = [];
  for (const id of readdirSync(dir)) {
    if (!ID_RE.test(id)) continue;
    try {
      const data = readFile(root, rel, id);
      out.push({ id, name: data.name, time: data.time, size: Buffer.byteLength(data.content, 'utf8') });
    } catch {
      // 읽지 못한 파일은 목록에서 뺀다.
    }
  }
  return out.sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0));
}

export function readSnapshot(root: string, rel: string, id: string): SnapshotFile {
  return readFile(root, rel, id);
}

/** 이름만 바꾼다(내용·시각 유지). 빈 이름은 시각으로. */
export function renameSnapshot(root: string, rel: string, id: string, name: string, at = new Date()): SnapshotEntry {
  const data = readFile(root, rel, id);
  const next: SnapshotFile = { ...data, name: normalizeSnapshotName(name, at) };
  atomicWrite(path.join(snapshotsDir(root, rel), id), `${JSON.stringify(next, null, 2)}\n`);
  return { id, name: next.name, time: next.time, size: Buffer.byteLength(next.content, 'utf8') };
}

/** 스냅샷 파일 하나만 지운다(노트·자동 이력은 그대로). */
export function deleteSnapshot(root: string, rel: string, id: string): void {
  if (!ID_RE.test(id)) throw new CodedError('core.err.badHistoryName');
  const file = path.join(snapshotsDir(root, rel), id);
  if (existsSync(file)) unlinkSync(file);
}

/** 손상된 파일을 덮어쓰지 않도록 남겨 두는 테스트용 도우미 — 잘못된 id 는 거부한다. */
export function isSnapshotId(id: string): boolean {
  return ID_RE.test(id);
}

/** 테스트에서 내용을 직접 읽을 때 쓴다(파일 형식 확인용). */
export function rawSnapshotText(root: string, rel: string, id: string): string {
  return readFileSync(path.join(snapshotsDir(root, rel), id), 'utf8');
}
