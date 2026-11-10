/**
 * 작가 모드 '이전 회차' 찾기(순수 함수).
 *
 * 같은 작품의 회차 폴더(하위 폴더 포함) 안 노트를 숫자 인식 자연 정렬해
 * 현재 노트의 바로 앞 노트를 돌려준다. 첫 회차·회차 폴더 밖·빈 폴더면 null.
 */

export interface EpisodeWork {
  name: string;
  /** 실제 회차 폴더 경로(연재 `회차`/`Episodes`, 출판형 `원고`/`Manuscript`) */
  episodeFolder: string;
  episodeRows: { path: string }[];
}

const under = (path: string, folder: string) => path === folder || path.startsWith(`${folder}/`);

/** 숫자 인식 자연 정렬(001화 < 002화 < 10화, 1권 < 10권). 경로 전체를 비교해 권 폴더 순서도 따른다. */
export function compareEpisodePaths(a: string, b: string, locale?: string): number {
  return new Intl.Collator(locale, { numeric: true, sensitivity: 'base' }).compare(a, b);
}

/**
 * 현재 노트의 이전 회차 경로. 회차 폴더 안의 노트만 대상으로 하고,
 * 현재 노트가 목록에 없으면(아직 색인 전) 현재 경로를 넣어 같은 규칙으로 찾는다.
 */
export function previousEpisodePath(works: EpisodeWork[], current: string, locale?: string): string | null {
  if (!current) return null;
  // 회차 폴더가 겹치면 더 깊은(=정확한) 폴더를 쓴다.
  const work = works
    .filter((w) => under(current, w.episodeFolder))
    .sort((a, b) => b.episodeFolder.length - a.episodeFolder.length)[0];
  if (!work) return null;
  const paths = new Set(
    work.episodeRows.map((r) => r.path).filter((p) => under(p, work.episodeFolder)),
  );
  paths.add(current);
  if (paths.size < 2) return null;
  const sorted = [...paths].sort((a, b) => compareEpisodePaths(a, b, locale));
  const at = sorted.indexOf(current);
  return at > 0 ? sorted[at - 1]! : null;
}
