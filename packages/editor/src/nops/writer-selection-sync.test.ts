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

describe('위키링크 NodeView 안쪽 DOM 선택', () => {
  function wikiEditor(markdown: string) {
    const host = document.createElement('div');
    document.body.append(host);
    const editor = createNopsEditor(host, { onOpenLink: () => undefined });
    editor.setDocument(parseDocument(markdown).doc, { silent: true });
    return { view: editor.getView() as EditorView, host };
  }
  /** 위키링크 NodeView 안의 텍스트 노드 */
  function aliasTextNode(host: HTMLElement, n = 0): Text {
    const spans = host.querySelectorAll<HTMLElement>('.nops-wikilink');
    const el = spans[n];
    if (!el) throw new Error('no wikilink');
    const node = el.firstChild;
    if (!node || node.nodeType !== 3) throw new Error('no alias text');
    return node as Text;
  }
  const total = { chars: 100, charsNoSpace: 100, words: 1 };

  it('별칭 전체를 DOM 으로 선택하면 별칭 글자수', () => {
    const { view, host } = wikiEditor('가 [[노트|별칭]] 나\n');
    const node = aliasTextNode(host);
    window.getSelection()?.setBaseAndExtent(node, 0, node, 2);
    expect(readEditorSelection(view, total)?.chars).toBe(2);
  });

  it('별칭 일부(같은 텍스트 노드)만 선택', () => {
    const { view, host } = wikiEditor('가 [[노트|강태공]] 나\n');
    const node = aliasTextNode(host);
    window.getSelection()?.setBaseAndExtent(node, 1, node, 2);
    expect(readEditorSelection(view, total)?.chars).toBe(1);
  });

  it('별칭 없는 위키의 대상 표기를 선택', () => {
    const { view, host } = wikiEditor('[[노트이름]]\n');
    const node = aliasTextNode(host);
    window.getSelection()?.setBaseAndExtent(node, 0, node, (node.textContent ?? '').length);
    expect(readEditorSelection(view, total)?.chars).toBe(4);
  });

  it('문단 일부 + 별칭에 걸친 선택도 화면 글자수와 일치', () => {
    const { view, host } = wikiEditor('가나 [[노트|별칭]] 다라\n');
    const para = host.querySelector('p');
    const first = para?.firstChild;
    const alias = aliasTextNode(host);
    if (!first || first.nodeType !== 3) throw new Error('no leading text');
    window.getSelection()?.setBaseAndExtent(first, 1, alias, 2); // '나 ' + '별칭'
    expect(readEditorSelection(view, total)?.chars).toBe(4);
  });

  it('총계보다 큰 선택은 클램프(선택 ≤ 전체)', () => {
    const { view, host } = wikiEditor('[[노트|별칭]]\n');
    const node = aliasTextNode(host);
    window.getSelection()?.setBaseAndExtent(node, 0, node, 2);
    expect(readEditorSelection(view, { chars: 1, charsNoSpace: 1, words: 1 })?.chars).toBe(1);
  });
});

describe('표·이미지·각주·수식 선택은 PM 경로(총계와 같은 규칙)', () => {
  function editorFor(markdown: string) {
    const host = document.createElement('div');
    document.body.append(host);
    const editor = createNopsEditor(host, { onOpenLink: () => undefined });
    editor.setDocument(parseDocument(markdown).doc, { silent: true });
    return { view: editor.getView() as EditorView, host };
  }
  /** Chromium 처럼 표 셀 사이에 탭·행 사이에 개행을 넣는 DOM 선택을 흉내낸다. */
  function selectNodeText(root: Node, node: Node) {
    const range = document.createRange();
    range.selectNodeContents(node);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    return { root, range };
  }
  const total = { chars: 1000, charsNoSpace: 1000, words: 10 };

  it('표 셀 하나를 선택하면 셀 글자수(탭 없음)', () => {
    const { view, host } = editorFor('| 12 | 34 |\n|---|---|\n| 5 | 6 |\n');
    const cell = host.querySelector('.ProseMirror table td, .ProseMirror table th');
    if (!cell) throw new Error('no cell');
    selectNodeText(host, cell);
    expect(readEditorSelection(view, total)?.chars).toBe(2);
  });

  it('Chromium 처럼 탭이 섞인 DOM 문자열이어도 PM 경로라 부풀지 않는다', () => {
    const { view, host } = editorFor('| 12 | 34 |\n|---|---|\n| 5 | 6 |\n');
    const cell = host.querySelector('.ProseMirror table td, .ProseMirror table th');
    if (!cell) throw new Error('no cell');
    selectNodeText(host, cell);
    const original = window.getSelection()?.toString.bind(window.getSelection());
    // Chromium 은 표 선택 시 탭·개행을 넣는다. PM 경로를 쓰므로 값이 변하면 안 된다.
    Object.defineProperty(window.getSelection()!, 'toString', { value: () => '12\t34\n5\t6', configurable: true });
    try {
      expect(readEditorSelection(view, total)?.chars).toBe(2);
    } finally {
      if (original) Object.defineProperty(window.getSelection()!, 'toString', { value: original, configurable: true });
    }
  });

  it('ZWJ 가족 이모지는 1자(ZWJ 제거 금지)', () => {
    const { view, host } = editorFor('가족 👨‍👩‍👧 끝\n');
    const p = host.querySelector('p');
    if (!p) throw new Error('no paragraph');
    selectNodeText(host, p);
    expect(readEditorSelection(view, total)?.chars).toBe(6); // '가족 ' + 1 + ' 끝'
    expect(readEditorSelection(view, total)?.chars).toBeLessThan(8); // ZWJ 를 지우면 8자가 된다
  });

  it('이미지 alt·각주 참조·수식이 든 문단은 총계 규칙대로 센다', () => {
    const { view, host } = editorFor('가 ![대체](a.png) 나\n');
    const p = host.querySelector('p');
    if (!p) throw new Error('no paragraph');
    selectNodeText(host, p);
    expect(readEditorSelection(view, total)?.chars).toBe(4); // '가 ' + ' 나' (이미지 0자)
  });

  it('50k 자 선택 계산 비용 ≤ 100ms', async () => {
    const markdown = '문장 하나를 길게 씁니다. **강조** 그리고 [링크](https://x.y)\n\n'.repeat(600);
    const { view } = editorFor(markdown);
    const { TextSelection } = await import('prosemirror-state');
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 0, view.state.doc.content.size)));
    const started = performance.now();
    const stats = readEditorSelection(view, { chars: 100000, charsNoSpace: 100000, words: 1 });
    const elapsed = performance.now() - started;
    expect(stats).not.toBeNull();
    expect(elapsed).toBeLessThan(100);
  });
});
