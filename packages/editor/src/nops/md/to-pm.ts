import type { Mark, Node as PMNode, Schema } from 'prosemirror-model';
import type {
  Blockquote,
  List,
  ListItem,
  Paragraph,
  PhrasingContent,
  RootContent,
  Table,
} from 'mdast';
import { decodeInline, parseWikiInner, type EditorParse, type InlineToken } from '@nopsidian/core/markdown';
import { parseSizeSpec } from '@nopsidian/core/assets';
import { colorSpanOpen, isColorSpanClose } from '../text-color';

/** 최상위 PM 블록 하나와, 그것을 만들어 낸 원문 구간 [start, end) (파일 전체 기준 오프셋). */
export interface Segment {
  node: PMNode;
  start: number;
  end: number;
}

interface Ctx {
  schema: Schema;
  /** 프런트매터를 뺀 본문 — mdast 위치(offset)가 이 문자열 기준이다 */
  body: string;
  tokens: InlineToken[];
  /** 각주 정의 노드의 안정적인 편집 키(직렬화하지 않는다) */
  nextFootnoteKey: number;
}

const CALLOUT_HEAD = /^\[!([A-Za-z][\w-]*)\]([+-])?[ \t]*/;
const lf = (s: string) => s.replace(/\r\n?/g, '\n');
/** `![alt|400](src)` · `![|400x300](src)` — Obsidian과 같은 크기 표기를 alt 끝에서 읽는다 */
function splitImageAlt(alt: string | null | undefined): { alt: string | null; width: string | null; height: string | null } {
  const text = alt ?? '';
  const bar = text.lastIndexOf('|');
  const size = bar >= 0 ? parseSizeSpec(text.slice(bar + 1)) : null;
  if (!size) return { alt: text || null, width: null, height: null };
  return { alt: text.slice(0, bar) || null, width: String(size.width), height: size.height ? String(size.height) : null };
}

const TRAILING_ID = /(^|\s)\^([A-Za-z0-9-]+)$/;

function slice(ctx: Ctx, node: { position?: import('unist').Position }): string {
  const s = node.position?.start.offset;
  const e = node.position?.end.offset;
  return s === undefined || e === undefined ? '' : lf(ctx.body.slice(s, e));
}

// ───────────────────────── 인라인 ─────────────────────────

const FOOTNOTE_TEXT = /(?<!\\)\[\^([^[\]\n]+?)\]/g;

/** 정의가 아직 없는 각주 참조도 편집기에서 각주로 보이게 텍스트를 나눈다. */
function textAndFootnotes(schema: Schema, value: string, marks: readonly Mark[]): PMNode[] {
  const out: PMNode[] = [];
  let last = 0;
  for (const m of value.matchAll(FOOTNOTE_TEXT)) {
    const at = m.index ?? 0;
    if (at > last) out.push(schema.text(value.slice(last, at), marks));
    const label = m[1] ?? '';
    out.push(schema.nodes.footnote_ref!.create({ identifier: label, label, inline: false, text: null }, null, marks));
    last = at + m[0].length;
  }
  if (last < value.length) out.push(schema.text(value.slice(last), marks));
  return out;
}

function textNodes(ctx: Ctx, rawValue: string, marks: readonly Mark[]): PMNode[] {
  const { schema } = ctx;
  const value = lf(rawValue);
  const out: PMNode[] = [];
  for (const part of decodeInline(value, ctx.tokens)) {
    if (typeof part === 'string') {
      out.push(...textAndFootnotes(schema, part, marks));
      continue;
    }
    const { kind, inner } = part.token;
    if (kind === 'highlight') {
      out.push(schema.text(inner, schema.marks.highlight!.create().addToSet(marks)));
    } else if (kind === 'footnote-inline') {
      out.push(schema.nodes.footnote_ref!.create({ identifier: null, label: null, inline: true, text: inner }, null, marks));
    } else {
      const link = parseWikiInner(inner, kind === 'embed', 0);
      out.push(
        schema.nodes[kind]!.create(
          { target: link.target, heading: link.heading ?? null, block: link.block ?? null, alias: link.alias ?? null },
          null,
          marks,
        ),
      );
    }
  }
  return out;
}

function hasClosingU(children: PhrasingContent[], from: number): boolean {
  return children.slice(from).some((c) => c.type === 'html' && c.value.toLowerCase() === '</u>');
}

interface InlineState {
  /** 열린 글씨색 span 의 색(중첩되면 마지막이 이긴다). */
  color: string | null;
}

export function inlineToPm(ctx: Ctx, children: PhrasingContent[], marks: readonly Mark[] = [], state: InlineState = { color: null }): PMNode[] {
  const { schema } = ctx;
  const out: PMNode[] = [];
  let underline = false;
  const cur = () => {
    let next = underline ? schema.marks.underline!.create().addToSet(marks) : marks;
    if (state.color) next = schema.marks.color!.create({ color: state.color }).addToSet(next);
    return next;
  };

  children.forEach((child, i) => {
    switch (child.type) {
      case 'text':
        out.push(...textNodes(ctx, child.value, cur()));
        break;
      case 'emphasis':
        out.push(...inlineToPm(ctx, child.children, schema.marks.em!.create().addToSet(cur()), state));
        break;
      case 'strong':
        out.push(...inlineToPm(ctx, child.children, schema.marks.strong!.create().addToSet(cur()), state));
        break;
      case 'delete':
        out.push(...inlineToPm(ctx, child.children, schema.marks.strike!.create().addToSet(cur()), state));
        break;
      case 'inlineCode':
        out.push(schema.text(lf(child.value), schema.marks.code!.create().addToSet(cur())));
        break;
      case 'link':
        out.push(
          ...inlineToPm(
            ctx,
            child.children,
            schema.marks.link!.create({ href: child.url, title: child.title ?? null }).addToSet(cur()),
            state,
          ),
        );
        break;
      case 'image':
        out.push(schema.nodes.inline_image!.create({ src: child.url, alt: child.alt ?? null, title: child.title ?? null }, null, cur()));
        break;
      case 'break':
        out.push(schema.nodes.hard_break!.create());
        break;
      case 'inlineMath':
        out.push(schema.nodes.math_inline!.create({ value: child.value }, null, cur()));
        break;
      case 'footnoteReference':
        out.push(
          schema.nodes.footnote_ref!.create(
            { identifier: child.identifier, label: child.label ?? child.identifier, inline: false, text: null },
            null,
            cur(),
          ),
        );
        break;
      case 'html': {
        const color = colorSpanOpen(child.value);
        if (color) {
          state.color = color;
          break;
        }
        if (state.color && isColorSpanClose(child.value)) {
          state.color = null;
          break;
        }
        const v = child.value.toLowerCase();
        if (v === '<u>' && !underline && hasClosingU(children, i + 1)) underline = true;
        else if (v === '</u>' && underline) underline = false;
        else out.push(schema.nodes.raw_inline!.create({ source: lf(child.value) }));
        break;
      }
      default:
        out.push(schema.nodes.raw_inline!.create({ source: slice(ctx, child as { position?: import('unist').Position }) }));
    }
  });
  return out;
}

/** 문단·제목 끝의 ` ^블록ID`를 떼어 낸다. 앞에 본문이 남을 때만 블록 ID로 본다. */
function extractBlockId(nodes: PMNode[]): { nodes: PMNode[]; blockId: string | null } {
  const last = nodes[nodes.length - 1];
  if (!last?.isText) return { nodes, blockId: null };
  const m = TRAILING_ID.exec(last.text ?? '');
  if (!m) return { nodes, blockId: null };
  const rest = (last.text ?? '').slice(0, m.index);
  const kept = nodes.slice(0, -1);
  if (rest) kept.push(last.type.schema.text(rest, last.marks));
  if (kept.length === 0) return { nodes, blockId: null };
  return { nodes: kept, blockId: m[2] ?? null };
}

/** 제목 끝의 ` {.toggle}` 표시를 떼어 낸다(블록 ID를 뗀 뒤에 쓴다) */
function extractToggle(nodes: PMNode[]): { nodes: PMNode[]; toggle: boolean } {
  const last = nodes[nodes.length - 1];
  if (!last?.isText) return { nodes, toggle: false };
  const m = /\s*\{\.toggle\}$/.exec(last.text ?? '');
  if (!m) return { nodes, toggle: false };
  const rest = (last.text ?? '').slice(0, m.index);
  const kept = nodes.slice(0, -1);
  if (rest) kept.push(last.type.schema.text(rest, last.marks));
  if (kept.length === 0) return { nodes, toggle: false };
  return { nodes: kept, toggle: true };
}

// ───────────────────────── 블록 ─────────────────────────

function raw(ctx: Ctx, node: RootContent): PMNode {
  return ctx.schema.nodes.raw_block!.create({ source: slice(ctx, node) });
}

function paragraphToPm(ctx: Ctx, node: Paragraph, inlineOnly = false): PMNode {
  const { schema } = ctx;
  const only = node.children.length === 1 ? node.children[0] : undefined;
  if (only?.type === 'image' && !inlineOnly) {
    const { alt, width, height } = splitImageAlt(only.alt);
    return schema.nodes.image!.create({ src: only.url, alt, title: only.title ?? null, width, height });
  }
  const { nodes, blockId } = extractBlockId(inlineToPm(ctx, node.children));
  return schema.nodes.paragraph!.create({ blockId }, nodes);
}

function listToPm(ctx: Ctx, node: List): PMNode {
  const { schema } = ctx;
  const items: PMNode[] = [];
  for (const item of node.children as ListItem[]) {
    const kids = item.children;
    if (kids.length > 0 && kids[0]!.type !== 'paragraph') return raw(ctx, node);
    // 항목의 첫 블록은 항상 문단이어야 하므로, 이미지 한 개짜리 문단도 인라인 이미지로 둔다
    const content =
      kids.length === 0
        ? [schema.nodes.paragraph!.create()]
        : [paragraphToPm(ctx, kids[0] as Paragraph, true), ...blocksToPm(ctx, kids.slice(1))];
    items.push(schema.nodes.list_item!.create({ checked: item.checked ?? null }, content));
  }
  const attrs = { tight: !node.spread };
  return node.ordered
    ? schema.nodes.ordered_list!.create({ ...attrs, order: node.start ?? 1 }, items)
    : schema.nodes.bullet_list!.create(attrs, items);
}

function blockquoteToPm(ctx: Ctx, node: Blockquote): PMNode {
  const { schema } = ctx;
  const callout = calloutToPm(ctx, node);
  if (callout) return callout;
  return schema.nodes.blockquote!.create(null, node.children.length ? blocksToPm(ctx, node.children) : [schema.nodes.paragraph!.create()]);
}

function calloutToPm(ctx: Ctx, node: Blockquote): PMNode | undefined {
  const { schema } = ctx;
  const first = node.children[0];
  if (first?.type !== 'paragraph') return undefined;
  const head = first.children[0];
  if (head?.type !== 'text') return undefined;
  const m = CALLOUT_HEAD.exec(head.value);
  if (!m) return undefined;

  const children: PhrasingContent[] = [{ ...head, value: head.value.slice(m[0].length) }, ...first.children.slice(1)].map((c) =>
    c.type === 'text' ? { ...c, value: lf(c.value) } : c,
  );
  // 제목은 첫 줄(첫 개행 또는 강제 줄바꿈 전까지), 나머지는 본문 문단
  let split = -1;
  for (let i = 0; i < children.length; i++) {
    const c = children[i]!;
    if ((c.type === 'text' && c.value.includes('\n')) || c.type === 'break') {
      split = i;
      break;
    }
  }
  let titleKids = children;
  let restKids: PhrasingContent[] = [];
  if (split >= 0) {
    const c = children[split]!;
    if (c.type === 'text') {
      const nl = c.value.indexOf('\n');
      titleKids = [...children.slice(0, split), { ...c, value: c.value.slice(0, nl) }];
      restKids = [{ ...c, value: c.value.slice(nl + 1) }, ...children.slice(split + 1)];
    } else {
      titleKids = children.slice(0, split);
      restKids = children.slice(split + 1);
    }
  }
  const type = (m[1] ?? 'note').toLowerCase();
  const fold = m[2] ?? null;
  const titleNodes = inlineToPm(ctx, titleKids.filter((c) => !(c.type === 'text' && c.value === '')));
  const body: PMNode[] = [];
  const restNonEmpty = restKids.some((c) => c.type !== 'text' || c.value.trim() !== '');
  if (restNonEmpty) body.push(...blocksToPm(ctx, [{ type: 'paragraph', children: restKids } as Paragraph]));
  body.push(...blocksToPm(ctx, node.children.slice(1)));

  if (type === 'toggle') {
    return schema.nodes.toggle!.create({ fold: fold ?? '+' }, [schema.nodes.toggle_summary!.create(null, titleNodes), ...body]);
  }
  return schema.nodes.callout!.create({ type, fold }, [schema.nodes.callout_title!.create(null, titleNodes), ...body]);
}

function tableToPm(ctx: Ctx, node: Table): PMNode {
  const { schema } = ctx;
  // GFM은 짧은 행을 빈 셀로 채워 렌더링하므로 같은 폭으로 맞춘다
  const width = Math.max(...node.children.map((r) => r.children.length));
  const rows = node.children.map((row, r) => {
    const padded = [...row.children];
    while (padded.length < width) padded.push({ type: 'tableCell', children: [] });
    const cells = padded.map((cell) => {
      const type = r === 0 ? schema.nodes.table_header! : schema.nodes.table_cell!;
      const { nodes } = { nodes: inlineToPm(ctx, cell.children) };
      return type.create(null, schema.nodes.paragraph!.create(null, nodes));
    });
    return schema.nodes.table_row!.create(null, cells);
  });
  const align = Array.from({ length: width }, (_, i) => node.align?.[i] ?? null);
  return schema.nodes.table!.create({ align: align.some(Boolean) ? align : null }, rows);
}

export function blockToPm(ctx: Ctx, node: RootContent): PMNode {
  const { schema } = ctx;
  switch (node.type) {
    case 'paragraph':
      return paragraphToPm(ctx, node);
    case 'heading': {
      const { nodes: afterId, blockId } = extractBlockId(inlineToPm(ctx, node.children));
      const { nodes, toggle } = extractToggle(afterId);
      return schema.nodes.heading!.create({ level: node.depth, blockId, toggle }, nodes);
    }
    case 'list':
      return listToPm(ctx, node);
    case 'blockquote':
      return blockquoteToPm(ctx, node);
    case 'code':
      return schema.nodes.code_block!.create(
        { language: node.lang ?? null, meta: node.meta ?? null },
        node.value ? schema.text(lf(node.value)) : null,
      );
    case 'thematicBreak':
      return schema.nodes.horizontal_rule!.create();
    case 'table':
      return tableToPm(ctx, node);
    case 'math':
      return schema.nodes.math_block!.create(null, node.value ? schema.text(lf(node.value)) : null);
    case 'footnoteDefinition':
      return schema.nodes.footnote_def!.create({ identifier: node.identifier, label: node.label ?? node.identifier, source: slice(ctx, node), key: `fn-${ctx.nextFootnoteKey++}` });
    default:
      return raw(ctx, node);
  }
}

function blocksToPm(ctx: Ctx, nodes: RootContent[]): PMNode[] {
  return nodes.map((n) => blockToPm(ctx, n));
}

// ───────────────────────── 최상위: `:::columns` 펜스 ─────────────────────────

/** 같은 콜론 개수의 닫는 펜스 위치(중첩된 같은 개수의 열기는 건너뛴다). 없으면 -1 */
function findClose(ep: EditorParse, open: number): number {
  const colons = ep.note.blocks[open]!.fence!.colons;
  let depth = 0;
  for (let i = open + 1; i < ep.note.blocks.length; i++) {
    const b = ep.note.blocks[i]!;
    if (b.fence?.colons !== colons) continue;
    if (b.kind === 'fence-open') depth++;
    else if (depth === 0) return i;
    else depth--;
  }
  return -1;
}

function convertRange(ctx: Ctx, ep: EditorParse, from: number, to: number): Segment[] {
  const out: Segment[] = [];
  for (let i = from; i < to; i++) {
    const block = ep.note.blocks[i]!;
    if (block.kind === 'fence-open' && block.fence!.name === 'columns') {
      const close = findClose(ep, i);
      const node = close > i && close < to ? tryColumns(ctx, ep, i, close) : undefined;
      if (node) {
        out.push({ node, start: block.start, end: ep.note.blocks[close]!.end });
        i = close;
        continue;
      }
    }
    out.push({ node: blockToPm(ctx, ep.nodes[i]!), start: block.start, end: block.end });
  }
  return out;
}

function tryColumns(ctx: Ctx, ep: EditorParse, open: number, close: number): PMNode | undefined {
  const { schema } = ctx;
  const columns: PMNode[] = [];
  for (let i = open + 1; i < close; i++) {
    const b = ep.note.blocks[i]!;
    if (b.kind !== 'fence-open' || b.fence!.name !== 'column') return undefined;
    const end = findClose(ep, i);
    if (end < 0 || end >= close) return undefined;
    const inner = convertRange(ctx, ep, i + 1, end).map((s) => s.node);
    columns.push(schema.nodes.column!.create(null, inner.length ? inner : [schema.nodes.paragraph!.create()]));
    i = end;
  }
  if (columns.length < 2 || columns.length > 5) return undefined;
  return schema.nodes.columns!.create(null, columns);
}

export interface ConvertedDocument {
  doc: PMNode;
  segments: Segment[];
}

/** 블록 사이 여분 빈 줄 수(기본 2줄 = 빈 문단 0개). 빈 문단 하나당 한 줄이 더 있다. */
function blankParagraphs(gap: string): number {
  return Math.max(0, (gap.match(/\r?\n/g) ?? []).length - 2);
}

export function convertParsed(schema: Schema, ep: EditorParse): ConvertedDocument {
  const ctx: Ctx = { schema, body: ep.body, tokens: ep.tokens, nextFootnoteKey: 0 };
  const segments = convertRange(ctx, ep, 0, ep.note.blocks.length);
  const children: PMNode[] = [];
  segments.forEach((segment, i) => {
    if (i > 0) {
      const prev = segments[i - 1]!;
      // 원문의 여분 빈 줄만큼 빈 문단을 넣는다(맨 앞·맨 뒤는 기존처럼 만들지 않는다).
      const gap = ep.body.slice(prev.end - ep.bodyOffset, segment.start - ep.bodyOffset);
      for (let k = blankParagraphs(gap); k > 0; k--) children.push(schema.nodes.paragraph!.create());
    }
    children.push(segment.node);
  });
  const doc = schema.topNodeType.create(null, children.length ? children : [schema.nodes.paragraph!.create()]);
  return { doc, segments };
}
