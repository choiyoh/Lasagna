import { Slice, type Node as PMNode, type NodeType } from 'prosemirror-model';
import { TextSelection } from 'prosemirror-state';
import type { Command, EditorState, Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { parseDocument } from './md';

/**
 * 현재 블록 자리에 노드를 넣는다. 현재 블록이 빈 문단이면 그 자리를 대체하고,
 * 아니면 가장 가까운 "넣을 수 있는" 조상 블록 뒤에 삽입한다. 삽입한 노드의 시작 위치를 돌려준다.
 */
function placeBlock(state: EditorState, tr: Transaction, node: PMNode): number | null {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const parent = $from.node(depth - 1);
    const index = $from.index(depth - 1);
    const here = $from.node(depth);
    const replaceHere = here.type.name === 'paragraph' && here.childCount === 0;
    if (replaceHere && parent.canReplaceWith(index, index + 1, node.type)) {
      const start = $from.before(depth);
      tr.replaceWith(start, $from.after(depth), node);
      return start;
    }
    if (parent.canReplaceWith(index + 1, index + 1, node.type)) {
      const at = $from.after(depth);
      tr.insert(at, node);
      return at;
    }
  }
  return null;
}

function insertAndFocus(node: (state: EditorState) => PMNode | null, focusOffset: number): Command {
  return (state, dispatch) => {
    const n = node(state);
    if (!n) return false;
    const tr = state.tr;
    const start = placeBlock(state, tr, n);
    if (start === null) return false;
    if (dispatch) {
      tr.setSelection(TextSelection.create(tr.doc, start + focusOffset));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

const para = (state: EditorState) => state.schema.nodes.paragraph!.create();

/** 콜아웃: callout > [callout_title, paragraph] — 커서는 제목 안 */
export const insertCallout = (type = 'note'): Command =>
  insertAndFocus((state) => {
    const { callout, callout_title } = state.schema.nodes;
    return callout && callout_title ? callout.create({ type, fold: null }, [callout_title.create(), para(state)]) : null;
  }, 2);

/** 토글: toggle > [toggle_summary, paragraph] */
export const insertToggle = (): Command =>
  insertAndFocus((state) => {
    const { toggle, toggle_summary } = state.schema.nodes;
    return toggle && toggle_summary ? toggle.create({ fold: '+' }, [toggle_summary.create(), para(state)]) : null;
  }, 2);

/** 열 레이아웃: columns > column{n} — 커서는 첫 열의 문단 안 */
export const insertColumns = (count = 2): Command =>
  insertAndFocus((state) => {
    const { columns, column } = state.schema.nodes;
    if (!columns || !column) return null;
    return columns.create(
      null,
      Array.from({ length: count }, () => column.create(null, para(state))),
    );
  }, 3);

export const insertMathBlock = (): Command =>
  insertAndFocus((state) => state.schema.nodes.math_block?.create() ?? null, 1);

// ───────────────────────── 제목 줄(Enter/Backspace) ─────────────────────────

const isTitle = (type: NodeType) => type.name === 'callout_title' || type.name === 'toggle_summary';

/**
 * 콜아웃·토글의 제목에서 Enter: 커서 뒤의 텍스트를 본문 첫 문단으로 옮기고 거기로 이동한다.
 * (제목 노드를 둘로 쪼개지 않는다.)
 */
export const enterInTitle: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || !isTitle($from.parent.type)) return false;
  const container = $from.node($from.depth - 1);
  const titleEnd = $from.after();
  if (dispatch) {
    const tr = state.tr;
    const rest = $from.parent.content.cut($from.parentOffset);
    if (rest.size > 0) tr.delete($from.pos, $from.end());
    const first = container.childCount > 1 ? container.child(1) : null;
    if (first && first.type.name === 'paragraph' && first.childCount === 0 && rest.size > 0) {
      // 빈 첫 문단이 이미 있으면 거기에 넣는다
      const at = tr.mapping.map(titleEnd) + 1;
      tr.insert(at, rest);
      tr.setSelection(TextSelection.create(tr.doc, at));
    } else if (first && rest.size === 0) {
      tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(titleEnd) + 1));
    } else {
      const at = tr.mapping.map(titleEnd);
      tr.insert(at, state.schema.nodes.paragraph!.create(null, rest));
      tr.setSelection(TextSelection.create(tr.doc, at + 1));
    }
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/** 비어 있는 제목의 맨 앞에서 Backspace: 콜아웃/토글을 풀어 본문만 남긴다. */
export const backspaceInTitle: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || !isTitle($from.parent.type) || $from.parentOffset !== 0 || $from.parent.childCount > 0) return false;
  const container = $from.node($from.depth - 1);
  if (dispatch) {
    const body: PMNode[] = [];
    container.forEach((c, _o, i) => {
      if (i > 0) body.push(c);
    });
    const start = $from.before($from.depth - 1);
    const tr = state.tr.replaceWith(start, start + container.nodeSize, body.length ? body : [state.schema.nodes.paragraph!.create()]);
    tr.setSelection(TextSelection.create(tr.doc, start + 1));
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/** 목록 항목의 체크 상태를 바꾼다. */
export function toggleChecked(state: EditorState, pos: number): Transaction | null {
  const node = state.doc.nodeAt(pos);
  if (!node || node.type.name !== 'list_item' || node.attrs.checked === null) return null;
  return state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: !node.attrs.checked });
}

/** 마크다운 조각을 현재 선택 위치에 블록·인라인으로 넣는다(템플릿 삽입 등). 선택 영역은 대체된다. */
export function insertMarkdown(view: EditorView, markdown: string): boolean {
  const { doc } = parseDocument(markdown, view.state.schema);
  // 한 문단짜리 조각은 문단을 쪼개지 않고 그 자리에 이어 붙인다
  const single = doc.childCount === 1 && doc.child(0).type.name === 'paragraph';
  const slice = single ? new Slice(doc.child(0).content, 0, 0) : new Slice(doc.content, 0, 0);
  const tr = view.state.tr.replaceSelection(slice);
  if (!tr.docChanged) return false;
  view.dispatch(tr.scrollIntoView());
  return true;
}
