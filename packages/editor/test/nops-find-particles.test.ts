import { describe, expect, it } from 'vitest';
import { undo } from 'prosemirror-history';
import type { Node as PMNode } from 'prosemirror-model';
import { createNopsEditor, parseDocument, replaceEvery, replaceOne, setFind } from '../src/nops';

function setup(src: string) {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createNopsEditor(host, { onOpenLink: () => undefined });
  editor.setDocument(parseDocument(src).doc, { silent: true });
  return { editor, view: editor.getView() };
}

/** 본문 글자와 그 글자에 걸린 서식 이름 */
function markedText(doc: PMNode): string[] {
  const out: string[] = [];
  doc.descendants((node) => {
    if (node.isText) out.push(`${node.text ?? ''}:${node.marks.map((m) => m.type.name).join('+') || '-'}`);
    return true;
  });
  return out;
}

const SENTENCE = '유리는 유리가 유리를 유리와 유리로 유리야 유리가게\n';

describe('찾기·바꾸기 조사 맞추기', () => {
  it('모두 바꾸기에서 바로 뒤 조사를 새 말의 받침에 맞춘다', () => {
    const { view } = setup(SENTENCE);
    setFind(view, '유리', '요한');
    expect(replaceEvery(view, true)).toBe(true);
    // 유리야·유리가게 는 조사가 아니라 그대로 둔다(맞춤 대상 조사만 고친다)
    expect(view.state.doc.textContent).toBe('요한은 요한이 요한을 요한과 요한으로 요한야 요한가게');
  });

  it('끄면 예전과 똑같이 바꾼다', () => {
    const { view } = setup(SENTENCE);
    setFind(view, '유리', '요한');
    replaceEvery(view, false);
    expect(view.state.doc.textContent).toBe('요한는 요한가 요한를 요한와 요한로 요한야 요한가게');
  });

  it('모두 바꾸기는 ⌘Z 한 번으로 전부 되돌아간다', () => {
    const { view } = setup(SENTENCE);
    const before = view.state.doc.toJSON();
    setFind(view, '유리', '요한');
    replaceEvery(view, true);
    expect(view.state.doc.textContent).not.toContain('유리');
    undo(view.state, view.dispatch);
    expect(view.state.doc.toJSON()).toEqual(before);
  });

  it('서식이 걸린 말과 조사를 바꿔도 서식이 남는다', () => {
    const { view } = setup('**유리**는 밝고 *유리*를 봤다\n');
    setFind(view, '유리', '요한');
    replaceEvery(view, true);
    expect(view.state.doc.textContent).toBe('요한은 밝고 요한을 봤다');
    expect(markedText(view.state.doc)).toEqual(['요한:strong', '은 밝고 :-', '요한:em', '을 봤다:-']);
  });

  it('다른 문단의 조사는 건드리지 않는다', () => {
    const { view } = setup('유리\n\n은 사람\n');
    setFind(view, '유리', '요한');
    replaceEvery(view, true);
    expect(view.state.doc.textContent).toBe('요한은 사람');
  });

  it('바꾸기(하나)도 조사를 맞추고 다음 일치로 간다', () => {
    const { view } = setup('유리는 유리가\n');
    setFind(view, '유리', '요한');
    // 처음에는 일치를 고르기만 한다
    replaceOne(view, true);
    expect(view.state.doc.textContent).toBe('유리는 유리가');
    replaceOne(view, true);
    expect(view.state.doc.textContent).toBe('요한은 유리가');
    replaceOne(view, true);
    replaceOne(view, true);
    expect(view.state.doc.textContent).toBe('요한은 요한이');
  });

  it('받침을 모르는 말(영문·숫자)로 바꾸면 조사를 그대로 둔다', () => {
    const { view } = setup('유리는 유리가\n');
    setFind(view, '유리', 'Yohan');
    replaceEvery(view, true);
    expect(view.state.doc.textContent).toBe('Yohan는 Yohan가');
  });

  it('맞출 일치가 없으면 false', () => {
    const { view } = setup('사과\n');
    setFind(view, '없는말', '배');
    expect(replaceEvery(view, true)).toBe(false);
  });
});
