import { Plugin } from 'prosemirror-state';
import type { EditorView, NodeView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import type { SlashItemSpec } from '@oh-new-editor/core';
import { t } from '@nopsidian/i18n';
import { lazySlashItem } from './slash-item';
import { insertMarkdown } from './commands';

export const TOC_LANG = 'toc';

const views = new WeakMap<EditorView, Set<() => void>>();

/** 문서의 제목들을 목록으로 그린다. 제목을 누르면 그 위치로 스크롤한다. */
function build(container: HTMLElement, view: EditorView) {
  container.replaceChildren();
  const heads: { level: number; text: string; pos: number }[] = [];
  view.state.doc.forEach((n, offset) => {
    if (n.type.name === 'heading' && n.textContent.trim()) heads.push({ level: n.attrs.level as number, text: n.textContent.trim(), pos: offset });
  });
  if (heads.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'nops-toc__empty';
    empty.textContent = t('editor.toc.empty');
    container.append(empty);
    return;
  }
  const min = Math.min(...heads.map((h) => h.level));
  for (const h of heads) {
    const a = document.createElement('a');
    a.className = 'nops-toc__item';
    a.style.paddingLeft = `${(h.level - min) * 16}px`;
    a.textContent = h.text;
    a.href = '#';
    a.addEventListener('mousedown', (e) => e.preventDefault());
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const dom = view.nodeDOM(h.pos);
      if (dom instanceof HTMLElement) dom.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
    container.append(a);
  }
}

/** ```` ```toc ```` 펜스를 자동 목차로 그린다. 다른 코드 블록은 기본 렌더링을 쓴다. */
export const tocNodeView = (node: PMNode, view: EditorView): NodeView => {
  if (node.attrs.language !== TOC_LANG) return undefined as unknown as NodeView;
  const dom = document.createElement('div');
  dom.className = 'nops-toc';
  dom.contentEditable = 'false';
  dom.setAttribute('data-testid', 'toc');
  const title = document.createElement('div');
  title.className = 'nops-toc__title';
  title.textContent = t('editor.toc.title');
  const list = document.createElement('div');
  dom.append(title, list);
  const redraw = () => build(list, view);
  redraw();
  let set = views.get(view);
  if (!set) views.set(view, (set = new Set()));
  set.add(redraw);
  return {
    dom,
    update: (n) => n.type === node.type && n.attrs.language === TOC_LANG,
    destroy: () => void set!.delete(redraw),
    stopEvent: () => true,
    ignoreMutation: () => true,
  };
};

/** 문서가 바뀔 때마다 열려 있는 목차를 다시 그린다. */
export function createTocPlugin(): Plugin {
  return new Plugin({
    view: () => ({
      update(view, prev) {
        if (view.state.doc === prev.doc) return;
        for (const fn of views.get(view) ?? []) fn();
      },
    }),
  });
}

export const tocSlashItem = (): SlashItemSpec =>
  lazySlashItem(
    { icon: '☰', category: 'advanced', keywords: ['toc', 'table of contents', '목차', '차례', '제목 목록'], run: (v) => insertMarkdown(v, `\`\`\`${TOC_LANG}\n\`\`\`\n`) },
    'editor.toc.title',
    'editor.toc.desc',
  );
