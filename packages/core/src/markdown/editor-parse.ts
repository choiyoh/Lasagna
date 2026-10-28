import type { RootContent } from 'mdast';
import { maskInlineCode, NO_INLINE_SCAN, parseNote, parseTree } from './parse.js';
import type { ParsedNote } from './types.js';

/**
 * 에디터 변환용 파싱.
 *
 * 위키링크·임베드·하이라이트는 mdast에 없는 문법이라, 파싱 전에 같은 길이의 자리표시자로 바꿔 둔다.
 * (길이와 줄바꿈이 같으므로 블록 경계·오프셋이 원문과 그대로 일치한다.)
 * 자리표시자 형식: [MARK][인덱스 상위][인덱스 하위][FILL…]  — 모두 유니코드 사설 영역 문자.
 */
export type InlineTokenKind = 'wikilink' | 'embed' | 'highlight' | 'footnote-inline';

export interface InlineToken {
  kind: InlineTokenKind;
  /** wikilink/embed: `[[`와 `]]` 사이, highlight: `==` 사이 텍스트 */
  inner: string;
  /** 원문에서 차지하는 길이 */
  length: number;
}

const MARK = 0xe000;
const FILL = 0xe0ff;
const IDX_BASE = 0xe100;

export interface EditorParse {
  note: ParsedNote;
  /** 프런트매터를 뺀 본문 원문 */
  body: string;
  bodyOffset: number;
  /** `note.blocks`와 같은 순서·같은 개수의 최상위 mdast 노드 (위치는 `body` 기준) */
  nodes: RootContent[];
  tokens: InlineToken[];
}

const WIKI = /(!?)\[\[([^[\]\n]+?)\]\]/g;
const HIGHLIGHT = /==([^=\n*_`~[\]\\<>|]+?)==/g;
const INLINE_MATH = /\$[^$\n]+\$/g;
const INLINE_FOOTNOTE = /\^\[([^[\]\n]+?)\]/g;

function blank(s: string, re: RegExp): string {
  return s.replace(re, (m) => ' '.repeat(m.length));
}

function encode(index: number, length: number): string {
  let out = String.fromCharCode(MARK, IDX_BASE + ((index >> 8) & 0xff), IDX_BASE + (index & 0xff));
  while (out.length < length) out += String.fromCharCode(FILL);
  return out;
}

function maskSegment(segment: string, tokens: InlineToken[], inTable: boolean): string {
  // GFM 표 안에서는 `\|`가 셀 안의 `|`를 뜻한다
  const unescape = (s: string) => (inTable ? s.replace(/\\\|/g, '|') : s);
  const scan = blank(maskInlineCode(segment), INLINE_MATH);
  const found: { start: number; token: InlineToken }[] = [];

  for (const m of scan.matchAll(WIKI)) {
    const start = m.index ?? 0;
    if (start > 0 && scan[start - 1] === '\\') continue;
    found.push({ start, token: { kind: m[1] ? 'embed' : 'wikilink', inner: unescape(m[2] ?? ''), length: m[0].length } });
  }
  const withoutLinks = blank(scan, WIKI);
  for (const m of withoutLinks.matchAll(HIGHLIGHT)) {
    const start = m.index ?? 0;
    if (start > 0 && withoutLinks[start - 1] === '\\') continue;
    found.push({ start, token: { kind: 'highlight', inner: unescape(m[1] ?? ''), length: m[0].length } });
  }
  // Obsidian 인라인 각주 `^[내용]` — 위키링크·하이라이트·코드 안은 제외한다.
  const withoutHighlight = blank(withoutLinks, HIGHLIGHT);
  for (const m of withoutHighlight.matchAll(INLINE_FOOTNOTE)) {
    const start = m.index ?? 0;
    if (start > 0 && withoutHighlight[start - 1] === '\\') continue;
    found.push({ start, token: { kind: 'footnote-inline', inner: unescape(m[1] ?? ''), length: m[0].length } });
  }
  if (found.length === 0) return segment;
  found.sort((a, b) => a.start - b.start);

  let out = '';
  let pos = 0;
  for (const f of found) {
    out += segment.slice(pos, f.start) + encode(tokens.length, f.token.length);
    tokens.push(f.token);
    pos = f.start + f.token.length;
  }
  return out + segment.slice(pos);
}

const PRIVATE_USE = /[-]/;

export function parseForEditor(source: string): EditorParse {
  const note = parseNote(source);
  const bodyOffset = note.frontmatter?.end ?? 0;
  const body = source.slice(bodyOffset);
  const tokens: InlineToken[] = [];

  // 원문에 자리표시자와 겹치는 문자가 있으면 마스킹하지 않는다(위키링크는 일반 텍스트로 남지만 무손실이다).
  if (!PRIVATE_USE.test(body)) {
    let masked = '';
    let pos = 0;
    for (const b of note.blocks) {
      if (NO_INLINE_SCAN.has(b.kind)) continue;
      masked += body.slice(pos, b.start - bodyOffset) + maskSegment(b.source, tokens, b.kind === 'table');
      pos = b.end - bodyOffset;
    }
    masked += body.slice(pos);
    if (tokens.length > 0 && masked.length === body.length) {
      const tree = parseTree(masked);
      if (tree.children.length === note.blocks.length) {
        return { note, body, bodyOffset, nodes: tree.children, tokens };
      }
    }
  }
  const tree = parseTree(body);
  return { note, body, bodyOffset, nodes: tree.children, tokens: [] };
}

export type DecodedPart = string | { token: InlineToken };

/** mdast 텍스트 값에서 자리표시자를 찾아 토큰으로 되돌린다. */
export function decodeInline(value: string, tokens: InlineToken[]): DecodedPart[] {
  if (tokens.length === 0 || !PRIVATE_USE.test(value)) return [value];
  const parts: DecodedPart[] = [];
  let text = '';
  for (let i = 0; i < value.length; ) {
    if (value.charCodeAt(i) === MARK && i + 2 < value.length) {
      const idx = ((value.charCodeAt(i + 1) - IDX_BASE) << 8) | (value.charCodeAt(i + 2) - IDX_BASE);
      const token = tokens[idx];
      if (token) {
        if (text) parts.push(text);
        text = '';
        parts.push({ token });
        i += token.length;
        continue;
      }
    }
    text += value[i];
    i++;
  }
  if (text) parts.push(text);
  return parts;
}
