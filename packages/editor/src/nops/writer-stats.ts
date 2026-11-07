import { countMarkdown, type TextStats } from '@nopsidian/core';
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
