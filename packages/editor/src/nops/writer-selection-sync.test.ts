import { describe, expect, it } from 'vitest';
import type { EditorView } from 'prosemirror-view';
import { createNopsEditor, parseDocument } from './index.js';
import { readEditorSelection } from './writer-stats.js';

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
