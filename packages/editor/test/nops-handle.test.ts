import { afterEach, describe, expect, it } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { createNopsEditor, parseDocument, serializeDocument } from '../src/nops';

function setup(src: string) {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createNopsEditor(host);
  editor.setDocument(parseDocument(src).doc, { silent: true });
  return { editor, view: editor.getView(), host };
}

const md = (view: EditorView) => serializeDocument(view.state.doc, null);

/** 문서에서 텍스트를 가진 블록의 시작 위치 */
function posOf(view: EditorView, text: string) {
  let pos = -1;
  view.state.doc.descendants((n, p) => {
    if (pos < 0 && n.isTextblock && n.textContent.includes(text)) pos = p + 1;
    return pos < 0;
  });
  return pos;
}

const key = (view: EditorView, key: string, mods: KeyboardEventInit = {}) =>
  view.someProp('handleKeyDown', (f) => f(view, new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...mods })));

/** jsdom에는 레이아웃이 없으므로 posAtCoords를 흉내 낸다 */
function hover(view: EditorView, host: HTMLElement, text: string) {
  const pos = posOf(view, text);
  view.posAtCoords = () => ({ pos, inside: pos - 1 });
  host.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 100, bubbles: true }));
}
const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

afterEach(() => {
  document.body.replaceChildren();
});

describe('키보드', () => {
  it('⌘D로 현재 블록을 복제하고, ⌘⇧↑↓로 이동한다', () => {
    const { view } = setup('가\n\n나\n\n다\n');
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, posOf(view, '나'))));
    expect(key(view, 'd', { ctrlKey: true })).toBe(true);
    expect(md(view)).toBe('가\n\n나\n\n나\n\n다\n');

    const t = setup('가\n\n나\n\n다\n');
    t.view.dispatch(t.view.state.tr.setSelection(TextSelection.create(t.view.state.doc, posOf(t.view, '나'))));
    expect(key(t.view, 'ArrowDown', { ctrlKey: true, shiftKey: true })).toBe(true);
    expect(md(t.view)).toBe('가\n\n다\n\n나\n');
    expect(key(t.view, 'ArrowUp', { ctrlKey: true, shiftKey: true })).toBe(true);
    expect(md(t.view)).toBe('가\n\n나\n\n다\n');
  });
});

describe('블록 핸들', () => {
  it('마우스를 올리면 핸들이 나타나고, 문서가 바뀌면 사라진다', async () => {
    const { view, host } = setup('가\n\n나\n');
    const handle = () => document.querySelector<HTMLElement>('.nops-handle')!;
    expect(handle().hidden).toBe(true);
    hover(view, host, '나');
    await frame();
    expect(handle().hidden).toBe(false);
    view.dispatch(view.state.tr.delete(posOf(view, '나') - 1, view.state.doc.content.size));
    expect(handle().hidden).toBe(true);
  });

  it('+ 버튼은 아래에 "/" 문단을 만들고 커서를 그 뒤에 둔다', async () => {
    const { view, host } = setup('가\n\n나\n');
    hover(view, host, '가');
    await frame();
    document.querySelector<HTMLButtonElement>('.nops-handle__add')!.click();
    expect(view.state.doc.child(1).textContent).toBe('/');
    expect(view.state.selection.$from.parent.textContent).toBe('/');
    expect(view.state.selection.$from.parentOffset).toBe(1);
  });

  it('⋮⋮ 클릭 → 메뉴에서 "다른 블록으로 바꾸기 > 제목 2"와 "복제", "삭제"를 쓴다', async () => {
    const { view, host } = setup('가\n\n나\n\n다\n');
    hover(view, host, '나');
    await frame();
    const grip = document.querySelector<HTMLElement>('.nops-handle__grip')!;
    grip.click();
    const menu = document.querySelector<HTMLElement>('.nops-block-menu')!;
    expect(menu).toBeTruthy();
    const item = (label: string) => [...menu.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.startsWith(label))!;

    item('제목 2').click();
    expect(md(view)).toBe('가\n\n## 나\n\n다\n');
    expect(document.querySelector('.nops-block-menu')).toBeNull();

    hover(view, host, '나');
    await frame();
    document.querySelector<HTMLElement>('.nops-handle__grip')!.click();
    [...document.querySelectorAll<HTMLButtonElement>('.nops-block-menu button')].find((b) => b.textContent?.startsWith('삭제'))!.click();
    expect(md(view)).toBe('가\n\n다\n');
  });

  it('Esc로 메뉴를 닫는다', async () => {
    const { view, host } = setup('가\n');
    hover(view, host, '가');
    await frame();
    document.querySelector<HTMLElement>('.nops-handle__grip')!.click();
    expect(document.querySelector('.nops-block-menu')).toBeTruthy();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.nops-block-menu')).toBeNull();
  });

  it('에디터를 없애면 핸들 요소도 정리된다', () => {
    const { editor } = setup('가\n');
    expect(document.querySelector('.nops-handle')).toBeTruthy();
    editor.destroy();
    expect(document.querySelector('.nops-handle')).toBeNull();
  });
});

describe('드래그 시작', () => {
  it('핸들을 끌기 시작하면 블록이 선택되고 PM 드래그 상태가 설정된다', async () => {
    const { view, host } = setup('가\n\n나\n');
    hover(view, host, '나');
    await frame();
    const grip = document.querySelector<HTMLElement>('.nops-handle__grip')!;
    const dt = { effectAllowed: '', setData: () => undefined, setDragImage: () => undefined } as unknown as DataTransfer;
    const ev = new Event('dragstart', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', { value: dt });
    grip.dispatchEvent(ev);
    expect(view.dragging?.move).toBe(true);
    expect(view.dragging?.slice.content.firstChild?.textContent).toBe('나');
    grip.dispatchEvent(new Event('dragend', { bubbles: true }));
    expect(view.dragging).toBeNull();
  });
});
