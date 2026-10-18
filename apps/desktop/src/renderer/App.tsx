import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { NoteSummary, SearchHit, SyncStatus, VaultInfo } from '@nopsidian/ipc-contract';
import { NoteEditor } from './NoteEditor';
import { useAssetStore } from './assets';
import { ConfirmDialog } from './ConfirmDialog';
import { LinkPanel } from './LinkPanel';
import { HistoryPanel } from './HistoryPanel';
import { keys } from './keys';
import { ShortcutsDialog } from './ShortcutsDialog';
import { SettingsDialog } from './SettingsDialog';
import { OutlinePanel } from './OutlinePanel';
import { TrashDialog } from './TrashDialog';
import { EXPAND_ALL_LIMIT, sameNotes, useFolderOpen } from './tree-state';
import type { SidebarOrder } from './sidebar-order';
import { buildTree, type TreeNode } from './sidebar/build-tree';
import { dropProps } from './sidebar/drag';
import { TreeView, type TreeCtx } from './sidebar/TreeView';
import { flattenVisible, useTreeSelection } from './sidebar/selection';
import { VaultPicker } from './VaultPicker';
import { Welcome } from './Welcome';
import type { ConfirmState, Toast } from './app-types';
import { Panes } from './Panes';
import { EntryMenu, type EntryMenuState } from './EntryMenu';
import { ToastView } from './ToastView';
import { useEntryActions } from './useEntryActions';
import { useAppShortcuts } from './useAppShortcuts';
import { useLinkHosts } from './useLinkHosts';
import { useImportExport } from './useImportExport';
import { applyTheme, loadTheme, nextTheme, THEME_ICON, THEME_LABEL, type ThemeChoice } from './theme';
import { initialTabs, parseTabs, selectedOf, tabsReducer } from './tabs';
import { DatabaseScreen } from './db/DatabaseScreen';
import { DbList } from './db/DbList';
import { SyncDialog, syncStateText } from './SyncDialog';
import { GraphScreen, LocalGraph } from './graph/GraphScreen';
import { linkNameFor } from './link-host';
import { QuickSwitcher } from './QuickSwitcher';
import { CommandPalette, type PaletteCommand } from './CommandPalette';
import { TagPanel } from './TagPanel';

export function App() {
  const [vault, setVault] = useState<VaultInfo | null | undefined>(undefined);
  useEffect(() => {
    void window.nops.vault.current().then(setVault);
  }, []);

  if (vault === undefined) return null;
  if (!vault) return <VaultPicker onOpen={setVault} />;
  return <Workspace vault={vault} onClose={() => setVault(null)} />;
}

function Workspace({ vault, onClose }: { vault: VaultInfo; onClose: () => void }) {
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  /** 빈 폴더도 보이게 따로 받는 폴더 목록 */
  const [folders, setFolders] = useState<string[]>([]);
  /** 사이드바에서 손으로 정한 순서(`.nopsidian/order.json`) */
  const [order, setOrderState] = useState<SidebarOrder>({});
  const orderRef = useRef(order);
  orderRef.current = order;
  const commitOrder = useCallback((next: SidebarOrder) => {
    orderRef.current = next;
    setOrderState(next);
    void window.nops.order.set(next);
  }, []);
  useEffect(() => {
    const load = () => void window.nops.order.get().then((o) => setOrderState((cur) => (JSON.stringify(cur) === JSON.stringify(o) ? cur : o)));
    load();
    window.addEventListener('focus', load); // 동기화로 다른 기기의 순서가 들어왔을 수 있다
    return () => window.removeEventListener('focus', load);
  }, []);
  const [trashOpen, setTrashOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [tabs, dispatchTabs] = useReducer(tabsReducer, undefined, initialTabs);
  const selected = selectedOf(tabs);
  /** 현재 탭에서 노트를 연다(이미 다른 탭에 열려 있으면 그 탭으로 간다) */
  const setSelected = useCallback((path: string) => dispatchTabs({ type: 'open', path }), []);
  const openInNewTab = useCallback((path: string) => dispatchTabs({ type: 'open', path, newTab: true }), []);
  /** 링크로 열 때 이동할 제목/블록 */
  const [focus, setFocus] = useState<{ heading: string | null; block: string | null } | null>(null);
  const [sideTab, setSideTab] = useState<'files' | 'tags' | 'db' | 'marks'>('files');
  const [bookmarks, setBookmarks] = useState<string[]>([]);
  const [palette, setPalette] = useState(false);
  /** 사이드바 항목 우클릭 메뉴 */
  const [menu, setMenu] = useState<EntryMenuState | null>(null);
  const [theme, setTheme] = useState<ThemeChoice>(() => loadTheme());
  const cycleTheme = useCallback(() => {
    setTheme((cur) => {
      const next = nextTheme(cur);
      applyTheme(next);
      return next;
    });
  }, []);
  useEffect(() => {
    void window.nops.bookmarks.get().then(setBookmarks);
  }, [vault.id]);
  const toggleBookmark = useCallback((p: string) => {
    setBookmarks((cur) => {
      const next = cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p];
      void window.nops.bookmarks.set(next);
      return next;
    });
  }, []);
  const [panelOpen, setPanelOpen] = useState(true);
  const [switcher, setSwitcher] = useState(false);
  /** 전환기에서 고른 노트를 새 탭으로 열 때 */
  const [switcherNewTab, setSwitcherNewTab] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);
  const [dbOpen, setDbOpen] = useState<string | null>(null);
  const [syncOpen, setSyncOpen] = useState(false);
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [dockTab, setDockTab] = useState<'links' | 'outline' | 'graph' | 'history'>('links');
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const assets = useAssetStore();

  const refresh = useCallback(() => {
    void window.nops.note.list().then((next) => setNotes((cur) => (sameNotes(cur, next) ? cur : next)));
    void window.nops.folder.list().then((next) => setFolders((cur) => (cur.join('\n') === next.join('\n') ? cur : next)));
  }, []);

  useEffect(() => {
    refresh();
    // 저장할 때마다 오는 변경 알림은 묶어서 한 번만 목록을 다시 읽는다
    let timer: ReturnType<typeof setTimeout> | undefined;
    const offChanged = window.nops.on('note.changed', () => {
      clearTimeout(timer);
      timer = setTimeout(refresh, 150);
    });
    const offProgress = window.nops.on('index.progress', (p) => setProgress(p.done >= p.total ? null : p));
    return () => {
      clearTimeout(timer);
      offChanged();
      offProgress();
    };
  }, [refresh]);

  useEffect(() => {
    if (!query.trim()) return setHits(null);
    const t = setTimeout(() => void window.nops.search.query({ q: query, limit: 50 }).then(setHits), 120);
    return () => clearTimeout(t);
  }, [query]);

  const { openLink, peekHost, linkHost, live } = useLinkHosts({ notes, selected, assets, setSelected, setFocus });

  const treeRef = useRef<TreeNode[]>([]);
  const {
    createNote,
    quickNote,
    newFolder,
    openDaily,
    renameEntry,
    renameCurrent,
    setNoteIcon,
    renameNoteTitle,
    moveEntries,
    moveRelative,
    deleteEntry,
    deleteEntries,
  } = useEntryActions({ refresh, selected, setSelected, dispatchTabs, setDbOpen, setBookmarks, setToast, setConfirm, live, order: orderRef, commitOrder, tree: treeRef });

  useEffect(() => {
    void window.nops.sync.status().then(setSync);
    return window.nops.on('sync.changed', (s) => setSync(s as SyncStatus));
  }, []);

  useAppShortcuts({
    overlayOpen: graphOpen,
    dbOpen: dbOpen !== null,
    closeOverlay: () => {
      setGraphOpen(false);
      setDbOpen(null);
    },
    selected,
    openSwitcher: () => setSwitcher(true),
    toggleGraph: () => {
      setDbOpen(null);
      setGraphOpen((o) => !o);
    },
    newNote: () => void quickNote(''),
    openSettings: () => setSettingsOpen(true),
    openShortcuts: () => setShortcutsOpen(true),
    rename: () => void renameCurrent(),
    closeTab: (path) => dispatchTabs({ type: 'close', pane: tabs.activePane, path }),
    openPalette: () => setPalette(true),
    toggleBookmark,
    openDaily: () => void openDaily(),
  });

  // 시작: `?open=` 로 열린 창이면 그 노트, 아니면 저장된 탭·분할 배치를 복원한다
  const restored = useRef(false);
  const openedWith = useMemo(() => new URLSearchParams(window.location.search).get('open'), []);
  useEffect(() => {
    if (restored.current || notes.length === 0) return;
    restored.current = true;
    if (openedWith) {
      dispatchTabs({ type: 'open', path: openedWith });
      return;
    }
    const known = new Set(notes.map((n) => n.path));
    void window.nops.workspace.get().then((raw) => {
      const state = parseTabs(raw, (p) => known.has(p));
      if (state) dispatchTabs({ type: 'load', state });
    });
  }, [notes, openedWith]);
  useEffect(() => {
    if (!restored.current || openedWith) return; // 새 창은 배치를 덮어쓰지 않는다
    const t = setTimeout(() => void window.nops.workspace.set(tabs), 400);
    return () => clearTimeout(t);
  }, [tabs, openedWith]);

  const { exportNote, exportVault, importNotion } = useImportExport({ selected, refresh, setToast });

  const commands = useMemo<PaletteCommand[]>(
    () => [
      { id: 'quick', label: '노트 찾기 (빠른 이동)', hint: '⌘O', keywords: ['open', '열기', '전환', 'ㅇㄱ'], run: () => setSwitcher(true) },
      { id: 'new-folder', label: '새 폴더', keywords: ['folder', 'new', '폴더', '새로'], run: () => void newFolder('') },
      { id: 'trash', label: '휴지통 열기', keywords: ['trash', 'restore', '휴지통', '복원'], run: () => setTrashOpen(true) },
      { id: 'settings', label: '설정', hint: '⌘,', keywords: ['settings', 'preferences', '설정', '환경'], run: () => setSettingsOpen(true) },
      { id: 'shortcuts', label: '단축키 목록', hint: 'F1', keywords: ['shortcut', 'keys', 'help', '단축키', '도움말'], run: () => setShortcutsOpen(true) },
      { id: 'new', label: '새 노트', hint: '⌘N', keywords: ['new', '새로', '만들기'], run: () => void quickNote('') },
      { id: 'daily', label: '오늘의 노트', hint: '⌘⌥D', keywords: ['daily', 'today', '일기', '데일리'], run: () => void openDaily() },
      { id: 'graph', label: '그래프 보기', hint: '⌘⇧G', keywords: ['graph', '그래프'], run: () => { setDbOpen(null); setGraphOpen((o) => !o); } },
      { id: 'bookmark', label: '현재 노트 북마크 추가·해제', hint: '⌘⇧B', keywords: ['bookmark', '북마크', '즐겨찾기'], enabled: !!selected, run: () => selected && toggleBookmark(selected) },
      { id: 'bookmarks', label: '북마크 목록 보기', keywords: ['bookmarks', '북마크'], run: () => setSideTab('marks') },
      { id: 'rename', label: '현재 노트 이름 바꾸기', hint: 'F2', keywords: ['rename', '이름', '이동'], enabled: !!selected, run: () => void renameCurrent() },
      { id: 'delete', label: '현재 노트 삭제 (휴지통)', keywords: ['delete', 'remove', 'trash', '삭제', '지우기', '휴지통'], enabled: !!selected, run: () => selected && deleteEntry(selected, false) },
      { id: 'source', label: '소스 모드 전환', hint: '⌘E', keywords: ['source', 'markdown', '소스', '원문'], enabled: !!selected, run: () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', metaKey: true })) },
      { id: 'links', label: '링크·기록 패널 열기', keywords: ['panel', '패널', '백링크', '기록', '링크'], enabled: !!selected, run: () => setPanelOpen(true) },
      { id: 'history', label: '버전 기록 보기', keywords: ['history', '기록', '버전', '복원'], enabled: !!selected, run: () => { setPanelOpen(true); setDockTab('history'); } },
      { id: 'tags', label: '태그 목록', keywords: ['tags', '태그'], run: () => setSideTab('tags') },
      { id: 'dbs', label: '데이터베이스 목록', keywords: ['database', 'db', '데이터베이스'], run: () => setSideTab('db') },
      { id: 'files', label: '파일 목록', keywords: ['files', '파일', '탐색기'], run: () => setSideTab('files') },
      { id: 'sync', label: 'Google Drive 동기화', keywords: ['sync', 'drive', '동기화', '구글'], run: () => setSyncOpen(true) },
      { id: 'export-html', label: '현재 노트를 HTML로 내보내기', keywords: ['export', 'html', '내보내기'], enabled: !!selected, run: () => void exportNote('html') },
      { id: 'export-pdf', label: '현재 노트를 PDF로 내보내기', keywords: ['export', 'pdf', '내보내기'], enabled: !!selected, run: () => void exportNote('pdf') },
      { id: 'export-vault', label: '볼트 전체를 HTML 사이트로 내보내기', keywords: ['export', 'site', 'html', '내보내기', '사이트'], run: () => void exportVault() },
      { id: 'import-notion', label: 'Notion에서 가져오기 (내보낸 ZIP 파일)', keywords: ['import', 'notion', '노션', '가져오기'], run: () => void importNotion() },
      { id: 'tab-new', label: '새 탭에서 노트 열기', keywords: ['tab', '탭'], run: () => { setSwitcherNewTab(true); setSwitcher(true); } },
      { id: 'tab-close', label: '현재 탭 닫기', hint: '⌘W', keywords: ['close', 'tab', '탭', '닫기'], enabled: !!selected, run: () => selected && dispatchTabs({ type: 'close', pane: tabs.activePane, path: selected }) },
      { id: 'split-right', label: '오른쪽으로 분할', keywords: ['split', '분할', '좌우'], run: () => dispatchTabs({ type: 'split', dir: 'row' }) },
      { id: 'split-down', label: '아래로 분할', keywords: ['split', '분할', '상하'], run: () => dispatchTabs({ type: 'split', dir: 'col' }) },
      { id: 'unsplit', label: '분할 합치기', keywords: ['unsplit', 'merge', '분할', '합치기'], enabled: tabs.panes.length > 1, run: () => dispatchTabs({ type: 'unsplit' }) },
      { id: 'new-window', label: '새 창에서 열기', keywords: ['window', '창', '새 창'], enabled: !!selected, run: () => selected && void window.nops.window.new({ path: selected }) },
      { id: 'theme', label: '테마 바꾸기 (시스템 → 라이트 → 다크)', keywords: ['theme', 'dark', 'light', '다크', '라이트', '테마', '다크모드'], run: cycleTheme },
      { id: 'close', label: '다른 볼트 열기', keywords: ['vault', '볼트', '닫기'], run: onClose },
    ],
    [selected, openDaily, toggleBookmark, renameCurrent, exportNote, exportVault, importNotion, cycleTheme, deleteEntry, newFolder, quickNote, onClose, tabs.activePane, tabs.panes.length],
  );

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.undo ? 10000 : 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const tree = useMemo(() => buildTree(notes, folders, order), [notes, folders, order]);
  treeRef.current = tree;
  const folderOpen = useFolderOpen(vault.id, notes.length <= EXPAND_ALL_LIMIT);
  const { reveal } = folderOpen;
  const visible = useMemo(() => flattenVisible(tree, folderOpen.isOpen), [tree, folderOpen.isOpen]);
  const sel = useTreeSelection(visible);
  useEffect(() => {
    if (selected) reveal(selected);
  }, [selected, reveal]);
  // 창 제목: 작업 표시줄·창 전환에서 구분되도록 현재 노트 이름을 넣는다
  useEffect(() => {
    const n = selected ? notes.find((x) => x.path === selected) : undefined;
    document.title = n ? `${n.icon ? `${n.icon} ` : ''}${n.title} — Nopsidian` : `${vault.name} — Nopsidian`;
  }, [selected, notes, vault.name]);
  /** 노트 안의 ```dbview 가 앱으로 돌아올 때 쓰는 기능 */
  const dbHost = useMemo(
    () =>
      vault
        ? {
            vaultId: vault.id,
            notes: notes.map((n) => ({ path: n.path, title: n.title })),
            openNote: (p: string) => {
              setDbOpen(null);
              setGraphOpen(false);
              setSelected(p);
            },
            openDb: (f: string) => {
              setGraphOpen(false);
              setDbOpen(f);
            },
            renameNote: renameNoteTitle,
          }
        : undefined,
    [vault, notes, renameNoteTitle],
  );

  /** 사이드바 나무가 쓰는 것들 */
  const treeCtx: TreeCtx = {
    folderOpen,
    selected,
    picked: sel.picked,
    cursor: sel.cursor,
    onOpen: (p, newTab) => (newTab ? openInNewTab(p) : setSelected(p)),
    onItemClick: (p, e) => sel.click(p, e),
    onRenameFolder: (f) => void renameEntry(f, true),
    onMenu: (p, isFolder, x, y) => setMenu({ path: p, isFolder, x, y, multi: sel.contextOn(p) }),
    dragItems: (p, isFolder) => (sel.picked.has(p) && sel.picked.size > 1 ? sel.entries() : [{ path: p, isFolder }]),
    onMove: moveEntries,
    onReorder: moveRelative,
  };

  return (
    <div className="workspace">
      <aside className="sidebar">
        <header className="drag">
          <strong>{vault.name}</strong>
          <button className="link" onClick={onClose} title="다른 볼트 열기">
            ⇄
          </button>
        </header>
        <nav className="sidebar__nav" aria-label="빠른 메뉴">
          <button className="navitem" onClick={() => setSwitcher(true)} title={keys('노트 찾기 (⌘O)')} aria-label="노트 찾기">
            <span className="navitem__icon" aria-hidden>⌕</span>
            <span className="navitem__label">노트 찾기</span>
            <kbd>{keys('⌘O')}</kbd>
          </button>
          <button className="navitem" onClick={() => void quickNote('')} title={keys('새 노트 (⌘N)')} aria-label="새 노트">
            <span className="navitem__icon" aria-hidden>＋</span>
            <span className="navitem__label">새 노트</span>
          </button>
          <button className="navitem" onClick={() => void newFolder('')} aria-label="새 폴더">
            <span className="navitem__icon" aria-hidden>▤</span>
            <span className="navitem__label">새 폴더</span>
          </button>
          <button className="navitem" onClick={() => void openDaily()} title={keys('오늘의 노트 (⌘⌥D)')} aria-label="오늘">
            <span className="navitem__icon" aria-hidden>☀</span>
            <span className="navitem__label">오늘의 노트</span>
          </button>
          <button className="navitem" onClick={() => { setDbOpen(null); setGraphOpen((o) => !o); }} title={keys('그래프 (⌘⇧G)')} aria-label="그래프">
            <span className="navitem__icon" aria-hidden>◎</span>
            <span className="navitem__label">그래프</span>
          </button>
          <button className="navitem" onClick={() => setTrashOpen(true)} aria-label="휴지통">
            <span className="navitem__icon" aria-hidden>🗑</span>
            <span className="navitem__label">휴지통</span>
          </button>
        </nav>
        <input className="search" placeholder="전문 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="sidebar__tabs" role="tablist">
          <button role="tab" aria-selected={sideTab === 'files'} className={sideTab === 'files' ? 'active' : ''} onClick={() => setSideTab('files')}>
            파일
          </button>
          <button role="tab" aria-selected={sideTab === 'marks'} className={sideTab === 'marks' ? 'active' : ''} onClick={() => setSideTab('marks')} title={keys('북마크 (⌘⇧B로 현재 노트 추가·해제)')}>
            ★
          </button>
          <button role="tab" aria-selected={sideTab === 'db'} className={sideTab === 'db' ? 'active' : ''} onClick={() => setSideTab('db')}>
            DB
          </button>
          <button role="tab" aria-selected={sideTab === 'tags'} className={sideTab === 'tags' ? 'active' : ''} onClick={() => setSideTab('tags')}>
            태그
          </button>
        </div>
        {progress && (
          <p className="muted small">
            인덱싱 {progress.done}/{progress.total}
          </p>
        )}
        <nav
          className="list"
          {...dropProps((items) => moveEntries(items, ''))}
          onKeyDown={(e) =>
            sel.onKeyDown(e, {
              isOpen: folderOpen.isOpen,
              setOpen: folderOpen.setOpen,
              remove: deleteEntries,
              rename: (it) => void renameEntry(it.path, it.isFolder),
            })
          }
          onContextMenu={(e) => {
            if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains('tree')) return;
            e.preventDefault();
            setMenu({ path: '', isFolder: true, x: e.clientX, y: e.clientY });
          }}
        >
          {hits ? (
            hits.length === 0 ? (
              <p className="muted small pad">결과 없음</p>
            ) : (
              hits.map((h) => (
                <button key={h.path} className="hit" onClick={() => setSelected(h.path)}>
                  <strong>{h.title}</strong>
                  <span className="muted small">{h.path}</span>
                  <span className="snippet small">{h.snippet}</span>
                </button>
              ))
            )
          ) : sideTab === 'marks' ? (
            <div className="marks" data-testid="bookmarks">
              {selected && (
                <button className="marks__toggle" onClick={() => toggleBookmark(selected)} data-testid="bookmark-toggle">
                  {bookmarks.includes(selected) ? '★ 현재 노트 북마크 해제' : '☆ 현재 노트 북마크'}
                </button>
              )}
              {bookmarks.length === 0 && <p className="muted small pad">북마크한 노트가 없어요.</p>}
              {bookmarks.map((p) => {
                const note = notes.find((n) => n.path === p);
                return (
                  <div key={p} className={note ? 'marks__row' : 'marks__row missing'}>
                    <button className="marks__open" disabled={!note} onClick={() => setSelected(p)} title={p}>
                      {note?.title ?? `${p} (없음)`}
                    </button>
                    <button className="marks__x" onClick={() => toggleBookmark(p)} aria-label={`${p} 북마크 해제`}>
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          ) : sideTab === 'tags' ? (
            <TagPanel onOpen={setSelected} />
          ) : sideTab === 'db' ? (
            <DbList onOpen={(f) => { setGraphOpen(false); setDbOpen(f); }} />
          ) : (
            <TreeView nodes={tree} ctx={treeCtx} />
          )}
        </nav>
        <div className="sidebar__foot">
          <button className="syncbar" onClick={() => setSyncOpen(true)} title="Google Drive 동기화" data-testid="sync-bar">
          ☁ {sync?.enabled ? syncStateText(sync) : '동기화 꺼짐'}
        </button>
          <button className="themebtn" onClick={() => setSettingsOpen(true)} title={keys('설정 (⌘,)')} aria-label="설정" data-testid="settings-btn">
            <span aria-hidden>⚙</span>
          </button>
          <button className="themebtn" onClick={cycleTheme} title="테마 바꾸기: 시스템 → 라이트 → 다크" aria-label={`테마 ${THEME_LABEL[theme]}`} data-testid="theme-toggle">
            <span aria-hidden>{THEME_ICON[theme]}</span> {THEME_LABEL[theme]}
          </button>
        </div>
      </aside>
      <main className="content">
        {dbOpen !== null ? (
          <DatabaseScreen
            key={dbOpen}
            folder={dbOpen}
            vaultId={vault.id}
            onOpenNote={(p) => {
              setSelected(p);
              setDbOpen(null);
            }}
            onClose={() => setDbOpen(null)}
            notes={notes.map((n) => ({ path: n.path, title: n.title }))}
            onRenameNote={renameNoteTitle}
            renderNote={(p) => (
              <NoteEditor
                key={p}
                path={p}
                vaultId={vault.id}
                assets={assets}
                links={linkHost}
                focus={null}
                noteLinkName={linkNameFor(p, notes.map((n) => n.path))}
                onOpenLink={openLink}
                onRename={() => void renameEntry(p, false)}
                dbHost={dbHost}
                peek={peekHost}
                icon={notes.find((n) => n.path === p)?.icon ?? null}
                onSetIcon={(ic) => void setNoteIcon(p, ic)}
              />
            )}
          />
        ) : graphOpen ? (
          <GraphScreen
            vaultId={vault.id}
            current={selected}
            onOpen={(p) => {
              setSelected(p);
              setGraphOpen(false);
            }}
            onClose={() => setGraphOpen(false)}
          />
        ) : (
          <Panes
            tabs={tabs}
            dispatch={dispatchTabs}
            titleOf={(p) => {
              const n = notes.find((x) => x.path === p);
              return `${n?.icon ? `${n.icon} ` : ''}${n?.title ?? p.replace(/\.md$/i, '').split('/').pop()!}`;
            }}
            onPopOut={(p) => {
              dispatchTabs({ type: 'close', pane: tabs.panes.findIndex((x) => x.tabs.includes(p)), path: p });
              void window.nops.window.new({ path: p });
            }}
            empty={
              <Welcome
                notes={notes}
                onOpen={setSelected}
                actions={[
                  { icon: '＋', label: '새 노트', hint: '', run: () => void quickNote('') },
                  { icon: '☀', label: '오늘의 노트', hint: '⌘⌥D', run: () => void openDaily() },
                  { icon: '⌕', label: '노트 찾기', hint: '⌘O', run: () => setSwitcher(true) },
                  { icon: '⌘', label: '명령 팔레트', hint: '⌘P', run: () => setPalette(true) },
                  { icon: '◎', label: '그래프', hint: '⌘⇧G', run: () => { setDbOpen(null); setGraphOpen(true); } },
                  { icon: '⇪', label: 'Notion 가져오기', hint: '', run: () => void importNotion() },
                ]}
              />
            }
            renderEditor={(p, pane) => (
              <NoteEditor
                key={p}
                path={p}
                vaultId={vault.id}
                assets={assets}
                links={linkHost}
                focus={pane === tabs.activePane ? focus : null}
                noteLinkName={linkNameFor(p, notes.map((n) => n.path))}
                onOpenLink={openLink}
                onRename={() => void renameEntry(p, false)}
                onTitleRename={(to) => void renameEntry(p, false, to.replace(/\.md$/i, ''), { auto: true })}
                dbHost={dbHost}
                peek={peekHost}
                icon={notes.find((n) => n.path === p)?.icon ?? null}
                onSetIcon={(ic) => void setNoteIcon(p, ic)}
              />
            )}
          />
        )}
      </main>
      {selected && (
        <div className={panelOpen ? 'rightdock open' : 'rightdock'}>
          <button className="rightdock__toggle" onClick={() => setPanelOpen((o) => !o)} title="링크 패널 열기/닫기" aria-expanded={panelOpen}>
            {panelOpen ? '›' : '‹'}
          </button>
          {panelOpen && (
            <div className="dockbody">
              <div className="dockbody__tabs" role="tablist">
                <button role="tab" aria-selected={dockTab === 'links'} className={dockTab === 'links' ? 'active' : ''} onClick={() => setDockTab('links')}>
                  링크
                </button>
                <button role="tab" aria-selected={dockTab === 'outline'} className={dockTab === 'outline' ? 'active' : ''} onClick={() => setDockTab('outline')}>
                  개요
                </button>
                <button role="tab" aria-selected={dockTab === 'graph'} className={dockTab === 'graph' ? 'active' : ''} onClick={() => setDockTab('graph')}>
                  로컬 그래프
                </button>
                <button role="tab" aria-selected={dockTab === 'history'} className={dockTab === 'history' ? 'active' : ''} onClick={() => setDockTab('history')}>
                  기록
                </button>
              </div>
              {dockTab === 'links' ? <LinkPanel path={selected} onOpen={setSelected} /> : dockTab === 'outline' ? <OutlinePanel path={selected} /> : dockTab === 'history' ? <HistoryPanel path={selected} onRestored={(message) => setToast({ message })} /> : <LocalGraph path={selected} onOpen={setSelected} />}
            </div>
          )}
        </div>
      )}
      {switcher && (
        <QuickSwitcher notes={notes} onOpen={(p) => (switcherNewTab ? openInNewTab(p) : setSelected(p))} onCreate={(n) => void createNote(n)} onClose={() => { setSwitcher(false); setSwitcherNewTab(false); }} />
      )}
      {palette && <CommandPalette commands={commands} onClose={() => setPalette(false)} />}
      {syncOpen && <SyncDialog status={sync} onClose={() => setSyncOpen(false)} onOpenNote={setSelected} />}
      {trashOpen && (
        <TrashDialog
          onClose={() => setTrashOpen(false)}
          onRestored={(p, isFolder) => {
            refresh();
            if (!isFolder) setSelected(p);
            setToast({ message: `복원했어요: ${p.replace(/\.md$/i, '')}` });
          }}
        />
      )}
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
      {settingsOpen && (
        <SettingsDialog
          theme={theme}
          onTheme={setTheme}
          onClose={() => setSettingsOpen(false)}
          onOpenSync={() => {
            setSettingsOpen(false);
            setSyncOpen(true);
          }}
          onOpenNote={setSelected}
          onReverted={(p, kind) => {
            refresh();
            // 열려 있는 편집기는 되돌린 내용으로 다시 불러온다(새로 만든 노트를 치웠다면 탭을 닫는다)
            if (kind === 'trashed') dispatchTabs({ type: 'closePath', path: p });
            else window.dispatchEvent(new CustomEvent('nops:reload-note', { detail: p }));
          }}
          onOpenTrash={() => {
            setSettingsOpen(false);
            setTrashOpen(true);
          }}
          onOpenShortcuts={() => {
            setSettingsOpen(false);
            setShortcutsOpen(true);
          }}
        />
      )}
      {menu && (
        <EntryMenu
          menu={menu}
          bookmarked={bookmarks.includes(menu.path)}
          pickedCount={sel.picked.size}
          onClose={() => setMenu(null)}
          onOpenInNewTab={openInNewTab}
          onNewNote={(folder) => void quickNote(folder)}
          onNewFolder={(parent) => void newFolder(parent)}
          onRename={(path, isFolder) => void renameEntry(path, isFolder)}
          onToggleBookmark={toggleBookmark}
          onDelete={(path, isFolder) => deleteEntry(path, isFolder)}
          onDeletePicked={() => deleteEntries(sel.entries())}
          onClearPicked={sel.clear}
        />
      )}
      {confirm && <ConfirmDialog {...confirm} onCancel={() => setConfirm(null)} />}
      <ToastView toast={toast} setToast={setToast} />
    </div>
  );
}
