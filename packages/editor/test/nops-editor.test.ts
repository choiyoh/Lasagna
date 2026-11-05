import { describe, expect, it } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { createNopsEditor, insertCallout, insertColumns, insertMarkdown, insertToggle, nopsSlashItems, parseDocument, serializeDocument } from '../src/nops';

function setup(src = '') {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createNopsEditor(host, { onOpenLink: () => undefined });
  const parsed = parseDocument(src);
  editor.setDocument(parsed.doc, { silent: true });
  return { editor, view: editor.getView(), host, parsed };
}

/** 글자 단위 입력(입력 규칙이 동작하도록 handleTextInput 경로를 탄다) */
function type(view: EditorView, text: string) {
  for (const ch of text) {
    const { from, to } = view.state.selection;
    const handled = view.someProp('handleTextInput', (f) => f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)));
    if (!handled) view.dispatch(view.state.tr.insertText(ch, from, to));
  }
}

const press = (view: EditorView, key: string) =>
  view.someProp('handleKeyDown', (f) => f(view, new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));

const placeCursor = (view: EditorView, pos: number) =>
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));

describe('에디터 통합', () => {
  it('문서를 불러오면 콜아웃·열·위키링크가 DOM에 그려진다', () => {
    const { host } = setup('> [!tip]- 제목\n> 본문 [[노트]]\n\n::::columns\n\n:::column\n\n왼\n\n:::\n\n:::column\n\n오\n\n:::\n\n::::\n');
    expect(host.querySelector('.nops-callout[data-callout="tip"]')).toBeTruthy();
    expect(host.querySelector('.nops-callout')?.classList.contains('is-collapsed')).toBe(true);
    expect(host.querySelectorAll('[data-column]')).toHaveLength(2);
    expect(host.querySelector('.nops-wikilink')?.textContent).toBe('노트');
  });

  it('setDocument(silent)는 change 이벤트를 내지 않고 일반 편집은 낸다', () => {
    const { editor, view } = setup('본문\n');
    let changes = 0;
    editor.on('change', () => changes++);
    editor.setDocument(parseDocument('다른 본문\n').doc, { silent: true });
    expect(changes).toBe(0);
    view.dispatch(view.state.tr.insertText('x', 1));
    expect(changes).toBeGreaterThan(0);
  });

  it('접기 핸들은 문서를 바꾸지 않는다', () => {
    const { editor, host } = setup('> [!note]- 접힘\n> 본문\n');
    const before = editor.getDocument();
    const handle = host.querySelector<HTMLButtonElement>('.nops-callout__handle')!;
    handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(host.querySelector('.nops-callout')?.classList.contains('is-collapsed')).toBe(false);
    expect(editor.getDocument().eq(before)).toBe(true);
  });
});

describe('삽입 명령', () => {
  it('빈 문단 자리에 콜아웃을 넣고 커서를 제목에 둔다', () => {
    const { view } = setup('');
    expect(insertCallout('warning')(view.state, view.dispatch)).toBe(true);
    const callout = view.state.doc.child(0);
    expect(callout.type.name).toBe('callout');
    expect(callout.attrs.type).toBe('warning');
    expect(view.state.doc.childCount).toBe(1);
    expect(view.state.selection.$from.parent.type.name).toBe('callout_title');
  });

  it('내용이 있는 문단이면 그 뒤에 넣는다', () => {
    const { view } = setup('앞 문단\n');
    expect(insertToggle()(view.state, view.dispatch)).toBe(true);
    expect(view.state.doc.child(0).type.name).toBe('paragraph');
    expect(view.state.doc.child(1).type.name).toBe('toggle');
  });

  it('열은 문단 하나씩을 가진 column n개', () => {
    const { view } = setup('');
    insertColumns(3)(view.state, view.dispatch);
    const cols = view.state.doc.child(0);
    expect(cols.type.name).toBe('columns');
    expect(cols.childCount).toBe(3);
    expect(cols.child(0).child(0).type.name).toBe('paragraph');
    expect(view.state.selection.$from.parent.type.name).toBe('paragraph');
    expect(() => view.state.doc.check()).not.toThrow();
  });

  it('콜아웃 안에서도 삽입할 수 있다(중첩)', () => {
    const { view } = setup('');
    insertCallout()(view.state, view.dispatch);
    // 본문 문단으로 이동
    const callout = view.state.doc.child(0);
    placeCursor(view, 1 + callout.child(0).nodeSize + 1);
    expect(insertColumns(2)(view.state, view.dispatch)).toBe(true);
    expect(view.state.doc.child(0).child(1).type.name).toBe('columns');
    expect(() => view.state.doc.check()).not.toThrow();
  });
});

describe('제목 줄 키 처리', () => {
  it('제목에서 Enter: 커서 뒤 텍스트가 본문 첫 문단으로 이동한다', () => {
    const { view } = setup('> [!note] 앞뒤\n> 본문\n');
    placeCursor(view, 3); // callout(0) title(1) → '앞'(2~3) | '뒤'(3~4)
    expect(press(view, 'Enter')).toBe(true);
    const callout = view.state.doc.child(0);
    expect(callout.child(0).textContent).toBe('앞');
    expect(callout.child(1).textContent).toBe('뒤');
    expect(callout.child(2).textContent).toBe('본문');
    expect(view.state.selection.$from.parent.textContent).toBe('뒤');
  });

  it('본문이 없는 제목 끝에서 Enter: 새 문단을 만든다', () => {
    const { view } = setup('');
    insertCallout()(view.state, view.dispatch);
    view.dispatch(view.state.tr.delete(view.state.doc.child(0).child(1).nodeSize > 0 ? 1 + view.state.doc.child(0).child(0).nodeSize : 0, 1 + view.state.doc.child(0).child(0).nodeSize + view.state.doc.child(0).child(1).nodeSize));
    placeCursor(view, 2);
    expect(press(view, 'Enter')).toBe(true);
    expect(view.state.doc.child(0).childCount).toBe(2);
    expect(view.state.selection.$from.parent.type.name).toBe('paragraph');
  });

  it('빈 제목에서 Backspace: 콜아웃을 풀고 본문만 남긴다', () => {
    const { view } = setup('');
    insertCallout()(view.state, view.dispatch);
    expect(press(view, 'Backspace')).toBe(true);
    expect(view.state.doc.child(0).type.name).toBe('paragraph');
    expect(() => view.state.doc.check()).not.toThrow();
  });
});

describe('입력 규칙', () => {
  it('[[노트#제목|별칭]]을 입력하면 위키링크 노드가 된다', () => {
    const { view } = setup('');
    type(view, '[[노트#제목|별칭]]');
    const p = view.state.doc.child(0);
    expect(p.childCount).toBe(1);
    expect(p.child(0).type.name).toBe('wikilink');
    expect(p.child(0).attrs).toMatchObject({ target: '노트', heading: '제목', alias: '별칭' });
    expect(serializeDocument(view.state.doc, null)).toBe('[[노트#제목|별칭]]\n');
  });

  it('![[img.png|300]]은 임베드, ==글==은 하이라이트, `- [ ] `는 할 일', () => {
    const { view } = setup('');
    type(view, '![[img.png|300]] ==강조==');
    const p = view.state.doc.child(0);
    expect(p.child(0).type.name).toBe('embed');
    expect(p.lastChild?.marks.map((m) => m.type.name)).toEqual(['highlight']);

    const t = setup('');
    type(t.view, '- [x] 끝낸 일');
    const list = t.view.state.doc.child(0);
    expect(list.type.name).toBe('bullet_list');
    expect(list.child(0).attrs.checked).toBe(true);
    expect(serializeDocument(t.view.state.doc, null)).toBe('- [x] 끝낸 일\n');
  });

  it('입력한 콜아웃은 마크다운 콜아웃 문법으로 저장된다', () => {
    const { view } = setup('');
    insertCallout('tip')(view.state, view.dispatch);
    type(view, '핵심');
    expect(serializeDocument(view.state.doc, null)).toBe('> [!tip] 핵심\n');
  });
});

describe('한글 입력', () => {
  it('조합이 끝난 한글 텍스트를 그대로 저장한다', () => {
    const { view, parsed } = setup('# 제목\n\n본문\n');
    const end = view.state.doc.child(0).nodeSize + 1 + view.state.doc.child(1).content.size;
    placeCursor(view, end);
    type(view, ' 가나다라 ㅎㅎ');
    expect(serializeDocument(view.state.doc, parsed.baseline)).toBe('# 제목\n\n본문 가나다라 ㅎㅎ\n');
  });
});

describe('insertMarkdown (템플릿 삽입)', () => {
  it('여러 블록을 현재 위치에 넣는다', () => {
    const { view } = setup('앞\n\n뒤\n');
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1 + '앞'.length + 2))); // 두 번째 문단 시작
    expect(insertMarkdown(view, '## 할 일\n\n- [ ] 하나\n- [ ] 둘\n\n> [!tip] 팁\n')).toBe(true);
    expect(serializeDocument(view.state.doc, null)).toBe('앞\n\n## 할 일\n\n- [ ] 하나\n- [ ] 둘\n\n> [!tip] 팁\n\n뒤\n');
    expect(() => view.state.doc.check()).not.toThrow();
  });

  it('한 문단짜리는 문단을 쪼개지 않고 이어 붙인다', () => {
    const { view } = setup('가나\n');
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)));
    insertMarkdown(view, '**굵게** [[링크]]');
    expect(serializeDocument(view.state.doc, null)).toBe('가**굵게** [[링크]]나\n');
  });

  it('선택 영역은 대체된다', () => {
    const { view } = setup('아주 긴 문장\n');
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 4, 5))); // '긴'
    insertMarkdown(view, '짧은');
    expect(serializeDocument(view.state.doc, null)).toBe('아주 짧은 문장\n');
  });
});

describe('flashBlock', () => {
  it('장식으로 잠깐 강조하고 지운다(DOM 클래스를 직접 건드리지 않는다)', async () => {
    const { view, host } = setup('가\n\n나\n');
    const { flashBlock } = await import('../src/nops');
    flashBlock(view, view.state.doc.child(0).nodeSize, 30);
    expect(host.querySelector('.nops-flash')?.textContent).toBe('나');
    await new Promise((r) => setTimeout(r, 80));
    expect(host.querySelector('.nops-flash')).toBeNull();
  });
});


describe('Markdown 호환 슬래시 항목', () => {
  it('다이어그램(Mermaid)과 각주 항목이 있다', () => {
    const labels = nopsSlashItems().map((i) => i.label);
    expect(labels).toContain('다이어그램 (Mermaid)');
    expect(labels).toContain('각주');
    expect(nopsSlashItems().find((i) => i.label === '다이어그램 (Mermaid)')!.keywords).toContain('mermaid');
  });
});
