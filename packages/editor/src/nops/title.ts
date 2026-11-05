import { t } from '@nopsidian/i18n';
import { Plugin } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';

/** 문서 맨 앞의 H1(노트 제목) 텍스트. 첫 블록이 H1 이 아니면 null */
export function firstTitle(doc: PMNode): string | null {
  const first = doc.firstChild;
  return first && first.type.name === 'heading' && first.attrs.level === 1 ? first.textContent : null;
}

/** 노트 제목(첫 H1)이 비어 있으면 회색 "제목 없음" 안내를 보인다. */
export function createTitlePlugin() {
  return new Plugin({
    props: {
      decorations(state) {
        const first = state.doc.firstChild;
        if (!first || first.type.name !== 'heading' || first.attrs.level !== 1 || first.content.size > 0) return null;
        return DecorationSet.create(state.doc, [Decoration.node(0, first.nodeSize, { class: 'nops-empty-title', 'data-placeholder': t('default.untitled') })]);
      },
    },
  });
}
