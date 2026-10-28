import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, TextSelection, type Command } from 'prosemirror-state';
import type { EditorView, NodeView } from 'prosemirror-view';
import type { SlashItemSpec } from '@oh-new-editor/core';

interface RefInfo {
  pos: number;
  node: PMNode;
  number: number;
}

interface DefInfo {
  pos: number;
  node: PMNode;
}

/** 각주 참조 번호: 같은 이름은 같은 번호, 인라인 각주는 등장 순서대로 번호를 준다. */
function references(doc: PMNode): { refs: RefInfo[]; byId: Map<string, number> } {
  const refs: RefInfo[] = [];
  const byId = new Map<string, number>();
  let next = 1;
  doc.descendants((node, pos) => {
    if (node.type.name !== 'footnote_ref') return;
    const id = node.attrs.identifier as string | null;
    let number = id ? byId.get(id) : undefined;
    if (number === undefined) {
      number = next++;
      if (id) byId.set(id, number);
    }
    refs.push({ pos, node, number });
  });
  return { refs, byId };
}

function definitions(doc: PMNode): DefInfo[] {
  const out: DefInfo[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'footnote_def') out.push({ pos, node });
  });
  return out;
}

/** `[^id]: 본문` 에서 `[^id]: ` 접두사와 편집할 본문을 나눈다. */
function definitionParts(source: string): { prefix: string; text: string } {
  const m = /^\[\^[^\]]+\]:[ \t]?/.exec(source);
  if (!m) return { prefix: '', text: source };
  return { prefix: m[0], text: source.slice(m[0].length) };
}

function shortTitle(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 300 ? `${flat.slice(0, 300)}…` : flat;
}

function refNumberAt(doc: PMNode, pos: number | undefined, node: PMNode): number {
  const { refs, byId } = references(doc);
  const exact = pos === undefined ? undefined : refs.find((r) => r.pos === pos);
  if (exact) return exact.number;
  const id = node.attrs.identifier as string | null;
  return id ? (byId.get(id) ?? 0) : 0;
}

function definitionFor(doc: PMNode, id: string | null): DefInfo | undefined {
  if (!id) return undefined;
  return definitions(doc).find((d) => d.node.attrs.identifier === id);
}

/** 본문 각주 참조 `<sup>`: 번호·툴팁을 그리고, 클릭하면 아래 각주 영역으로 이동한다. */
export function footnoteRefView(node: PMNode, view: EditorView, getPos: () => number | undefined): NodeView {
  const dom = document.createElement('sup');
  dom.className = 'nops-footnote-ref';
  dom.contentEditable = 'false';
  let current = node;

  const draw = (n: PMNode) => {
    const id = (n.attrs.identifier as string | null) ?? null;
    const number = refNumberAt(view.state.doc, getPos(), n);
    dom.textContent = number ? String(number) : '?';
    dom.dataset.footnoteRef = id ?? '';
    if (n.attrs.inline) {
      dom.title = `인라인 각주: ${shortTitle(String(n.attrs.text ?? ''))}`;
      dom.dataset.footnoteInline = '1';
    } else {
      const def = definitionFor(view.state.doc, id);
      dom.title = def ? `각주: ${shortTitle(definitionParts(String(def.node.attrs.source)).text)}` : '정의가 없는 각주';
      delete dom.dataset.footnoteInline;
    }
    dom.setAttribute('aria-label', `각주 ${dom.textContent}${dom.title ? ` — ${dom.title}` : ''}`);
  };
  draw(node);

  dom.addEventListener('mousedown', (e) => e.preventDefault());
  dom.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const id = current.attrs.identifier as string | null;
    if (!id) return;
    const target = [...document.querySelectorAll<HTMLElement>('.nops-footnotes [data-footnote-def]')].find((el) => el.dataset.footnoteDef === id);
    if (!target) return;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target.querySelector('textarea')?.focus();
  });

  return {
    dom,
    update(n) {
      if (n.type !== node.type) return false;
      current = n;
      draw(n);
      return true;
    },
    stopEvent: () => true,
    ignoreMutation: () => true,
  };
}

/** 정의 블록은 원문 위치에 숨겨 두고, 실제 내용은 아래 각주 영역에서 보여 준다. */
export function footnoteDefView(node: PMNode): NodeView {
  const dom = document.createElement('div');
  dom.className = 'nops-footnote-def';
  dom.hidden = true;
  dom.contentEditable = 'false';
  const sync = (n: PMNode) => {
    dom.dataset.footnoteDef = String(n.attrs.identifier ?? '');
    dom.dataset.footnoteLabel = String(n.attrs.label ?? '');
  };
  sync(node);
  return {
    dom,
    update(n) {
      if (n.type !== node.type) return false;
      sync(n);
      return true;
    },
    ignoreMutation: () => true,
    stopEvent: () => true,
  };
}

/** 노트 아래 각주 영역. 정의의 위치는 문서에 그대로 두고 여기서 내용을 편집한다. */
function renderPanel(panel: HTMLElement, view: EditorView): void {
  panel.replaceChildren();
  const defs = definitions(view.state.doc);
  panel.hidden = defs.length === 0;
  if (defs.length === 0) return;

  const { refs, byId } = references(view.state.doc);
  const title = document.createElement('div');
  title.className = 'nops-footnotes__title';
  title.textContent = '각주';
  panel.append(title);

  for (const def of defs) {
    const id = String(def.node.attrs.identifier ?? '');
    const label = String(def.node.attrs.label ?? id);
    const number = byId.get(id);
    const item = document.createElement('div');
    item.className = 'nops-footnotes__item';
    item.dataset.footnoteDef = id;

    const head = document.createElement('div');
    head.className = 'nops-footnotes__head';
    const num = document.createElement('sup');
    num.className = 'nops-footnotes__number';
    num.textContent = number ? String(number) : '·';
    const labelEl = document.createElement('span');
    labelEl.className = 'nops-footnotes__label';
    labelEl.textContent = `[^${label}]`;
    head.append(num, labelEl);

    const firstRef = refs.find((r) => r.node.attrs.identifier === id);
    if (firstRef) {
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'nops-footnotes__back';
      back.textContent = '본문으로';
      back.addEventListener('click', (e) => {
        e.preventDefault();
        const refDom = view.nodeDOM(firstRef.pos);
        if (refDom instanceof HTMLElement) refDom.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
      head.append(back);
    }

    const { prefix, text } = definitionParts(String(def.node.attrs.source ?? ''));
    const area = document.createElement('textarea');
    area.className = 'nops-footnotes__text';
    area.value = text;
    area.rows = Math.min(8, Math.max(2, text.split('\n').length));
    area.disabled = !view.editable;
    area.setAttribute('aria-label', `각주 ${label} 내용`);
    area.spellcheck = false;
    area.addEventListener('change', () => {
      const nextSource = `${prefix}${area.value}`;
      if (nextSource === def.node.attrs.source) return;
      view.dispatch(view.state.tr.setNodeMarkup(def.pos, undefined, { ...def.node.attrs, source: nextSource }));
    });

    item.append(head, area);
    panel.append(item);
  }
}

/** 편집기 호스트 아래에 각주 영역을 두고, 문서가 바뀔 때마다 다시 그린다. */
export function createFootnotePlugin(host: HTMLElement): Plugin {
  let panel: HTMLDivElement | null = null;
  return new Plugin({
    view(view) {
      panel = document.createElement('div');
      panel.className = 'nops-footnotes';
      panel.setAttribute('data-testid', 'footnotes');
      panel.contentEditable = 'false';
      host.append(panel);
      renderPanel(panel, view);
      let lastEditable = view.editable;
      return {
        update(next, prev) {
          if (next.state.doc !== prev.doc || next.editable !== lastEditable) {
            lastEditable = next.editable;
            renderPanel(panel!, next);
          }
        },
        destroy() {
          panel?.remove();
          panel = null;
        },
      };
    },
  });
}

/** 각주 참조와 정의를 한 번에 넣는다. 정의는 문서 끝(원래 위치)에 추가한다. */
export const insertFootnote: Command = (state, dispatch) => {
  const { footnote_ref: refType, footnote_def: defType } = state.schema.nodes;
  if (!refType || !defType) return false;
  const used = new Set<string>();
  state.doc.descendants((n) => {
    if ((n.type.name === 'footnote_ref' || n.type.name === 'footnote_def') && n.attrs.identifier) used.add(String(n.attrs.identifier));
  });
  let number = 1;
  while (used.has(String(number))) number++;
  const label = String(number);
  const ref = refType.create({ identifier: label, label, inline: false, text: null });
  const def = defType.create({ identifier: label, label, source: `[^${label}]: ` });
  if (dispatch) {
    const tr = state.tr;
    const from = state.selection.from;
    tr.replaceSelectionWith(ref);
    const after = from + ref.nodeSize;
    tr.insert(tr.doc.content.size, def);
    tr.setSelection(TextSelection.create(tr.doc, after));
    dispatch(tr.scrollIntoView());
  }
  return true;
};

export const footnoteSlashItem: SlashItemSpec = {
  icon: '¹',
  label: '각주',
  description: '각주 참조와 정의를 넣어요',
  category: 'advanced',
  keywords: ['footnote', '각주', '주석', 'note'],
  run: (v) => insertFootnote(v.state, v.dispatch),
};
