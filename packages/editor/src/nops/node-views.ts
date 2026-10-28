import type { Node as PMNode } from 'prosemirror-model';
import type { NodeView } from 'prosemirror-view';

const ICONS: Record<string, string> = {
  note: '✎',
  info: 'ℹ',
  tip: '💡',
  hint: '💡',
  success: '✔',
  check: '✔',
  done: '✔',
  question: '?',
  help: '?',
  faq: '?',
  warning: '⚠',
  caution: '⚠',
  attention: '⚠',
  failure: '✖',
  fail: '✖',
  missing: '✖',
  danger: '⚡',
  error: '⚡',
  bug: '🐞',
  example: '☰',
  quote: '❝',
  cite: '❝',
  abstract: '☷',
  summary: '☷',
  tldr: '☷',
  todo: '☐',
};

/**
 * 콜아웃·토글 노드 뷰. 접기 상태는 문서가 아니라 화면 상태다(접었다 펴도 문서가 바뀌지 않는다).
 * 시작 상태는 `fold` 속성(`-` 접힘)을 따른다.
 */
function foldableView(kind: 'callout' | 'toggle') {
  return (node: PMNode): NodeView => {
    const dom = document.createElement('div');
    dom.className = `nops-${kind}`;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `nops-${kind}__handle`;
    button.contentEditable = 'false';
    button.tabIndex = -1;
    button.setAttribute('aria-label', '접기/펼치기');
    const body = document.createElement('div');
    body.className = `nops-${kind}__content`;
    dom.append(button, body);

    let collapsed = node.attrs.fold === '-';
    const sync = (n: PMNode) => {
      if (kind === 'callout') dom.dataset.callout = n.attrs.type;
      else dom.dataset.toggle = '';
      const foldable = kind === 'toggle' || n.attrs.fold !== null;
      dom.classList.toggle('is-foldable', foldable);
      dom.classList.toggle('is-collapsed', foldable && collapsed);
      button.textContent = kind === 'callout' ? (ICONS[n.attrs.type] ?? '✎') : collapsed ? '▸' : '▾';
      if (kind === 'callout') button.dataset.icon = '';
    };
    sync(node);

    button.addEventListener('mousedown', (e) => {
      e.preventDefault();
      collapsed = !collapsed;
      sync(currentNode);
    });
    let currentNode = node;

    return {
      dom,
      contentDOM: body,
      update(n) {
        if (n.type !== currentNode.type) return false;
        currentNode = n;
        sync(n);
        return true;
      },
      // 핸들·클래스 변경은 ProseMirror가 문서 변경으로 오인하지 않게 한다
      ignoreMutation: (m) => !body.contains(m.target) || m.type === 'attributes',
      stopEvent: (e) => e.target === button,
    };
  };
}

import { mathBlockView, mathInlineView } from './math';
import { footnoteDefView, footnoteRefView } from './footnotes';

export const nopsNodeViews = {
  math_inline: mathInlineView,
  math_block: mathBlockView,
  footnote_ref: footnoteRefView,
  footnote_def: footnoteDefView,
  callout: foldableView('callout'),
  toggle: foldableView('toggle'),
};
