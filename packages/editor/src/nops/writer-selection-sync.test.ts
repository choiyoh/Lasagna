import { describe, expect, it } from 'vitest';
import type { EditorView } from 'prosemirror-view';
import { createNopsEditor, parseDocument } from './index.js';
import type { Node as PMNode } from 'prosemirror-model';
import { editorSelectionStats, readEditorSelection } from './writer-stats.js';

function setup(markdown: string) {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createNopsEditor(host, { onOpenLink: () => undefined });
  editor.setDocument(parseDocument(markdown).doc, { silent: true });
  return { editor, view: editor.getView() as EditorView, host };
}

/** 실제 DOM 선택을 문단 텍스트의 offset 구간으로 만든다(브라우저 선택 이벤트 순서와 같다). */
function selectDomText(view: EditorView, from: number, to: number) {
  const para = view.dom.querySelector('p');
  const node = para?.firstChild;
  if (!node) throw new Error('no paragraph text');
  const range = document.createRange();
  range.setStart(node, from);
  range.setEnd(node, to);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

describe('선택 글자수는 PM 이 DOM 선택을 반영한 뒤 값을 쓴다', () => {
  it('선택 1·3·5자 확장에서 마지막 표시 값 == DOM 선택 글자수', () => {
    const { view } = setup('가나다라마바사아자차\n');
    for (const n of [1, 3, 5]) {
      selectDomText(view, 0, n);
      const stats = readEditorSelection(view, { chars: 100, charsNoSpace: 100, words: 1 });
      expect(stats?.chars).toBe(n);
    }
  });

  it('전체 선택 후 3자만 남기면 3', () => {
    const { view } = setup('가나다라마바사아자차\n');
    const total = { chars: 10, charsNoSpace: 10, words: 1 };
    selectDomText(view, 0, 10);
    expect(readEditorSelection(view, total)?.chars).toBe(10);
    selectDomText(view, 0, 3);
    expect(readEditorSelection(view, total)?.chars).toBe(3);
  });

  it('연속 selectionchange(1→3→5)에서 매 단계 최신 값으로 수렴한다', () => {
    const { view } = setup('가나다라마바사아자차\n');
    const seen: number[] = [];
    for (const n of [1, 3, 5]) {
      selectDomText(view, 0, n);
      // selectionchange 직후 DOM 은 n 글자, PM 상태는 아직 이전 값일 수 있다.
      const stats = readEditorSelection(view, { chars: 100, charsNoSpace: 100, words: 1 });
      if (stats) seen.push(stats.chars);
    }
    expect(seen).toEqual([1, 3, 5]);
  });

  it('선택 없음은 null(표시 숨김)', () => {
    const { view } = setup('가나다\n');
    selectDomText(view, 0, 0);
    expect(readEditorSelection(view, { chars: 3, charsNoSpace: 3, words: 1 })).toBeNull();
  });
});

describe('위키링크(atom) 선택은 화면에 보이는 글자로 센다', () => {
  function wikiDoc(markdown: string) {
    const host = document.createElement('div');
    document.body.append(host);
    const editor = createNopsEditor(host, { onOpenLink: () => undefined });
    editor.setDocument(parseDocument(markdown).doc, { silent: true });
    return { view: editor.getView() as EditorView, host };
  }
  /** 문서에서 n번째 위키링크 노드의 위치 */
  function wikiPos(doc: PMNode, n = 0): { from: number; to: number } {
    let seen = 0;
    let found: { from: number; to: number } | null = null;
    doc.descendants((node, pos) => {
      if (found) return false;
      if (node.type.name === 'wikilink') {
        if (seen === n) found = { from: pos, to: pos + node.nodeSize };
        seen += 1;
      }
      return true;
    });
    if (!found) throw new Error('no wikilink');
    return found;
  }

  it('별칭만 선택하면 별칭 글자수', () => {
    const { view } = wikiDoc('가 [[노트|별칭]] 나\n');
    const { from, to } = wikiPos(view.state.doc);
    const total = { chars: 100, charsNoSpace: 100, words: 1 };
    expect(editorSelectionStats(view.state.doc, from, to, total)?.chars).toBe(2);
  });

  it('별칭 없는 위키링크는 대상 제목 글자수', () => {
    const { view } = wikiDoc('[[노트이름]]\n');
    const { from, to } = wikiPos(view.state.doc);
    expect(editorSelectionStats(view.state.doc, from, to, { chars: 100, charsNoSpace: 100, words: 1 })?.chars).toBe(4);
  });

  it('위키링크가 든 문단 전체 선택은 화면 글자수와 일치', () => {
    const { view } = wikiDoc('가 [[노트|별칭]] 나\n');
    const stats = editorSelectionStats(view.state.doc, 0, view.state.doc.content.size, {
      chars: 7,
      charsNoSpace: 5,
      words: 1
    });
    expect(stats?.chars).toBe(7); // '가 별칭 나'
  });

  it('위키링크 앞뒤 일부만 걸치는 선택', () => {
    const { view } = wikiDoc('가나 [[노트|별칭]] 다라\n');
    // '나 ' + 별칭(2자) = 4자
    const { from } = wikiPos(view.state.doc);
    expect(editorSelectionStats(view.state.doc, from - 2, from + 1, { chars: 100, charsNoSpace: 100, words: 1 })?.chars).toBe(4);
  });

  it('한글 별칭·위키링크 둘 이상', () => {
    const { view } = wikiDoc('[[인물|강태공]] 그리고 [[장소|낙양성]]\n');
    const a = wikiPos(view.state.doc, 0);
    const b = wikiPos(view.state.doc, 1);
    const total = { chars: 100, charsNoSpace: 100, words: 1 };
    expect(editorSelectionStats(view.state.doc, a.from, a.to, total)?.chars).toBe(3);
    expect(editorSelectionStats(view.state.doc, b.from, b.to, total)?.chars).toBe(3);
    expect(editorSelectionStats(view.state.doc, a.from, b.to, total)?.chars).toBe(11); // '강태공 그리고 낙양성'
  });
});
