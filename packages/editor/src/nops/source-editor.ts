import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { LanguageDescription, defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { searchKeymap } from '@codemirror/search';
import { Annotation, Compartment, EditorState } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView, drawSelection, highlightActiveLine, keymap } from '@codemirror/view';

/**
 * 소스 모드: 파일 전체(프런트매터 포함)의 마크다운 원문을 그대로 편집한다.
 * 파서가 이해하지 못하는 문법도 여기서는 손실 없이 고칠 수 있다.
 */
export interface SourceEditor {
  readonly view: EditorView;
  getText(): string;
  /** 사용자 편집이 아닌 교체(change 이벤트를 내지 않는다) */
  setText(text: string): void;
  focus(): void;
  destroy(): void;
}

export interface SourceEditorOptions {
  text: string;
  /** 사용자가 문서를 바꿀 때마다 */
  onChange: () => void;
  /** 지정하지 않으면 시스템 설정을 따른다 */
  dark?: boolean;
}

const programmatic = Annotation.define<boolean>();

const codeLanguages = [
  LanguageDescription.of({ name: 'javascript', alias: ['js', 'jsx', 'ts', 'tsx', 'typescript'], support: javascript({ jsx: true, typescript: true }) }),
  LanguageDescription.of({ name: 'json', alias: ['jsonc'], support: json() }),
  LanguageDescription.of({ name: 'python', alias: ['py'], support: python() }),
  LanguageDescription.of({ name: 'css', alias: ['scss'], support: css() }),
  LanguageDescription.of({ name: 'html', alias: ['xml', 'svg'], support: html() }),
];

const baseTheme = EditorView.theme({
  '&': { backgroundColor: 'transparent', fontSize: '13.5px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', lineHeight: '1.7' },
  '.cm-content': { padding: '0 0 120px', caretColor: 'currentColor' },
  '.cm-line': { padding: '0' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, currentColor 6%, transparent)' },
});

const text_eol = (text: string) => (text.includes('\r\n') ? 'crlf' : 'lf');

export function createSourceEditor(host: HTMLElement, options: SourceEditorOptions): SourceEditor {
  const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  const isDark = () => options.dark ?? media?.matches ?? false;
  const themeSlot = new Compartment();
  const eolSlot = new Compartment();
  const eolFor = (text: string) => (text.includes('\r\n') ? EditorState.lineSeparator.of('\r\n') : []);
  let eol = text_eol(options.text);
  const themeFor = (dark: boolean) => (dark ? oneDark : syntaxHighlighting(defaultHighlightStyle, { fallback: true }));

  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: options.text,
      extensions: [
        history(),
        drawSelection(),
        highlightActiveLine(),
        EditorView.lineWrapping,
        eolSlot.of(eolFor(options.text)),
        EditorState.tabSize.of(2),
        markdown({ codeLanguages }),
        keymap.of([...searchKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
        themeSlot.of(themeFor(isDark())),
        baseTheme,
        EditorView.contentAttributes.of({ 'aria-label': '마크다운 소스', spellcheck: 'false' }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && !u.transactions.some((t) => t.annotation(programmatic))) options.onChange();
        }),
      ],
    }),
  });

  const onScheme = () => view.dispatch({ effects: themeSlot.reconfigure(themeFor(isDark())) });
  if (options.dark === undefined) media?.addEventListener('change', onScheme);

  return {
    view,
    getText: () => view.state.sliceDoc(),
    setText(text) {
      if (text === view.state.sliceDoc()) return;
      // 줄바꿈 방식이 바뀌면 먼저 구분자를 바꿔야 삽입 문자열이 올바르게 나뉜다
      if (text_eol(text) !== eol) {
        eol = text_eol(text);
        view.dispatch({ effects: eolSlot.reconfigure(eolFor(text)), annotations: programmatic.of(true) });
      }
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        annotations: programmatic.of(true),
        selection: { anchor: Math.min(view.state.selection.main.head, text.length) },
      });
    },
    focus: () => view.focus(),
    destroy() {
      media?.removeEventListener('change', onScheme);
      view.destroy();
    },
  };
}
