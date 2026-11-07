import { splitFrontmatter } from './markdown/frontmatter.js';
import { parseTree } from './markdown/parse.js';

/** 작가 모드 글자수 — 보이는 글자만 센다(마크다운 기호·링크 주소·frontmatter 제외). */
export interface TextStats {
  /** 공백 포함 글자수(줄바꿈 제외) */
  chars: number;
  /** 공백·줄바꿈 제외 글자수 */
  charsNoSpace: number;
  /** 단어 수(공백으로 나눔, 영어 표기에 쓴다) */
  words: number;
}

const segmenter = new Intl.Segmenter('ko', { granularity: 'grapheme' });

/** 자소가 아니라 사용자가 보는 글자(grapheme) 수. NFC 로 정규화해 조합형·완성형 차이를 없앤다. */
export function graphemeCount(text: string): number {
  let n = 0;
  for (const segment of segmenter.segment(text.normalize('NFC'))) {
    if (segment) n += 1;
  }
  return n;
}

/** mdast 노드(파서가 만든 값·구조만 쓴다 — 원문 오프셋에 의존하지 않는다) */
interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
}

/** 인라인 조각: 코드 내용인지(코드에는 마크다운 규칙을 적용하지 않는다) */
interface Part {
  text: string;
  code: boolean;
}

const BLOCK = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'list',
  'listItem',
  'code',
  'table',
  'tableRow',
  'footnoteDefinition',
  'math',
  'html',
  'thematicBreak',
]);

const HIDDEN = new Set(['math', 'inlineMath', 'html', 'image', 'yaml', 'definition', 'footnoteReference']);

/** 커스텀 표식(위키링크·콜아웃·columns·toggle)을 **코드가 아닌 텍스트**에서만 제거한다. */
function stripCustomMarkers(parts: Part[], ctx: { callout: boolean; heading: boolean }): string {
  // 붙여 놓고, 코드 구간은 보호 목록으로 표시한다.
  let joined = '';
  const protectedRanges: [number, number][] = [];
  for (const part of parts) {
    const start = joined.length;
    joined += part.text;
    if (part.code) protectedRanges.push([start, joined.length]);
  }
  const inProtected = (from: number, to: number) => protectedRanges.some(([a, b]) => from < b && to > a);
  const hidden: [number, number][] = [];
  const hide = (from: number, to: number) => {
    if (to > from) hidden.push([from, to]);
  };
  /** 코드 내용을 건드리면 안 되는 규칙(콜아웃·columns·toggle)용 */
  const hideOutsideCode = (from: number, to: number) => {
    if (to > from && !inProtected(from, to)) hidden.push([from, to]);
  };

  // 위키링크: 링크 **전체가 코드 조각 안**에 있으면 손대지 않는다(인라인 코드 내용 보호).
  const entirelyInCode = (from: number, to: number) => protectedRanges.some(([a, b]) => from >= a && to <= b);
  for (const m of joined.matchAll(/!?\[\[([^\]|#]*)(#[^\]|]*)?(\|([^\]]*))?\]\]/g)) {
    const at = m.index ?? 0;
    const end = at + m[0].length;
    if (entirelyInCode(at, end)) continue;
    if (m[0].startsWith('!')) {
      hide(at, end);
    } else if (m[4] !== undefined) {
      const aliasAt = at + m[0].indexOf('|') + 1;
      hide(at, aliasAt);
      hide(aliasAt + m[4].length, end);
    } else {
      hide(at, at + 2);
      hide(end - 2, end);
    }
  }
  // 콜아웃 표식은 인용 블록 첫 줄 맨 앞에서만
  if (ctx.callout) {
    const m = /^[ \t]*\[![^\]]+\][ \t]?/.exec(joined);
    if (m) hideOutsideCode(0, m[0].length);
  }
  // columns 표식은 줄 전체가 표식일 때만(코드 구간이면 건드리지 않는다)
  let lineStart = 0;
  while (lineStart <= joined.length) {
    const nl = joined.indexOf('\n', lineStart);
    const lineEnd = nl < 0 ? joined.length : nl;
    const line = joined.slice(lineStart, lineEnd);
    if (/^[ \t]*:{3,}[a-zA-Z-]*[ \t]*$/.test(line) && !inProtected(lineStart, lineEnd)) hideOutsideCode(lineStart, lineEnd + (nl < 0 ? 0 : 1));
    if (nl < 0) break;
    lineStart = nl + 1;
  }
  // 제목 끝의 {…} 속성만
  if (ctx.heading) {
    const m = /\{[^{}]*\}[ \t]*$/.exec(joined);
    if (m) hideOutsideCode(m.index ?? 0, joined.length);
  }

  hidden.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let out = '';
  let cursor = 0;
  for (const [from, to] of hidden) {
    if (from > cursor) out += joined.slice(cursor, from);
    cursor = Math.max(cursor, to);
  }
  out += joined.slice(cursor);
  return out;
}

/** 이스케이프된 기호는 기호만 보인다(`\*별표\*` → `*별표*`). 코드 내용은 그대로. */
const unescape = (text: string): string => text.replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, '$1');

/** 인라인 노드들을 코드 여부를 유지한 조각으로 모은다. */
function collectInline(node: MdNode, parts: Part[]): void {
  if (node.type === 'text') {
    parts.push({ text: unescape(node.value ?? ''), code: false });
    return;
  }
  if (node.type === 'inlineCode') {
    parts.push({ text: node.value ?? '', code: true });
    return;
  }
  // 하드 브레이크는 줄바꿈 — 글자수는 0 이지만 단어 구분자로는 남긴다.
  if (node.type === 'break') {
    parts.push({ text: '\n', code: false });
    return;
  }
  if (HIDDEN.has(node.type)) return;
  for (const child of node.children ?? []) collectInline(child, parts);
}

/** 문서 전체를 블록 단위로 순회하며 보이는 문자열을 만든다. */
function documentText(tree: MdNode, inQuote = false): string {
  if (tree.type === 'code') return tree.value ?? '';
  if (HIDDEN.has(tree.type)) return '';
  if (tree.type === 'table' || tree.type === 'tableRow' || tree.type === 'list' || tree.type === 'listItem' || tree.type === 'blockquote' || tree.type === 'footnoteDefinition') {
    const children = tree.children ?? [];
    if (tree.type === 'blockquote') {
      // 콜아웃 표식은 인용 블록의 **첫 문단 첫 줄 맨 앞**에서만 제외한다(중첩 인용의 첫 문단도 동일).
      return children.map((c, i) => documentText(c, i === 0)).join('\n');
    }
    return children.map((c) => documentText(c, inQuote)).join('\n');
  }
  if (BLOCK.has(tree.type)) {
    const parts: Part[] = [];
    collectInline(tree, parts);
    return stripCustomMarkers(parts, { callout: inQuote && tree.type === 'paragraph', heading: tree.type === 'heading' });
  }
  if (tree.type === 'root') {
    const chunks = (tree.children ?? []).map((c) => documentText(c, inQuote));
    return chunks.join('\n');
  }
  // 그 밖의 인라인 컨테이너(link·emphasis·strong·delete·footnoteDefinition 안 등)
  const parts: Part[] = [];
  collectInline(tree, parts);
  return stripCustomMarkers(parts, { callout: false, heading: false });
}

/** 마크다운 원문의 보이는 문자열(파서 값 기반) */
export function visibleText(markdown: string): string {
  const source = markdown.replace(/\r\n?/g, '\n');
  const frontmatter = splitFrontmatter(source);
  const body = source.slice(frontmatter?.end ?? 0);
  if (body === '') return '';
  const tree = parseTree(body) as unknown as MdNode;
  // 블록 사이는 줄바꿈 하나로 잇는다(단어 구분자)
  return documentText(tree);
}

/** 이미 보이는 텍스트(에디터 선택 등)의 글자수 — 마크다운 해석 없이 그대로 센다. */
export function countPlain(text: string): TextStats {
  const normalized = text.normalize('NFC');
  const chars = graphemeCount(normalized.replace(/\n/g, ''));
  const charsNoSpace = graphemeCount(normalized.replace(/\s/g, ''));
  const words = normalized.split(/\s+/).filter((w) => w !== '').length;
  return { chars, charsNoSpace, words };
}

const cache = new Map<string, TextStats>();

function statsFor(markdown: string): TextStats {
  const hit = cache.get(markdown);
  if (hit) {
    // LRU: 히트 시 맨 뒤로
    cache.delete(markdown);
    cache.set(markdown, hit);
    return hit;
  }
  const made = countPlain(visibleText(markdown));
  if (cache.size >= 4) cache.delete(cache.keys().next().value as string);
  cache.set(markdown, made);
  return made;
}

/** 마크다운 원문의 글자수(작가 모드 상태줄) — 같은 원문은 한 번만 계산한다. */
export function countMarkdown(markdown: string): TextStats {
  return statsFor(markdown);
}
