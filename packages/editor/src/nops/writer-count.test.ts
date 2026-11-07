import { countMarkdown } from '@nopsidian/core';
import { describe, expect, it } from 'vitest';
import { parseDocument, serializeDocument } from './md/document.js';
import type { Node as PMNode } from 'prosemirror-model';
import { editorSelectionStats, editorTotalStats } from './writer-stats.js';

const docOf = (markdown: string): PMNode => parseDocument(markdown).doc as unknown as PMNode;

/** UI 가 실제로 쓰는 함수(에디터 총계)와 소스 총계를 비교한다. */
const DOCS: [string, string][] = [
  ['novel', '# 1화\n\n밤이 깊어지면 도시의 불빛이 하나씩 꺼지고, 서연은 창가에 앉았다.\n\n두 번째 문단입니다.\n'],
  ['columns', ':::columns\n:::column\n첫째\n:::\n:::column\n둘째\n:::\n:::\n'],
  ['nested columns', '::::columns\n::::column\n바깥\n:::columns\n:::column\n안쪽\n:::\n:::\n::::\n::::\n'],
  ['wiki', '본문 [[노트]] 와 [[노트|별칭]] 링크\n'],
  ['toggle', '## 접이식 {.toggle}\n\n숨은 내용\n'],
  ['footnote', '본문[^1]\n\n[^1]: 각주 내용\n'],
  ['hard break', '줄1  \n줄2\n'],
  ['table', '| a | b |\n|---|---|\n| 1 | 2 |\n'],
  ['math', '수식 $x^2$ 와 $$y$$\n'],
  ['image', '![[사진.png]] ![대체](a.png)\n'],
];

describe('에디터 총계 == 소스 총계(UI 함수 대상)', () => {
  it('여러 문서 모양에서 같은 값을 낸다', () => {
    const diffs: string[] = [];
    for (const [name, markdown] of DOCS) {
      const editor = editorTotalStats(docOf(markdown), null);
      const source = countMarkdown(markdown);
      if (editor.chars !== source.chars || editor.charsNoSpace !== source.charsNoSpace) {
        diffs.push(`${name}: editor=${JSON.stringify(editor)} source=${JSON.stringify(source)}`);
      }
    }
    expect(diffs).toEqual([]);
  });

  it('전체 선택은 총계와 항등, 임의 구간은 선택 ≤ 전체(클램프 없이도)', () => {
    for (const [name, markdown] of DOCS) {
      const doc = docOf(markdown);
      const size = doc.content.size;
      const total = editorTotalStats(doc, null);
      expect(editorSelectionStats(doc, 0, size, total)).toEqual(total);
      for (let from = 0; from <= size; from += 2) {
        for (let to = from; to <= size; to += 3) {
          const part = editorSelectionStats(doc, from, to, total);
          if (!part) continue;
          if (part.chars > total.chars || part.charsNoSpace > total.charsNoSpace) {
            throw new Error(`${name} ${from}..${to}: part=${JSON.stringify(part)} total=${JSON.stringify(total)}`);
          }
        }
      }
    }
  });

  it('직렬화 원문은 소스 마크다운과 같은 글자수를 낸다(왕복)', () => {
    for (const [name, markdown] of DOCS) {
      const round = serializeDocument(docOf(markdown), null);
      expect([name, countMarkdown(round)]).toEqual([name, countMarkdown(markdown)]);
    }
  });
});
