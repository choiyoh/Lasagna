import type { WorkSummary } from '@nopsidian/core';

/** 열린 작품을 고르는 데 필요한 작품 폴더 정보 */
type WorkFolders = Pick<WorkSummary, 'name' | 'episodeFolder' | 'characterFolder' | 'storyBibleFolder'>;

/**
 * 노트 경로가 속한 작품 이름. 회차·캐릭터·설정집 폴더 하위면 그 작품이다.
 * 작품 폴더가 겹치면(중첩) 더 깊은 폴더가 이긴다.
 */
export function workOfPath(works: readonly WorkFolders[], path: string | null | undefined): string | null {
  if (!path) return null;
  let best: string | null = null;
  let bestLength = -1;
  for (const work of works) {
    for (const folder of [work.episodeFolder, work.characterFolder, work.storyBibleFolder]) {
      if (!folder) continue;
      if (!path.startsWith(`${folder}/`)) continue;
      if (folder.length > bestLength) {
        best = work.name;
        bestLength = folder.length;
      }
    }
  }
  return best;
}

export interface OpenWorkChoice {
  /** 현재 열린 노트가 속한 작품 */
  current: string | null;
  /** 사용자가 목록에서 직접 고른 작품(있으면 가장 세다) */
  picked?: string | null;
  /** 마지막으로 확장했거나 연 작품(sessionStorage 수준) */
  last?: string | null;
}

/**
 * 열린 작품 결정: 사용자가 고른 작품 → 현재 노트의 작품 → 마지막으로 연 작품 → 첫 작품.
 * 목록에 없는 이름(지워졌거나 이름이 바뀐 작품)은 건너뛴다.
 */
export function resolveOpenWork(works: readonly { name: string }[], { current, picked, last }: OpenWorkChoice): string | null {
  if (works.length === 0) return null;
  const exists = (name: string | null | undefined): name is string => !!name && works.some((w) => w.name === name);
  if (exists(picked)) return picked;
  if (exists(current)) return current;
  if (exists(last)) return last;
  return works[0]!.name;
}
