/**
 * 작가용 사이드바의 작품 인식·집계(순수 함수).
 *
 * 작품 = 볼트 루트 바로 아래 폴더 중 W2 가 만드는 회차·캐릭터 폴더를 **둘 다** 가진 폴더.
 * 한국어 이름만/영어 이름만 있어도 그 언어의 작품으로 인식하고, 설정집·템플릿 유무는 따지지 않는다.
 * 회차 수·글자수는 회차 폴더(하위 폴더 포함)의 노트 기준이다.
 */
import { translate } from '@nopsidian/i18n';
import type { TextStats } from './text-stats.js';

type Chars = Pick<TextStats, 'chars' | 'charsNoSpace'>;

export interface WorkRoot {
  /** 볼트 루트 기준 작품 폴더 이름 */
  name: string;
  /** 실제로 존재하는 회차 폴더 경로(한국어/영어) */
  episodeFolders: string[];
  characterFolders: string[];
  /** 설정집 폴더가 있으면 그 경로 */
  storyBibleFolders: string[];
  /** 이 작품을 인식한 언어(카드 문구는 UI 언어를 따르므로 참고용) */
  locale: 'ko' | 'en';
}

export interface WorkSummary {
  name: string;
  episodes: number;
  characters: number;
  /** 설정집 폴더가 없으면 null(칩 숨김) */
  storyBible: number | null;
  /** 실제 폴더 경로(칩을 누르면 이 폴더를 펼친다) */
  episodeFolder: string;
  characterFolder: string;
  storyBibleFolder: string | null;
  chars: number;
  charsNoSpace: number;
  /** 회차 폴더 안 노트별 글자수(트리 행 배지용) */
  episodeRows: { path: string; chars: number; charsNoSpace: number }[];
}

function names(locale: 'ko' | 'en') {
  return {
    episodes: translate(locale, 'work.folder.episodes'),
    characters: translate(locale, 'work.folder.characters'),
    storyBible: translate(locale, 'work.folder.storyBible'),
  };
}

/** 볼트의 모든 폴더 경로에서 작품 루트를 찾는다. 순서는 폴더 목록 순서를 따른다. */
export function detectWorkRoots(folders: string[]): WorkRoot[] {
  const set = new Set(folders);
  const roots: string[] = [];
  for (const folder of folders) {
    if (!folder || folder.includes('/')) continue; // 루트 바로 아래 폴더만
    if (!roots.includes(folder)) roots.push(folder);
  }
  const out: WorkRoot[] = [];
  for (const name of roots) {
    const found: { episodes: string[]; characters: string[]; storyBible: string[]; locale: 'ko' | 'en' } = {
      episodes: [],
      characters: [],
      storyBible: [],
      locale: 'ko',
    };
    for (const locale of ['ko', 'en'] as const) {
      const n = names(locale);
      if (set.has(`${name}/${n.episodes}`)) found.episodes.push(`${name}/${n.episodes}`);
      if (set.has(`${name}/${n.characters}`)) found.characters.push(`${name}/${n.characters}`);
      if (set.has(`${name}/${n.storyBible}`)) found.storyBible.push(`${name}/${n.storyBible}`);
      if (found.episodes.length > 0 && found.characters.length > 0 && found.locale === 'ko' && locale === 'en' && !set.has(`${name}/${names('ko').episodes}`)) {
        found.locale = 'en';
      }
    }
    if (found.episodes.length === 0 || found.characters.length === 0) continue;
    out.push({ name, episodeFolders: found.episodes, characterFolders: found.characters, storyBibleFolders: found.storyBible, locale: found.locale });
  }
  return out;
}

const under = (path: string, folder: string) => path.startsWith(`${folder}/`);

/** 작품별 노트 수·글자수 합. `stats` 는 경로별 W1 글자수(없으면 세지 않는다). */
export function summarizeWorks(roots: WorkRoot[], notes: string[], stats: Map<string, Chars>): WorkSummary[] {
  return roots.map((root) => {
    const episodes = notes.filter((p) => root.episodeFolders.some((folder) => under(p, folder)));
    const characters = notes.filter((p) => root.characterFolders.some((folder) => under(p, folder)));
    const story = notes.filter((p) => root.storyBibleFolders.some((folder) => under(p, folder)));
    let chars = 0;
    let charsNoSpace = 0;
    const episodeRows: { path: string; chars: number; charsNoSpace: number }[] = [];
    for (const path of episodes) {
      const s = stats.get(path);
      const counted = s ?? { chars: 0, charsNoSpace: 0 };
      if (s) {
        chars += s.chars;
        charsNoSpace += s.charsNoSpace;
      }
      episodeRows.push({ path, chars: counted.chars, charsNoSpace: counted.charsNoSpace });
    }
    return {
      name: root.name,
      episodes: episodes.length,
      characters: characters.length,
      storyBible: root.storyBibleFolders.length > 0 ? story.length : null,
      episodeFolder: root.episodeFolders[0] ?? `${root.name}/`,
      characterFolder: root.characterFolders[0] ?? `${root.name}/`,
      storyBibleFolder: root.storyBibleFolders[0] ?? null,
      chars,
      charsNoSpace,
      episodeRows,
    };
  });
}
