import { Plugin, PluginKey, type Command } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

const key = new PluginKey<Set<number>>('nopsToggleHeading');

/**
 * 접이식 제목(`## 제목 {.toggle}`).
 * 접힘 상태는 화면에만 있고 파일에는 쓰지 않는다. 접힌 제목 아래의 블록(다음 같은/높은 단계 제목 전까지)은 숨긴다.
 */
export function createToggleHeadingPlugin(): Plugin {
  return new Plugin<Set<number>>({
    key,
    state: {
      init: () => new Set(),
      apply(tr, folded) {
        let next = folded;
        if (tr.docChanged && folded.size) {
          next = new Set();
          for (const p of folded) {
            const r = tr.mapping.mapResult(p, 1);
            if (!r.deleted) next.add(r.pos);
          }
        }
        const flip = tr.getMeta(key) as number | undefined;
        if (flip !== undefined) {
          next = new Set(next);
          if (!next.delete(flip)) next.add(flip);
        }
        return next;
      },
    },
    props: {
      decorations(state) {
        const folded = key.getState(state);
        const decos: Decoration[] = [];
        const doc = state.doc;
        let hideUntilLevel = 0; // 0 = 숨기는 중 아님
        doc.forEach((node, offset) => {
          const isHeading = node.type.name === 'heading';
          if (hideUntilLevel && isHeading && (node.attrs.level as number) <= hideUntilLevel) hideUntilLevel = 0;
          if (hideUntilLevel) {
            decos.push(Decoration.node(offset, offset + node.nodeSize, { class: 'nops-folded' }));
            return;
          }
          if (isHeading && node.attrs.toggle) {
            const isFolded = folded?.has(offset) ?? false;
            if (isFolded) hideUntilLevel = node.attrs.level as number;
            decos.push(
              Decoration.widget(
                offset + 1,
                (view) => {
                  const btn = document.createElement('span');
                  btn.className = `nops-toggle-heading__arrow${isFolded ? ' is-folded' : ''}`;
                  btn.contentEditable = 'false';
                  btn.setAttribute('data-testid', 'toggle-heading-arrow');
                  btn.textContent = isFolded ? '▸' : '▾';
                  btn.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    view.dispatch(view.state.tr.setMeta(key, offset).setMeta('addToHistory', false));
                  });
                  return btn;
                },
                { side: -1, key: `th-${offset}-${isFolded}` },
              ),
              Decoration.node(offset, offset + node.nodeSize, { class: 'nops-toggle-heading' }),
            );
          }
        });
        return decos.length ? DecorationSet.create(doc, decos) : null;
      },
    },
  });
}

/** 현재 블록을 접이식 제목(1~3단계)으로 바꾼다. 이미 같은 단계의 접이식이면 일반 제목으로 되돌린다. */
export function toggleHeadingCommand(level: 1 | 2 | 3): Command {
  return (state, dispatch) => {
    const { $from } = state.selection;
    const node = $from.parent;
    const heading = state.schema.nodes.heading;
    if (!heading || !node.isTextblock || $from.depth !== 1) return false;
    const same = node.type === heading && node.attrs.level === level && node.attrs.toggle;
    if (dispatch) {
      const pos = $from.before();
      const attrs = same ? { ...node.attrs, toggle: false } : { ...(node.type === heading ? node.attrs : {}), level, toggle: true };
      dispatch(state.tr.setNodeMarkup(pos, heading, attrs).scrollIntoView());
    }
    return true;
  };
}
