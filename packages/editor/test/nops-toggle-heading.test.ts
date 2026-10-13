import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { parseDocument, serializeDocument } from '../src/nops/md';
import { createToggleHeadingPlugin, toggleHeadingCommand } from '../src/nops/toggle-heading';


describe('접이식 제목', () => {
  it('`## 제목 {.toggle} ^id` 를 읽으면 toggle 속성이 켜지고 글자에는 안 남는다', () => {
    const { doc } = parseDocument('## 제목 {.toggle} ^h1\n\n내용\n');
    const h = doc.firstChild!;
    expect(h.attrs).toMatchObject({ level: 2, toggle: true, blockId: 'h1' });
    expect(h.textContent).toBe('제목');
  });

  it('바이트를 그대로 보존한다(열었다가 그대로 저장)', () => {
    const src = '# 가 {.toggle}\n\n내용\n\n## 나 {.toggle} ^x1\n\n끝\n';
    const parsed = parseDocument(src);
    expect(serializeDocument(parsed.doc, parsed.baseline)).toBe(src);
  });

  it('슬래시 명령으로 바꾸면 ` {.toggle}` 가 붙어 저장되고, 다시 실행하면 일반 제목', () => {
    const parsed = parseDocument('제목\n');
    let state = EditorState.create({ doc: parsed.doc, plugins: [createToggleHeadingPlugin()] });
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2)));
    toggleHeadingCommand(2)(state, (tr) => (state = state.apply(tr)));
    expect(state.doc.firstChild!.attrs).toMatchObject({ level: 2, toggle: true });
    expect(serializeDocument(state.doc, parsed.baseline)).toBe('## 제목 {.toggle}\n');
    toggleHeadingCommand(2)(state, (tr) => (state = state.apply(tr)));
    expect(serializeDocument(state.doc, parsed.baseline)).toBe('## 제목\n');
  });
});
