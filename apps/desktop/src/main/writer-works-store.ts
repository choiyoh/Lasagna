import { atomicWrite } from '@nopsidian/core';
import { parseLocalDay, type WorkGoal } from '@nopsidian/core';
import { readFileSync } from 'node:fs';

interface WriterWorksFile {
  version: 1;
  /** vaultId → 작품 폴더 이름 → 목표 */
  vaults: Record<string, Record<string, WorkGoal>>;
}

const EMPTY = (): WriterWorksFile => ({ version: 1, vaults: {} });

function isGoal(value: unknown): value is WorkGoal {
  if (!value || typeof value !== 'object') return false;
  const g = value as Record<string, unknown>;
  return (
    typeof g.episodes === 'number' &&
    Number.isFinite(g.episodes) &&
    typeof g.perEpisode === 'number' &&
    Number.isFinite(g.perEpisode) &&
    (g.basis === 'include' || g.basis === 'exclude') &&
    (g.deadline === null || typeof g.deadline === 'string') &&
    (g.preset === 'naver' || g.preset === 'kakao' || g.preset === 'ridi' || g.preset === 'custom')
  );
}

/** 깨진 마감일(형식·존재하지 않는 날짜)은 그 필드만 버리고 목표는 살린다. */
function normalize(goal: WorkGoal): WorkGoal {
  if (goal.deadline !== null && !parseLocalDay(goal.deadline)) return { ...goal, deadline: null };
  return goal;
}

/** userData/writer-works.json — 작품 목표(볼트·노트에는 기록하지 않는다). 깨지면 빈 값으로 복구. */
export class WriterWorksStore {
  private data: WriterWorksFile | null = null;

  constructor(private readonly file: string) {}

  private load(): WriterWorksFile {
    if (this.data) return this.data;
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<WriterWorksFile> | null;
      if (!raw || raw.version !== 1 || typeof raw.vaults !== 'object' || raw.vaults === null) {
        this.data = EMPTY();
        return this.data;
      }
      const vaults: Record<string, Record<string, WorkGoal>> = {};
      for (const [vaultId, works] of Object.entries(raw.vaults)) {
        if (!works || typeof works !== 'object') continue;
        const clean: Record<string, WorkGoal> = {};
        for (const [work, goal] of Object.entries(works)) if (isGoal(goal)) clean[work] = normalize(goal);
        if (Object.keys(clean).length > 0) vaults[vaultId] = clean;
      }
      this.data = { version: 1, vaults };
    } catch {
      this.data = EMPTY();
    }
    return this.data;
  }

  all(vaultId: string): Record<string, WorkGoal> {
    return this.load().vaults[vaultId] ?? {};
  }

  set(vaultId: string, work: string, goal: WorkGoal | null): Record<string, WorkGoal> {
    const data = this.load();
    const works = { ...(data.vaults[vaultId] ?? {}) };
    if (goal === null) delete works[work];
    else works[work] = normalize(goal);
    const next: WriterWorksFile = {
      version: 1,
      vaults: { ...data.vaults, ...(Object.keys(works).length > 0 ? { [vaultId]: works } : {}) },
    };
    if (Object.keys(works).length === 0) delete next.vaults[vaultId];
    atomicWrite(this.file, `${JSON.stringify(next, null, 2)}\n`);
    this.data = next;
    return works;
  }
}
