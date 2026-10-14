import { setFrontmatter } from '@nopsidian/core/db';

/** 노트 원문의 프런트매터 `icon` 을 바꾼다(null 이면 지운다). 본문은 한 바이트도 건드리지 않는다. */
export function withNoteIcon(content: string, icon: string | null): string {
  return setFrontmatter(content, { icon: icon === null || icon.trim() === '' ? undefined : icon.trim() });
}
