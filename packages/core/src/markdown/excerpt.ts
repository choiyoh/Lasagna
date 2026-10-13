import { parseNote } from './parse.js';

export interface ExcerptQuery {
  heading?: string | null;
  block?: string | null;
  /** 돌려줄 글자 수 상한(기본 600) */
  maxChars?: number;
}

export interface Excerpt {
  /** 블록·제목을 못 찾았으면 false (노트 앞부분을 대신 돌려준다) */
  found: boolean;
  /** 일반 텍스트(블록마다 한 줄 이상) */
  text: string;
  truncated: boolean;
}

const clip = (text: string, max: number): { text: string; truncated: boolean } =>
  text.length > max ? { text: `${text.slice(0, max).trimEnd()}…`, truncated: true } : { text, truncated: false };

/**
 * 링크 미리보기·블록 임베드에 보여 줄 발췌.
 *  - `block`: 그 `^id`가 붙은 블록
 *  - `heading`: 그 제목 아래, 같거나 높은 단계의 다음 제목 전까지
 *  - 둘 다 없으면 본문 앞부분
 */
export function extractExcerpt(content: string, q: ExcerptQuery = {}): Excerpt {
  const max = q.maxChars ?? 600;
  const note = parseNote(content);
  const blocks = note.blocks.filter((b) => b.kind !== 'fence-open' && b.kind !== 'fence-close');
  const textOf = (bs: typeof blocks) =>
    bs
      .map((b) => b.text.replace(/\s*\^[A-Za-z0-9-]+\s*$/, '').trim())
      .filter(Boolean)
      .join('\n');

  if (q.block) {
    const i = blocks.findIndex((b) => b.blockId === q.block);
    if (i >= 0) return { found: true, ...clip(textOf([blocks[i]!]), max) };
  } else if (q.heading) {
    const want = q.heading.trim().toLowerCase();
    const i = blocks.findIndex((b) => b.kind === 'heading' && b.text.replace(/\s*\^[A-Za-z0-9-]+\s*$/, '').trim().toLowerCase() === want);
    if (i >= 0) {
      const level = blocks[i]!.headingLevel ?? 6;
      let j = i + 1;
      while (j < blocks.length && !(blocks[j]!.kind === 'heading' && (blocks[j]!.headingLevel ?? 6) <= level)) j++;
      return { found: true, ...clip(textOf(blocks.slice(i, j)), max) };
    }
  }
  const lead = textOf(blocks.filter((b) => b.kind !== 'thematicBreak'));
  return { found: !q.block && !q.heading, ...clip(lead, max) };
}
