import { t, type MessageKey } from '@nopsidian/i18n';
import { Fragment, type Node as PMNode, type NodeType, type ResolvedPos } from 'prosemirror-model';
import { type EditorState, TextSelection, type Transaction } from 'prosemirror-state';

const isTextblockLike = (n: PMNode) => ['paragraph', 'heading', 'code_block'].includes(n.type.name);

/** 핸들·드래그·키보드 이동의 대상이 되는 "블록". 목록은 항목(list_item) 단위로 다룬다. */
const BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'code_block',
  'math_block',
  'horizontal_rule',
  'image',
  'raw_block',
  'table',
  'blockquote',
  'callout',
  'toggle',
  'columns',
  'list_item',
]);

export interface BlockRef {
  /** 블록 노드가 시작하는 문서 위치 */
  pos: number;
  node: PMNode;
  /** 블록 노드가 놓인 깊이(doc 바로 아래가 1) */
  depth: number;
}

/**
 * 위치 `$pos`를 감싸는 블록을 찾는다.
 *  - 목록 항목의 첫 문단 → 그 항목
 *  - 콜아웃/토글의 제목 → 콜아웃/토글
 *  - 표 안의 어떤 위치든 → 표
 *  - 그 밖에는 가장 안쪽의 블록
 */
export function blockAt($pos: ResolvedPos): BlockRef | null {
  const ref = (d: number): BlockRef => ({ pos: $pos.before(d), node: $pos.node(d), depth: d });
  let found: BlockRef | null = null;
  for (let d = $pos.depth; d >= 1; d--) {
    const name = $pos.node(d).type.name;
    if (name === 'table') return ref(d);
    if (!BLOCK_TYPES.has(name)) continue; // callout_title, toggle_summary, column 등은 건너뛴다
    if (!found) {
      found = ref(d);
    } else if (name === 'list_item' && $pos.index(d) === 0 && found.depth === d + 1 && isTextblockLike(found.node)) {
      found = ref(d); // 항목의 첫 문단은 항목 전체를 대표한다
    }
  }
  return found;
}

export const blockAtPos = (state: EditorState, pos: number) => blockAt(state.doc.resolve(pos));

// ───────────────────────── 복제 ─────────────────────────

/** 블록 ID(`^id`)는 문서 안에서 유일해야 하므로 복제본에서는 지운다. */
function stripBlockIds(node: PMNode): PMNode {
  if (node.isText || node.isLeaf) return node;
  const children: PMNode[] = [];
  node.forEach((c) => children.push(stripBlockIds(c)));
  const attrs = 'blockId' in node.attrs && node.attrs.blockId ? { ...node.attrs, blockId: null } : node.attrs;
  return node.type.create(attrs, Fragment.from(children), node.marks);
}

export function duplicateBlock(state: EditorState, ref: BlockRef): Transaction {
  const copy = stripBlockIds(ref.node);
  const at = ref.pos + ref.node.nodeSize;
  const tr = state.tr.insert(at, copy);
  tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1)));
  return tr.scrollIntoView();
}

// ───────────────────────── 삭제 ─────────────────────────

/** 마지막 하나 남은 자식을 지우면 빈 껍데기가 남는 컨테이너는 함께 지운다. */
const COLLAPSE_WITH_LAST_CHILD = new Set(['bullet_list', 'ordered_list', 'blockquote', 'column']);

export function deleteBlock(state: EditorState, ref: BlockRef): Transaction {
  const $pos = state.doc.resolve(ref.pos);
  let depth = ref.depth;
  let from = ref.pos;
  let to = ref.pos + ref.node.nodeSize;
  while (depth > 1 && $pos.node(depth - 1).childCount === 1 && COLLAPSE_WITH_LAST_CHILD.has($pos.node(depth - 1).type.name)) {
    depth--;
    from = $pos.before(depth);
    to = from + $pos.node(depth).nodeSize;
  }
  const tr = state.tr.delete(from, to);
  const near = Math.min(from, tr.doc.content.size);
  tr.setSelection(TextSelection.near(tr.doc.resolve(near), -1));
  tr.setMeta('nopsMove', true);
  return tr.scrollIntoView();
}

// ───────────────────────── 이동 ─────────────────────────

/** 같은 부모 안에서 한 칸 위/아래로 옮긴다. 더 갈 곳이 없으면 null. */
export function moveBlock(state: EditorState, ref: BlockRef, dir: -1 | 1): Transaction | null {
  const $pos = state.doc.resolve(ref.pos);
  const parent = $pos.node(ref.depth - 1);
  const index = $pos.index(ref.depth - 1);
  const siblingIndex = index + dir;
  if (siblingIndex < 0 || siblingIndex >= parent.childCount) return null;
  // 제목 노드(콜아웃 제목, 토글 요약)는 움직이지 않는다
  if (parent.child(siblingIndex).type.name.endsWith('_title') || parent.child(siblingIndex).type.name === 'toggle_summary') return null;

  const sibling = parent.child(siblingIndex);
  const parentStart = $pos.start(ref.depth - 1);
  let offset = 0;
  for (let i = 0; i < Math.min(index, siblingIndex); i++) offset += parent.child(i).nodeSize;
  // 문서 순서상 앞/뒤 노드를 맞바꾼다
  const earlier = dir === -1 ? sibling : ref.node;
  const later = dir === -1 ? ref.node : sibling;
  const from = parentStart + offset;
  const to = from + earlier.nodeSize + later.nodeSize;

  const tr = state.tr.replaceWith(from, to, [later, earlier]);
  const newPos = dir === -1 ? from : from + sibling.nodeSize;
  tr.setSelection(TextSelection.near(tr.doc.resolve(newPos + 1)));
  tr.setMeta('nopsMove', true);
  return tr.scrollIntoView();
}

// ───────────────────────── 여러 블록(범위 선택) ─────────────────────────

/**
 * 선택이 같은 부모 아래의 형제 블록 둘 이상에 걸쳐 있으면 그 블록들을 순서대로 돌려준다.
 * 한 블록 안에 있거나, 서로 다른 부모에 걸치면 null(그때는 커서가 있는 블록 하나만 다룬다).
 */
export function selectedBlocks(state: EditorState): BlockRef[] | null {
  const { $from, $to } = state.selection;
  if ($from.pos === $to.pos) return null;
  const a = blockAt($from);
  const b = blockAt($to);
  if (!a || !b || a.pos === b.pos || a.depth !== b.depth) return null;
  const pa = state.doc.resolve(a.pos);
  const pb = state.doc.resolve(b.pos);
  if (pa.start(a.depth - 1) !== pb.start(b.depth - 1)) return null;
  const parent = pa.node(a.depth - 1);
  const refs: BlockRef[] = [];
  for (let i = pa.index(a.depth - 1); i <= pb.index(b.depth - 1); i++) {
    const child = parent.child(i);
    if (child.type.name.endsWith('_title') || child.type.name === 'toggle_summary') continue;
    let pos = pa.start(a.depth - 1);
    for (let k = 0; k < i; k++) pos += parent.child(k).nodeSize;
    refs.push({ pos, node: child, depth: a.depth });
  }
  return refs.length > 1 ? refs : null;
}

const endOf = (r: BlockRef) => r.pos + r.node.nodeSize;

export function duplicateBlocks(state: EditorState, refs: BlockRef[]): Transaction {
  const last = refs[refs.length - 1]!;
  const copies = refs.map((r) => stripBlockIds(r.node));
  const at = endOf(last);
  const tr = state.tr.insert(at, copies);
  tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1)));
  return tr.scrollIntoView();
}

export function deleteBlocks(state: EditorState, refs: BlockRef[]): Transaction {
  const first = refs[0]!;
  const last = refs[refs.length - 1]!;
  const $pos = state.doc.resolve(first.pos);
  let depth = first.depth;
  let from = first.pos;
  let to = endOf(last);
  // 컨테이너의 자식을 전부 지우면 빈 껍데기가 남으므로 컨테이너째 지운다
  while (depth > 1 && $pos.node(depth - 1).childCount === refs.length && COLLAPSE_WITH_LAST_CHILD.has($pos.node(depth - 1).type.name)) {
    depth--;
    from = $pos.before(depth);
    to = from + $pos.node(depth).nodeSize;
  }
  const tr = state.tr.delete(from, to);
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(from, tr.doc.content.size)), -1));
  tr.setMeta('nopsMove', true);
  return tr.scrollIntoView();
}

/** 선택한 블록 묶음을 같은 부모 안에서 한 칸 위/아래로 옮긴다(이웃 하나와 자리를 바꾼다). */
export function moveBlocks(state: EditorState, refs: BlockRef[], dir: -1 | 1): Transaction | null {
  const first = refs[0]!;
  const last = refs[refs.length - 1]!;
  const $first = state.doc.resolve(first.pos);
  const parent = $first.node(first.depth - 1);
  const firstIndex = $first.index(first.depth - 1);
  const neighborIndex = dir === -1 ? firstIndex - 1 : firstIndex + refs.length;
  if (neighborIndex < 0 || neighborIndex >= parent.childCount) return null;
  const neighbor = parent.child(neighborIndex);
  if (neighbor.type.name.endsWith('_title') || neighbor.type.name === 'toggle_summary') return null;
  const group = refs.map((r) => r.node);
  const parentStart = $first.start(first.depth - 1);
  let offset = 0;
  for (let i = 0; i < Math.min(firstIndex, neighborIndex); i++) offset += parent.child(i).nodeSize;
  const from = parentStart + offset;
  const to = dir === -1 ? endOf(last) : from + first.node.nodeSize + (endOf(last) - first.pos - first.node.nodeSize) + neighbor.nodeSize;
  const tr = state.tr.replaceWith(from, to, dir === -1 ? [...group, neighbor] : [neighbor, ...group]);
  const groupStart = dir === -1 ? from : from + neighbor.nodeSize;
  const groupEnd = groupStart + group.reduce((n, g) => n + g.nodeSize, 0);
  tr.setSelection(TextSelection.create(tr.doc, groupStart + 1, groupEnd - 1));
  tr.setMeta('nopsMove', true);
  return tr.scrollIntoView();
}

// ───────────────────────── 블록 종류 바꾸기 ─────────────────────────

export type TurnIntoKind =
  | 'paragraph'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'bullet'
  | 'ordered'
  | 'todo'
  | 'quote'
  | 'code'
  | 'callout'
  | 'toggle';

/** 블록 종류 표시 이름. 메뉴를 그리는 시점의 언어를 따른다(모듈 로드 시 t() 금지). */
export const turnIntoLabel = (kind: TurnIntoKind): string => t(`editor.turn.${kind}` as MessageKey);

/** 이 블록을 `kind`로 바꿀 수 있는가 */
export function canTurnInto(ref: BlockRef, kind: TurnIntoKind): boolean {
  const name = ref.node.type.name;
  if (name === 'list_item') return ['paragraph', 'h1', 'h2', 'h3', 'bullet', 'ordered', 'todo', 'code'].includes(kind);
  return isTextblockLike(ref.node) && !(name === 'paragraph' && kind === 'paragraph');
}

function textOf(node: PMNode): Fragment {
  return node.type.name === 'code_block' ? Fragment.from(node.textContent ? node.type.schema.text(node.textContent) : []) : node.content;
}

/** 서식(마크)이 있는 인라인을 코드 블록용 순수 텍스트로 바꾼다 */
function plain(node: PMNode, type: NodeType): Fragment {
  const text = node.textContent;
  return type.name === 'code_block' ? Fragment.from(text ? type.schema.text(text) : []) : textOf(node);
}

export function turnInto(state: EditorState, ref: BlockRef, kind: TurnIntoKind): Transaction | null {
  if (!canTurnInto(ref, kind)) return null;
  const { schema } = state;
  const n = schema.nodes;
  const tr = state.tr;
  tr.setMeta('nopsMove', true);

  // 목록 항목 안에서의 변환: 목록 종류/체크 상태를 바꾸거나, 항목을 풀어 일반 블록으로 만든다
  if (ref.node.type.name === 'list_item') {
    const $pos = state.doc.resolve(ref.pos);
    const listDepth = ref.depth - 1;
    const list = $pos.node(listDepth);
    const listPos = $pos.before(listDepth);
    if (kind === 'bullet' || kind === 'ordered' || kind === 'todo') {
      const listType = kind === 'ordered' ? n.ordered_list! : n.bullet_list!;
      if (list.type !== listType) tr.setNodeMarkup(listPos, listType, listType === n.ordered_list ? { ...list.attrs, order: 1 } : list.attrs);
      tr.setNodeMarkup(ref.pos, undefined, { ...ref.node.attrs, checked: kind === 'todo' ? ref.node.attrs.checked ?? false : null });
      return tr;
    }
    // 항목을 목록에서 꺼내 일반 블록으로: 항목의 첫 문단을 대상 종류로 만든다
    const first = ref.node.child(0);
    const rest: PMNode[] = [];
    ref.node.forEach((c, _o, i) => {
      if (i > 0) rest.push(c);
    });
    const made = makeTextblock(state, first, kind);
    if (!made) return null;
    return liftItemOut(state, tr, ref, list, listPos, [made, ...rest]);
  }

  // 일반 텍스트 블록
  switch (kind) {
    case 'paragraph':
      return tr.setBlockType(ref.pos + 1, ref.pos + 1, n.paragraph!);
    case 'h1':
    case 'h2':
    case 'h3':
      return tr.setBlockType(ref.pos + 1, ref.pos + ref.node.nodeSize - 1, n.heading!, { level: Number(kind[1]) });
    case 'code':
      return tr.setBlockType(ref.pos + 1, ref.pos + ref.node.nodeSize - 1, n.code_block!);
    case 'bullet':
    case 'ordered':
    case 'todo': {
      const para = ref.node.type.name === 'paragraph' ? ref.node : n.paragraph!.create(null, plain(ref.node, n.paragraph!));
      const item = n.list_item!.create({ checked: kind === 'todo' ? false : null }, para);
      const list = (kind === 'ordered' ? n.ordered_list! : n.bullet_list!).create(null, item);
      tr.replaceWith(ref.pos, ref.pos + ref.node.nodeSize, list);
      return tr;
    }
    case 'quote': {
      const para = ref.node.type.name === 'paragraph' ? ref.node : n.paragraph!.create(null, plain(ref.node, n.paragraph!));
      tr.replaceWith(ref.pos, ref.pos + ref.node.nodeSize, n.blockquote!.create(null, para));
      return tr;
    }
    case 'callout':
    case 'toggle': {
      // 문단의 글이 제목이 되고, 본문은 빈 상태로 시작한다
      const title = (kind === 'callout' ? n.callout_title! : n.toggle_summary!).create(null, plain(ref.node, n.paragraph!));
      const box =
        kind === 'callout' ? n.callout!.create({ type: 'note', fold: null }, title) : n.toggle!.create({ fold: '+' }, title);
      tr.replaceWith(ref.pos, ref.pos + ref.node.nodeSize, box);
      return tr;
    }
  }
}

function makeTextblock(state: EditorState, source: PMNode, kind: TurnIntoKind): PMNode | null {
  const n = state.schema.nodes;
  const content = plain(source, kind === 'code' ? n.code_block! : n.paragraph!);
  switch (kind) {
    case 'paragraph':
      return n.paragraph!.create(null, content);
    case 'h1':
    case 'h2':
    case 'h3':
      return n.heading!.create({ level: Number(kind[1]) }, content);
    case 'code':
      return n.code_block!.create(null, content);
    default:
      return null;
  }
}

/** 목록에서 항목 하나를 꺼내 `blocks`로 바꾼다. 항목이 중간에 있으면 목록을 앞뒤로 나눈다. */
function liftItemOut(
  state: EditorState,
  tr: Transaction,
  ref: BlockRef,
  list: PMNode,
  listPos: number,
  blocks: PMNode[],
): Transaction {
  const index = state.doc.resolve(ref.pos).index(ref.depth - 1);
  const before: PMNode[] = [];
  const after: PMNode[] = [];
  list.forEach((c, _o, i) => (i < index ? before : i > index ? after : []).push(c));
  const out: PMNode[] = [];
  if (before.length) out.push(list.type.create(list.attrs, before));
  out.push(...blocks);
  if (after.length) {
    const attrs = list.type.name === 'ordered_list' ? { ...list.attrs, order: (list.attrs.order ?? 1) + index + 1 } : list.attrs;
    out.push(list.type.create(attrs, after));
  }
  tr.replaceWith(listPos, listPos + list.nodeSize, out);
  return tr;
}

// ───────────────────────── 열 만들기(좌우 드롭) ─────────────────────────

export interface DragSource {
  from: number;
  to: number;
}

const MAX_COLUMNS = 5;

/**
 * `source` 블록을 `target` 블록의 왼쪽/오른쪽에 두어 열 레이아웃을 만든다.
 *  - 대상이 이미 열 안에 있으면 그 옆에 새 열을 추가한다(최대 5열)
 *  - 아니면 대상과 원본을 두 열로 감싼다
 */
export function dropToColumns(state: EditorState, source: DragSource, target: BlockRef, side: 'left' | 'right'): Transaction | null {
  const { schema } = state;
  const n = schema.nodes;
  if (!n.columns || !n.column) return null;
  if (target.pos >= source.from && target.pos < source.to) return null; // 자기 자신(또는 자기 안)
  const src = state.doc.nodeAt(source.from);
  if (!src || src.type.name === 'column') return null;

  // 목록 항목은 목록으로 감싸서 열에 넣는다
  const wrapSource = (node: PMNode): PMNode =>
    node.type.name === 'list_item' ? n.bullet_list!.create({ tight: true }, node) : node;
  const dragged = wrapSource(src);

  const $target = state.doc.resolve(target.pos);
  // 대상 블록이 놓인 컨테이너에서 열 안인지 확인
  let columnDepth = -1;
  for (let d = target.depth - 1; d >= 1; d--) {
    if ($target.node(d).type === n.column) {
      columnDepth = d;
      break;
    }
  }

  const tr = state.tr;
  tr.setMeta('nopsMove', true);
  tr.delete(source.from, source.to);
  const map = (pos: number) => tr.mapping.map(pos, -1);

  if (columnDepth >= 0) {
    const columns = $target.node(columnDepth - 1);
    if (columns.childCount >= MAX_COLUMNS) return null;
    const colPos = map($target.before(columnDepth));
    const col = tr.doc.nodeAt(colPos);
    if (!col) return null;
    const at = side === 'left' ? colPos : colPos + col.nodeSize;
    tr.insert(at, n.column.create(null, dragged));
    return tr;
  }

  // 대상은 "열을 넣을 수 있는" 가장 바깥 블록으로 올린다(예: list_item → 목록 전체)
  let depth = target.depth;
  let node = target.node;
  let pos = target.pos;
  while (depth > 1) {
    const parent = $target.node(depth - 1);
    const idx = $target.index(depth - 1);
    if (parent.canReplaceWith(idx, idx + 1, n.columns)) break;
    depth--;
    node = $target.node(depth);
    pos = $target.before(depth);
  }
  if (pos >= source.from && pos < source.to) return null;
  const tPos = map(pos);
  const tNode = tr.doc.nodeAt(tPos);
  if (!tNode || tNode.type !== node.type) return null;
  const wrappedTarget = wrapSource(tNode);
  const cols =
    side === 'left'
      ? [n.column.create(null, dragged), n.column.create(null, wrappedTarget)]
      : [n.column.create(null, wrappedTarget), n.column.create(null, dragged)];
  tr.replaceWith(tPos, tPos + tNode.nodeSize, n.columns.create(null, cols));
  return tr;
}

// ───────────────────────── 열 정리 ─────────────────────────

const isEmptyColumn = (col: PMNode) =>
  col.childCount === 1 && col.child(0).type.name === 'paragraph' && col.child(0).childCount === 0;

/**
 * 블록을 열 밖으로 옮겨 비게 된 열을 지우고, 열이 하나만 남으면 열 레이아웃을 풀어 내용만 남긴다.
 * (일부러 만든 빈 열은 건드리지 않도록, 이동/삭제 트랜잭션 뒤에만 호출한다.)
 */
export function normalizeColumns(state: EditorState): Transaction | null {
  const fixes: { pos: number; node: PMNode; replacement: PMNode[] }[] = [];
  state.doc.descendants((node, pos) => {
    if (node.type.name !== 'columns') return true;
    const kept: PMNode[] = [];
    node.forEach((c) => {
      if (!isEmptyColumn(c)) kept.push(c);
    });
    if (kept.length === node.childCount || kept.length === 0) {
      return false;
    }
    if (kept.length >= 2) {
      fixes.push({ pos, node, replacement: [node.type.create(node.attrs, kept)] });
    } else {
      const only = kept[0]!;
      const content: PMNode[] = [];
      only.forEach((c) => content.push(c));
      fixes.push({ pos, node, replacement: content });
    }
    return false;
  });
  // 열이 하나만 남은 경우도 처리(이미 비어 있지 않은 열이 1개뿐인 columns)
  state.doc.descendants((node, pos) => {
    if (node.type.name === 'columns' && node.childCount === 1 && !fixes.some((f) => f.pos === pos)) {
      const content: PMNode[] = [];
      node.child(0).forEach((c) => content.push(c));
      fixes.push({ pos, node, replacement: content });
    }
    return true;
  });
  if (fixes.length === 0) return null;
  const tr = state.tr;
  for (const f of fixes.sort((a, b) => b.pos - a.pos)) {
    tr.replaceWith(f.pos, f.pos + f.node.nodeSize, f.replacement);
  }
  return tr;
}


// ───────────────────────── 블록 링크용 ID ─────────────────────────

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

function randomId(existing: ReadonlySet<string>): string {
  for (;;) {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(6));
    let id = '';
    for (let i = 0; i < 6; i++) id += ID_CHARS[bytes[i]! % ID_CHARS.length];
    if (!existing.has(id)) return id;
  }
}

/** 문서에 이미 쓰인 블록 ID(문단·제목의 속성과, 표·코드 뒤의 단독 `^id` 문단) */
export function collectBlockIds(doc: PMNode): Set<string> {
  const ids = new Set<string>();
  doc.descendants((n) => {
    if (n.attrs.blockId) ids.add(n.attrs.blockId as string);
    if (n.type.name === 'paragraph') {
      const m = /^\^([A-Za-z0-9-]+)$/.exec(n.textContent);
      if (m) ids.add(m[1]!);
    }
    return true;
  });
  return ids;
}

/**
 * 이 블록을 가리키는 블록 링크에 쓸 ID를 보장한다. 이미 있으면 그대로 쓰고 `tr`은 null.
 *  - 문단·제목: 속성에 ID. 목록 항목: 첫 문단. 인용·콜아웃·토글: 마지막 문단
 *  - 그 밖의 블록(표·코드·수식·이미지 …): 바로 아래에 `^id` 문단을 둔다(마크다운에서는 단독 줄이 된다)
 */
export function ensureBlockId(state: EditorState, ref: BlockRef): { id: string; tr: Transaction | null } {
  const $pos = state.doc.resolve(ref.pos);
  const { paragraph } = state.schema.nodes;
  const existing = collectBlockIds(state.doc);

  // ID를 속성으로 가질 수 있는 문단/제목 찾기
  const holder = (node: PMNode, pos: number): { node: PMNode; pos: number } | null => {
    const name = node.type.name;
    if (name === 'paragraph' || name === 'heading') return { node, pos };
    if (name === 'list_item') return holder(node.child(0), pos + 1);
    if (name === 'blockquote' || name === 'callout' || name === 'toggle') {
      const last = node.lastChild;
      if (!last || last.type.name !== 'paragraph') return null;
      return { node: last, pos: pos + node.nodeSize - 1 - last.nodeSize };
    }
    return null;
  };
  void $pos;

  const target = holder(ref.node, ref.pos);
  if (target) {
    const current = target.node.attrs.blockId as string | null;
    if (current) return { id: current, tr: null };
    const id = randomId(existing);
    return { id, tr: state.tr.setNodeMarkup(target.pos, undefined, { ...target.node.attrs, blockId: id }) };
  }

  // 단독 `^id` 문단이 이미 바로 아래에 있으면 재사용
  const after = ref.pos + ref.node.nodeSize;
  const next = state.doc.nodeAt(after);
  const m = next && next.type.name === 'paragraph' ? /^\^([A-Za-z0-9-]+)$/.exec(next.textContent) : null;
  if (m) return { id: m[1]!, tr: null };
  const id = randomId(existing);
  return { id, tr: state.tr.insert(after, paragraph!.create(null, state.schema.text(`^${id}`))) };
}
