import { countMarkdown, countPlain, type TextStats } from '@nopsidian/core';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { serializeDocument, type Baseline } from './md/document.js';

/**
 * 작가 모드 글자수 — **저장될 마크다운 원문**을 기준으로 센다(소스 모드와 같은 함수).
 * 에디터 문서를 직렬화해 `countMarkdown` 에 넣으므로 columns·위키링크·토글·각주·하드브레이크가
 * 소스 모드와 구조적으로 같은 값이 된다.
 */
export function editorTotalStats(doc: PMNode, baseline: Baseline | null): TextStats | null {
  try {
    return countMarkdown(serializeDocument(doc, baseline));
  } catch {
    // 직렬화가 실패하면 화면은 이전 값을 유지한다(0·'…' 로 깜빡이지 않게).
    return null;
  }
}

/** atom(inline) 노드가 화면에 보이는 글자 — 위키링크는 별칭/대상, 그 밖의 atom 은 총계 규칙과 같게 0자. */
export function atomDisplayText(node: PMNode): string {
  const a = node.attrs as Record<string, unknown>;
  switch (node.type.name) {
    case 'wikilink': {
      const target = String(a.target ?? '');
      const label = a.alias ? String(a.alias) : `${target}${a.heading ? `#${String(a.heading)}` : ''}${a.block ? `#^${String(a.block)}` : ''}`;
      return label;
    }
    case 'raw_inline':
      return String(a.source ?? '');
    default:
      return ''; // embed·수식·이미지·각주 참조는 총계와 같이 0자
  }
}

/** 선택이 한 텍스트블록(문단·제목·목록 항목 등) 안에 있으면 그 텍스트만 돌려준다(atom 은 화면 글자로). */
export function singleTextblockText(doc: PMNode, from: number, to: number): string | null {
  const from$ = doc.resolve(from);
  const to$ = doc.resolve(to);
  if (from$.parent !== to$.parent || !from$.parent.isTextblock) return null;
  return doc.textBetween(from, to, '\n', atomDisplayText);
}

/**
 * 선택 구간 글자수.
 * - 전체 선택은 총계와 항등
 * - **한 텍스트블록 안 선택은 직렬화하지 않고** 그 텍스트를 같은 글자수 함수로 센다(작가의 가장 흔한 선택 — 정확해야 한다)
 * - 여러 블록에 걸친 선택만 블록 구분자 텍스트 + 클램프
 */
export function editorSelectionStats(doc: PMNode, from: number, to: number, total: TextStats | null): TextStats | null {
  const size = doc.content.size;
  if (from === to) return null;
  if (from <= 0 && to >= size && total) return total;
  // 총계가 아직 없으면 선택 표시도 하지 않는다(클램프를 우회한 큰 수가 보이지 않게).
  if (!total) return null;
  const inline = singleTextblockText(doc, from, to);
  const text = inline ?? doc.textBetween(from, to, '\n', atomDisplayText);
  // 이미지 atom 등 보이는 글자가 없는 선택은 표시하지 않는다.
  if (text.trim() === '') return null;
  const stats = countPlain(text);
  // 블록 경계를 가로지르는 선택은 컨테이너 일부가 텍스트로 잡혀 총계보다 커질 수 있어 클램프한다(안전장치).
  return {
    chars: Math.min(stats.chars, total.chars),
    charsNoSpace: Math.min(stats.charsNoSpace, total.charsNoSpace),
    words: stats.words,
  };
}

/** 화면에서만 보이는 숨은 장식(제로폭 스페이스·BOM)만 제거한다. ZWJ·variation selector 는 grapheme 일부라 남긴다. */
function cleanSelectionText(text: string): string {
  return text.replace(/[\u200B\uFEFF]/g, '');
}

/** 선택 끝점이 원자 NodeView(위키링크·임베드·수식·각주·이미지) 안쪽인지 */
function atomHost(node: Node, root: HTMLElement): HTMLElement | null {
  let el: Element | null = node.nodeType === 1 ? (node as Element) : node.parentElement;
  while (el && el !== root) {
    if (el.matches('.nops-wikilink, .nops-embed, .nops-footnote-ref, .nops-math, img[data-inline]')) return el as HTMLElement;
    el = el.parentElement;
  }
  return null;
}

/**
 * 지금 화면의 선택 글자수.
 * - 기본은 **PM 경로**(posAtDOM→문서 위치→`textBetween(..., atomDisplayText)`): 표·이미지·각주·수식이 총계와 같은 규칙이고 탭·행 구분자가 끼지 않는다.
 * - DOM 선택이 접히지 않았는데 위치 변환이 접히거나(from==to) 원자 NodeView 안쪽이면 **DOM 선택 텍스트**로 센다(별칭 등 화면 글자).
 */
export function readEditorSelection(view: EditorView, total: TextStats | null): TextStats | null {
  type WithObserver = { domObserver?: { flush?: () => void } };
  try {
    (view as unknown as WithObserver).domObserver?.flush?.();
  } catch {
    // 관찰자 flush 실패는 무시하고 아래 경로로 센다.
  }
  const domSel = typeof window === 'undefined' ? null : window.getSelection();
  const fromState = () => {
    const { from, to } = view.state.selection;
    return editorSelectionStats(view.state.doc, from, to, total);
  };
  if (!domSel || domSel.rangeCount === 0 || domSel.isCollapsed) return fromState();
  const anchor = domSel.anchorNode;
  const focus = domSel.focusNode;
  if (!anchor || !focus || !view.dom.contains(anchor) || !view.dom.contains(focus)) return fromState();

  const anchorAtom = atomHost(anchor, view.dom);
  const focusAtom = atomHost(focus, view.dom);
  const sameAtom = anchorAtom !== null && anchorAtom === focusAtom;
  let mapped: { from: number; to: number } | null = null;
  try {
    const a = view.posAtDOM(anchor, domSel.anchorOffset);
    const b = view.posAtDOM(focus, domSel.focusOffset);
    mapped = { from: Math.min(a, b), to: Math.max(a, b) };
  } catch {
    mapped = null;
  }
  // 원자 안쪽이 아니고 위치 변환이 살아 있으면 PM 경로(표·각주·수식·이미지가 총계와 일치).
  if (!anchorAtom && !focusAtom && mapped && mapped.from !== mapped.to) {
    return editorSelectionStats(view.state.doc, mapped.from, mapped.to, total);
  }
  if (sameAtom) {
    // 위키링크만 글자를 가진다(임베드·수식·각주·이미지는 총계 규칙과 같이 0자 → 숨김).
    if (!anchorAtom.classList.contains('nops-wikilink')) return null;
    const text = cleanSelectionText(domSel.toString());
    if (text.trim() === '') return null;
    const stats = countPlain(text);
    return total ? { chars: Math.min(stats.chars, total.chars), charsNoSpace: Math.min(stats.charsNoSpace, total.charsNoSpace), words: stats.words } : null;
  }
  // 원자와 일반 텍스트에 걸친 혼합 선택: 화면 텍스트에서 탭·행 구분자만 지우고 총계로 클램프.
  const text = cleanSelectionText(domSel.toString()).replace(/[\t\r\n]/g, '');
  if (text.trim() === '') return null;
  const stats = countPlain(text);
  return total ? { chars: Math.min(stats.chars, total.chars), charsNoSpace: Math.min(stats.charsNoSpace, total.charsNoSpace), words: stats.words } : null;
}
