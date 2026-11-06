import { CodedError } from '../errors.js';
import type { Root, RootContent } from 'mdast';
import { parseForEditor } from './editor-parse.js';
import { maskInlineCode, NO_INLINE_SCAN } from './parse.js';
import { parseWikiInner } from './inline.js';
import type { LinkKind } from './types.js';

/**
 * 원문 안에서 링크가 차지하는 위치. 이름 변경·이동 때 링크 대상만 정확히 고쳐 쓰기 위한 것이다.
 * 모든 오프셋은 파일 전체(프런트매터 포함) 기준 [start, end).
 */
export interface LinkSpan {
  kind: LinkKind;
  /** 링크 전체 */
  start: number;
  end: number;
  /** 대상 이름(위키링크) 또는 경로(마크다운 링크)의 구간 — `#제목`·`|별칭`·`#조각`은 포함하지 않는다 */
  targetStart: number;
  targetEnd: number;
  /** 위 구간의 현재 글자(위키링크는 앞뒤 공백 포함 원문, 마크다운은 퍼센트 인코딩 해제 전 원문) */
  rawTarget: string;
  /** 마크다운 문법 `[](…)`/`![](…)`으로 쓰인 링크인가(위키링크·임베드 `[[…]]`와 구분) */
  markdown: boolean;
  /** 마크다운 링크 전용: 대상 토큰이 `<…>`로 감싸졌는가 / 퍼센트 인코딩이 쓰였는가 */
  angle?: boolean;
  encoded?: boolean;
}

const WIKI = /(!?)\[\[([^[\]\n]+?)\]\]/g;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

function wikiSpans(text: string, base: number, kindOverride?: LinkKind): LinkSpan[] {
  const out: LinkSpan[] = [];
  for (const m of text.matchAll(WIKI)) {
    const at = m.index ?? 0;
    if (at > 0 && text[at - 1] === '\\') continue;
    const inner = m[2] ?? '';
    const innerStart = base + at + (m[1] ? 3 : 2);
    // 대상은 첫 `#` 또는 `|` 앞까지
    const stop = inner.search(/[#|]/);
    const rawTarget = stop === -1 ? inner : inner.slice(0, stop);
    const link = parseWikiInner(inner, Boolean(m[1]), 0);
    out.push({
      kind: kindOverride ?? link.kind,
      start: base + at,
      end: base + at + m[0].length,
      targetStart: innerStart,
      targetEnd: innerStart + rawTarget.length,
      rawTarget,
      markdown: false,
    });
  }
  return out;
}

function collect(nodes: RootContent[] | Root['children'], into: (RootContent & { url: string })[]) {
  for (const n of nodes) {
    if ((n.type === 'link' || n.type === 'image') && n.position) into.push(n as RootContent & { url: string });
    if ('children' in n && Array.isArray(n.children)) collect(n.children as RootContent[], into);
  }
}

/** `[텍스트](대상 "제목")` 조각에서 대상 토큰의 위치를 찾는다. */
function destination(slice: string): { from: number; to: number; angle: boolean } | null {
  const open = slice.lastIndexOf('](');
  if (open < 0) return null;
  let i = open + 2;
  while (i < slice.length && /\s/.test(slice[i]!)) i++;
  if (slice[i] === '<') {
    const close = slice.indexOf('>', i + 1);
    return close < 0 ? null : { from: i, to: close + 1, angle: true };
  }
  let depth = 0;
  let j = i;
  for (; j < slice.length; j++) {
    const c = slice[j]!;
    if (c === '\\') { j++; continue; }
    if (c === '(') depth++;
    else if (c === ')') { if (depth === 0) break; depth--; }
    else if (/\s/.test(c) && depth === 0) break;
  }
  return { from: i, to: j, angle: false };
}

export function findLinkSpans(source: string): LinkSpan[] {
  const ep = parseForEditor(source);
  const out: LinkSpan[] = [];

  // 프런트매터의 relation 링크
  const fm = ep.note.frontmatter;
  if (fm) out.push(...wikiSpans(fm.raw, 0, 'relation'));

  // 본문의 위키링크·임베드(코드·수식·HTML 블록과 인라인 코드 안은 제외)
  for (const b of ep.note.blocks) {
    if (NO_INLINE_SCAN.has(b.kind)) continue;
    out.push(...wikiSpans(maskInlineCode(b.source), b.start));
  }

  // 마크다운 링크·이미지
  const nodes: (RootContent & { url: string })[] = [];
  collect(ep.nodes, nodes);
  for (const n of nodes) {
    const s = n.position!.start.offset;
    const e = n.position!.end.offset;
    if (s === undefined || e === undefined) continue;
    const start = ep.bodyOffset + s;
    const end = ep.bodyOffset + e;
    const slice = source.slice(start, end);
    const dest = destination(slice);
    if (!dest) continue;
    const token = slice.slice(dest.from, dest.to);
    const inner = dest.angle ? token.slice(1, -1) : token;
    if (!inner || SCHEME.test(inner) || inner.startsWith('//') || inner.startsWith('#')) continue;
    const hash = inner.indexOf('#');
    const pathPart = hash === -1 ? inner : inner.slice(0, hash);
    if (!pathPart) continue;
    const tStart = start + dest.from + (dest.angle ? 1 : 0);
    out.push({
      kind: n.type === 'image' ? 'embed' : 'md',
      start,
      end,
      targetStart: tStart,
      targetEnd: tStart + pathPart.length,
      rawTarget: pathPart,
      markdown: true,
      angle: dest.angle,
      encoded: /%[0-9a-f]{2}/i.test(pathPart),
    });
  }
  return out.sort((a, b) => a.targetStart - b.targetStart);
}

export interface TextEdit {
  start: number;
  end: number;
  text: string;
}

/** 겹치지 않는 편집을 한꺼번에 적용한다(뒤에서부터). 겹치면 예외. */
export function applyEdits(source: string, edits: readonly TextEdit[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let out = source;
  let prevStart = Infinity;
  for (const e of sorted) {
    if (e.end > prevStart) throw new CodedError('core.err.overlappingEdit');
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
    prevStart = e.start;
  }
  return out;
}
