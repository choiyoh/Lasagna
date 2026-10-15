import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseNote } from '@nopsidian/core';

/**
 * 노트 한 개를 색인에 넣기 위해 파일에서 뽑아 둔 값 전부(SQLite 와 무관한 순수 데이터).
 * 파싱(가장 비싼 부분)은 여러 스레드에서, SQLite 쓰기는 색인 스레드 한 곳에서 하려고 둘을 나눈다.
 */
export interface IndexRecord {
  rel: string;
  mtime: number;
  size: number;
  hash: string;
  content: string;
  title: string;
  folder: string;
  /** 프런트매터 data 의 JSON */
  frontmatter: string;
  cover: string | null;
  noteId: string | null;
  aliases: string[];
  headings: { level: number; text: string; slug: string; line: number }[];
  blocks: { blockId: string | null; kind: string; index: number; text: string; headingLevel: number | null; lineStart: number; lineEnd: number }[];
  tags: { tag: string; source: string }[];
  links: { srcBlock: string | null; target: string; heading: string | null; block: string | null; kind: string; line: number }[];
}

const IMG_EXT = '(?:png|jpe?g|gif|webp|avif|svg)';
const WIKI_IMG = new RegExp(`!\\[\\[([^\\]|#]+\\.${IMG_EXT})`, 'i');
const MD_IMG = new RegExp(`!\\[[^\\]]*\\]\\(<?([^)>\\s]+\\.${IMG_EXT})`, 'i');

/** 본문에서 처음 나오는 이미지 참조(`![[a.png]]` 또는 `![](a.png)`) — 갤러리 커버용 */
export function firstImage(body: string): string | null {
  const a = WIKI_IMG.exec(body);
  const b = MD_IMG.exec(body);
  const hit = a && b ? (a.index <= b.index ? a : b) : (a ?? b);
  return hit ? decodeURI(hit[1]!.trim()) : null;
}

/** 파일을 읽고 파싱해 색인 레코드를 만든다. 읽을 수 없으면 null. */
export function buildIndexRecord(root: string, rel: string): IndexRecord | null {
  const full = path.join(root, rel);
  let content: string;
  let st;
  try {
    st = statSync(full);
    content = readFileSync(full, 'utf8');
  } catch {
    return null;
  }
  const note = parseNote(content);
  const { meta, blocks } = note;
  const dir = path.posix.dirname(rel);
  const seenTags = new Set<string>();
  const tags: IndexRecord['tags'] = [];
  for (const t of meta.tags) {
    const key = `${t.tag}\0${t.source}`;
    if (seenTags.has(key)) continue;
    seenTags.add(key);
    tags.push({ tag: t.tag, source: t.source });
  }
  return {
    rel,
    mtime: st.mtimeMs,
    size: st.size,
    hash: createHash('sha256').update(content).digest('hex'),
    content,
    title: meta.title || path.posix.basename(rel, path.posix.extname(rel)),
    folder: dir === '.' ? '' : dir,
    frontmatter: JSON.stringify(note.frontmatter?.data ?? {}),
    cover: firstImage(content.slice(note.frontmatter?.end ?? 0)),
    noteId: meta.id ?? null,
    aliases: meta.aliases,
    headings: meta.headings.map((h) => ({ level: h.level, text: h.text, slug: h.slug, line: h.line })),
    blocks: blocks.map((b) => ({ blockId: b.blockId ?? null, kind: b.kind, index: b.index, text: b.text, headingLevel: b.headingLevel ?? null, lineStart: b.lineStart, lineEnd: b.lineEnd })),
    tags,
    links: meta.links.map((l) => ({
      srcBlock: blocks.find((b) => l.line >= b.lineStart && l.line <= b.lineEnd)?.blockId ?? null,
      target: l.target,
      heading: l.heading ?? null,
      block: l.block ?? null,
      kind: l.kind,
      line: l.line,
    })),
  };
}
