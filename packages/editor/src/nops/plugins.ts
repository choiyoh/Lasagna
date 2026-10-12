import { InputRule } from 'prosemirror-inputrules';
import { inputRules } from 'prosemirror-inputrules';
import { keymap } from 'prosemirror-keymap';
import { Plugin } from 'prosemirror-state';
import type { Schema } from 'prosemirror-model';
import { backspaceInTitle, enterInTitle, toggleChecked } from './commands';

export interface WikiLinkTarget {
  target: string;
  heading: string | null;
  block: string | null;
  embed: boolean;
}

/** 제목 줄의 Enter/Backspace. 기본 키맵보다 먼저 등록해야 한다. */
export function createTitleKeymapPlugin(): Plugin {
  return keymap({ Enter: enterInTitle, Backspace: backspaceInTitle });
}

/** `[[노트]]`·`![[노트|크기]]`·`==형광펜==`·`- [ ] ` 입력 변환 */
export function createNopsInputRules(schema: Schema): Plugin {
  const rules: InputRule[] = [];

  const { wikilink, embed } = schema.nodes;
  if (wikilink && embed) {
    rules.push(
      new InputRule(/(!?)\[\[([^[\]\n|#]+)(?:#(\^?)([^[\]\n|]+))?(?:\|([^[\]\n]+))?\]\]$/, (state, m, start, end) => {
        const [, bang, target, caret, frag, alias] = m;
        const node = (bang ? embed : wikilink).create({
          target: (target ?? '').trim(),
          heading: frag && !caret ? frag : null,
          block: frag && caret ? frag : null,
          alias: alias ?? null,
        });
        return state.tr.replaceWith(start, end, node);
      }),
    );
  }

  const highlight = schema.marks.highlight;
  if (highlight) {
    rules.push(
      new InputRule(/==([^=\n]+)==$/, (state, m, start, end) =>
        state.tr.replaceWith(start, end, schema.text(m[1] ?? '', [highlight.create()])),
      ),
    );
  }

  const { bullet_list, list_item } = schema.nodes;
  if (bullet_list && list_item) {
    rules.push(
      new InputRule(/^\s*[-*]\s\[([ xX])\]\s$/, (state, m, start, end) => {
        const tr = state.tr.delete(start, end);
        const range = tr.doc.resolve(start).blockRange();
        if (!range) return null;
        tr.wrap(range, [{ type: bullet_list, attrs: { tight: true } }, { type: list_item, attrs: { checked: m[1] !== ' ' } }]);
        return tr;
      }),
    );
  }
  if (list_item) {
    // `- ` 입력으로 목록이 먼저 만들어진 뒤 `[ ] `/`[x] `를 치는 경우
    rules.push(
      new InputRule(/^\[([ xX])\]\s$/, (state, m, start, end) => {
        const $pos = state.doc.resolve(start);
        const itemDepth = $pos.depth - 1;
        if (itemDepth < 1 || $pos.node(itemDepth).type !== list_item || $pos.index(itemDepth) !== 0) return null;
        if ($pos.node(itemDepth).attrs.checked !== null) return null;
        const tr = state.tr.delete(start, end);
        tr.setNodeMarkup($pos.before(itemDepth), undefined, { ...$pos.node(itemDepth).attrs, checked: m[1] !== ' ' });
        return tr;
      }),
    );
  }
  return inputRules({ rules });
}

/** 위키링크 클릭 → 앱이 노트를 연다. 체크박스 클릭 → 체크 토글. */
export function createInteractionPlugin(opts: { onOpenLink?: (link: WikiLinkTarget) => void }): Plugin {
  return new Plugin({
    props: {
      handleClickOn(_view, _pos, node, nodePos) {
        if ((node.type.name === 'wikilink' || node.type.name === 'embed') && opts.onOpenLink) {
          opts.onOpenLink({
            target: node.attrs.target,
            heading: node.attrs.heading,
            block: node.attrs.block,
            embed: node.type.name === 'embed',
          });
          return true;
        }
        void nodePos;
        return false;
      },
      handleDOMEvents: {
        mousedown(view, event) {
          const target = event.target;
          if (!(target instanceof HTMLElement)) return false;
          const li = target.closest('li[data-checked]');
          if (!li || !view.dom.contains(li)) return false;
          // 항목 왼쪽의 체크박스 영역(약 1.6em)만 반응한다
          const rect = li.getBoundingClientRect();
          if (event.clientX - rect.left > 28) return false;
          const pos = view.posAtDOM(li, 0) - 1;
          const tr = toggleChecked(view.state, pos);
          if (!tr) return false;
          view.dispatch(tr);
          event.preventDefault();
          return true;
        },
      },
    },
  });
}
