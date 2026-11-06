import { t } from '@nopsidian/i18n';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { visit } from 'unist-util-visit';
import { toString } from 'mdast-util-to-string';
import type { Root, RootContent } from 'mdast';
import { asStringList, splitFrontmatter } from './frontmatter.js';
import {
  countNewlines,
  findTags,
  findWikiLinks,
  parseCalloutHead,
  parseFenceLine,
  slugify,
} from './inline.js';
import type {
  Block,
  BlockKind,
  Frontmatter,
  NoteMeta,
  ParsedBlockId,
  ParsedHeading,
  ParsedLink,
  ParsedNote,
  ParsedTag,
} from './types.js';

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

/** 본문(프런트매터 제외)을 mdast로 파싱한다. 위치(offset)는 `body` 기준이다. */
export function parseTree(body: string): Root {
  return processor.parse(body) as Root;
}

export const NO_INLINE_SCAN: ReadonlySet<BlockKind> = new Set(['code', 'math', 'html']);

/** 인라인 코드 구간을 같은 길이의 공백으로 가린다(줄바꿈은 유지해 줄 번호가 어긋나지 않게). */
export function maskInlineCode(s: string): string {
  return s.replace(/(`+)[\s\S]*?\1/g, (m) => m.replace(/[^\n]/g, ' '));
}

function kindOf(node: RootContent, source: string): BlockKind {
  switch (node.type) {
    case 'paragraph':
      return parseFenceLine(source) && !source.includes('\n') ? 'fence-open' : 'paragraph';
    case 'heading':
      return 'heading';
    case 'list':
      return 'list';
    case 'code':
      return 'code';
    case 'blockquote':
      return 'quote';
    case 'table':
      return 'table';
    case 'thematicBreak':
      return 'thematicBreak';
    case 'math':
      return 'math';
    case 'html':
      return 'html';
    default:
      return 'other';
  }
}

const BLOCK_ID_LINE = /(?:^|\s)\^([A-Za-z0-9-]+)[ \t]*\r?$/;
// 표·코드 같은 블록 뒤에 단독 줄로 붙는 `^id`
const STANDALONE_ID = /^\^([A-Za-z0-9-]+)\s*$/;

export function parseNote(source: string): ParsedNote {
  const frontmatter = splitFrontmatter(source);
  const bodyOffset = frontmatter?.end ?? 0;
  const body = source.slice(bodyOffset);
  const lineBase = countNewlines(source, bodyOffset);
  const tree = processor.parse(body) as Root;

  const blocks: Block[] = [];
  for (const node of tree.children) {
    const pos = node.position;
    if (!pos || pos.start.offset === undefined || pos.end.offset === undefined) continue;
    const start = pos.start.offset + bodyOffset;
    const end = pos.end.offset + bodyOffset;
    const text = source.slice(start, end);
    let kind = kindOf(node, text);
    const block: Block = {
      index: blocks.length,
      kind,
      start,
      end,
      source: text,
      lineStart: pos.start.line + lineBase,
      lineEnd: pos.end.line + lineBase,
      text: node.type === 'heading' ? toString(node).replace(/\s*\{\.toggle\}(?=\s*(?:\^[A-Za-z0-9-]+\s*)?$)/, '') : toString(node),
    };
    if (node.type === 'heading') block.headingLevel = node.depth;
    if (kind === 'fence-open') {
      const f = parseFenceLine(text);
      if (f) {
        block.fence = f;
        if (!f.name) {
          kind = 'fence-close';
          block.kind = kind;
        }
      }
    }
    if (node.type === 'blockquote') {
      const first = text.split('\n', 1)[0] ?? '';
      const head = parseCalloutHead(first.replace(/^>[ \t]?/, ''));
      if (head) {
        block.kind = 'callout';
        block.callout = head;
      }
    }
    blocks.push(block);
  }

  // 블록 ID: 각 줄 끝의 ^id (코드·수식·HTML 제외) + 단독 줄 `^id`는 직전 블록에 붙인다.
  const blockIds: ParsedBlockId[] = [];
  blocks.forEach((b, i) => {
    if (NO_INLINE_SCAN.has(b.kind)) return;
    if (b.kind === 'paragraph' && STANDALONE_ID.test(b.source) && i > 0) {
      const prev = blocks[i - 1]!;
      const id = STANDALONE_ID.exec(b.source)![1]!;
      prev.blockId = id;
      blockIds.push({ id, blockIndex: prev.index });
      return;
    }
    for (const line of b.source.split('\n')) {
      const m = BLOCK_ID_LINE.exec(line);
      if (m) {
        b.blockId = m[1]!;
        blockIds.push({ id: m[1]!, blockIndex: b.index });
      }
    }
  });

  const meta = extractMeta(source, frontmatter, tree, blocks, blockIds, lineBase, bodyOffset);
  return { source, frontmatter, blocks, meta };
}

function extractMeta(
  source: string,
  fm: Frontmatter | null,
  tree: Root,
  blocks: Block[],
  blockIds: ParsedBlockId[],
  lineBase: number,
  bodyOffset: number,
): NoteMeta {
  const links: ParsedLink[] = [];
  const tags: ParsedTag[] = [];
  const headings: ParsedHeading[] = [];
  // 각주 정의(`[^id]: …`) 안의 제목은 노트 개요·제목으로 세지 않는다.
  const footnoteRanges = blocks.filter((b) => /^\[\^[^\]]+\]:/.test(b.source)).map((b) => [b.start, b.end] as const);
  const inFootnote = (offset: number | undefined) =>
    offset !== undefined && footnoteRanges.some(([start, end]) => offset + bodyOffset >= start && offset + bodyOffset < end);

  // 위키링크·임베드·인라인 태그는 원문에서 직접 찾는다(강조 기호 등으로 텍스트 노드가 쪼개져도 안전).
  for (const b of blocks) {
    if (NO_INLINE_SCAN.has(b.kind)) continue;
    const masked = maskInlineCode(b.source);
    links.push(...findWikiLinks(masked, b.lineStart));
    const withoutLinks = masked.replace(/!?\[\[[^[\]\n]+?\]\]/g, (m) => ' '.repeat(m.length));
    for (const tag of findTags(withoutLinks)) tags.push({ tag, source: 'inline' });
  }

  visit(tree, (node) => {
    if (node.type === 'heading') {
      if (inFootnote(node.position?.start.offset)) return;
      const text = toString(node).replace(/\s+\^[A-Za-z0-9-]+\s*$/, '').replace(/\s*\{\.toggle\}\s*$/, '').trim();
      headings.push({
        level: node.depth,
        text,
        slug: slugify(text),
        line: (node.position?.start.line ?? 1) + lineBase,
      });
    } else if (node.type === 'link' || node.type === 'image') {
      const url = node.url;
      if (!url || /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//')) return;
      if (url.startsWith('#')) return;
      const [pathPart = '', frag] = url.split('#');
      let target = pathPart;
      try {
        target = decodeURIComponent(pathPart);
      } catch {
        // 잘못된 인코딩은 원문 그대로 둔다
      }
      if (!target) return;
      const link: ParsedLink = {
        kind: node.type === 'image' ? 'embed' : 'md',
        target,
        line: (node.position?.start.line ?? 1) + lineBase,
      };
      if (frag) link.heading = frag;
      links.push(link);
    }
  });

  let aliases: string[] = [];
  let id: string | undefined;
  let fmTitle: string | undefined;
  if (fm) {
    aliases = asStringList(fm.data.aliases);
    for (const t of asStringList(fm.data.tags)) tags.push({ tag: t.replace(/^#/, ''), source: 'frontmatter' });
    if (typeof fm.data.id === 'string') id = fm.data.id;
    if (typeof fm.data.title === 'string') fmTitle = fm.data.title;
    for (const [key, value] of Object.entries(fm.data)) {
      if (key === 'aliases' || key === 'tags') continue;
      const strings = Array.isArray(value) ? value : [value];
      for (const s of strings) {
        if (typeof s !== 'string') continue;
        for (const l of findWikiLinks(s, 1)) links.push({ ...l, kind: 'relation' });
      }
    }
  }

  const h1 = headings.find((h) => h.level === 1);
  const meta: NoteMeta = {
    title: fmTitle ?? h1?.text ?? '',
    aliases,
    tags,
    headings,
    links,
    blockIds,
  };
  if (id) meta.id = id;
  void source;
  return meta;
}

/** 원문을 [프런트매터][블록 + 사이 공백]… 으로 다시 조립한다. 항상 원문과 같아야 한다(분할 검증용). */
export function assemble(note: ParsedNote): string {
  let out = '';
  let pos = 0;
  for (const b of note.blocks) {
    out += note.source.slice(pos, b.start) + b.source;
    pos = b.end;
  }
  return out + note.source.slice(pos);
}

/** i번째 블록의 원문만 교체한 새 문서 원문. 나머지 바이트는 그대로 유지된다. */
export function replaceBlock(note: ParsedNote, index: number, newSource: string): string {
  const b = note.blocks[index];
  if (!b) throw new RangeError(t('core.err.blockMissing', { index }));
  return note.source.slice(0, b.start) + newSource + note.source.slice(b.end);
}
