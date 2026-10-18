import { setFrontmatter } from '@nopsidian/core/db';

/** 마지막 키를 지워 비어 버린 프런트매터(`---\n{}\n---`)는 통째로 없앤다 */
const dropEmptyFrontmatter = (s: string) => s.replace(/^---\r?\n\{\}\r?\n---\r?\n/, '');

/** 노트 원문의 프런트매터 `icon` 을 바꾼다(null 이면 지운다). 본문은 한 바이트도 건드리지 않는다. */
export function withNoteIcon(content: string, icon: string | null): string {
  return dropEmptyFrontmatter(setFrontmatter(content, { icon: icon === null || icon.trim() === '' ? undefined : icon.trim() }));
}

/** 노트 원문의 프런트매터 `cover` 를 바꾼다(null 이면 지운다). 본문은 한 바이트도 건드리지 않는다. */
export function withNoteCover(content: string, cover: string | null): string {
  return dropEmptyFrontmatter(setFrontmatter(content, { cover: cover === null || cover.trim() === '' ? undefined : cover.trim() }));
}
