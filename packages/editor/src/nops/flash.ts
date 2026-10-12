import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';

const key = new PluginKey<{ pos: number | null }>('nopsFlash');

/**
 * 링크로 이동했을 때 도착한 블록을 잠깐 강조한다. DOM 클래스를 직접 붙이면 ProseMirror가 변경으로 보고
 * 다시 그리며 지워 버리므로, 노드 장식(decoration)으로 표시한다.
 */
export function createFlashPlugin(): Plugin {
  return new Plugin<{ pos: number | null }>({
    key,
    state: {
      init: () => ({ pos: null }),
      apply(tr, value) {
        const meta = tr.getMeta(key) as { pos: number | null } | undefined;
        if (meta) return meta;
        return value.pos !== null && tr.docChanged ? { pos: tr.mapping.map(value.pos) } : value;
      },
    },
    props: {
      decorations(state) {
        const { pos } = key.getState(state) ?? { pos: null };
        const node = pos === null ? null : state.doc.nodeAt(pos);
        if (pos === null || !node) return null;
        return DecorationSet.create(state.doc, [Decoration.node(pos, pos + node.nodeSize, { class: 'nops-flash' })]);
      },
    },
  });
}

/** `pos`에서 시작하는 블록을 `ms` 동안 강조한다. */
export function flashBlock(view: EditorView, pos: number, ms = 1600) {
  view.dispatch(view.state.tr.setMeta(key, { pos }).setMeta('addToHistory', false));
  setTimeout(() => {
    if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(key, { pos: null }).setMeta('addToHistory', false));
  }, ms);
}
