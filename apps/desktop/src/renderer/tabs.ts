/** 탭·분할 상태. 창 안에는 분할 칸(pane)이 1~2개, 칸마다 탭 여러 개가 있다. 같은 노트는 한 곳에만 열린다. */
export interface Pane {
  tabs: string[];
  active: string | null;
}

export interface TabsState {
  panes: Pane[];
  activePane: number;
  /** row = 좌우 분할, col = 상하 분할 */
  dir: 'row' | 'col';
}

export const initialTabs = (): TabsState => ({ panes: [{ tabs: [], active: null }], activePane: 0, dir: 'row' });

export type TabsAction =
  | { type: 'open'; path: string; newTab?: boolean }
  | { type: 'close'; pane: number; path: string }
  | { type: 'activate'; pane: number; path: string }
  | { type: 'focusPane'; pane: number }
  | { type: 'split'; dir: 'row' | 'col' }
  | { type: 'unsplit' }
  | { type: 'remap'; from: string; to: string }
  /** 지운 노트(또는 폴더 아래 모든 노트)의 탭을 닫는다 */
  | { type: 'closePath'; path: string }
  | { type: 'load'; state: TabsState };

const remapPath = (p: string, a: string, b: string) => (p === a ? b : p.startsWith(`${a}/`) ? `${b}${p.slice(a.length)}` : p);

function dropEmptyPanes(s: TabsState): TabsState {
  if (s.panes.length < 2) return s;
  const keep = s.panes.filter((p) => p.tabs.length > 0);
  if (keep.length === s.panes.length) return s;
  if (keep.length === 0) return { ...s, panes: [{ tabs: [], active: null }], activePane: 0 };
  const activePane = Math.min(s.activePane, keep.length - 1);
  return { ...s, panes: keep, activePane };
}

export function tabsReducer(s: TabsState, a: TabsAction): TabsState {
  switch (a.type) {
    case 'open': {
      const at = s.panes.findIndex((p) => p.tabs.includes(a.path));
      if (at >= 0) {
        return { ...s, activePane: at, panes: s.panes.map((p, i) => (i === at ? { ...p, active: a.path } : p)) };
      }
      const cur = s.panes[s.activePane]!;
      const panes = s.panes.map((p, i) => {
        if (i !== s.activePane) return p;
        if (a.newTab || cur.active === null) return { tabs: [...p.tabs, a.path], active: a.path };
        return { tabs: p.tabs.map((t) => (t === cur.active ? a.path : t)), active: a.path };
      });
      return { ...s, panes };
    }
    case 'close': {
      const panes = s.panes.map((p, i) => {
        if (i !== a.pane || !p.tabs.includes(a.path)) return p;
        const idx = p.tabs.indexOf(a.path);
        const tabs = p.tabs.filter((t) => t !== a.path);
        const active = p.active === a.path ? (tabs[Math.min(idx, tabs.length - 1)] ?? null) : p.active;
        return { tabs, active };
      });
      return dropEmptyPanes({ ...s, panes });
    }
    case 'activate':
      return { ...s, activePane: a.pane, panes: s.panes.map((p, i) => (i === a.pane && p.tabs.includes(a.path) ? { ...p, active: a.path } : p)) };
    case 'focusPane':
      return a.pane >= 0 && a.pane < s.panes.length ? { ...s, activePane: a.pane } : s;
    case 'split':
      // 이미 둘이면 방향만 바꾼다. 하나면 빈 칸을 하나 더 만들고 거기로 옮겨 간다.
      if (s.panes.length >= 2) return { ...s, dir: a.dir };
      return { ...s, dir: a.dir, panes: [...s.panes, { tabs: [], active: null }], activePane: 1 };
    case 'unsplit': {
      if (s.panes.length < 2) return s;
      const first = s.panes[0]!;
      const tabs = [...first.tabs, ...s.panes.slice(1).flatMap((p) => p.tabs)];
      const activeOf = s.panes[s.activePane]!.active ?? first.active;
      return { ...s, panes: [{ tabs, active: activeOf }], activePane: 0 };
    }
    case 'remap': {
      const panes = s.panes.map((p) => ({ tabs: p.tabs.map((t) => remapPath(t, a.from, a.to)), active: p.active === null ? null : remapPath(p.active, a.from, a.to) }));
      return { ...s, panes };
    }
    case 'closePath': {
      const gone = (p: string) => p === a.path || p.startsWith(`${a.path}/`);
      const panes = s.panes.map((p) => {
        const tabs = p.tabs.filter((t) => !gone(t));
        if (tabs.length === p.tabs.length) return p;
        const active = p.active && !gone(p.active) ? p.active : (tabs[Math.min(Math.max(p.tabs.indexOf(p.active ?? ''), 0), tabs.length - 1)] ?? null);
        return { tabs, active };
      });
      return dropEmptyPanes({ ...s, panes });
    }
    case 'load':
      return a.state;
  }
}

/** 지금 활성 칸의 활성 노트 */
export const selectedOf = (s: TabsState): string | null => s.panes[s.activePane]?.active ?? null;

/** 저장해 둔 값을 믿지 않고 모양을 검사한다. 맞지 않으면 null */
export function parseTabs(raw: unknown, exists: (path: string) => boolean): TabsState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { panes?: unknown; activePane?: unknown; dir?: unknown };
  if (!Array.isArray(r.panes) || r.panes.length < 1 || r.panes.length > 2) return null;
  const seen = new Set<string>();
  const panes: Pane[] = [];
  for (const p of r.panes) {
    const t = (p as { tabs?: unknown })?.tabs;
    if (!Array.isArray(t)) return null;
    const tabs: string[] = [];
    for (const x of t) {
      if (typeof x === 'string' && exists(x) && !seen.has(x)) {
        seen.add(x);
        tabs.push(x);
      }
    }
    const wanted = (p as { active?: unknown }).active;
    panes.push({ tabs, active: typeof wanted === 'string' && tabs.includes(wanted) ? wanted : (tabs[0] ?? null) });
  }
  const s: TabsState = {
    panes,
    activePane: typeof r.activePane === 'number' && r.activePane >= 0 && r.activePane < panes.length ? r.activePane : 0,
    dir: r.dir === 'col' ? 'col' : 'row',
  };
  return panes.length === 2 && panes.every((p) => p.tabs.length === 0) ? initialTabs() : s;
}
