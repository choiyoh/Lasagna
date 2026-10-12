import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNopsEditor, parseDocument, serializeDocument } from '../src/nops';
import { createSourceEditor } from '../src/nops/source-editor';
import { normalizeLanguage, tokenize } from '../src/nops/code-highlight';

afterEach(() => {
  document.body.replaceChildren();
});

describe('소스 모드 (CodeMirror)', () => {
  const make = (text: string, onChange = vi.fn()) => {
    const host = document.createElement('div');
    document.body.append(host);
    return { onChange, host, ed: createSourceEditor(host, { text, onChange, dark: false }) };
  };

  it('원문 전체(프런트매터 포함)를 그대로 보여 주고 돌려준다', () => {
    const text = '---\nid: X\n---\n\n# 제목\n\n> [!note] 콜아웃\n[^1]: 각주\r\n\t탭과 CRLF\n';
    const { ed } = make(text);
    expect(ed.getText()).toBe(text);
    expect(ed.view.dom.querySelector('.cm-content')?.getAttribute('aria-label')).toBe('마크다운 소스');
  });

  it('setText는 change 이벤트를 내지 않고, 사용자 편집은 낸다', () => {
    const { ed, onChange } = make('가');
    ed.setText('나다');
    expect(ed.getText()).toBe('나다');
    expect(onChange).not.toHaveBeenCalled();
    ed.view.dispatch({ changes: { from: 2, insert: '라' } });
    expect(ed.getText()).toBe('나다라');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('같은 텍스트로 setText하면 아무 일도 하지 않는다', () => {
    const { ed } = make('abc');
    const before = ed.view.state;
    ed.setText('abc');
    expect(ed.view.state).toBe(before);
  });

  it('소스에서 고친 내용을 에디터 문서로 읽으면 같은 블록 구조가 된다', () => {
    const { ed } = make('# 제목\n\n본문\n');
    ed.view.dispatch({ changes: { from: ed.getText().length, insert: '\n[[노트]] ==강조==\n' } });
    const { doc, baseline } = parseDocument(ed.getText());
    expect(doc.childCount).toBe(3);
    expect(serializeDocument(doc, baseline)).toBe(ed.getText());
  });

  it('CRLF 파일은 줄바꿈을 보존한다(LF로 바뀌어 저장되지 않는다)', () => {
    const crlf = '# 제목\r\n\r\n본문\r\n';
    const { ed } = make(crlf);
    expect(ed.getText()).toBe(crlf);
    ed.view.dispatch({ changes: { from: ed.view.state.doc.length, insert: '추가' } });
    expect(ed.getText()).toBe(crlf + '추가');
    ed.setText('LF만\n쓴다\n');
    expect(ed.getText()).toBe('LF만\n쓴다\n');
    ed.setText('다시\r\nCRLF\r\n');
    expect(ed.getText()).toBe('다시\r\nCRLF\r\n');
  });

  it('정리하면 DOM이 사라진다', () => {
    const { ed, host } = make('x');
    ed.destroy();
    expect(host.querySelector('.cm-editor')).toBeNull();
  });
});

describe('코드 블록 구문 강조 (Shiki)', () => {
  it('언어 이름과 별칭을 정규화한다', () => {
    expect(normalizeLanguage('TS')).toBe('typescript');
    expect(normalizeLanguage('sh')).toBe('bash');
    expect(normalizeLanguage('c++')).toBe('cpp');
    expect(normalizeLanguage('unknown-lang')).toBeNull();
    expect(normalizeLanguage(null)).toBeNull();
  });

  it('토큰은 라이트·다크 색 변수를 가진다', async () => {
    const lines = await tokenize('const a = 1;', 'ts');
    expect(lines).not.toBeNull();
    const first = lines![0]![0]!;
    expect(first.content).toBe('const');
    expect(first.htmlStyle).toMatchObject({ '--shiki-light': expect.stringMatching(/^#/), '--shiki-dark': expect.stringMatching(/^#/) });
    expect(await tokenize('x', 'nope')).toBeNull();
  });

  it('에디터의 코드 블록에 장식이 입혀지고, 문서(저장되는 마크다운)는 그대로다', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const editor = createNopsEditor(host);
    const src = '```ts\nconst x: number = 1; // 주석\n```\n';
    editor.setDocument(parseDocument(src).doc, { silent: true });
    await vi.waitFor(() => expect(host.querySelectorAll('.nops-tok').length).toBeGreaterThan(3), { timeout: 5000 });
    const styled = host.querySelector<HTMLElement>('.nops-tok')!;
    expect(styled.getAttribute('style')).toContain('--shiki-light');
    expect(host.querySelector('pre')?.textContent).toBe('const x: number = 1; // 주석');
    expect(serializeDocument(editor.getDocument(), null)).toBe(src);
  });

  it('알 수 없는 언어와 언어 없는 블록은 강조 없이 둔다', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const editor = createNopsEditor(host);
    editor.setDocument(parseDocument('```whatever\nfoo bar\n```\n\n```\nplain\n```\n').doc, { silent: true });
    await new Promise((r) => setTimeout(r, 400));
    expect(host.querySelectorAll('.nops-tok')).toHaveLength(0);
  });

  it('편집하면 다시 강조된다', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const editor = createNopsEditor(host);
    editor.setDocument(parseDocument('```js\nlet a\n```\n').doc, { silent: true });
    await vi.waitFor(() => expect(host.querySelectorAll('.nops-tok').length).toBeGreaterThan(0), { timeout: 5000 });
    const view = editor.getView();
    view.dispatch(view.state.tr.insertText(' = 42;', 1 + 'let a'.length));
    await vi.waitFor(() => expect(host.querySelector('pre')?.textContent).toBe('let a = 42;'));
    await vi.waitFor(
      () => {
        const toks = [...host.querySelectorAll('.nops-tok')].map((t) => t.textContent);
        expect(toks).toContain('42');
      },
      { timeout: 5000 },
    );
  });
});
