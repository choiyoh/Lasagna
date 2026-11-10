/**
 * 작가 모드에서 '회차 노트'인지 판정하는 순수 함수.
 *
 * 작품의 회차 폴더(연재 `회차`/`Episodes`, 출판형 `원고`/`Manuscript`)와 그 하위 폴더 안이면 회차 노트다.
 * 판정에는 W3 `note.workList` 의 작품 정보(회차 폴더 경로)를 그대로 쓴다 — 새 IPC 없음.
 * 작품 목록을 아직 받지 못했으면(빈 배열) 모든 노트가 회차가 아니므로 상태줄은 숨김 상태로 시작한다.
 */

export interface EpisodeNoteWork {
  /** 실제 회차 폴더 경로 */
  episodeFolder: string;
}

const under = (path: string, folder: string) => path === folder || path.startsWith(`${folder}/`);

export function isEpisodeNote(works: readonly EpisodeNoteWork[], path: string): boolean {
  if (!path) return false;
  return works.some((work) => !!work.episodeFolder && under(path, work.episodeFolder));
}
