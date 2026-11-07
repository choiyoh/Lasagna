import { splitFrontmatter } from './markdown/frontmatter.js';
import { setFrontmatter } from './db/yaml-edit.js';

/** 문서 목표 글자수를 담는 노트 속성 키(언어와 무관한 영문 키). */
export const GOAL_CHARS_KEY = 'goal_chars';

/** 마지막 키를 지워 비어 버린 프런트매터(`---\n{}\n---`)는 통째로 없앤다. */
const dropEmptyFrontmatter = (s: string) => s.replace(/^---\r?\n\{\}\r?\n---\r?\n/, '');

/**
 * 노트 원문의 목표 글자수. 없거나 숫자가 아니거나 0 이하이면 `null`(목표 없음).
 * 원문은 읽기만 하고 바꾸지 않는다.
 */
export function readGoalChars(content: string): number | null {
  const fm = splitFrontmatter(content);
  const raw = fm?.data?.[GOAL_CHARS_KEY];
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw.trim()) : Number.NaN;
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.floor(value);
}

/**
 * 노트 원문의 목표 글자수를 설정/삭제한다(null 이면 속성 삭제). **본문은 한 바이트도 바꾸지 않는다.**
 * 프런트매터가 없으면 맨 앞에 새로 만들고, CRLF 노트는 CRLF 를 유지한다.
 */
export function withGoalChars(content: string, goal: number | null): string {
  const value = goal !== null && Number.isFinite(goal) && goal > 0 ? Math.floor(goal) : undefined;
  return dropEmptyFrontmatter(setFrontmatter(content, { [GOAL_CHARS_KEY]: value }));
}
