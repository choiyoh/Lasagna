import { countMarkdown, countPlain, type TextStats } from '@nopsidian/core';
import type { Node as PMNode } from 'prosemirror-model';
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

/** 선택이 한 텍스트블록(문단·제목·목록 항목 등) 안에 있으면 그 텍스트만 돌려준다. */
export function singleTextblockText(doc: PMNode, from: number, to: number): string | null {
  const from$ = doc.resolve(from);
  const to$ = doc.resolve(to);
  if (from$.parent !== to$.parent || !from$.parent.isTextblock) return null;
  return doc.textBetween(from, to, '\n', '');
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
  const text = inline ?? doc.textBetween(from, to, '\n', '');
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
