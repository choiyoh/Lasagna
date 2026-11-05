import { t } from '@nopsidian/i18n';
import { lazySlashItem } from './slash-item';
import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, TextSelection, type Command } from 'prosemirror-state';
import type { EditorView, NodeView } from 'prosemirror-view';
import type { SlashItemSpec } from '@oh-new-editor/core';

interface RefInfo {
  pos: number;
  node: PMNode;
  number: number;
}

interface RefCache {
  refs: RefInfo[];
  byId: Map<string, number>;
  byPos: Map<number, RefInfo>;
}

interface DefInfo {
  pos: number;
  node: PMNode;
}

interface DefCache {
  defs: DefInfo[];
  byKey: Map<string, DefInfo>;
  byId: Map<string, DefInfo[]>;
}

const refCache = new WeakMap<PMNode, RefCache>();
const defCache = new WeakMap<PMNode, DefCache>();

/** 각주 참조 번호: 같은 이름은 같은 번호, 인라인 각주는 등장 순서대로 번호를 준다. */
function references(doc: PMNode): RefCache {
  const cached = refCache.get(doc);
  if (cached) return cached;
  const refs: RefInfo[] = [];
  const byId = new Map<string, number>();
  const byPos = new Map<number, RefInfo>();
  let next = 1;
  doc.descendants((node, pos) => {
    if (node.type.name !== 'footnote_ref') return;
    const id = node.attrs.identifier as string | null;
    let number = id ? byId.get(id) : undefined;
    if (number === undefined) {
      number = next++;
      if (id) byId.set(id, number);
    }
    const info = { pos, node, number };
    refs.push(info);
    byPos.set(pos, info);
  });
  const result = { refs, byId, byPos };
  refCache.set(doc, result);
  return result;
}

function definitions(doc: PMNode): DefCache {
  const cached = defCache.get(doc);
  if (cached) return cached;
  const defs: DefInfo[] = [];
  const byKey = new Map<string, DefInfo>();
  const byId = new Map<string, DefInfo[]>();
  doc.descendants((node, pos) => {
    if (node.type.name !== 'footnote_def') return;
    const info = { pos, node };
    defs.push(info);
    const key = node.attrs.key as string | null;
    if (key) byKey.set(key, info);
    const id = String(node.attrs.identifier ?? '');
    const list = byId.get(id);
    if (list) list.push(info);
    else byId.set(id, [info]);
  });
  const result = { defs, byKey, byId };
  defCache.set(doc, result);
  return result;
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
  const cache = references(doc);
  const exact = pos === undefined ? undefined : cache.byPos.get(pos);
  if (exact) return exact.number;
  const id = node.attrs.identifier as string | null;
  return id ? (cache.byId.get(id) ?? 0) : 0;
}

function definitionFor(doc: PMNode, id: string | null): DefInfo | undefined {
  if (!id) return undefined;
  return definitions(doc).byId.get(id)?.[0];
}

/**
 * 편집 중 문서가 바뀌어도 올바른 정의를 고른다.
 * key 는 파싱 때 붙는 안정적인 내부 키이고, 중복 정의는 key 없이는 고르지 않는다.
 */
function definitionByKey(doc: PMNode, key: string | null, id: string): DefInfo | undefined {
  const cache = definitions(doc);
  if (key) {
    const exact = cache.byKey.get(key);
    if (exact && exact.node.attrs.identifier === id) return exact;
  }
  const same = cache.byId.get(id) ?? [];
  return same.length === 1 ? same[0] : undefined;
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
      dom.title = t('editor.footnote.inline', { text: shortTitle(String(n.attrs.text ?? '')) });
      dom.dataset.footnoteInline = '1';
    } else {
      const def = definitionFor(view.state.doc, id);
      dom.title = def ? t('editor.footnote.ref', { text: shortTitle(definitionParts(String(def.node.attrs.source)).text) }) : t('editor.footnote.undefined');
      delete dom.dataset.footnoteInline;
    }
    dom.setAttribute('aria-label', t('editor.footnote.aria', { label: dom.textContent, suffix: dom.title ? ` — ${dom.title}` : '' }));
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
    if (n.attrs.key) dom.dataset.footnoteKey = String(n.attrs.key);
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

interface PanelItem {
  key: string;
  identifier: string;
  item: HTMLDivElement;
  number: HTMLElement;
  label: HTMLElement;
  back: HTMLButtonElement;
  textarea: HTMLTextAreaElement;
  lastId: string;
  lastSource: string;
  lastNumber: number | undefined;
  lastLabel: string;
  lastDisabled: boolean;
  lastBackHidden: boolean;
}

function createPanelItem(panel: HTMLElement, view: EditorView, key: string, id: string): PanelItem {
  const item = document.createElement('div');
  item.className = 'nops-footnotes__item';
  item.dataset.footnoteDef = id;
  item.dataset.footnoteKey = key;

  const head = document.createElement('div');
  head.className = 'nops-footnotes__head';
  const number = document.createElement('sup');
  number.className = 'nops-footnotes__number';
  const labelEl = document.createElement('span');
  labelEl.className = 'nops-footnotes__label';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'nops-footnotes__back';
  back.textContent = t('editor.footnote.back');
  back.addEventListener('click', (e) => {
    e.preventDefault();
    const def = item.dataset.footnoteKey ? definitionByKey(view.state.doc, item.dataset.footnoteKey, item.dataset.footnoteDef ?? '') : undefined;
    if (!def) return;
    const ref = references(view.state.doc).refs.find((r) => r.node.attrs.identifier === def.node.attrs.identifier);
    const refDom = ref ? view.nodeDOM(ref.pos) : null;
    if (refDom instanceof HTMLElement) refDom.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
  head.append(number, labelEl, back);

  const area = document.createElement('textarea');
  area.className = 'nops-footnotes__text';
  area.spellcheck = false;
  area.addEventListener('change', () => {
    const currentKey = item.dataset.footnoteKey ?? null;
    const currentId = item.dataset.footnoteDef ?? '';
    const def = definitionByKey(view.state.doc, currentKey, currentId);
    // 문서에서 사라졌거나 중복 정의라 대상을 확정할 수 없으면 다른 노드를 덮어쓰지 않는다.
    if (!def) {
      area.setAttribute('aria-invalid', 'true');
      return;
    }
    area.removeAttribute('aria-invalid');
    const prefix = definitionParts(String(def.node.attrs.source ?? '')).prefix;
    const nextSource = `${prefix}${area.value}`;
    if (nextSource === def.node.attrs.source) return;
    view.dispatch(view.state.tr.setNodeMarkup(def.pos, undefined, { ...def.node.attrs, source: nextSource }));
  });
  item.append(head, area);
  panel.append(item);
  return {
    key,
    identifier: id,
    item,
    number,
    label: labelEl,
    back,
    textarea: area,
    lastId: '',
    lastSource: '',
    lastNumber: undefined,
    lastLabel: '',
    lastDisabled: false,
    lastBackHidden: false,
  };
}

/** 노트 아래 각주 영역. 정의의 위치는 문서에 그대로 두고 여기서 내용을 편집한다. */
function renderPanel(panel: HTMLElement, title: HTMLElement, items: Map<string, PanelItem>, view: EditorView): void {
  const defs = definitions(view.state.doc).defs;
  panel.hidden = defs.length === 0;
  if (defs.length === 0) {
    for (const entry of items.values()) entry.item.remove();
    items.clear();
    return;
  }

  const { byId } = references(view.state.doc);
  const seen = new Set<string>();
  const ordered: PanelItem[] = [];

  defs.forEach((def, index) => {
    const id = String(def.node.attrs.identifier ?? '');
    const label = String(def.node.attrs.label ?? id);
    const key = String(def.node.attrs.key ?? `id:${id}:${index}`);
    seen.add(key);
    let entry = items.get(key);
    if (entry && entry.identifier !== id) {
      // 같은 키가 다른 정의를 가리키게 바뀌면(외부 문서 교체 등) 예전 입력을 재사용하지 않는다.
      entry.item.remove();
      items.delete(key);
      entry = undefined;
    }
    if (!entry) {
      entry = createPanelItem(panel, view, key, id);
      items.set(key, entry);
    }
    const { item, number, label: labelEl, back, textarea } = entry;
    const n = byId.get(id);
    const disabled = !view.editable;
    const backHidden = !byId.has(id);
    const source = String(def.node.attrs.source ?? '');
    const unchanged =
      entry.lastId === id &&
      entry.lastSource === source &&
      entry.lastNumber === n &&
      entry.lastLabel === label &&
      entry.lastDisabled === disabled &&
      entry.lastBackHidden === backHidden;
    if (unchanged) {
      ordered.push(entry);
      return;
    }

    item.dataset.footnoteDef = id;
    item.dataset.footnoteKey = key;
    entry.identifier = id;
    number.textContent = n ? String(n) : '·';
    labelEl.textContent = `[^${label}]`;
    back.hidden = backHidden;
    textarea.disabled = disabled;
    textarea.setAttribute('aria-label', t('editor.footnote.contentAria', { label }));

    const { text } = definitionParts(source);
    // 포커스가 있는 입력창은 사용자가 치던 값을 덮어쓰지 않는다.
    if (document.activeElement !== textarea && textarea.value !== text) {
      textarea.value = text;
      textarea.rows = Math.min(8, Math.max(2, text.split('\n').length));
    }
    entry.lastId = id;
    entry.lastSource = source;
    entry.lastNumber = n;
    entry.lastLabel = label;
    entry.lastDisabled = disabled;
    entry.lastBackHidden = backHidden;
    ordered.push(entry);
  });

  for (const [key, entry] of items) {
    if (seen.has(key)) continue;
    entry.item.remove();
    items.delete(key);
  }

  const active = document.activeElement;
  const editing = active instanceof HTMLTextAreaElement && panel.contains(active);
  if (!editing) {
    const desired = ordered.map((e) => e.item);
    const current = [...panel.children].filter((el) => el !== title);
    // 순서가 그대로면 DOM 을 건드리지 않는다(증분 갱신).
    if (current.length !== desired.length || current.some((el, i) => el !== desired[i])) {
      panel.replaceChildren(title, ...desired);
    }
  } else {
    // 편집 중에는 기존 textarea 를 옮기지 않는다(포커스·미커밋 입력 보존).
    for (const entry of ordered) if (!panel.contains(entry.item)) panel.append(entry.item);
  }
}

/** 편집기 호스트 아래에 각주 영역을 두고, 문서가 바뀔 때마다 증분 갱신한다. */
export function createFootnotePlugin(host: HTMLElement): Plugin {
  let panel: HTMLDivElement | null = null;
  return new Plugin({
    view(view) {
      panel = document.createElement('div');
      panel.className = 'nops-footnotes';
      panel.setAttribute('data-testid', 'footnotes');
      panel.contentEditable = 'false';
      const title = document.createElement('div');
      title.className = 'nops-footnotes__title';
      title.textContent = t('editor.footnote.title');
      panel.append(title);
      host.append(panel);
      const items = new Map<string, PanelItem>();
      renderPanel(panel, title, items, view);
      let lastEditable = view.editable;
      return {
        update(next, prev) {
          if (next.state.doc !== prev.doc || next.editable !== lastEditable) {
            lastEditable = next.editable;
            renderPanel(panel!, title, items, next);
          }
        },
        destroy() {
          items.clear();
          panel?.remove();
          panel = null;
        },
      };
    },
  });
}

let newFootnoteKey = 1;

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
  const def = defType.create({ identifier: label, label, source: `[^${label}]: `, key: `fn-new-${newFootnoteKey++}` });
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

export const footnoteSlashItem = (): SlashItemSpec =>
  lazySlashItem(
    { icon: '¹', category: 'advanced', keywords: ['footnote', '각주', '주석', 'note'], run: (v) => insertFootnote(v.state, v.dispatch) },
    'editor.footnote.title',
    'editor.footnote.desc',
  );
