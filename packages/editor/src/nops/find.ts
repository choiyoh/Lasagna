import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import {
  SearchQuery,
  findNext,
  findPrev,
  getSearchState,
  replaceAll,
  replaceNext,
  search,
  setSearchState,
} from 'prosemirror-search';

/** 노트 안 찾기·바꾸기(⌘F). 일치 항목 강조는 `prosemirror-search` 플러그인이 한다. */
export const createFindPlugin = () => search();

export interface FindOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
}

/** 찾을 말·바꿀 말을 정한다(빈 문자열이면 강조를 지운다) */
export function setFind(view: EditorView, text: string, replace = '', options: FindOptions = {}): void {
  const query = new SearchQuery({ search: text, replace, literal: true, caseSensitive: !!options.caseSensitive, wholeWord: !!options.wholeWord });
  view.dispatch(setSearchState(view.state.tr, query));
}

export const clearFind = (view: EditorView) => setFind(view, '');

/** 일치 개수와 지금 선택된 일치의 순번(1부터, 없으면 0). 너무 많으면 `limit` 에서 센다. */
export function findCount(view: EditorView, limit = 9999): { current: number; total: number } {
  const st = getSearchState(view.state);
  if (!st || !st.query.valid) return { current: 0, total: 0 };
  const { from: selFrom, to: selTo } = view.state.selection;
  let total = 0;
  let current = 0;
  let pos = 0;
  for (;;) {
    const r = st.query.findNext(view.state, pos);
    if (!r) break;
    total++;
    if (r.from === selFrom && r.to === selTo) current = total;
    if (total >= limit) break;
    pos = r.to > r.from ? r.to : r.to + 1;
  }
  return { current, total };
}

/** 다음(1)·이전(-1) 일치로 선택을 옮긴다(끝에서 처음으로 돈다) */
export function findMove(view: EditorView, dir: 1 | -1): boolean {
  return (dir > 0 ? findNext : findPrev)(view.state, view.dispatch);
}

/** 커서 자리(포함)부터 첫 일치를 고른다. 찾을 말을 한 글자씩 칠 때 지금 일치에 머무르도록. */
export function findFromCursor(view: EditorView): boolean {
  const st = getSearchState(view.state);
  if (!st || !st.query.valid) return false;
  const r = st.query.findNext(view.state, view.state.selection.from) ?? st.query.findNext(view.state, 0);
  if (!r) return false;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, r.from, r.to)).scrollIntoView());
  return true;
}

/** 지금 선택된 일치를 바꾸고 다음으로 간다(선택된 것이 없으면 다음 일치를 고른다) */
export const replaceOne = (view: EditorView) => replaceNext(view.state, view.dispatch);

/** 모든 일치를 바꾼다(되돌리기 한 번으로 돌아온다) */
export const replaceEvery = (view: EditorView) => replaceAll(view.state, view.dispatch);
