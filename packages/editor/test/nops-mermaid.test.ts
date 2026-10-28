import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorView } from 'prosemirror-view';
import { createNopsEditor, parseDocument } from '../src/nops';
import { sanitizeSvg } from '../src/nops/mermaid';

const mermaidMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async () => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><g><text>ok</text></g></svg>' })),
}));
vi.mock('mermaid', () => ({ default: mermaidMock }));

beforeEach(() => {
  mermaidMock.initialize.mockClear();
  mermaidMock.render.mockClear();
  document.documentElement.removeAttribute('data-theme');
});
afterEach(() => {
  document.documentElement.removeAttribute('data-theme');
});

describe('Mermaid 보안·지연 렌더', () => {
  it('SVG 프로필로 script·이벤트·javascript·foreignObject 를 제거한다', () => {
    const clean = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><image href="javascript:alert(1)" onerror="alert(1)"/><foreignObject><div>html</div></foreignObject><g><text>ok</text></g></svg>',
    );
    expect(clean).not.toContain('<script');
    expect(clean).not.toContain('onerror');
    expect(clean).not.toContain('javascript:');
    expect(clean).not.toContain('foreignObject');
    expect(clean).toContain('<text>ok</text>');
  });

  it('입력은 300ms 디바운스되고 initialize 는 테마가 바뀔 때만 한다', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const editor = createNopsEditor(host, { onOpenLink: () => undefined });
    editor.setDocument(parseDocument('```mermaid\nflowchart TD\n  A --> B\n```\n').doc, { silent: true });
    const view = editor.getView() as EditorView;
    await vi.waitFor(() => expect(mermaidMock.render).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(mermaidMock.initialize).toHaveBeenCalledTimes(1);

    // 여러 글자를 빠르게 입력해도 한 번만 다시 그린다.
    for (let i = 0; i < 10; i++) view.dispatch(view.state.tr.insertText('x', 1));
    await new Promise((r) => setTimeout(r, 50));
    expect(mermaidMock.render).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(mermaidMock.render).toHaveBeenCalledTimes(2), { timeout: 2000 });

    // 테마가 바뀌면 즉시 다시 그리고 initialize 도 한 번 더 호출한다.
    document.documentElement.dataset.theme = 'dark';
    await vi.waitFor(() => expect(mermaidMock.render).toHaveBeenCalledTimes(3), { timeout: 2000 });
    expect(mermaidMock.initialize).toHaveBeenCalledTimes(2);
  });
});
