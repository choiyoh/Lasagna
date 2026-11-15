import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { formatNumber, t } from '@nopsidian/i18n';
import type { NoteSummary, SyncStatus, VaultInfo } from '@nopsidian/ipc-contract';
import { NoteEditor } from './NoteEditor';
import { useAssetStore } from './assets';
import { ConfirmDialog } from './ConfirmDialog';
import { ErrorBoundary } from './ErrorBoundary';
import { LinkPanel } from './LinkPanel';
import { HistoryPanel } from './HistoryPanel';
import { keys } from './keys';
import { ShortcutsDialog } from './ShortcutsDialog';
import { SettingsDialog } from './SettingsDialog';
import { changeWriterSettings } from './language';
import { WorkSection } from './WorkSection';
import { WorkCreateDialog } from './WorkCreateDialog';
import { WorkGoalDialog } from './WorkGoalDialog';
import { MergeExportDialog } from './MergeExportDialog';
import { calcWorkGoal, goalLineText, goalTooltip, parseLocalDay, type WorkGoal } from '@nopsidian/core';
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
import { useLanguage, useLocale } from './useLocale';
import { showTextPrompt } from '@nopsidian/editor/nops';
import { isEpisodeNote, previousEpisodePath, type WorkSummary } from '@nopsidian/core';
import { initialTabs, parseTabs, selectedOf, tabsReducer } from './tabs';
import { DatabaseScreen } from './db/DatabaseScreen';
import { DbList } from './db/DbList';
import { SyncDialog } from './SyncDialog';
import { SyncBar } from './components/SyncBar';
import { GraphScreen, LocalGraph } from './graph/GraphScreen';
import { linkNameFor } from './link-host';
import { QuickSwitcher, type SearchScope } from './QuickSwitcher';
import { CommandPalette, type PaletteCommand } from './CommandPalette';
import { SidebarMenu, type SidebarMenuItem } from './SidebarMenu';
import { canRestoreFocus } from './focus-guard';
import { TagPanel } from './TagPanel';
import { dockAvailable, loadDockMode, nextDockMode, resolveDockOpen, saveDockMode, type DockMode } from './dock';
import { MoreIcon, PlusIcon, SearchIcon, SettingsIcon, TrashIcon } from './icons';

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
  const language = useLanguage();
  const writerOn = language.writerMode === true;
  /** 작가 모드 '작품' 카드(메인이 mtime 캐시로 집계). 일반 모드에서는 비어 있다. */
  const [works, setWorks] = useState<WorkSummary[]>([]);
  /** 오늘 쓴 글자수(작품 카드 진행 막대) — W1b 통계와 같은 값 */
  const [workToday, setWorkToday] = useState(0);
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
  const settingsBtnRef = useRef<HTMLButtonElement>(null);
  /** 설정을 닫고 초점을 연 버튼(사이드바 설정)으로 돌려준다.
   *  같은 틱에 팔레트·대화상자가 열렸다면 그쪽이 초점을 가져야 하므로 복귀를 생략한다. */
  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    requestAnimationFrame(() => {
      if (canRestoreFocus()) settingsBtnRef.current?.focus();
    });
  }, []);
  /** 작품 만들기 대화상자(이름+구조). 설정·사이드바가 같은 것을 연다 */
  const [workDialog, setWorkDialog] = useState(false);
  /** 원고 합본 내보내기 대상 작품 / 지금 열린 작품(팔레트가 같은 작품을 쓴다) */
  const [mergeWork, setMergeWork] = useState<string | null>(null);
  const [openWorkName, setOpenWorkName] = useState<string | null>(null);
  /** 작품 목표(앱 데이터)와 목표 대화상자 */
  const [workGoals, setWorkGoals] = useState<Record<string, WorkGoal>>({});
  const [goalWork, setGoalWork] = useState<string | null>(null);
  /** 집중 모드(작가 모드 전용, 세션 단위) */
  const [focusMode, setFocusMode] = useState(false);
  const [chromeShown, setChromeShown] = useState(true);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  /** 사이드바 머리줄 `⋯` 메뉴(연 버튼의 좌표) */
  const [moreMenu, setMoreMenu] = useState<{ x: number; y: number } | null>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
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
  useEffect(() => {
    if (!writerOn) {
      setWorks([]);
      return;
    }
    let alive = true;
    // 노트 목록이 바뀔 때마다(저장·외부 변경·생성) 조금 모아서 다시 센다 — 타이핑을 막지 않는다.
    const timer = setTimeout(() => {
      void window.nops.note
        .workList()
        .then((list) => {
          if (alive) setWorks(list);
        })
        .catch(() => {
          // 집계 실패는 카드만 비워 둔다(집필을 막지 않는다).
        });
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [writerOn, notes, folders]);

  useEffect(() => {
    if (!writerOn) return;
    void window.nops.settings.workGoals({ vaultId: vault.id }).then(setWorkGoals).catch(() => setWorkGoals({}));
  }, [writerOn, vault.id, works]);

  useEffect(() => {
    if (!writerOn) return;
    void window.nops.settings
      .writerToday({ vaultId: vault.id })
      .then((r) => setWorkToday(r.chars))
      .catch(() => undefined);
  }, [writerOn, vault.id]);

  useEffect(() => {
    const onToday = (e: Event) => setWorkToday((e as CustomEvent<number>).detail ?? 0);
    window.addEventListener('nops:writer-today', onToday);
    return () => window.removeEventListener('nops:writer-today', onToday);
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
  /** 통합 검색 팝업의 처음 칩: ⌘O 는 전체, ⌘⇧F 는 본문 */
  const [switcherScope, setSwitcherScope] = useState<SearchScope>('all');
  const openSwitcher = useCallback((scope: SearchScope = 'all') => {
    setSwitcherScope(scope);
    setSwitcher(true);
  }, []);
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
    createCharacter,
    createEpisode,
    openEpisodeDb,
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

  useEffect(() => {
    if (!writerOn) setFocusMode(false);
  }, [writerOn]);

  // 집중 모드에서 도크·설정 등 다른 화면을 열면 집중 모드를 끝낸다.
  // 통합 검색 팝업(switcher)은 집중 모드에서도 쓰는 도구라 여기에 넣지 않는다.
  useEffect(() => {
    if (focusMode) setFocusMode(false);
  }, [settingsOpen, trashOpen, shortcutsOpen, palette, syncOpen, graphOpen, dbOpen]);

  // 도크를 **새로 여는** 경로(단축키·팔레트·레일 클릭)에서 집중 모드를 끝낸다.
  // (집중 모드에 들어갈 때 이미 열려 있던 도크는 숨기기만 하고, 진입을 막지는 않는다.)
  const wasPanelOpen = useRef(panelOpen);
  useEffect(() => {
    const opened = !wasPanelOpen.current && panelOpen;
    wasPanelOpen.current = panelOpen;
    if (opened && focusMode) setFocusMode(false);
  }, [focusMode, panelOpen]);

  useEffect(() => {
    if (!focusMode) return;
    setChromeShown(true);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onMove = () => {
      setChromeShown(true);
      clearTimeout(timer);
      timer = setTimeout(() => setChromeShown(false), 2000);
    };
    window.addEventListener('mousemove', onMove);
    return () => {
      window.removeEventListener('mousemove', onMove);
      clearTimeout(timer);
    };
  }, [focusMode]);

  useAppShortcuts({
    focusAvailable: writerOn,
    focusMode,
    toggleFocus: () => setFocusMode((v) => !v),
    overlayOpen: graphOpen,
    dbOpen: dbOpen !== null,
    closeOverlay: () => {
      setGraphOpen(false);
      setDbOpen(null);
    },
    selected,
    openSwitcher: () => openSwitcher('all'),
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
    openBodySearch: () => openSwitcher('body'),
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

  const previousOf = useCallback((p: string) => previousEpisodePath(works, p, locale), [works, locale]);
  /** 회차 폴더 안 노트에만 작가 상태줄·오늘 집계를 보인다(작품 목록 로드 전에는 false) */
  const episodeOf = useCallback((p: string) => isEpisodeNote(works, p), [works]);
  const previous = selected ? previousOf(selected) : null;
  const [refocus, setRefocus] = useState<{ path: string; tick: number } | null>(null);
  const refocusTick = useRef(0);
  const restoreEditorFocus = useCallback((path: string) => setRefocus({ path, tick: ++refocusTick.current }), []);
  // split if needed, open in the other pane, then restore focus to the writing pane
  const openPrevious = useCallback(
    (from: string, to: string) => {
      const cur = tabs.activePane;
      const at = tabs.panes.findIndex((p) => p.tabs.includes(to));
      if (tabs.panes.length < 2) {
        if (at === 0) dispatchTabs({ type: 'close', pane: 0, path: to });
        dispatchTabs({ type: 'split', dir: 'row' });
        dispatchTabs({ type: 'open', path: to, newTab: true });
        dispatchTabs({ type: 'focusPane', pane: 0 });
        restoreEditorFocus(from);
        return;
      }
      const other = cur === 0 ? 1 : 0;
      if (at === cur) dispatchTabs({ type: 'close', pane: cur, path: to });
      dispatchTabs({ type: 'focusPane', pane: other });
      dispatchTabs({ type: 'open', path: to, newTab: true });
      dispatchTabs({ type: 'focusPane', pane: cur });
      restoreEditorFocus(from);
    },
    [tabs, dispatchTabs, restoreEditorFocus],
  );

  const commands = useMemo<PaletteCommand[]>(
    () => [
      { id: 'quick', label: t('palette.quick'), hint: '⌘O', keywords: ['open', '열기', '전환', 'ㅇㄱ'], run: () => openSwitcher('all') },
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
      { id: 'tab-new', label: t('palette.tabNew'), keywords: ['tab', '탭'], run: () => { setSwitcherNewTab(true); openSwitcher('all'); } },
      { id: 'tab-close', label: t('palette.tabClose'), hint: '⌘W', keywords: ['close', 'tab', '탭', '닫기'], enabled: !!selected, run: () => selected && dispatchTabs({ type: 'close', pane: tabs.activePane, path: selected }) },
      ...(writerOn
        ? [
            {
              id: 'previous-episode',
              label: t('palette.previousEpisode'),
              keywords: ['previous', 'episode'],
              enabled: !!previous,
              run: () => selected && previous && openPrevious(selected, previous),
            },
            {
              id: 'merge-export',
              label: t('palette.mergeExport'),
              keywords: ['merge', 'export', 'docx', 'txt'],
              enabled: works.length > 0,
              run: () => setMergeWork(openWorkName ?? works[0]?.name ?? null),
            },
          ]
        : []),
      { id: 'split-right', label: t('palette.splitRight'), keywords: ['split', '분할', '좌우'], run: () => dispatchTabs({ type: 'split', dir: 'row' }) },
      { id: 'split-down', label: t('palette.splitDown'), keywords: ['split', '분할', '상하'], run: () => dispatchTabs({ type: 'split', dir: 'col' }) },
      { id: 'unsplit', label: t('palette.unsplit'), keywords: ['unsplit', 'merge', '분할', '합치기'], enabled: tabs.panes.length > 1, run: () => dispatchTabs({ type: 'unsplit' }) },
      { id: 'new-window', label: t('palette.newWindow'), keywords: ['window', '창', '새 창'], enabled: !!selected, run: () => selected && void window.nops.window.new({ path: selected }) },
      { id: 'theme', label: t('palette.theme'), keywords: ['theme', 'dark', 'light', '다크', '라이트', '테마', '다크모드'], run: cycleTheme },
      { id: 'close', label: t('palette.switchVault'), keywords: ['vault', '볼트', '닫기'], run: onClose },
    ],
    [selected, dockVisible, openDaily, toggleBookmark, renameCurrent, exportNote, exportVault, importNotion, importMarkdown, cycleTheme, deleteEntry, newFolder, quickNote, onClose, openPanel, tabs.activePane, tabs.panes.length, locale, writerOn, previous, openPrevious],
  );

  /** 사이드바 머리줄 `⋯` 메뉴. 같은 동작은 ⌘P 팔레트·단축키로도 닿는다. */
  const moreItems: SidebarMenuItem[] = [
    { id: 'new-folder', label: t('palette.newFolder'), onRun: () => void newFolder('') },
    { id: 'daily', label: t('nav.today'), hint: keys('⌘⌥D'), onRun: () => void openDaily() },
    {
      id: 'graph',
      label: t('nav.graph'),
      hint: keys('⌘⇧G'),
      onRun: () => {
        setDbOpen(null);
        setGraphOpen((o) => !o);
      },
    },
    { id: 'trash', label: t('nav.trash'), separator: true, onRun: () => setTrashOpen(true) },
    { id: 'sync', label: t('palette.sync'), onRun: () => setSyncOpen(true) },
    { id: 'export', label: t('palette.exportVault'), onRun: () => void exportVault() },
    { id: 'vault', label: t('palette.switchVault'), separator: true, onRun: onClose },
  ];

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
    // 작가 모드에서만 회차 행에 글자수 배지(일반 모드는 DOM 에도 없다).
    badgeOf: writerOn
      ? (path: string) => {
          const side = language.writerSpacing === 'exclude' ? 'charsNoSpace' : 'chars';
          const row = works.flatMap((w) => w.episodeRows).find((r) => r.path === path);
          return row ? formatNumber(row[side], locale) : undefined;
        }
      : undefined,
  };

  return (
    <div
      className={`workspace${focusMode ? ' workspace--focus' : ''}`}
      data-font={language.writerFont ?? 'sans'}
      data-testid="workspace"
    >
      <aside className="sidebar">
        <header
          className="sidebar__head drag"
          role="toolbar"
          aria-label={t('nav.toolbar')}
          onKeyDown={(e) => {
            // 툴바 안에서 ←/→ 로 `＋`·`⋯` 사이를 옮긴다(초점이 버튼에 있을 때만).
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            const buttons = [...(e.currentTarget.querySelectorAll<HTMLElement>('button'))];
            const at = buttons.indexOf(document.activeElement as HTMLElement);
            if (at < 0) return;
            e.preventDefault();
            buttons[(at + (e.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length].focus();
          }}
        >
          <strong title={vault.name}>{vault.name}</strong>
          <button className="iconbtn iconbtn--accent" onClick={() => void quickNote('')} title={keys(`${t('nav.newNote')} (⌘N)`)} aria-label={t('nav.newNote')} data-testid="sidebar-new-note">
            <PlusIcon />
          </button>
          <button
            ref={moreRef}
            className="iconbtn"
            onClick={(e) => {
              const box = e.currentTarget.getBoundingClientRect();
              setMoreMenu({ x: box.left, y: box.bottom + 4 });
            }}
            title={t('nav.more')}
            aria-label={t('nav.more')}
            aria-haspopup="menu"
            aria-expanded={moreMenu !== null}
            data-testid="sidebar-more"
          >
            <MoreIcon />
          </button>
        </header>
        <button
          className="sidebar__searchbtn"
          onClick={() => openSwitcher('all')}
          title={keys(`${t('nav.searchButton')} (⌘O · ⌘⇧F)`)}
          aria-label={t('nav.searchButton')}
          aria-keyshortcuts={keys('⌘O ⌘⇧F')}
          data-testid="sidebar-search"
        >
          <SearchIcon size={14} />
          <span className="sidebar__searchlabel">{t(viewportWidth <= 920 ? 'nav.searchButtonShort' : 'nav.searchButton')}</span>
          {viewportWidth > 920 && <kbd>{keys('⌘O')}</kbd>}
        </button>
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
        {writerOn && sideTab === 'files' && (
          <WorkSection
            locale={locale}
            works={works}
            currentPath={selected}
            goalTitles={Object.fromEntries(
              works.map((w) => {
                const goal = workGoals[w.name];
                if (!goal) return [w.name, ''];
                const progress = calcWorkGoal(goal, { episodes: w.episodes, chars: w.chars, charsNoSpace: w.charsNoSpace }, new Date());
                // 저장된 마감일이 깨져 있어도 렌더가 죽지 않게(유효한 날짜일 때만 Intl 서식).
                const day = parseLocalDay(goal.deadline);
                const deadline = day ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(day) : '';
                return [w.name, goalTooltip({ locale, progress, deadline: goal.deadline, dateText: deadline })];
              }),
            )}
            goalLines={Object.fromEntries(
              works.map((w) => {
                const goal = workGoals[w.name];
                if (!goal) return [w.name, ''];
                const progress = calcWorkGoal(
                  goal,
                  { episodes: w.episodes, chars: w.chars, charsNoSpace: w.charsNoSpace },
                  new Date(),
                );
                return [w.name, goalLineText({ locale, episodes: w.episodes, goal: goal.episodes, perDay: progress.perDay, narrow: viewportWidth <= 920 })];
              }),
            )}
            onOpenGoal={(work) => setGoalWork(work)}
            spacing={language.writerSpacing ?? 'include'}
            narrow={viewportWidth <= 920}
            today={workToday}
            dailyGoal={language.writerDailyGoal ?? null}
            onOpenFolder={(path) => {
              // 상위 폴더까지 펼쳐야 트리에 보인다.
              setSideTab('files');
              const parts = path.split('/');
              for (let i = 1; i <= parts.length; i += 1) folderOpen.setOpen(parts.slice(0, i).join('/'), true);
              requestAnimationFrame(() => {
                document.querySelector(`[data-path="${CSS.escape(path)}"]`)?.scrollIntoView({ block: 'nearest' });
              });
            }}
            onCreateWork={() => setWorkDialog(true)}
            onOpenEpisodeDb={(work) => {
              const summary = works.find((w) => w.name === work);
              if (summary) void openEpisodeDb(summary.episodeFolder, work);
            }}
            onMergeExport={(work) => setMergeWork(work)}
            onOpenWorkChange={setOpenWorkName}
            onCreateEpisode={(work) => {
              void showTextPrompt(t('episode.namePrompt'), '').then((name) => {
                if (name === null) return;
                const summary = works.find((w) => w.name === work);
                if (summary) void createEpisode(work, summary.episodeFolder, name);
              });
            }}
            onCreateCharacter={(work) => {
              void showTextPrompt(t('character.namePrompt'), '').then((name) => {
                if (name === null) return;
                const summary = works.find((w) => w.name === work);
                if (summary) void createCharacter(work, summary.characterFolder, name);
              });
            }}
          />
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
          {sideTab === 'marks' ? (
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
          <button className="iconbtn" onClick={() => setTrashOpen(true)} title={t('nav.trash')} aria-label={t('nav.trash')} data-testid="trash-btn">
            <TrashIcon />
          </button>
          <button
            className="iconbtn"
            onClick={cycleTheme}
            title={`${t(THEME_KEY[theme])} — ${t('nav.themeTitle')}`}
            aria-label={t('nav.themeAria', { theme: t(THEME_KEY[theme]) })}
            data-testid="theme-toggle"
          >
            <ThemeIcon />
          </button>
          <button ref={settingsBtnRef} className="iconbtn" onClick={() => setSettingsOpen(true)} title={keys(`${t('nav.settings')} (⌘,)`)} aria-label={t('nav.settings')} data-testid="settings-btn">
            <SettingsIcon />
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
                    {...(writerOn
                      ? { previousEpisode: { available: !!previousOf(p), onOpen: () => { const prev = previousOf(p); if (prev) openPrevious(p, prev); } } }
                      : {})}
                    refocus={refocus?.path === p ? refocus.tick : undefined}
                    onRefocusDone={() => setRefocus((cur) => (cur?.path === p ? null : cur))}
                    episodeNote={episodeOf(p)}
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
                  { icon: '⌕', label: t('welcome.action.find'), hint: '⌘O', run: () => openSwitcher('all') },
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
                  focusMode={focusMode && pane === tabs.activePane}
                  typewriter={language.writerTypewriter !== false}
                  {...(writerOn
                    ? { previousEpisode: { available: !!previousOf(p), onOpen: () => { const prev = previousOf(p); if (prev) openPrevious(p, prev); } } }
                    : {})}
                  refocus={refocus?.path === p ? refocus.tick : undefined}
                  onRefocusDone={() => setRefocus((cur) => (cur?.path === p ? null : cur))}
                  episodeNote={episodeOf(p)}
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
        <QuickSwitcher
          notes={notes}
          initialScope={switcherScope}
          indexing={progress !== null}
          onOpen={(p, newTab) => (newTab || switcherNewTab ? openInNewTab(p) : setSelected(p))}
          onCreate={(n) => void createNote(n)}
          onClose={() => {
            setSwitcher(false);
            setSwitcherNewTab(false);
          }}
        />
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
          onClose={closeSettings}
          onCreateWork={() => setWorkDialog(true)}
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
      {focusMode && (
        <div className={`focuschrome${chromeShown ? ' show' : ''}`} data-testid="focus-chrome">
          <span className="focuschrome__path">{selected ?? ''}</span>
          <span className="focuschrome__fonts" role="group" aria-label={t('writer.focus.font')}>
            {(['sans', 'serif', 'mono'] as const).map((font) => (
              <button
                key={font}
                className={language.writerFont === font ? 'active' : ''}
                data-testid={`focus-font-${font}`}
                aria-pressed={language.writerFont === font}
                onClick={() => void changeWriterSettings({ font }).catch(() => undefined)}
              >
                {t(`writer.focus.font.${font}`)}
              </button>
            ))}
          </span>
          <button className="focuschrome__exit" data-testid="focus-exit" onClick={() => setFocusMode(false)}>
            {t('writer.focus.exit')} (Esc)
          </button>
        </div>
      )}
      {goalWork &&
        (() => {
          const summary = works.find((w) => w.name === goalWork);
          if (!summary) return null;
          return (
            <WorkGoalDialog
              work={goalWork}
              locale={locale}
              goal={workGoals[goalWork] ?? null}
              current={{ episodes: summary.episodes, chars: summary.chars, charsNoSpace: summary.charsNoSpace }}
              today={new Date()}
              todayChars={workToday}
              onClose={() => setGoalWork(null)}
              onSave={(goal) => {
                void window.nops.settings
                  .setWorkGoal({ vaultId: vault.id, work: goalWork, goal })
                  .then((next) => {
                    setWorkGoals(next);
                    setGoalWork(null);
                  })
                  .catch(() => setGoalWork(null));
              }}
              onSetDaily={(perDay) => {
                // 일일 목표만 바꾼다 — 작품 목표는 사용자가 저장을 눌렀을 때만 저장하고, 대화상자는 닫지 않는다.
                void changeWriterSettings({ dailyGoal: perDay }).catch(() => undefined);
              }}
            />
          );
        })()}
      {mergeWork &&
        (() => {
          const work = works.find((w) => w.name === mergeWork);
          if (!work) return null;
          return (
            <MergeExportDialog
              work={work}
              notes={notes}
              locale={locale}
              spacing={language.writerSpacing ?? 'include'}
              onClose={() => setMergeWork(null)}
              onSaved={(saved) => {
                setMergeWork(null);
                setToast({ message: t('merge.saved', { name: saved.slice(saved.lastIndexOf('/') + 1) }) });
              }}
            />
          );
        })()}
      {workDialog && (
        <WorkCreateDialog
          locale={locale}
          onCancel={() => setWorkDialog(false)}
          onSubmit={(name, kind) => {
            setWorkDialog(false);
            void createWork(name, kind);
          }}
        />
      )}
      {moreMenu && (
        <SidebarMenu
          anchor={moreMenu}
          items={moreItems}
          onClose={() => {
            setMoreMenu(null);
            moreRef.current?.focus();
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
