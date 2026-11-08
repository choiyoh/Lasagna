import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { t, tPlural } from '@nopsidian/i18n';
import type { NoteSummary, SearchHit, SyncStatus, VaultInfo } from '@nopsidian/ipc-contract';
import { NoteEditor } from './NoteEditor';
import { useAssetStore } from './assets';
import { ConfirmDialog } from './ConfirmDialog';
import { ErrorBoundary } from './ErrorBoundary';
import { LinkPanel } from './LinkPanel';
import { HistoryPanel } from './HistoryPanel';
import { keys } from './keys';
import { ShortcutsDialog } from './ShortcutsDialog';
import { SettingsDialog } from './SettingsDialog';
import { OutlinePanel } from './OutlinePanel';
import { CommentsPanel } from './CommentsPanel';
import { TrashDialog } from './TrashDialog';
import { EXPAND_ALL_LIMIT, sameNotes, useFolderLimit, useFolderOpen } from './tree-state';
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
import { applyTheme, loadTheme, nextTheme, THEME_ICON, THEME_KEY, type ThemeChoice } from './theme';
import { useLocale } from './useLocale';
import { initialTabs, parseTabs, selectedOf, tabsReducer } from './tabs';
import { DatabaseScreen } from './db/DatabaseScreen';
import { DbList } from './db/DbList';
import { SyncDialog } from './SyncDialog';
import { EmptyState } from './components/EmptyState';
import { SyncBar } from './components/SyncBar';
import { GraphScreen, LocalGraph } from './graph/GraphScreen';
import { linkNameFor } from './link-host';
import { QuickSwitcher } from './QuickSwitcher';
import { CommandPalette, type PaletteCommand } from './CommandPalette';
import { TagPanel } from './TagPanel';
import { dockAvailable, loadDockMode, nextDockMode, resolveDockOpen, saveDockMode, type DockMode } from './dock';
import { cleanSearchSnippet } from './link-snippet';
import { matchParts } from './search-highlight';
import { GraphIcon, NewFolderIcon, PlusIcon, SearchIcon, SettingsIcon, SunIcon, TrashIcon } from './icons';

/** 검색 결과에서 일치한 글자만 강조한다(원문은 그대로) */
function Marked({ text, query }: { text: string; query: string }) {
  return <>{matchParts(text, query).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : p.text))}</>;
}

export function App() {
  useLocale();
  const [vault, setVault] = useState<VaultInfo | null | undefined>(undefined);
  useEffect(() => {
    void window.nops.vault.current().then(setVault);
  }, []);

  if (vault === undefined) return null;
  if (!vault) return <VaultPicker onOpen={setVault} />;
  return <Workspace vault={vault} onClose={() => setVault(null)} />;
}

function Workspace({ vault, onClose }: { vault: VaultInfo; onClose: () => void }) {
  const locale = useLocale();
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
  const searchRef = useRef<HTMLInputElement>(null);
  const [tabs, dispatchTabs] = useReducer(tabsReducer, undefined, initialTabs);
  const selected = selectedOf(tabs);
  /** 현재 탭에서 노트를 연다(이미 다른 탭에 열려 있으면 그 탭으로 간다) */
  const setSelected = useCallback((path: string) => dispatchTabs({ type: 'open', path }), []);
  const openInNewTab = useCallback((path: string) => dispatchTabs({ type: 'open', path, newTab: true }), []);
  /** 링크로 열 때 이동할 제목/블록. tick 은 같은 곳을 다시 눌러도 다시 이동하게 하는 표시 */
  const [focus, setFocusState] = useState<{ heading: string | null; block: string | null; tick: number } | null>(null);
  const focusTick = useRef(0);
  const setFocus = useCallback((next: { heading: string | null; block: string | null } | null) => {
    setFocusState(next ? { ...next, tick: ++focusTick.current } : null);
  }, []);
  const [sideTab, setSideTab] = useState<'files' | 'tags' | 'db' | 'marks'>('files');
  const [bookmarks, setBookmarks] = useState<string[]>([]);
  const [palette, setPalette] = useState(false);
  /** 사이드바 항목 우클릭 메뉴 */
  const [menu, setMenu] = useState<EntryMenuState | null>(null);
  const [theme, setTheme] = useState<ThemeChoice>(() => loadTheme());
  const ThemeIcon = THEME_ICON[theme];
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
  const [panelOpenMode, setPanelOpenMode] = useState<DockMode>(loadDockMode);
  /** 창 폭이 바뀌면 도크 기본값이 달라진다(1,340px 이하 접힘) */
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const panelOpen = resolveDockOpen(panelOpenMode, viewportWidth);
  const togglePanel = useCallback(() => {
    const next = nextDockMode(panelOpen);
    setPanelOpenMode(next);
    saveDockMode(next);
  }, [panelOpen]);
  /** 명령 팔레트에서 "패널 열기" — 이번 실행에서만 연다(사용자가 직접 토글한 선택만 저장한다) */
  const openPanel = useCallback(() => {
    setPanelOpenMode('open');
  }, []);
  const [switcher, setSwitcher] = useState(false);
  /** 전환기에서 고른 노트를 새 탭으로 열 때 */
  const [switcherNewTab, setSwitcherNewTab] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);
  const [dbOpen, setDbOpen] = useState<string | null>(null);
  const [syncOpen, setSyncOpen] = useState(false);
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [dockTab, setDockTab] = useState<'links' | 'outline' | 'comments' | 'graph' | 'history'>('links');
  /** 열린 노트의 안 푼 댓글 수(탭에 배지로 보인다) */
  const [commentCount, setCommentCount] = useState(0);
  const countComments = useCallback(() => {
    if (!selected) return setCommentCount(0);
    void window.nops.comment.list({ path: selected }).then((l) => setCommentCount(l.filter((c) => !c.resolved).length)).catch(() => setCommentCount(0));
  }, [selected]);
  useEffect(() => {
    countComments();
    window.addEventListener('focus', countComments);
    return () => window.removeEventListener('focus', countComments);
  }, [countComments]);
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
    setNoteCover,
    setNoteGoal,
    createWork,
    moveEntries,
    moveRelative,
    deleteEntry,
    deleteEntries,
  } = useEntryActions({ refresh, selected, setSelected, dispatchTabs, setDbOpen, setBookmarks, setToast, setConfirm, live, order: orderRef, commitOrder, tree: treeRef });

  useEffect(() => {
    void window.nops.sync.status().then(setSync);
    return window.nops.on('sync.changed', (s) => setSync(s as SyncStatus));
  }, []);

  /** 도크는 노트를 볼 때만 붙는다(DB·전체 그래프 화면은 폭을 콘텐츠에 준다) */
  const dockVisible = dockAvailable({ hasNote: !!selected, dbOpen: dbOpen !== null, graphOpen });

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
    togglePanel: () => {
      if (dockVisible) togglePanel();
    },
    focusSearch: () => searchRef.current?.focus(),
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

  const { exportNote, exportVault, importNotion, importMarkdown } = useImportExport({ selected, refresh, setToast });

  const commands = useMemo<PaletteCommand[]>(
    () => [
      { id: 'quick', label: t('palette.quick'), hint: '⌘O', keywords: ['open', '열기', '전환', 'ㅇㄱ'], run: () => setSwitcher(true) },
      { id: 'new-folder', label: t('palette.newFolder'), keywords: ['folder', 'new', '폴더', '새로'], run: () => void newFolder('') },
      { id: 'trash', label: t('palette.trash'), keywords: ['trash', 'restore', '휴지통', '복원'], run: () => setTrashOpen(true) },
      { id: 'settings', label: t('palette.settings'), hint: '⌘,', keywords: ['settings', 'preferences', '설정', '환경'], run: () => setSettingsOpen(true) },
      { id: 'shortcuts', label: t('palette.shortcuts'), hint: 'F1', keywords: ['shortcut', 'keys', 'help', '단축키', '도움말'], run: () => setShortcutsOpen(true) },
      { id: 'new', label: t('palette.new'), hint: '⌘N', keywords: ['new', '새로', '만들기'], run: () => void quickNote('') },
      { id: 'daily', label: t('palette.daily'), hint: '⌘⌥D', keywords: ['daily', 'today', '일기', '데일리'], run: () => void openDaily() },
      { id: 'graph', label: t('palette.graph'), hint: '⌘⇧G', keywords: ['graph', '그래프'], run: () => { setDbOpen(null); setGraphOpen((o) => !o); } },
      { id: 'bookmark', label: t('palette.bookmark'), hint: '⌘⇧B', keywords: ['bookmark', '북마크', '즐겨찾기'], enabled: !!selected, run: () => selected && toggleBookmark(selected) },
      { id: 'bookmarks', label: t('palette.bookmarks'), keywords: ['bookmarks', '북마크'], run: () => setSideTab('marks') },
      { id: 'rename', label: t('palette.rename'), hint: 'F2', keywords: ['rename', '이름', '이동'], enabled: !!selected, run: () => void renameCurrent() },
      { id: 'delete', label: t('palette.delete'), keywords: ['delete', 'remove', 'trash', '삭제', '지우기', '휴지통'], enabled: !!selected, run: () => selected && deleteEntry(selected, false) },
      { id: 'source', label: t('palette.source'), hint: '⌘E', keywords: ['source', 'markdown', '소스', '원문'], enabled: !!selected, run: () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', metaKey: true })) },
      { id: 'links', label: t('palette.links'), keywords: ['panel', '패널', '백링크', '기록', '링크'], enabled: dockVisible, run: () => openPanel() },
      { id: 'history', label: t('palette.history'), keywords: ['history', '기록', '버전', '복원'], enabled: dockVisible, run: () => { openPanel(); setDockTab('history'); } },
      { id: 'tags', label: t('palette.tags'), keywords: ['tags', '태그'], run: () => setSideTab('tags') },
      { id: 'dbs', label: t('palette.dbs'), keywords: ['database', 'db', '데이터베이스'], run: () => setSideTab('db') },
      { id: 'files', label: t('palette.files'), keywords: ['files', '파일', '탐색기'], run: () => setSideTab('files') },
      { id: 'sync', label: t('palette.sync'), keywords: ['sync', 'drive', '동기화', '구글'], run: () => setSyncOpen(true) },
      { id: 'export-html', label: t('palette.exportHtml'), keywords: ['export', 'html', '내보내기'], enabled: !!selected, run: () => void exportNote('html') },
      { id: 'export-pdf', label: t('palette.exportPdf'), keywords: ['export', 'pdf', '내보내기'], enabled: !!selected, run: () => void exportNote('pdf') },
      { id: 'export-vault', label: t('palette.exportVault'), keywords: ['export', 'site', 'html', '내보내기', '사이트'], run: () => void exportVault() },
      { id: 'import-md-files', label: t('palette.importFiles'), keywords: ['import', 'markdown', 'md', '가져오기', '마크다운'], run: () => void importMarkdown('files') },
      { id: 'import-md-folder', label: t('palette.importFolder'), keywords: ['import', 'markdown', 'folder', 'obsidian', '옵시디언', '가져오기', '폴더'], run: () => void importMarkdown('folder') },
      { id: 'import-notion', label: t('palette.importNotion'), keywords: ['import', 'notion', '노션', '가져오기'], run: () => void importNotion() },
      { id: 'tab-new', label: t('palette.tabNew'), keywords: ['tab', '탭'], run: () => { setSwitcherNewTab(true); setSwitcher(true); } },
      { id: 'tab-close', label: t('palette.tabClose'), hint: '⌘W', keywords: ['close', 'tab', '탭', '닫기'], enabled: !!selected, run: () => selected && dispatchTabs({ type: 'close', pane: tabs.activePane, path: selected }) },
      { id: 'split-right', label: t('palette.splitRight'), keywords: ['split', '분할', '좌우'], run: () => dispatchTabs({ type: 'split', dir: 'row' }) },
      { id: 'split-down', label: t('palette.splitDown'), keywords: ['split', '분할', '상하'], run: () => dispatchTabs({ type: 'split', dir: 'col' }) },
      { id: 'unsplit', label: t('palette.unsplit'), keywords: ['unsplit', 'merge', '분할', '합치기'], enabled: tabs.panes.length > 1, run: () => dispatchTabs({ type: 'unsplit' }) },
      { id: 'new-window', label: t('palette.newWindow'), keywords: ['window', '창', '새 창'], enabled: !!selected, run: () => selected && void window.nops.window.new({ path: selected }) },
      { id: 'theme', label: t('palette.theme'), keywords: ['theme', 'dark', 'light', '다크', '라이트', '테마', '다크모드'], run: cycleTheme },
      { id: 'close', label: t('palette.switchVault'), keywords: ['vault', '볼트', '닫기'], run: onClose },
    ],
    [selected, dockVisible, openDaily, toggleBookmark, renameCurrent, exportNote, exportVault, importNotion, importMarkdown, cycleTheme, deleteEntry, newFolder, quickNote, onClose, openPanel, tabs.activePane, tabs.panes.length, locale],
  );

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.duration ?? (toast.undo ? 10000 : 4000));
    return () => clearTimeout(t);
  }, [toast]);

  const tree = useMemo(() => buildTree(notes, folders, order), [notes, folders, order]);
  treeRef.current = tree;
  const folderOpen = useFolderOpen(vault.id, notes.length <= EXPAND_ALL_LIMIT);
  const { reveal } = folderOpen;
  const folderLimit = useFolderLimit();
  const visible = useMemo(() => flattenVisible(tree, folderOpen.isOpen, folderLimit.limitOf), [tree, folderOpen.isOpen, folderLimit.limitOf]);
  const sel = useTreeSelection(visible);
  useEffect(() => {
    if (selected) reveal(selected);
  }, [selected, reveal]);
  // 창 제목: 작업 표시줄·창 전환에서 구분되도록 현재 노트 이름을 넣는다
  useEffect(() => {
    const n = selected ? notes.find((x) => x.path === selected) : undefined;
    document.title = n ? `${n.icon ? `${n.icon} ` : ''}${n.title} — Lasagna` : `${vault.name} — Lasagna`;
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
    limitOf: folderLimit.limitOf,
    showMore: folderLimit.more,
  };

  return (
    <div className="workspace">
      <aside className="sidebar">
        <header className="drag">
          <strong>{vault.name}</strong>
          <button className="link" onClick={onClose} title={t('nav.switchVault')}>
            ⇄
          </button>
        </header>
        <nav className="sidebar__nav" aria-label={t('nav.menu')}>
          <button className="navitem" onClick={() => setSwitcher(true)} title={keys(`${t('nav.quickSwitch')} — ${t('nav.quickSwitchSub')} (⌘O)`)} aria-label={t('nav.findNote')}>
            <span className="navitem__icon" aria-hidden><SearchIcon /></span>
            <span className="navitem__label">
              {t('nav.quickSwitch')}<span className="navitem__sub">{t('nav.quickSwitchSub')}</span>
            </span>
            <kbd>{keys('⌘O')}</kbd>
          </button>
          <button className="navitem" onClick={() => void quickNote('')} title={keys(`${t('nav.newNote')} (⌘N)`)} aria-label={t('nav.newNote')}>
            <span className="navitem__icon" aria-hidden><PlusIcon /></span>
            <span className="navitem__label">{t('nav.newNote')}</span>
          </button>
          <button className="navitem" onClick={() => void newFolder('')} aria-label={t('nav.newFolder')}>
            <span className="navitem__icon" aria-hidden><NewFolderIcon /></span>
            <span className="navitem__label">{t('nav.newFolder')}</span>
          </button>
          <button className="navitem" onClick={() => void openDaily()} title={keys(`${t('nav.today')} (⌘⌥D)`)} aria-label={t('nav.todayShort')}>
            <span className="navitem__icon" aria-hidden><SunIcon /></span>
            <span className="navitem__label">{t('nav.today')}</span>
          </button>
          <button className="navitem" onClick={() => { setDbOpen(null); setGraphOpen((o) => !o); }} title={keys(`${t('nav.graph')} (⌘⇧G)`)} aria-label={t('nav.graph')}>
            <span className="navitem__icon" aria-hidden><GraphIcon /></span>
            <span className="navitem__label">{t('nav.graph')}</span>
          </button>
          <button className="navitem" onClick={() => setTrashOpen(true)} aria-label={t('nav.trash')}>
            <span className="navitem__icon" aria-hidden><TrashIcon /></span>
            <span className="navitem__label">{t('nav.trash')}</span>
          </button>
        </nav>
        <label className="searchbox">
          <span className="searchbox__icon" aria-hidden><SearchIcon size={14} /></span>
          <input ref={searchRef} className="search" type="search" placeholder={t('nav.search')} aria-label={t('nav.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="sidebar__tabs" role="tablist">
          <button role="tab" aria-selected={sideTab === 'files'} className={sideTab === 'files' ? 'active' : ''} onClick={() => setSideTab('files')}>
            {t('nav.files')}
          </button>
          <button
            role="tab"
            aria-selected={sideTab === 'marks'}
            className={sideTab === 'marks' ? 'active' : ''}
            onClick={() => setSideTab('marks')}
            title={keys(t('nav.marksHint'))}
            aria-label={t('nav.marks')}
          >
            ★
          </button>
          <button role="tab" aria-selected={sideTab === 'db'} className={sideTab === 'db' ? 'active' : ''} onClick={() => setSideTab('db')}>
            DB
          </button>
          <button role="tab" aria-selected={sideTab === 'tags'} className={sideTab === 'tags' ? 'active' : ''} onClick={() => setSideTab('tags')}>
            {t('nav.tags')}
          </button>
        </div>
        {progress && (
          <p className="muted small">
            {t('app.indexing', { done: progress.done, total: progress.total })}
          </p>
        )}
        <nav
          className="list"
          {...dropProps((items) => moveEntries(items, ''), (paths) => void importMarkdown('paths', paths))}
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
              <EmptyState
                title={t('search.emptyTitle')}
                description={t('search.emptyBody')}
                onReset={() => setQuery('')}
                resetLabel={t('search.clear')}
              />
            ) : (
              <>
                <p className="searchcount muted small" role="status">
                  {tPlural('search.count', hits.length, { n: `${hits.length}${hits.length >= 50 ? '+' : ''}` })}
                </p>
                {hits.map((h) => (
                  <button key={h.path} className="hit" onClick={() => setSelected(h.path)}>
                    <strong>
                      <Marked text={h.title} query={query} />
                    </strong>
                    <span className="muted small">{h.path}</span>
                    <span className="snippet small">
                      <Marked text={cleanSearchSnippet(h.snippet)} query={query} />
                    </span>
                  </button>
                ))}
              </>
            )
          ) : sideTab === 'marks' ? (
            <div className="marks" data-testid="bookmarks">
              {selected && (
                <button className="marks__toggle" onClick={() => toggleBookmark(selected)} data-testid="bookmark-toggle">
                  {bookmarks.includes(selected) ? t('app.bookmarkRemove') : t('app.bookmarkAdd')}
                </button>
              )}
              {bookmarks.length === 0 && <p className="muted small pad">{t('app.noBookmarks')}</p>}
              {bookmarks.map((p) => {
                const note = notes.find((n) => n.path === p);
                return (
                  <div key={p} className={note ? 'marks__row' : 'marks__row missing'}>
                    <button className="marks__open" disabled={!note} onClick={() => setSelected(p)} title={p}>
                      {note?.title ?? t('app.missingNote', { path: p })}
                    </button>
                    <button className="marks__x" onClick={() => toggleBookmark(p)} aria-label={t('app.removeBookmarkAria', { path: p })}>
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
          <SyncBar status={sync} onOpen={() => setSyncOpen(true)} />
          <button className="themebtn" onClick={() => setSettingsOpen(true)} title={keys(`${t('nav.settings')} (⌘,)`)} aria-label={t('nav.settings')} data-testid="settings-btn">
            <SettingsIcon />
          </button>
          <button className="themebtn" onClick={cycleTheme} title={t('nav.themeTitle')} aria-label={t('nav.themeAria', { theme: t(THEME_KEY[theme]) })} data-testid="theme-toggle">
            <ThemeIcon />
            <span>{t(THEME_KEY[theme])}</span>
          </button>
        </div>
      </aside>
      <main className="content">
        {dbOpen !== null ? (
          <ErrorBoundary label={t('app.database')}>
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
              onToast={setToast}
              renderNote={(p) => (
                <ErrorBoundary label={t('app.note')} resetKeys={[p]}>
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
                    cover={notes.find((n) => n.path === p)?.cover ?? null}
                    onSetCover={(c) => void setNoteCover(p, c)}
                    onSetGoal={(g) => void setNoteGoal(p, g)}
                  />
                </ErrorBoundary>
              )}
            />
          </ErrorBoundary>
        ) : graphOpen ? (
          <ErrorBoundary label={t('app.graph')}>
            <GraphScreen
              vaultId={vault.id}
              current={selected}
              onOpen={(p) => {
                setSelected(p);
                setGraphOpen(false);
              }}
              onClose={() => setGraphOpen(false)}
            />
          </ErrorBoundary>
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
                  { icon: '＋', label: t('welcome.action.new'), hint: '', run: () => void quickNote('') },
                  { icon: '☀', label: t('palette.daily'), hint: '⌘⌥D', run: () => void openDaily() },
                  { icon: '⌕', label: t('welcome.action.find'), hint: '⌘O', run: () => setSwitcher(true) },
                  { icon: '⌘', label: t('welcome.action.palette'), hint: '⌘P', run: () => setPalette(true) },
                  { icon: '◎', label: t('welcome.action.graph'), hint: '⌘⇧G', run: () => { setDbOpen(null); setGraphOpen(true); } },
                  { icon: '⇩', label: t('welcome.action.importMarkdown'), hint: '', run: () => void importMarkdown('files') },
                  { icon: '⇪', label: t('welcome.action.importNotion'), hint: '', run: () => void importNotion() },
                ]}
              />
            }
            renderEditor={(p, pane) => (
              <ErrorBoundary label={t('app.note')} resetKeys={[p]}>
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
                  cover={notes.find((n) => n.path === p)?.cover ?? null}
                  onSetCover={(c) => void setNoteCover(p, c)}
                  onSetGoal={(g) => void setNoteGoal(p, g)}
                />
              </ErrorBoundary>
            )}
          />
        )}
      </main>
      {dockVisible && selected && (
        <div className={panelOpen ? 'rightdock open' : 'rightdock'}>
          {panelOpen ? (
            <div className="dockbody">
              <div className="dockbody__bar">
                <div className="dockbody__tabs" role="tablist">
                  <button role="tab" aria-selected={dockTab === 'links'} className={dockTab === 'links' ? 'active' : ''} onClick={() => setDockTab('links')}>
                    {t('dock.links')}
                  </button>
                  <button role="tab" aria-selected={dockTab === 'outline'} className={dockTab === 'outline' ? 'active' : ''} onClick={() => setDockTab('outline')}>
                    {t('dock.outline')}
                  </button>
                  <button role="tab" aria-selected={dockTab === 'comments'} className={dockTab === 'comments' ? 'active' : ''} onClick={() => setDockTab('comments')}>
                    {t('dock.comments')}{commentCount > 0 && <span className="count"> {commentCount}</span>}
                  </button>
                  <button role="tab" aria-selected={dockTab === 'graph'} className={dockTab === 'graph' ? 'active' : ''} onClick={() => setDockTab('graph')}>
                    {t('dock.graph')}
                  </button>
                  <button role="tab" aria-selected={dockTab === 'history'} className={dockTab === 'history' ? 'active' : ''} onClick={() => setDockTab('history')}>
                    {t('dock.history')}
                  </button>
                </div>
                <button className="dockbody__close" onClick={togglePanel} title={t('dock.togglePanel')} aria-label={t('dock.closePanel')} aria-expanded>
                  ×
                </button>
              </div>
              <ErrorBoundary label={t('app.panel')} resetKeys={[dockTab, selected]}>
                {dockTab === 'links' ? <LinkPanel path={selected} onOpen={setSelected} /> : dockTab === 'outline' ? <OutlinePanel path={selected} /> : dockTab === 'comments' ? <CommentsPanel path={selected} onChanged={countComments} /> : dockTab === 'history' ? <HistoryPanel path={selected} onRestored={(message) => setToast({ message })} /> : <LocalGraph path={selected} onOpen={setSelected} />}
              </ErrorBoundary>
            </div>
          ) : (
            <button className="rightdock__rail" onClick={togglePanel} title={t('dock.togglePanel')} aria-label={t('dock.openPanel')} aria-expanded={false}>
              <span className="rightdock__railtop" aria-hidden>‹</span>
              <span className="rightdock__raillabel" aria-hidden>{t('dock.rail')}</span>
            </button>
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
            setToast({ message: t('app.restored', { name: p.replace(/\.md$/i, '') }) });
          }}
        />
      )}
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
      {settingsOpen && (
        <SettingsDialog
          theme={theme}
          onTheme={setTheme}
          onClose={() => setSettingsOpen(false)}
          onCreateWork={(name) => void createWork(name)}
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
