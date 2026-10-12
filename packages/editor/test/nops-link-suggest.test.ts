import { afterEach, describe, expect, it, vi } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { createNopsEditor, parseDocument, parseLinkQuery, serializeDocument, type LinkQuery, type LinkSuggestion } from '../src/nops';

afterEach(() => document.body.replaceChildren());

const NOTES: LinkSuggestion[] = [
  { label: '클린 코드', detail: '독서/클린 코드.md', target: '클린 코드', kind: 'note' },
  { label: '리팩터링', detail: '독서/리팩터링.md', target: '리팩터링', kind: 'note' },
];

function setup(suggest = vi.fn((q: LinkQuery): LinkSuggestion[] => (q.name ? NOTES.filter((n) => n.label.includes(q.name)) : NOTES))) {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createNopsEditor(host, { links: { suggest } });
  editor.setDocument(parseDocument('').doc, { silent: true });
  return { editor, view: editor.getView(), suggest };
}

function type(view: EditorView, text: string) {
  for (const ch of text) {
    const { from, to } = view.state.selection;
    const handled = view.someProp('handleTextInput', (f) => f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)));
    if (!handled) view.dispatch(view.state.tr.insertText(ch, from, to));
  }
}
const press = (view: EditorView, key: string) =>
  view.someProp('handleKeyDown', (f) => f(view, new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
const popup = () => document.querySelector<HTMLElement>('.nops-link-suggest');
const rows = () => [...document.querySelectorAll('.nops-link-suggest__item')].map((r) => r.textContent);
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('parseLinkQuery', () => {
  it('이름·제목·블록·별칭을 나눈다', () => {
    expect(parseLinkQuery('노트')).toMatchObject({ name: '노트', heading: null, block: null, alias: null });
    expect(parseLinkQuery('노트#제목|별칭')).toMatchObject({ name: '노트', heading: '제목', alias: '별칭' });
    expect(parseLinkQuery('노트#^abc')).toMatchObject({ name: '노트', heading: null, block: 'abc' });
    expect(parseLinkQuery('#제목')).toMatchObject({ name: '', heading: '제목' });
  });
});

describe('[[ 자동완성', () => {
  it('[[ 를 치면 후보가 뜨고 입력에 따라 좁혀진다', async () => {
    const { view } = setup();
    type(view, '[[');
    await flush();
    expect(rows()).toHaveLength(2);
    type(view, '클린');
    await flush();
    expect(rows()).toEqual(['📄클린 코드독서/클린 코드.md']);
  });

  it('Enter로 고르면 [[…]]가 위키링크 노드로 바뀐다', async () => {
    const { view } = setup();
    type(view, '앞 [[리');
    await flush();
    expect(press(view, 'Enter')).toBe(true);
    const p = view.state.doc.child(0);
    expect(p.textContent).toBe('앞 ');
    expect(p.lastChild?.type.name).toBe('wikilink');
    expect(p.lastChild?.attrs.target).toBe('리팩터링');
    expect(popup()?.hidden).toBe(true);
    expect(serializeDocument(view.state.doc, null)).toBe('앞 [[리팩터링]]\n');
  });

  it('↓로 이동해서 고르고, 이미 닫힌 ]] 는 함께 지운다', async () => {
    const { view } = setup();
    type(view, '[[]]');
    // 커서를 ]] 앞으로
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.selection.from - 2)));
    await flush();
    expect(press(view, 'ArrowDown')).toBe(true);
    expect(press(view, 'Tab')).toBe(true);
    expect(serializeDocument(view.state.doc, null)).toBe('[[리팩터링]]\n');
    expect(view.state.doc.child(0).childCount).toBe(1);
  });

  it('직접 쓴 별칭(|)과 제목(#)이 유지된다', async () => {
    const suggest = vi.fn((q: LinkQuery): LinkSuggestion[] => [
      { label: '1장', target: '클린 코드', heading: q.heading ?? '1장', kind: 'heading' },
    ]);
    const { view } = setup(suggest);
    type(view, '[[클린#1|별칭');
    await flush();
    press(view, 'Enter');
    expect(serializeDocument(view.state.doc, null)).toBe('[[클린 코드#1|별칭]]\n');
    expect(suggest).toHaveBeenLastCalledWith(expect.objectContaining({ name: '클린', heading: '1', alias: '별칭' }), false);
  });

  it('![[ 는 임베드 후보를 요청하고 임베드 노드를 만든다', async () => {
    const suggest = vi.fn((): LinkSuggestion[] => [{ label: 'a.png', target: 'a.png', kind: 'asset' }]);
    const { view } = setup(suggest);
    type(view, '![[a');
    await flush();
    expect(suggest).toHaveBeenLastCalledWith(expect.anything(), true);
    press(view, 'Enter');
    expect(view.state.doc.child(0).lastChild?.type.name).toBe('embed');
    expect(serializeDocument(view.state.doc, null)).toBe('![[a.png]]\n');
  });

  it('Esc로 닫으면 같은 [[ 에서는 다시 뜨지 않다가, 더 입력하면 다시 뜬다', async () => {
    const { view } = setup();
    type(view, '[[클');
    await flush();
    expect(press(view, 'Escape')).toBe(true);
    expect(popup()?.hidden).toBe(true);
    // 닫혔으니 Enter는 자동완성이 아니라 일반 입력(문단 나누기)이다
    press(view, 'Enter');
    expect(view.state.doc.childCount).toBe(2);
    // 첫 문단 끝(`[[클` 바로 뒤)으로 돌아와 더 입력하면 다시 뜬다
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1 + '[[클'.length)));
    type(view, '린');
    await flush();
    expect(popup()?.hidden).toBe(false);
  });

  it('후보가 없으면 팝업이 숨겨지고 키 입력을 가로채지 않는다', async () => {
    const { view } = setup(vi.fn(() => []));
    type(view, '[[없는것');
    await flush();
    expect(popup()?.hidden).toBe(true);
    press(view, 'Enter'); // 가로채지 않으므로 일반 Enter(문단 나누기)
    expect(view.state.doc.childCount).toBe(2);
    expect(JSON.stringify(view.state.doc.toJSON())).not.toContain('wikilink');
  });

  it('늦게 도착한 오래된 응답은 버린다', async () => {
    let resolveFirst: (v: LinkSuggestion[]) => void = () => undefined;
    const suggest = vi
      .fn()
      .mockImplementationOnce(() => new Promise<LinkSuggestion[]>((r) => (resolveFirst = r)))
      .mockImplementation(() => [{ label: '새 결과', target: '새', kind: 'note' }] as LinkSuggestion[]);
    const { view } = setup(suggest);
    type(view, '[[a');
    type(view, 'b');
    await flush();
    resolveFirst([{ label: '오래된 결과', target: '옛', kind: 'note' }]);
    await flush();
    expect(rows().join('')).toContain('새 결과');
    expect(rows().join('')).not.toContain('오래된');
  });

  it('코드 블록 안이나 [[ ]] 가 이미 닫힌 뒤에는 뜨지 않는다', async () => {
    const { view } = setup();
    type(view, '[[노트]] 그리고 ');
    await flush();
    expect(popup()?.hidden ?? true).toBe(true);
  });
});
