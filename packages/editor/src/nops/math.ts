import katex from 'katex';
import { Plugin } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView, type NodeView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { showTextPrompt } from './prompt';

/** MathML 로 그린다: 글꼴·CSS 파일 없이 Chromium 이 바로 보여 주고, 오프라인·CSP 에도 안전하다. */
function render(el: HTMLElement, src: string, display: boolean): boolean {
  try {
    el.innerHTML = katex.renderToString(src, { displayMode: display, output: 'mathml', throwOnError: true });
    return true;
  } catch (e) {
    el.textContent = e instanceof Error ? e.message.replace(/^KaTeX parse error: /, '') : '수식 오류';
    return false;
  }
}

/** 인라인 수식 `$…$`: 렌더링된 수식을 보여 주고, 누르면 수식을 고치는 입력창이 뜬다. */
export function mathInlineView(node: PMNode, view: EditorView, getPos: () => number | undefined): NodeView {
  const dom = document.createElement('span');
  dom.className = 'nops-math';
  dom.contentEditable = 'false';
  let value = node.attrs.value as string;
  const draw = () => {
    const ok = render(dom, value, false);
    dom.classList.toggle('is-error', !ok);
    dom.title = value ? `$${value}$ — 눌러서 고치기` : '눌러서 수식 입력';
    if (!value) dom.textContent = '∑ 수식';
  };
  draw();
  dom.addEventListener('mousedown', (e) => {
    e.preventDefault();
    void showTextPrompt('수식 (LaTeX)', value).then((next) => {
      const pos = getPos();
      if (next === null || next === undefined || pos === undefined || view.isDestroyed) return;
      const v = next.replace(/\$/g, '').trim();
      if (!v) view.dispatch(view.state.tr.delete(pos, pos + 1));
      else if (v !== value) view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { value: v }));
      view.focus();
    });
  });
  return {
    dom,
    update(n) {
      if (n.type !== node.type) return false;
      value = n.attrs.value as string;
      draw();
      return true;
    },
    stopEvent: () => true,
    ignoreMutation: () => true,
  };
}

/**
 * 수식 블록 `$$…$$`: 평소에는 렌더링된 수식만 보이고, 커서가 들어오면 LaTeX 원문(편집 영역)이 함께 나온다.
 */
export function mathBlockView(node: PMNode): NodeView {
  const dom = document.createElement('div');
  dom.className = 'nops-mathblock';
  const shown = document.createElement('div');
  shown.className = 'nops-mathblock__render';
  shown.contentEditable = 'false';
  const pre = document.createElement('pre');
  pre.setAttribute('data-math-block', '');
  const code = document.createElement('code');
  pre.append(code);
  dom.append(shown, pre);
  const draw = (n: PMNode) => {
    const src = n.textContent.trim();
    if (!src) {
      shown.textContent = '수식을 입력하세요 (LaTeX)';
      shown.classList.add('is-empty');
      return;
    }
    shown.classList.remove('is-empty');
    shown.classList.toggle('is-error', !render(shown, src, true));
  };
  draw(node);
  return {
    dom,
    contentDOM: code,
    update(n) {
      if (n.type !== node.type) return false;
      draw(n);
      return true;
    },
    ignoreMutation: (m) => shown.contains(m.target),
  };
}

/** 커서가 들어 있는 수식 블록에 `is-active` 를 달아 원문 편집 영역을 보이게 한다. */
export function createMathActivePlugin(): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const { $from } = state.selection;
        for (let d = $from.depth; d > 0; d--) {
          const n = $from.node(d);
          if (n.type.name === 'math_block') {
            return DecorationSet.create(state.doc, [Decoration.node($from.before(d), $from.after(d), { class: 'is-active' })]);
          }
        }
        return null;
      },
    },
  });
}
