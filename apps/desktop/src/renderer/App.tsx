import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { NoteSummary, SearchHit, SyncStatus, VaultInfo } from '@nopsidian/ipc-contract';
import { createLinkResolver } from '@nopsidian/core/links';
import type { WikiLinkTarget } from '@nopsidian/editor/nops';
import { showTextPrompt } from '@nopsidian/editor/nops';
import type { NopsPeekHost } from '@nopsidian/editor/nops';
import { extractExcerpt, parseNote, replaceBlock } from '@nopsidian/core/markdown';
import { NoteEditor } from './NoteEditor';
import { useAssetStore } from './assets';
import { ConfirmDialog } from './ConfirmDialog';
import { flushAll } from './flush';
import { LinkPanel } from './LinkPanel';
import { HistoryPanel } from './HistoryPanel';
import { Logo } from './Logo';
import { Panes } from './Panes';
import { applyTheme, loadTheme, nextTheme, THEME_ICON, THEME_LABEL, type ThemeChoice } from './theme';
import { initialTabs, parseTabs, selectedOf, tabsReducer } from './tabs';
import { DatabaseScreen } from './db/DatabaseScreen';
import { DbList } from './db/DbList';
import { SyncDialog, syncStateText } from './SyncDialog';
import { GraphScreen, LocalGraph } from './graph/GraphScreen';
import { createLinkHost, linkNameFor } from './link-host';
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

/** 블록 원문 끝의 ` ^id` 를 뗀다 */
function stripBlockId(source: string, id: string): string {
  return source.replace(new RegExp(`[ \\t]*\\^${id}[ \\t]*(\\r?)$`), '$1').replace(/\s+$/, '');
}

function VaultPicker({ onOpen }: { onOpen: (v: VaultInfo) => void }) {
  const [recent, setRecent] = useState<VaultInfo[]>([]);
  const [error, setError] = useState('');
  const [theme, setTheme] = useState<ThemeChoice>(() => loadTheme());
  useEffect(() => {
    void window.nops.vault.listRecent().then(setRecent);
  }, []);

  const run = async (fn: () => Promise<VaultInfo | null>) => {
    try {
      const v = await fn();
      if (v) onOpen(v);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <main className="start">
      <div className="start__drag drag" />
      <button
        className="start__theme"
        title={`테마: ${THEME_LABEL[theme]} (눌러서 바꾸기)`}
        aria-label={`테마 ${THEME_LABEL[theme]}`}
        onClick={() => {
          const next = nextTheme(theme);
          applyTheme(next);
          setTheme(next);
        }}
      >
        {THEME_ICON[theme]}
      </button>
      <div className="start__card">
        <Logo size={88} />
        <h1>Nopsidian</h1>
        <p className="start__tagline">내 컴퓨터의 Markdown 폴더가 곧 노트가 됩니다.</p>
        <button className="primary start__cta" onClick={() => run(() => window.nops.vault.pick())}>
          폴더 열기 / 만들기
        </button>
        <p className="start__hint">기존 Obsidian 볼트나 Markdown 폴더도 그대로 열려요. 파일은 어디로도 옮겨지지 않아요.</p>
        {error && <p className="error">{error}</p>}
        {recent.length > 0 ? (
          <section className="start__recent" aria-label="최근 볼트">
            <h2>최근 볼트</h2>
            <ul className="recent">
              {recent.map((v) => (
                <li key={v.id}>
                  <button onClick={() => run(() => window.nops.vault.open({ id: v.id }))}>
                    <span className="recent__icon" aria-hidden>📁</span>
                    <span className="recent__text">
                      <strong>{v.name}</strong>
                      <span className="muted recent__path" title={v.path}>{v.path}</span>
                    </span>
                    <span className="recent__go" aria-hidden>열기 →</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <ul className="start__features" aria-label="주요 기능">
            <li><strong>블록 편집기</strong><span>슬래시(/)로 제목·표·콜아웃·수식을 바로 넣어요</span></li>
            <li><strong>링크와 그래프</strong><span>[[위키링크]], 백링크, 노트 사이의 연결 그래프</span></li>
            <li><strong>데이터베이스</strong><span>표·보드·캘린더로 보는 속성 있는 노트</span></li>
          </ul>
        )}
      </div>
    </main>
  );
}

interface WelcomeAction {
  icon: string;
  label: string;
  hint: string;
  run: () => void;
}

/** 열린 노트가 없을 때의 첫 화면: 자주 쓰는 동작과 최근 고친 노트 */
function Welcome({ notes, onOpen, actions }: { notes: NoteSummary[]; onOpen: (path: string) => void; actions: WelcomeAction[] }) {
  const recent = [...notes].sort((a, b) => b.mtime - a.mtime).slice(0, 6);
  return (
    <div className="welcome" data-testid="welcome">
      <Logo size={56} />
      <h2>무엇을 할까요?</h2>
      <div className="welcome__actions">
        {actions.map((a) => (
          <button key={a.label} onClick={a.run}>
            <span className="welcome__icon" aria-hidden>{a.icon}</span>
            <span>{a.label}</span>
            {a.hint && <kbd>{a.hint}</kbd>}
          </button>
        ))}
      </div>
      {recent.length > 0 ? (
        <section className="welcome__recent">
          <h3>최근에 고친 노트</h3>
          <ul>
            {recent.map((n) => (
              <li key={n.path}>
                <button onClick={() => onOpen(n.path)}>
                  <span>{n.title}</span>
                  <span className="muted small">{n.path}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="muted">아직 노트가 없어요. “새 노트”로 시작해 보세요.</p>
      )}
    </div>
  );
}

interface Toast {
  message: string;
  /** 있으면 "되돌리기" 버튼을 보여 준다 */
  undo?: () => Promise<void>;
}

interface ConfirmState {
  title: string;
  lines: string[];
  confirmLabel: string;
  onConfirm: () => void;
}

function Workspace({ vault, onClose }: { vault: VaultInfo; onClose: () => void }) {
  const [notes, setNotes] = useState<NoteSummary[]>([]);
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
  const [creating, setCreating] = useState(false);
  const [sideTab, setSideTab] = useState<'files' | 'tags' | 'db' | 'marks'>('files');
  const [bookmarks, setBookmarks] = useState<string[]>([]);
  const [palette, setPalette] = useState(false);
  /** 사이드바 항목 우클릭 메뉴 */
  const [menu, setMenu] = useState<{ path: string; isFolder: boolean; x: number; y: number } | null>(null);
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
  const [dockTab, setDockTab] = useState<'links' | 'graph' | 'history'>('links');
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const assets = useAssetStore();

  const refresh = useCallback(() => void window.nops.note.list().then(setNotes), []);

  useEffect(() => {
    refresh();
    const offChanged = window.nops.on('note.changed', () => refresh());
    const offProgress = window.nops.on('index.progress', (p) => setProgress(p.done >= p.total ? null : p));
    return () => {
      offChanged();
      offProgress();
    };
  }, [refresh]);

  useEffect(() => {
    if (!query.trim()) return setHits(null);
    const t = setTimeout(() => void window.nops.search.query({ q: query, limit: 50 }).then(setHits), 120);
    return () => clearTimeout(t);
  }, [query]);

  const resolver = useMemo(
    () =>
      createLinkResolver(
        notes.map((n, i) => ({ id: i, path: n.path, title: n.title })),
        notes.flatMap((n, i) => n.aliases.map((alias) => ({ pageId: i, alias }))),
      ),
    [notes],
  );

  const openLink = useCallback(
    (link: WikiLinkTarget) => {
      const id = resolver(link.target, selected ?? '');
      const note = id === undefined ? undefined : notes[id];
      if (note) {
        setFocus(link.heading || link.block ? { heading: link.heading, block: link.block } : null);
        setSelected(note.path);
      }
    },
    [resolver, notes, selected],
  );

  const peekHost = useMemo<NopsPeekHost>(
    () => {
      const findNote = (target: string) => {
        const id = resolver(target, selected ?? '');
        return id === undefined ? undefined : notes[id];
      };
      return {
      async peek({ target, heading, block }) {
        const note = findNote(target);
        if (!note) return null;
        const { content } = await window.nops.note.read({ path: note.path });
        return { title: note.title, ...extractExcerpt(content, { heading, block }) };
      },
      // 동기화 블록: `![[노트#^id]]` 를 그 자리에서 고치면 원본 노트의 블록이 바뀐다
      async source({ target, block }) {
        const note = findNote(target);
        if (!note || !block) return null;
        const { content } = await window.nops.note.read({ path: note.path });
        const parsed = parseNote(content);
        const b = parsed.blocks.find((x) => x.blockId === block);
        if (!b) return null;
        return stripBlockId(b.source, block);
      },
      async save({ target, block }, markdown) {
        const note = findNote(target);
        if (!note || !block) return false;
        await flushAll();
        const { content, hash } = await window.nops.note.read({ path: note.path });
        const parsed = parseNote(content);
        const b = parsed.blocks.find((x) => x.blockId === block);
        if (!b) return false;
        // `^id` 가 줄 끝에 붙어 있던 블록이면 새 원문 끝에도 붙이고, 아래 별도 줄이면 그 줄은 그대로 둔다
        const inline = new RegExp(`(?:^|\\s)\\^${block}[ \\t]*\\r?$`).test(b.source);
        const next = markdown.replace(/\s+$/, '');
        const source = inline ? `${next} ^${block}` : next;
        await window.nops.note.save({ path: note.path, content: replaceBlock(parsed, b.index, source), baseHash: hash });
        window.dispatchEvent(new CustomEvent('nops:reload-note', { detail: note.path }));
        return true;
      },
      onChange(cb) {
        return window.nops.on('note.changed', () => cb());
      },
      };
    },
    [resolver, notes, selected],
  );

  // `[[` 자동완성은 항상 최신 노트·첨부 목록을 봐야 하므로 ref로 읽는 안정적인 호스트를 하나만 만든다
  const live = useRef({ notes, selected, assets });
  live.current = { notes, selected, assets };
  const linkHost = useMemo(
    () =>
      createLinkHost({
        notes: () => live.current.notes,
        assets: () => assets.list(),
        currentPath: () => live.current.selected ?? '',
        headings: (path) => window.nops.link.headings({ path }),
        blocks: (path) => window.nops.link.blocks({ path }),
        ensureBlockId: async (path, line) => (await window.nops.link.ensureBlockId({ path, line })).id,
      }),
    [assets],
  );

  const createNote = useCallback(
    async (rawName: string) => {
      const name = rawName.trim().replace(/[\\:*?"<>|]/g, '').replace(/\.md$/i, '');
      setCreating(false);
      if (!name) return;
      const path = `${name}.md`;
      const r = await window.nops.note.save({ path, content: `# ${name.slice(name.lastIndexOf('/') + 1)}\n`, baseHash: null });
      setSelected(r.status === 'copy' && r.copyPath ? r.copyPath : path);
      refresh();
    },
    [refresh],
  );

  const openDaily = useCallback(async () => {
    const r = await window.nops.daily.open({});
    setSelected(r.path);
    refresh();
  }, [refresh]);

  /** 이름 변경/이동(노트 또는 폴더): 미리보기(바뀌는 링크 수) → 확인 → 실행 → 되돌리기 */
  const renameEntry = useCallback(async (from: string, isFolder: boolean, preset?: string) => {
    // 노션처럼 이름만 바꾼다: 입력창에는 이름만 보이고, 폴더는 그대로 유지한다. `폴더/이름` 으로 쓰면 이동도 한다.
    const dir = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : '';
    const currentName = (isFolder ? from : from.replace(/\.md$/i, '')).slice(dir ? dir.length + 1 : 0);
    const answer = preset ?? await showTextPrompt(
      isFolder ? '폴더 이름 (다른 폴더로 옮기려면 상위/이름 형식으로 쓰세요)' : '새 이름 (다른 폴더로 옮기려면 폴더/이름 형식으로 쓰세요)',
      currentName,
    );
    const typed = answer?.trim().replace(/^\/+|\/+$/g, '');
    const to = typed && !typed.includes('/') && dir ? `${dir}/${typed}` : typed;
    if (!to || to === from || `${to}.md` === from) return;
    const target = isFolder || /\.md$/i.test(to) ? to : `${to}.md`;
    await flushAll();
    /** 이동된 경로를 현재 선택·열린 DB 에 반영한다 */
    const remap = (p: string, a: string, b: string) => (p === a ? b : p.startsWith(`${a}/`) ? `${b}${p.slice(a.length)}` : p);
    const remapBookmarks = (a: string, b: string) =>
      setBookmarks((cur) => {
        const next = cur.map((p) => remap(p, a, b));
        if (next.some((p, i) => p !== cur[i])) void window.nops.bookmarks.set(next);
        return next;
      });
    try {
      const plan = await window.nops.note.renamePlan({ from, to: target });
      const apply = async () => {
        const done = await window.nops.note.rename({ from, to: target });
        dispatchTabs({ type: 'remap', from, to: target });
        setDbOpen((cur) => (cur === null ? cur : remap(cur, from, target)));
        remapBookmarks(from, target);
        refresh();
        setToast({
          message: done.totalChanges > 0 ? `이름을 바꾸고 링크 ${done.totalChanges}개를 고쳤어요.` : '이름을 바꿨어요.',
          undo: async () => {
            await flushAll();
            await window.nops.note.undoRename({ undoId: done.undoId });
            dispatchTabs({ type: 'remap', from: target, to: from });
            setDbOpen((cur) => (cur === null ? cur : remap(cur, target, from)));
            remapBookmarks(target, from);
            refresh();
            setToast({ message: '되돌렸어요.' });
          },
        });
      };
      if (plan.totalChanges === 0) return await apply();
      setConfirm({
        title: '이름을 바꾸고 링크를 갱신할까요?',
        lines: [
          `${from} → ${target}`,
          `${plan.edits.length}개 노트의 링크 ${plan.totalChanges}개를 고쳐요.`,
          ...plan.edits.slice(0, 8).map((e) => `· ${e.newPath} (${e.changes})`),
          ...(plan.edits.length > 8 ? [`… 외 ${plan.edits.length - 8}개`] : []),
        ],
        confirmLabel: '바꾸기',
        onConfirm: () => {
          setConfirm(null);
          void apply().catch((e) => setToast({ message: `실패: ${e instanceof Error ? e.message : String(e)}` }));
        },
      });
    } catch (e) {
      setToast({ message: `이름을 바꿀 수 없어요: ${e instanceof Error ? e.message : String(e)}` });
    }
  }, [refresh]);
  const renameCurrent = useCallback(async () => {
    if (selected) await renameEntry(selected, false);
  }, [selected, renameEntry]);

  useEffect(() => {
    void window.nops.sync.status().then(setSync);
    return window.nops.on('sync.changed', (s) => setSync(s as SyncStatus));
  }, []);

  // 단축키: ⌘O 빠른 전환기 · F2 이름 변경 · ⌘⌥D 오늘의 노트
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        setSwitcher(true);
      } else if (mod && e.shiftKey && !e.altKey && e.code === 'KeyG') {
        e.preventDefault();
        { setDbOpen(null); setGraphOpen((o) => !o); }
      } else if (e.key === 'Escape' && (graphOpen || (dbOpen !== null && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)))) {
        setGraphOpen(false);
        setDbOpen(null);
      } else if (e.key === 'F2') {
        e.preventDefault();
        void renameCurrent();
      } else if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        if (selected) dispatchTabs({ type: 'close', pane: tabs.activePane, path: selected });
      } else if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setPalette(true);
      } else if (mod && e.shiftKey && !e.altKey && e.code === 'KeyB') {
        e.preventDefault();
        if (selected) toggleBookmark(selected);
      } else if (mod && e.altKey && e.code === 'KeyD') {
        e.preventDefault();
        void openDaily();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [renameCurrent, openDaily, graphOpen, dbOpen, selected, toggleBookmark, tabs.activePane]);

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

  /** 표·카드의 제목을 직접 고칠 때: 파일 이름을 바꾼다(폴더는 그대로) */
  const renameNoteTitle = useCallback(
    (p: string, title: string) => {
      const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '';
      void renameEntry(p, false, `${dir}${title.replace(/[\\/:*?"<>|]/g, ' ').trim()}`);
    },
    [renameEntry],
  );

  /** 노트·폴더를 휴지통으로: 확인 → 이동 → 열린 탭·북마크 정리 → "되돌리기" 토스트 */
  const deleteEntry = useCallback(
    (target: string, isFolder: boolean) => {
      const name = target.slice(target.lastIndexOf('/') + 1).replace(/\.md$/i, '');
      setConfirm({
        title: isFolder ? `폴더 “${name}” 를 삭제할까요?` : `“${name}” 를 삭제할까요?`,
        lines: [
          isFolder ? '폴더 안의 모든 노트와 첨부가 함께 휴지통(.nopsidian/trash)으로 옮겨져요.' : '휴지통(.nopsidian/trash)으로 옮겨져요. 바로 되돌릴 수 있어요.',
          '이 노트로 가는 [[링크]] 는 그대로 남아 “없는 노트”로 표시돼요.',
        ],
        confirmLabel: '삭제',
        onConfirm: () => {
          setConfirm(null);
          void (async () => {
            try {
              await flushAll();
              const r = await window.nops.note.trash({ path: target });
              dispatchTabs({ type: 'closePath', path: target });
              setBookmarks((cur) => {
                const next = cur.filter((p) => p !== target && !p.startsWith(`${target}/`));
                if (next.length !== cur.length) void window.nops.bookmarks.set(next);
                return next;
              });
              refresh();
              setToast({
                message: `“${name}” 를 휴지통으로 옮겼어요.`,
                undo: async () => {
                  const back = await window.nops.note.restore({ trashId: r.trashId });
                  refresh();
                  if (!r.isFolder) setSelected(back.path);
                  setToast({ message: '되돌렸어요.' });
                },
              });
            } catch (e) {
              setToast({ message: `삭제하지 못했어요: ${e instanceof Error ? e.message : String(e)}` });
            }
          })();
        },
      });
    },
    [refresh, setSelected],
  );

  const exportNote = useCallback(
    async (format: 'html' | 'pdf') => {
      if (!selected) return;
      try {
        await flushAll();
        const r = await window.nops.export.note({ path: selected, format });
        if (r.saved) setToast({ message: `내보냈어요: ${r.saved}` });
      } catch (e) {
        setToast({ message: `내보내기 실패: ${e instanceof Error ? e.message : String(e)}` });
      }
    },
    [selected],
  );
  const exportVault = useCallback(async () => {
    try {
      await flushAll();
      const r = await window.nops.export.vault();
      if (r.dir) setToast({ message: `노트 ${r.notes}개·첨부 ${r.assets}개를 내보냈어요: ${r.dir}` });
    } catch (e) {
      setToast({ message: `내보내기 실패: ${e instanceof Error ? e.message : String(e)}` });
    }
  }, []);

  const importNotion = useCallback(async () => {
    try {
      const r = await window.nops.import.notion();
      if (!r.folder) return;
      refresh();
      setToast({
        message: `Notion에서 노트 ${r.notes}개·데이터베이스 ${r.databases}개·첨부 ${r.assets}개를 "${r.folder}" 폴더로 가져왔어요${r.unresolvedLinks ? ` (연결 못 한 링크 ${r.unresolvedLinks}개)` : ''}.`,
      });
    } catch (e) {
      setToast({ message: `가져오기 실패: ${e instanceof Error ? e.message : String(e)}` });
    }
  }, [refresh]);

  const commands = useMemo<PaletteCommand[]>(
    () => [
      { id: 'quick', label: '노트 열기 (빠른 전환기)', hint: '⌘O', keywords: ['open', '열기', '전환', 'ㅇㄱ'], run: () => setSwitcher(true) },
      { id: 'new', label: '새 노트', keywords: ['new', '새로', '만들기'], run: () => setCreating(true) },
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
      { id: 'import-notion', label: 'Notion 내보내기(ZIP) 가져오기', keywords: ['import', 'notion', '노션', '가져오기'], run: () => void importNotion() },
      { id: 'tab-new', label: '새 탭에서 노트 열기', keywords: ['tab', '탭'], run: () => { setSwitcherNewTab(true); setSwitcher(true); } },
      { id: 'tab-close', label: '현재 탭 닫기', hint: '⌘W', keywords: ['close', 'tab', '탭', '닫기'], enabled: !!selected, run: () => selected && dispatchTabs({ type: 'close', pane: tabs.activePane, path: selected }) },
      { id: 'split-right', label: '오른쪽으로 분할', keywords: ['split', '분할', '좌우'], run: () => dispatchTabs({ type: 'split', dir: 'row' }) },
      { id: 'split-down', label: '아래로 분할', keywords: ['split', '분할', '상하'], run: () => dispatchTabs({ type: 'split', dir: 'col' }) },
      { id: 'unsplit', label: '분할 합치기', keywords: ['unsplit', 'merge', '분할', '합치기'], enabled: tabs.panes.length > 1, run: () => dispatchTabs({ type: 'unsplit' }) },
      { id: 'new-window', label: '새 창에서 열기', keywords: ['window', '창', '새 창'], enabled: !!selected, run: () => selected && void window.nops.window.new({ path: selected }) },
      { id: 'theme', label: '테마 바꾸기 (시스템 → 라이트 → 다크)', keywords: ['theme', 'dark', 'light', '다크', '라이트', '테마', '다크모드'], run: cycleTheme },
      { id: 'close', label: '다른 볼트 열기', keywords: ['vault', '볼트', '닫기'], run: onClose },
    ],
    [selected, openDaily, toggleBookmark, renameCurrent, exportNote, exportVault, importNotion, cycleTheme, deleteEntry, onClose, tabs.activePane, tabs.panes.length],
  );

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.undo ? 10000 : 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const tree = useMemo(() => buildTree(notes), [notes]);
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
          <button className="navitem" onClick={() => setSwitcher(true)} title="빠른 전환기 (⌘O)" aria-label="노트 찾기">
            <span className="navitem__icon" aria-hidden>⌕</span>
            <span className="navitem__label">노트 찾기</span>
            <kbd>⌘O</kbd>
          </button>
          {creating ? (
            <input
              className="search"
              autoFocus
              placeholder="새 노트 이름 (Enter)"
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === 'Enter') void createNote(e.currentTarget.value);
                if (e.key === 'Escape') setCreating(false);
              }}
              onBlur={() => setCreating(false)}
            />
          ) : (
            <button className="navitem" onClick={() => setCreating(true)} aria-label="새 노트">
              <span className="navitem__icon" aria-hidden>＋</span>
              <span className="navitem__label">새 노트</span>
            </button>
          )}
          <button className="navitem" onClick={() => void openDaily()} title="오늘의 노트 (⌘⌥D)" aria-label="오늘">
            <span className="navitem__icon" aria-hidden>☀</span>
            <span className="navitem__label">오늘의 노트</span>
          </button>
          <button className="navitem" onClick={() => { setDbOpen(null); setGraphOpen((o) => !o); }} title="그래프 (⌘⇧G)" aria-label="그래프">
            <span className="navitem__icon" aria-hidden>◎</span>
            <span className="navitem__label">그래프</span>
          </button>
        </nav>
        <input className="search" placeholder="전문 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="sidebar__tabs" role="tablist">
          <button role="tab" aria-selected={sideTab === 'files'} className={sideTab === 'files' ? 'active' : ''} onClick={() => setSideTab('files')}>
            파일
          </button>
          <button role="tab" aria-selected={sideTab === 'marks'} className={sideTab === 'marks' ? 'active' : ''} onClick={() => setSideTab('marks')} title="북마크 (⌘⇧B로 현재 노트 추가·해제)">
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
        <nav className="list">
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
            <TreeView nodes={tree} selected={selected} onSelect={(p, newTab) => (newTab ? openInNewTab(p) : setSelected(p))} onRenameFolder={(f) => void renameEntry(f, true)} onMenu={(p, isFolder, x, y) => setMenu({ path: p, isFolder, x, y })} />
          )}
        </nav>
        <div className="sidebar__foot">
          <button className="syncbar" onClick={() => setSyncOpen(true)} title="Google Drive 동기화" data-testid="sync-bar">
          ☁ {sync?.enabled ? syncStateText(sync) : '동기화 꺼짐'}
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
              />
            )}
          />
        ) : graphOpen ? (
          <GraphScreen
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
            titleOf={(p) => notes.find((n) => n.path === p)?.title ?? p.replace(/\.md$/i, '').split('/').pop()!}
            onPopOut={(p) => {
              dispatchTabs({ type: 'close', pane: tabs.panes.findIndex((x) => x.tabs.includes(p)), path: p });
              void window.nops.window.new({ path: p });
            }}
            empty={
              <Welcome
                notes={notes}
                onOpen={setSelected}
                actions={[
                  { icon: '＋', label: '새 노트', hint: '', run: () => setCreating(true) },
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
                dbHost={dbHost}
                peek={peekHost}
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
                <button role="tab" aria-selected={dockTab === 'graph'} className={dockTab === 'graph' ? 'active' : ''} onClick={() => setDockTab('graph')}>
                  로컬 그래프
                </button>
                <button role="tab" aria-selected={dockTab === 'history'} className={dockTab === 'history' ? 'active' : ''} onClick={() => setDockTab('history')}>
                  기록
                </button>
              </div>
              {dockTab === 'links' ? <LinkPanel path={selected} onOpen={setSelected} /> : dockTab === 'history' ? <HistoryPanel path={selected} onRestored={(message) => setToast({ message })} /> : <LocalGraph path={selected} onOpen={setSelected} />}
            </div>
          )}
        </div>
      )}
      {switcher && (
        <QuickSwitcher notes={notes} onOpen={(p) => (switcherNewTab ? openInNewTab(p) : setSelected(p))} onCreate={(n) => void createNote(n)} onClose={() => { setSwitcher(false); setSwitcherNewTab(false); }} />
      )}
      {palette && <CommandPalette commands={commands} onClose={() => setPalette(false)} />}
      {syncOpen && <SyncDialog status={sync} onClose={() => setSyncOpen(false)} onOpenNote={setSelected} />}
      {menu && (
        <div className="ctxmask" onMouseDown={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }}>
          <div className="ctxmenu" role="menu" style={{ left: Math.min(menu.x, window.innerWidth - 190), top: Math.min(menu.y, window.innerHeight - 140) }} onMouseDown={(e) => e.stopPropagation()}>
            {!menu.isFolder && (
              <button role="menuitem" onClick={() => { const p = menu.path; setMenu(null); openInNewTab(p); }}>새 탭에서 열기</button>
            )}
            <button role="menuitem" onClick={() => { const m = menu; setMenu(null); void renameEntry(m.path, m.isFolder); }}>이름 바꾸기</button>
            {!menu.isFolder && (
              <button role="menuitem" onClick={() => { const p = menu.path; setMenu(null); toggleBookmark(p); }}>{bookmarks.includes(menu.path) ? '북마크 해제' : '북마크'}</button>
            )}
            <button role="menuitem" className="danger" onClick={() => { const m = menu; setMenu(null); deleteEntry(m.path, m.isFolder); }}>삭제</button>
          </div>
        </div>
      )}
      {confirm && <ConfirmDialog {...confirm} onCancel={() => setConfirm(null)} />}
      {toast && (
        <div className="toast" role="status">
          <span>{toast.message}</span>
          {toast.undo && (
            <button
              onClick={() => {
                const undo = toast.undo!;
                setToast(null);
                void undo().catch((e) => setToast({ message: `되돌리지 못했어요: ${e instanceof Error ? e.message : String(e)}` }));
              }}
            >
              되돌리기
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface TreeNode {
  name: string;
  path: string;
  note?: NoteSummary;
  children: TreeNode[];
}

function buildTree(notes: NoteSummary[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', children: [] };
  for (const n of notes) {
    let cur = root;
    const parts = n.path.split('/');
    parts.forEach((part, i) => {
      const p = parts.slice(0, i + 1).join('/');
      let child = cur.children.find((c) => c.path === p);
      if (!child) {
        child = { name: part, path: p, children: [] };
        cur.children.push(child);
      }
      if (i === parts.length - 1) child.note = n;
      cur = child;
    });
  }
  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => Number(!!a.note) - Number(!!b.note) || a.name.localeCompare(b.name, 'ko'));
    nodes.forEach((n) => sort(n.children));
  };
  sort(root.children);
  return root.children;
}

function TreeView({
  nodes,
  selected,
  onSelect,
  onRenameFolder,
  onMenu,
  depth = 0,
}: {
  nodes: TreeNode[];
  selected: string | null;
  onSelect: (p: string, newTab?: boolean) => void;
  onRenameFolder: (folder: string) => void;
  onMenu?: (path: string, isFolder: boolean, x: number, y: number) => void;
  depth?: number;
}) {
  return (
    <ul className="tree">
      {nodes.map((n) => (
        <li key={n.path}>
          {n.note ? (
            <button
              className={n.path === selected ? 'row active' : 'row'}
              style={{ paddingLeft: 8 + depth * 14 }}
              onClick={(e) => onSelect(n.path, e.metaKey || e.ctrlKey)}
              onContextMenu={(e) => {
                e.preventDefault();
                onMenu?.(n.path, false, e.clientX, e.clientY);
              }}
            >
              {n.note.title}
            </button>
          ) : (
            <details open>
              <summary
                style={{ paddingLeft: 8 + depth * 14 }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onMenu?.(n.path, true, e.clientX, e.clientY);
                }}
              >
                <span>{n.name}</span>
                <button
                  className="treerename"
                  title="폴더 이름 변경/이동"
                  aria-label={`${n.name} 폴더 이름 변경`}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onRenameFolder(n.path);
                  }}
                >
                  ✎
                </button>
              </summary>
              <TreeView nodes={n.children} selected={selected} onSelect={onSelect} onRenameFolder={onRenameFolder} onMenu={onMenu} depth={depth + 1} />
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}
