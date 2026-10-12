import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

/** `[[` 뒤에 입력 중인 내용: `이름`, `이름#제목`, `이름#^블록`, 그리고 `|별칭` */
export interface LinkQuery {
  name: string;
  heading: string | null;
  block: string | null;
  alias: string | null;
  /** `[[` 뒤의 원문 전체 */
  raw: string;
}

export interface LinkSuggestion {
  /** 목록에 보일 이름 */
  label: string;
  /** 보조 설명(경로 등) */
  detail?: string;
  /** 링크 대상(파일 이름 또는 경로) */
  target: string;
  heading?: string | null;
  block?: string | null;
  /** 표시 텍스트(`|별칭`) — 사용자가 직접 쓴 별칭이 있으면 그것이 우선한다 */
  alias?: string | null;
  /** `label` 안의 강조 구간 */
  ranges?: Array<[number, number]>;
  kind: 'note' | 'heading' | 'asset' | 'create' | 'block';
  /** 고른 뒤 링크를 넣기 전에 실행한다(예: 대상 블록에 `^id` 부여). 돌려준 `block`이 링크의 블록 ID가 된다 */
  prepare?: () => Promise<{ block: string }>;
}

/** 에디터가 링크 자동완성을 위해 앱에 요구하는 기능 */
export interface NopsLinkHost {
  suggest(query: LinkQuery, embed: boolean): Promise<LinkSuggestion[]> | LinkSuggestion[];
}

export function parseLinkQuery(raw: string): LinkQuery {
  const bar = raw.indexOf('|');
  const left = bar === -1 ? raw : raw.slice(0, bar);
  const alias = bar === -1 ? null : raw.slice(bar + 1);
  const hash = left.indexOf('#');
  const name = (hash === -1 ? left : left.slice(0, hash)).trim();
  let heading: string | null = null;
  let block: string | null = null;
  if (hash !== -1) {
    const frag = left.slice(hash + 1);
    if (frag.startsWith('^')) block = frag.slice(1);
    else heading = frag;
  }
  return { name, heading, block, alias, raw };
}

interface Active {
  from: number;
  to: number;
  embed: boolean;
  query: LinkQuery;
}

interface SuggestState {
  dismissedAt: number | null;
}
const key = new PluginKey<SuggestState>('nopsLinkSuggest');
const OPEN = /(!?)\[\[([^[\]\n]*)$/;

function findActive(view: EditorView): Active | null {
  const { selection } = view.state;
  if (!selection.empty) return null;
  const { $from } = selection;
  if (!$from.parent.inlineContent || $from.parent.type.spec.code) return null;
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '\0');
  const m = OPEN.exec(before);
  if (!m) return null;
  const from = selection.from - m[0].length;
  return { from, to: selection.from, embed: m[1] === '!', query: parseLinkQuery(m[2] ?? '') };
}

/**
 * `[[` 입력 뒤 후보 목록을 띄우고, 고르면 위키링크(`![[`이면 임베드) 노드로 바꾼다.
 * ↑↓ 이동, Enter/Tab 선택, Esc 닫기. 이미 `]]`로 닫혀 있으면 함께 지운다.
 */
export function createLinkSuggestPlugin(host: NopsLinkHost): Plugin {
  let ui: SuggestUi | null = null;

  return new Plugin<SuggestState>({
    key,
    state: {
      init: (): SuggestState => ({ dismissedAt: null }),
      apply(tr, value): SuggestState {
        const meta = tr.getMeta(key) as SuggestState | undefined;
        if (meta) return meta;
        // 문서가 바뀌면(입력) 닫았던 상태를 풀어 준다
        return tr.docChanged ? { dismissedAt: null } : value;
      },
    },
    props: {
      handleKeyDown(view, event) {
        if (!ui?.isOpen()) return false;
        if (event.isComposing) return false;
        switch (event.key) {
          case 'ArrowDown':
            ui.move(1);
            return true;
          case 'ArrowUp':
            ui.move(-1);
            return true;
          case 'Enter':
          case 'Tab':
            return ui.chooseCurrent(view);
          case 'Escape': {
            const a = findActive(view);
            view.dispatch(view.state.tr.setMeta(key, { dismissedAt: a?.from ?? null }));
            ui.close();
            return true;
          }
        }
        return false;
      },
    },
    view(view) {
      ui = new SuggestUi(view, host);
      return {
        update(v) {
          const active = findActive(v);
          const dismissed = key.getState(v.state)?.dismissedAt;
          if (!active || dismissed === active.from || !v.editable) ui?.close();
          else ui?.show(active);
        },
        destroy() {
          ui?.destroy();
          ui = null;
        },
      };
    },
  });
}

class SuggestUi {
  private readonly el = document.createElement('div');
  private items: LinkSuggestion[] = [];
  private selected = 0;
  private active: Active | null = null;
  private seq = 0;
  private lastQueryKey = '';

  constructor(
    private readonly view: EditorView,
    private readonly host: NopsLinkHost,
  ) {
    this.el.className = 'nops-link-suggest';
    this.el.setAttribute('role', 'listbox');
    this.el.hidden = true;
    this.el.addEventListener('mousedown', (e) => e.preventDefault());
    document.body.append(this.el);
  }

  isOpen() {
    return !this.el.hidden && this.items.length > 0;
  }

  show(active: Active) {
    this.active = active;
    const k = `${active.embed}|${active.query.raw}`;
    if (k !== this.lastQueryKey) {
      this.lastQueryKey = k;
      this.selected = 0;
      const seq = ++this.seq;
      void Promise.resolve(this.host.suggest(active.query, active.embed))
        .then((items) => {
          if (seq !== this.seq || this.view.isDestroyed) return; // 더 새로운 질의가 있으면 버린다
          this.items = items;
          this.selected = Math.min(this.selected, Math.max(0, items.length - 1));
          this.render();
        })
        .catch(() => this.close());
    }
    this.position();
  }

  close() {
    this.seq++;
    this.lastQueryKey = '';
    this.items = [];
    this.el.hidden = true;
    this.active = null;
  }

  destroy() {
    this.el.remove();
  }

  move(delta: number) {
    if (this.items.length === 0) return;
    this.selected = (this.selected + delta + this.items.length) % this.items.length;
    this.render();
  }

  chooseCurrent(view: EditorView): boolean {
    const item = this.items[this.selected];
    if (!item || !this.active) return false;
    this.choose(view, item);
    return true;
  }

  private choose(view: EditorView, item: LinkSuggestion) {
    if (item.prepare) {
      // 비동기 준비가 끝난 뒤 그 사이 문서가 바뀌었을 수 있으니 위치를 다시 찾는다
      void item
        .prepare()
        .then(({ block }) => {
          if (!view.isDestroyed) this.choose(view, { ...item, prepare: undefined, block });
        })
        .catch(() => this.close());
      return;
    }
    const active = findActive(view) ?? this.active;
    if (!active) return;
    const { schema, doc } = view.state;
    const type = active.embed ? schema.nodes.embed : schema.nodes.wikilink;
    if (!type) return;
    // 이미 `]]`로 닫혀 있으면 함께 지운다
    let to = active.to;
    if (doc.textBetween(to, Math.min(to + 2, doc.content.size), undefined, '\0') === ']]') to += 2;
    const typedAlias = active.query.alias && active.query.alias.trim() ? active.query.alias : null;
    const node = type.create({
      target: item.target,
      heading: item.heading ?? null,
      block: item.block ?? null,
      alias: typedAlias ?? item.alias ?? null,
    });
    const tr = view.state.tr.replaceWith(active.from, to, node);
    tr.setSelection(TextSelection.near(tr.doc.resolve(active.from + node.nodeSize)));
    view.dispatch(tr);
    view.focus();
    this.close();
  }

  private render() {
    this.el.replaceChildren();
    if (this.items.length === 0) {
      this.el.hidden = true;
      return;
    }
    this.items.forEach((item, i) => {
      const row = document.createElement('div');
      row.className = 'nops-link-suggest__item' + (i === this.selected ? ' is-active' : '');
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(i === this.selected));
      const icon = document.createElement('span');
      icon.className = 'nops-link-suggest__icon';
      icon.textContent = { note: '📄', heading: '#', asset: '🖼', create: '＋', block: '¶' }[item.kind];
      const text = document.createElement('span');
      text.className = 'nops-link-suggest__text';
      const label = document.createElement('span');
      label.className = 'nops-link-suggest__label';
      appendHighlighted(label, item.label, item.ranges ?? []);
      text.append(label);
      if (item.detail) {
        const d = document.createElement('span');
        d.className = 'nops-link-suggest__detail';
        d.textContent = item.detail;
        text.append(d);
      }
      row.append(icon, text);
      row.addEventListener('click', () => this.choose(this.view, item));
      this.el.append(row);
    });
    this.el.hidden = false;
    this.el.querySelector('.is-active')?.scrollIntoView?.({ block: 'nearest' });
    this.position();
  }

  private position() {
    if (this.el.hidden || !this.active) return;
    const c = this.view.coordsAtPos(this.active.to);
    this.el.style.left = `${Math.max(8, c.left)}px`;
    this.el.style.top = `${c.bottom + 6}px`;
  }
}

function appendHighlighted(el: HTMLElement, text: string, ranges: Array<[number, number]>) {
  let pos = 0;
  for (const [s, e] of ranges) {
    if (s > pos) el.append(text.slice(pos, s));
    const mark = document.createElement('mark');
    mark.textContent = text.slice(s, e);
    el.append(mark);
    pos = e;
  }
  if (pos < text.length) el.append(text.slice(pos));
}
