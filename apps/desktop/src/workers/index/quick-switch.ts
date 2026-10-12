/**
 * 빠른 전환기(Cmd+O)용 노트 검색.
 *
 * 제목·별칭·경로를 대상으로 일반 퍼지 검색과 한글 초성 검색(ㅋㄹㅋㄷ → 클린 코드)을 모두 지원하는
 * 순수 함수다. 렌더러/에디터에 의존하지 않도록 초성 추출을 이 파일에 독립적으로 구현했다
 * (packages/editor/src/ui/notion/NotionUi.ts 의 CHOSEONG/getChoseong 과 같은 방식).
 */

export interface SwitchNote {
  path: string;
  title: string;
  aliases: string[];
}

export interface SwitchHit {
  path: string;
  title: string;
  /** 일치한 필드: 제목이면 'title', 별칭이면 해당 별칭 문자열을 matchedText에 */
  field: 'title' | 'alias' | 'path';
  matchedText: string;
  score: number;
  /** matchedText 안에서 일치한 [시작, 끝) 구간들 — 화면에서 강조할 곳 (겹치지 않고 정렬됨) */
  ranges: Array<[number, number]>;
}

type Field = SwitchHit['field'];

const CHOSEONG = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

const HANGUL_BASE = 0xac00;
const HANGUL_LAST = 0xd7a3;
/** 중성 21 × 종성 28 — 초성 하나가 차지하는 코드포인트 수 */
const SYLLABLE_SPAN = 588;

const JAMO_ONLY = /^[ㄱ-ㅎ]+$/;

/**
 * 한글 음절은 초성 자모로 바꾸고 나머지 문자는 그대로 둔다.
 * 문자가 1:1로 대응하므로(길이 보존) 초성에서 찾은 구간을 원문 위치로 그대로 쓸 수 있다.
 */
export function choseongOf(text: string): string {
  const out: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    out.push(code >= HANGUL_BASE && code <= HANGUL_LAST ? CHOSEONG[Math.floor((code - HANGUL_BASE) / SYLLABLE_SPAN)]! : text[i]!);
  }
  return out.join('');
}

type MatchKind = 'exact' | 'prefix' | 'wordStart' | 'substring' | 'fuzzy';

interface TextMatch {
  kind: MatchKind;
  ranges: Array<[number, number]>;
  /** 같은 일치 종류 안에서의 미세 순위(현재는 부분 수열에만 쓰인다) */
  quality: number;
}

interface Candidate {
  field: Field;
  matchedText: string;
  score: number;
  ranges: Array<[number, number]>;
}

/**
 * 일치 종류별 기본 점수. 종류가 다르면 필드(제목/별칭/경로)보다 항상 우선한다.
 * 예) 별칭 전체 일치(100_500) > 제목 접두 일치(81_000) > ... > 경로 부분 수열(최대 499).
 */
const KIND_SCORE: Record<MatchKind, number> = {
  exact: 100_000,
  prefix: 80_000,
  wordStart: 60_000,
  substring: 40_000,
  fuzzy: 0,
};

/** 같은 일치 종류에서의 필드 가산점: 제목 > 별칭 > 경로 */
const FIELD_SCORE: Record<Field, number> = { title: 1_000, alias: 500, path: 0 };

/** 부분 수열 품질 가산점 상한. 필드 간 최소 간격(500)보다 작아야 필드 우선순위가 유지된다. */
const QUALITY_MAX = 499;

/** 단어 시작으로 인정하는 구분자(공백·하이픈·밑줄·경로 구분) */
const WORD_SEPARATORS = new Set([' ', '-', '_', '/']);

/**
 * 1:1 위치 대응을 유지한 소문자화. 'İ' 처럼 소문자화가 길이를 바꾸는 문자는 원문을 그대로 둔다.
 */
function lowerUnits(text: string): string {
  const lower = text.toLowerCase();
  if (lower.length === text.length) return lower;
  return Array.from(text, (ch) => {
    const mapped = ch.toLowerCase();
    return mapped.length === 1 ? mapped : ch;
  }).join('');
}

/** 구분자 바로 뒤에서 처음 나타나는 위치(0은 접두 일치가 이미 처리하므로 제외) */
function findWordStart(haystack: string, needle: string): number {
  for (let from = 1; ; ) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return -1;
    if (WORD_SEPARATORS.has(haystack[at - 1]!)) return at;
    from = at + 1;
  }
}

/** 질의 글자가 순서대로 흩어져 나타나는지 확인하고, 연속 구간 단위의 강조 구간을 만든다. */
function matchSubsequence(haystack: string, query: string): TextMatch | null {
  const positions: number[] = [];
  for (let i = 0, from = 0; i < query.length; i++) {
    const at = haystack.indexOf(query[i]!, from);
    if (at < 0) return null;
    positions.push(at);
    from = at + 1;
  }

  const ranges: Array<[number, number]> = [];
  let runStart = positions[0]!;
  let runLength = 1;
  let longestRun = 1;
  let adjacent = 0;
  for (let i = 1; i < positions.length; i++) {
    if (positions[i] === positions[i - 1]! + 1) {
      runLength++;
      adjacent++;
      if (runLength > longestRun) longestRun = runLength;
    } else {
      ranges.push([runStart, runStart + runLength]);
      runStart = positions[i]!;
      runLength = 1;
    }
  }
  ranges.push([runStart, runStart + runLength]);

  const contiguity = adjacent / (query.length - 1);
  const earliness = Math.max(0, 60 - positions[0]!);
  const quality = Math.min(QUALITY_MAX, Math.round(longestRun * 60 + contiguity * 150 + earliness));
  return { kind: 'fuzzy', ranges, quality };
}

/**
 * 변환된 문자열(mapped)에서 질의를 찾는다. mapped 는 원문과 길이가 같아야 한다.
 * allowFuzzy 가 false 면 부분 수열은 시도하지 않는다.
 */
function matchIn(mapped: string, raw: string, query: string, allowFuzzy: boolean): TextMatch | null {
  if (mapped === query) return { kind: 'exact', ranges: [[0, raw.length]], quality: 0 };
  if (mapped.startsWith(query)) return { kind: 'prefix', ranges: [[0, query.length]], quality: 0 };

  const wordStart = findWordStart(mapped, query);
  if (wordStart > 0) return { kind: 'wordStart', ranges: [[wordStart, wordStart + query.length]], quality: 0 };

  const at = mapped.indexOf(query);
  if (at >= 0) return { kind: 'substring', ranges: [[at, at + query.length]], quality: 0 };

  return allowFuzzy && query.length >= 2 ? matchSubsequence(mapped, query) : null;
}

/** 한 필드에서 가장 좋은 일치를 찾는다. */
function fieldCandidate(field: Field, text: string, query: string, choseong: boolean): Candidate | null {
  const match = choseong
    ? matchIn(choseongOf(text), text, query, true)
    : matchIn(lowerUnits(text), text, query, true);
  if (!match) return null;
  return {
    field,
    matchedText: text,
    score: KIND_SCORE[match.kind] + FIELD_SCORE[field] + match.quality,
    ranges: match.ranges,
  };
}

/** 점수가 더 높은 쪽을 남긴다(동점이면 앞선 후보 유지 — 제목이 먼저 들어온다). */
function better(current: Candidate | null, next: Candidate | null): Candidate | null {
  if (!next) return current;
  if (!current) return next;
  return next.score > current.score ? next : current;
}

function compareHits(a: SwitchHit, b: SwitchHit): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.title.length !== b.title.length) return a.title.length - b.title.length;
  if (a.path === b.path) return 0;
  return a.path < b.path ? -1 : 1;
}

/**
 * 빠른 전환기 검색.
 *
 * - 공백뿐인 질의: 입력 순서대로 앞에서 `limit`개(score 0, ranges 없음).
 * - 자모(ㄱ-ㅎ)로만 이뤄진 질의: 제목/별칭/경로의 초성에서 찾는다(글자 구간은 원문 기준).
 * - 그 밖: 전체 > 접두 > 단어 시작 > 부분 문자열 > 부분 수열 순으로 시도하고 점수가 높은 쪽을 쓴다.
 * - 필드 우선순위는 제목 > 별칭 > 경로이며, 같은 노트는 한 번만 나온다.
 * - 점수가 같으면 제목이 짧은 것, 그다음 경로 오름차순으로 정렬한다(결정적).
 */
export function quickSwitch(notes: readonly SwitchNote[], query: string, limit = 30): SwitchHit[] {
  const q = query.trim().toLowerCase();
  const cap = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;

  if (q.length === 0) {
    return notes.slice(0, cap).map((note): SwitchHit => ({
      path: note.path,
      title: note.title,
      field: 'title',
      matchedText: note.title,
      score: 0,
      ranges: [],
    }));
  }
  if (cap === 0) return [];

  const choseong = JAMO_ONLY.test(q);
  const hits: SwitchHit[] = [];

  for (const note of notes) {
    let best = fieldCandidate('title', note.title, q, choseong);
    for (const alias of note.aliases) {
      best = better(best, fieldCandidate('alias', alias, q, choseong));
    }
    best = better(best, fieldCandidate('path', note.path, q, choseong));
    if (!best) continue;

    hits.push({
      path: note.path,
      title: note.title,
      field: best.field,
      matchedText: best.matchedText,
      score: best.score,
      ranges: best.ranges,
    });
  }

  hits.sort(compareHits);
  return hits.slice(0, cap);
}
