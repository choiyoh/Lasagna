import { countMarkdown, countPlain, type TextStats } from '@nopsidian/core';
import type { Node as PMNode } from 'prosemirror-model';
import { serializeDocument, type Baseline } from './md/document.js';

/**
 * 작가 모드 글자수 — **저장될 마크다운 원문**을 기준으로 센다(소스 모드와 같은 함수).
 * 에디터 문서를 직렬화해 `countMarkdown` 에 넣으므로 columns·위키링크·토글·각주·하드브레이크가
 * 소스 모드와 구조적으로 같은 값이 된다.
 */
export function editorTotalStats(doc: PMNode, baseline: Baseline | null): TextStats {
  return countMarkdown(serializeDocument(doc, baseline));
}

/** 선택 구간 글자수 — 총계와 같은 계열(노드 값)로 세고, 전체 선택은 총계와 항등. */
export function editorSelectionStats(doc: PMNode, from: number, to: number, total: TextStats | null): TextStats | null {
  const size = doc.content.size;
  if (from === to) return null;
  // 전체 선택은 총계와 항등(특수 케이스)
  if (from <= 0 && to >= size && total) return total;
  // 구간에 걸친 텍스트만(블록 구분자 `\n`) — 컨테이너 표식은 텍스트가 아니라 자동 제외
  // 총계가 아직 없으면 선택 표시도 하지 않는다(클램프를 우회한 큰 수가 보이지 않게).
  if (!total) return null;
  const stats = countPlain(doc.textBetween(from, to, '\n', ''));
  // 블록 경계를 가로지르는 선택은 컨테이너 일부가 텍스트로 잡혀 총계보다 커질 수 있어 클램프한다.
  return {
    chars: Math.min(stats.chars, total.chars),
    charsNoSpace: Math.min(stats.charsNoSpace, total.charsNoSpace),
    words: stats.words,
  };
}
