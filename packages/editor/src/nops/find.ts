import type { EditorState, Transaction } from 'prosemirror-state';
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
import { adjustParticleAt } from './particles';

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

/** 강조를 지운다. 이미 파괴된 view 는 건드리지 않는다(화면을 닫는 정리에서도 불린다). */
export const clearFind = (view: EditorView) => {
  if (view.isDestroyed) return;
  setFind(view, '');
};

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

/** 한 자리를 이 글로 바꾼다(서식은 그 자리의 것을 이어받는다) */
function replaceAt(tr: Transaction, state: EditorState, from: number, to: number, text: string): void {
  if (!text) {
    tr.delete(from, to);
    return;
  }
  const marks = state.doc.resolve(from).marksAcross(state.doc.resolve(to));
  tr.replaceWith(from, to, state.schema.text(text, marks));
}

/** 일치 바로 뒤 조사 자리를 새 말에 맞춰 바꿀 범위(바뀔 것이 없으면 null) */
interface ParticleEdit {
  from: number;
  to: number;
  text: string;
}

/**
 * 일치 바로 뒤 조사를 새 말의 받침에 맞춘다.
 * 조사 자리가 다른 일치와 겹치면 맞추지 않는다 — 그 일치를 덮어써 글자가 사라지기 때문이다.
 */
function particleEdit(state: EditorState, query: SearchQuery, to: number, text: string): ParticleEdit | null {
  const $to = state.doc.resolve(to);
  if (!$to.parent.isTextblock) return null;
  const following = $to.parent.textBetween($to.parentOffset, $to.parent.content.size, undefined, ' ');
  const found = adjustParticleAt(text, following);
  if (!found || found.text === following.slice(0, found.length)) return null;
  // 일치는 서로 겹치지 않으므로 조사 자리 안에서 시작하는 일치만 확인하면 된다
  const other = query.findNext(state, to);
  if (other && other.from < to + found.length) return null;
  return { from: to, to: to + found.length, text: found.text };
}

/**
 * 일치 하나를 바꾼다. `particle` 이 있으면 바로 뒤 조사도 함께 바꾼다.
 * 조사 자리(뒤)를 먼저 바꾸므로 일치 자리 좌표는 그대로 쓸 수 있다.
 */
function replaceMatch(tr: Transaction, state: EditorState, from: number, to: number, text: string, particle: ParticleEdit | null): void {
  if (particle) replaceAt(tr, state, particle.from, particle.to, particle.text);
  replaceAt(tr, state, from, to, text);
}

/** 지금 자리에서 다음 일치(끝이면 처음으로 돈다) */
function nextMatch(state: EditorState, st: NonNullable<ReturnType<typeof getSearchState>>, curFrom: number, curTo: number) {
  const range = st.range || { from: 0, to: state.doc.content.size };
  return st.query.findNext(state, Math.max(curTo, range.from), range.to) ?? st.query.findNext(state, range.from, Math.min(curFrom, range.to));
}

/** 조사까지 맞춰 일치 하나를 바꾸고 다음 일치로 간다 */
function replaceOneWithParticles(view: EditorView): boolean {
  const state = view.state;
  const st = getSearchState(state);
  if (!st || !st.query.valid) return false;
  const { from, to } = state.selection;
  // 커서 자리부터 찾는다(선택된 일치가 있으면 그 일치가 나온다 — replaceNext 와 같다)
  const next = nextMatch(state, st, from, from);
  if (!next) return false;
  if (from !== next.from || to !== next.to) {
    view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, next.from, next.to)).scrollIntoView());
    return true;
  }
  const tr = state.tr;
  const particle = particleEdit(state, st.query, next.to, st.query.replace);
  replaceMatch(tr, state, next.from, next.to, st.query.replace, particle);
  const after = nextMatch(state, st, next.from, next.to);
  if (after) tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(after.from, 1), tr.mapping.map(after.to, -1)));
  else tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(next.to, 1)));
  view.dispatch(tr.scrollIntoView());
  return true;
}

/** 조사까지 맞춰 모든 일치를 바꾼다(트랜잭션 하나 → 되돌리기 한 번) */
function replaceEveryWithParticles(view: EditorView): boolean {
  const state = view.state;
  const st = getSearchState(state);
  if (!st) return false;
  const range = st.range || { from: 0, to: state.doc.content.size };
  const matches: { from: number; to: number }[] = [];
  for (let pos = range.from; ;) {
    const next = st.query.findNext(state, pos, range.to);
    if (!next) break;
    if (next.to > pos || !matches.length) matches.push({ from: next.from, to: next.to });
    pos = Math.max(next.to, pos + 1);
  }
  if (!matches.length) return false;
  const tr = state.tr;
  for (let i = matches.length - 1; i >= 0; i--) {
    const particle = particleEdit(state, st.query, matches[i].to, st.query.replace);
    replaceMatch(tr, state, matches[i].from, matches[i].to, st.query.replace, particle);
  }
  view.dispatch(tr);
  return true;
}

/**
 * 지금 선택된 일치를 바꾸고 다음으로 간다(선택된 것이 없으면 다음 일치를 고른다).
 * `adjustParticles` 면 바로 뒤 조사를 새 말의 받침에 맞춘다(끄면 예전과 같다).
 */
export const replaceOne = (view: EditorView, adjustParticles = false) =>
  adjustParticles ? replaceOneWithParticles(view) : replaceNext(view.state, view.dispatch);

/** 모든 일치를 바꾼다(되돌리기 한 번으로 돌아온다). `adjustParticles` 는 replaceOne 과 같다. */
export const replaceEvery = (view: EditorView, adjustParticles = false) =>
  adjustParticles ? replaceEveryWithParticles(view) : replaceAll(view.state, view.dispatch);
