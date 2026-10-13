import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';

/** 한 노트의 버전 기록 한 건 */
export interface HistoryEntry {
  /** 스냅샷 파일 이름(`2026-10-13T05-12-33-123Z-ab12cd34.md`) */
  id: string;
  /** 스냅샷을 만든 시각(ISO) */
  time: string;
  size: number;
}

const ID_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z-[0-9a-f]{8}\.md$/;

export function historyDir(root: string, rel: string): string {
  return path.join(root, '.nopsidian', 'history', createHash('sha1').update(rel).digest('hex').slice(0, 12));
}

/** 스냅샷 이름 → ISO 시각. 형식이 다르면 null */
export function timeOfSnapshot(id: string): string | null {
  const m = ID_RE.exec(id);
  return m ? `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z` : null;
}

/** 최신 순 목록 */
export function listHistory(root: string, rel: string): HistoryEntry[] {
  const dir = historyDir(root, rel);
  if (!existsSync(dir)) return [];
  const out: HistoryEntry[] = [];
  for (const id of readdirSync(dir)) {
    const time = timeOfSnapshot(id);
    if (!time) continue;
    out.push({ id, time, size: statSync(path.join(dir, id)).size });
  }
  return out.sort((a, b) => (a.id < b.id ? 1 : -1));
}

export function readHistory(root: string, rel: string, id: string): string {
  if (!ID_RE.test(id)) throw new Error('잘못된 기록 이름입니다');
  return readFileSync(path.join(historyDir(root, rel), id), 'utf8');
}

/**
 * 보존 정책: 최근 2일은 전부, 30일까지는 하루에 마지막 하나, 그보다 오래된 것은 지운다.
 * 지울 이름 목록을 돌려준다(순수 함수).
 */
export function pruneCandidates(ids: string[], now: Date): string[] {
  const DAY = 86_400_000;
  const drop: string[] = [];
  const lastOfDay = new Map<string, string>();
  for (const id of [...ids].sort()) {
    const t = timeOfSnapshot(id);
    if (!t) continue;
    const age = now.getTime() - new Date(t).getTime();
    if (age > 30 * DAY) drop.push(id);
    else if (age > 2 * DAY) {
      const day = t.slice(0, 10);
      const prev = lastOfDay.get(day);
      if (prev) drop.push(prev);
      lastOfDay.set(day, id);
    }
  }
  return drop;
}

/** 위 정책대로 오래된 스냅샷을 지운다. */
export function pruneHistory(root: string, rel: string, now = new Date()): number {
  const dir = historyDir(root, rel);
  if (!existsSync(dir)) return 0;
  const drop = pruneCandidates(readdirSync(dir), now);
  for (const id of drop) {
    try {
      unlinkSync(path.join(dir, id));
    } catch {
      // 이미 없으면 무시
    }
  }
  return drop.length;
}
