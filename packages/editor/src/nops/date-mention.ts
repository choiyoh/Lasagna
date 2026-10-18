import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

/** `@` 뒤에 입력한 말로 고를 수 있는 날짜 후보 */
export interface DateSuggestion {
  /** 목록에 보일 이름(예: `오늘 · 2026-10-18 (일)`) */
  label: string;
  /** 고르면 넣을 날짜 `YYYY-MM-DD` */
  date: string;
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const WEEKDAY_NAMES = WEEKDAYS.map((w) => `${w}요일`);

const p2 = (n: number) => String(n).padStart(2, '0');
export const isoDate = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const label = (name: string, d: Date) => `${name} · ${isoDate(d)} (${WEEKDAYS[d.getDay()]})`;

/** 실제 달력에 있는 날짜인가(2월 30일 같은 것은 거른다) */
function validDate(y: number, m: number, d: number): Date | null {
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? dt : null;
}

/** 요일 `weekday`(0=일)의 날짜. `next` 면 다음 주(월요일 시작 주 기준)의 그 요일, 아니면 오늘 다음으로 처음 오는 그 요일 */
function nextWeekday(today: Date, weekday: number, next: boolean): Date {
  if (next) {
    const mondayThisWeek = addDays(today, -((today.getDay() + 6) % 7));
    return addDays(mondayThisWeek, 7 + ((weekday + 6) % 7));
  }
  return addDays(today, (weekday - today.getDay() + 7) % 7 || 7);
}

const KEYWORDS: { names: string[]; offset: number; name: string }[] = [
  { names: ['오늘', 'today', 'now'], offset: 0, name: '오늘' },
  { names: ['내일', 'tomorrow'], offset: 1, name: '내일' },
  { names: ['어제', 'yesterday'], offset: -1, name: '어제' },
  { names: ['모레'], offset: 2, name: '모레' },
  { names: ['그제', '그저께'], offset: -2, name: '그저께' },
];

/**
 * `@` 뒤에 친 말(`query`)에서 날짜 후보를 만든다. 오늘·내일·어제·모레, 요일(`월`·`다음 주 월` 등), `+3`·`-2`(며칠 뒤·전),
 * `2026-10-20`·`10-20`·`10/20` 같은 날짜를 알아듣는다. 말이 없으면 자주 쓰는 날짜 몇 개를 보여 준다.
 */
export function dateSuggestions(query: string, today: Date = new Date()): DateSuggestion[] {
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const q = query.trim().toLowerCase();
  const out: DateSuggestion[] = [];
  const add = (name: string, d: Date) => {
    const date = isoDate(d);
    if (!out.some((o) => o.date === date)) out.push({ label: label(name, d), date });
  };

  if (!q) {
    add('오늘', t);
    add('내일', addDays(t, 1));
    add('어제', addDays(t, -1));
    add('다음 주 월요일', nextWeekday(t, 1, true));
    add('다음 주 금요일', nextWeekday(t, 5, true));
    return out;
  }

  // 정확한 날짜: 2026-10-20 · 2026/10/20 · 10-20 · 10/20 · 10.20
  const full = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(q);
  if (full) {
    const d = validDate(Number(full[1]), Number(full[2]), Number(full[3]));
    if (d) add('날짜', d);
    return out;
  }
  const short = /^(\d{1,2})[-/.](\d{1,2})$/.exec(q);
  if (short) {
    const d = validDate(t.getFullYear(), Number(short[1]), Number(short[2]));
    if (d) add('날짜', d);
    return out;
  }
  // 며칠 뒤·전: +3 · -2 · +3d · 3일 뒤 · 3일 후 · 3일 전
  const rel = /^([+-]?)(\d{1,4})\s*(?:d|일)?\s*(뒤|후|전)?$/.exec(q);
  if (rel && (rel[1] || rel[3])) {
    const n = Number(rel[2]) * (rel[1] === '-' || rel[3] === '전' ? -1 : 1);
    if (n !== 0) add(n > 0 ? `${n}일 뒤` : `${-n}일 전`, addDays(t, n));
    return out;
  }

  for (const k of KEYWORDS) if (k.names.some((n) => n.startsWith(q) || q.startsWith(n))) add(k.name, addDays(t, k.offset));
  // 요일: `월` · `월요일` · `다음 주 월` · `다음주월요일` · `다음 월`
  const wk = /^(?:(다음|next)\s*(?:주)?\s*)?(일|월|화|수|목|금|토)(?:요일)?$/.exec(q);
  if (wk) {
    const idx = WEEKDAYS.indexOf(wk[2]!);
    const next = !!wk[1];
    add(`${next ? '다음 주 ' : '이번 '}${WEEKDAY_NAMES[idx]}`, nextWeekday(t, idx, next));
    if (!next) add(`다음 주 ${WEEKDAY_NAMES[idx]}`, nextWeekday(t, idx, true));
  }
  return out;
}

interface Active {
  from: number;
  to: number;
  query: string;
}
const key = new PluginKey<{ dismissedAt: number | null }>('nopsDateMention');
const TRIGGER = /(?:^|\s)@([^\s@]{0,14})$/;

function findActive(view: EditorView): Active | null {
  const { selection } = view.state;
  if (!selection.empty) return null;
  const { $from } = selection;
  if (!$from.parent.inlineContent || $from.parent.type.spec.code) return null;
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '\0');
  const m = TRIGGER.exec(before);
  if (!m) return null;
  const typed = m[1] ?? '';
  return { from: selection.from - typed.length - 1, to: selection.from, query: typed };
}

/**
 * `@` 로 날짜를 넣는다: `@오늘` `@내일` `@금` `@10-20` `@+3` … 후보를 고르면 그 날짜의 노트 링크(`[[2026-10-20]]`)가 들어간다.
 * 데일리 노트 이름이 날짜이므로, 링크를 누르면 그날의 노트로 간다. ↑↓ 이동, Enter/Tab 선택, Esc 닫기.
 */
export function createDateMentionPlugin(now: () => Date = () => new Date()): Plugin {
  let ui: DateUi | null = null;
  return new Plugin({
    key,
    state: {
      init: () => ({ dismissedAt: null as number | null }),
      apply(tr, value) {
        const meta = tr.getMeta(key) as { dismissedAt: number | null } | undefined;
        if (meta) return meta;
        return tr.docChanged ? { dismissedAt: null } : value;
      },
    },
    props: {
      handleKeyDown(view, event) {
        if (!ui?.isOpen() || event.isComposing) return false;
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
            view.dispatch(view.state.tr.setMeta(key, { dismissedAt: findActive(view)?.from ?? null }));
            ui.close();
            return true;
          }
        }
        return false;
      },
    },
    view(view) {
      ui = new DateUi(view, now);
      return {
        update(v) {
          const active = findActive(v);
          if (!active || key.getState(v.state)?.dismissedAt === active.from || !v.editable) ui?.close();
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

class DateUi {
  private readonly el = document.createElement('div');
  private items: DateSuggestion[] = [];
  private selected = 0;
  private active: Active | null = null;
  private lastQuery = '';

  constructor(
    private readonly view: EditorView,
    private readonly now: () => Date,
  ) {
    this.el.className = 'nops-date-suggest';
    this.el.setAttribute('role', 'listbox');
    this.el.setAttribute('aria-label', '날짜 넣기');
    this.el.hidden = true;
    this.el.addEventListener('mousedown', (e) => e.preventDefault());
    document.body.append(this.el);
  }

  isOpen() {
    return !this.el.hidden && this.items.length > 0;
  }

  show(active: Active) {
    this.active = active;
    if (active.query !== this.lastQuery || this.items.length === 0) {
      this.lastQuery = active.query;
      this.selected = 0;
      this.items = dateSuggestions(active.query, this.now());
      this.render();
    }
    this.position();
  }

  close() {
    this.lastQuery = '';
    this.items = [];
    this.el.hidden = true;
    this.active = null;
  }

  destroy() {
    this.el.remove();
  }

  move(delta: number) {
    if (!this.items.length) return;
    this.selected = (this.selected + delta + this.items.length) % this.items.length;
    this.render();
  }

  chooseCurrent(view: EditorView): boolean {
    const item = this.items[this.selected];
    if (!item) return false;
    this.choose(view, item);
    return true;
  }

  private choose(view: EditorView, item: DateSuggestion) {
    const active = findActive(view) ?? this.active;
    const type = view.state.schema.nodes.wikilink;
    if (!active || !type) return;
    const node = type.create({ target: item.date, heading: null, block: null, alias: null });
    const tr = view.state.tr.replaceWith(active.from, active.to, node);
    tr.setSelection(TextSelection.near(tr.doc.resolve(active.from + node.nodeSize)));
    view.dispatch(tr);
    view.focus();
    this.close();
  }

  private render() {
    this.el.replaceChildren();
    if (!this.items.length) {
      this.el.hidden = true;
      return;
    }
    this.items.forEach((item, i) => {
      const row = document.createElement('div');
      row.className = `nops-date-suggest__item${i === this.selected ? ' is-active' : ''}`;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(i === this.selected));
      const icon = document.createElement('span');
      icon.className = 'nops-date-suggest__icon';
      icon.textContent = '📅';
      const label = document.createElement('span');
      label.className = 'nops-date-suggest__label';
      label.textContent = item.label;
      row.append(icon, label);
      row.addEventListener('click', () => this.choose(this.view, item));
      this.el.append(row);
    });
    this.el.hidden = false;
    this.position();
  }

  private position() {
    if (this.el.hidden || !this.active) return;
    const c = this.view.coordsAtPos(this.active.to);
    this.el.style.left = `${Math.max(8, c.left)}px`;
    this.el.style.top = `${c.bottom + 6}px`;
  }
}
