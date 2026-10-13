import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NoteSummary, SearchHit, SyncStatus, VaultInfo } from '@nopsidian/ipc-contract';
import { createLinkResolver } from '@nopsidian/core/links';
import type { WikiLinkTarget } from '@nopsidian/editor/nops';
import { showTextPrompt } from '@nopsidian/editor/nops';
import { NoteEditor } from './NoteEditor';
import { useAssetStore } from './assets';
import { ConfirmDialog } from './ConfirmDialog';
import { flushAll } from './flush';
import { LinkPanel } from './LinkPanel';
import { DatabaseScreen } from './db/DatabaseScreen';
import { DbList } from './db/DbList';
import { SyncDialog, syncStateText } from './SyncDialog';
import { GraphScreen, LocalGraph } from './graph/GraphScreen';
import { createLinkHost, linkNameFor } from './link-host';
import { QuickSwitcher } from './QuickSwitcher';
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

function VaultPicker({ onOpen }: { onOpen: (v: VaultInfo) => void }) {
  const [recent, setRecent] = useState<VaultInfo[]>([]);
  const [error, setError] = useState('');
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
    <main className="picker">
      <h1>Nopsidian</h1>
      <p className="muted">Markdown 폴더를 볼트로 엽니다. 폴더가 없으면 새로 만들 수 있어요.</p>
      <button className="primary" onClick={() => run(() => window.nops.vault.pick())}>
        폴더 열기 / 만들기
      </button>
      {recent.length > 0 && (
        <>
          <h2>최근 볼트</h2>
          <ul className="recent">
            {recent.map((v) => (
              <li key={v.id}>
                <button onClick={() => run(() => window.nops.vault.open({ id: v.id }))}>
                  <strong>{v.name}</strong>
                  <span className="muted">{v.path}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </main>
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
  const [selected, setSelected] = useState<string | null>(null);
  /** 링크로 열 때 이동할 제목/블록 */
  const [focus, setFocus] = useState<{ heading: string | null; block: string | null } | null>(null);
  const [creating, setCreating] = useState(false);
  const [sideTab, setSideTab] = useState<'files' | 'tags' | 'db'>('files');
  const [panelOpen, setPanelOpen] = useState(true);
  const [switcher, setSwitcher] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);
  const [dbOpen, setDbOpen] = useState<string | null>(null);
  const [syncOpen, setSyncOpen] = useState(false);
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [dockTab, setDockTab] = useState<'links' | 'graph'>('links');
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

  /** 이름 변경/이동: 미리보기(바뀌는 링크 수) → 확인 → 실행 → 되돌리기 */
  const renameCurrent = useCallback(async () => {
    if (!selected) return;
    const from = selected;
    const answer = await showTextPrompt('새 이름 (폴더/이름 형식으로 쓰면 이동도 해요)', from.replace(/\.md$/i, ''));
    const to = answer?.trim().replace(/^\/+|\/+$/g, '');
    if (!to || `${to}.md` === from || to === from) return;
    const target = /\.md$/i.test(to) ? to : `${to}.md`;
    await flushAll();
    try {
      const plan = await window.nops.note.renamePlan({ from, to: target });
      const apply = async () => {
        const done = await window.nops.note.rename({ from, to: target });
        setSelected(done.moves[0]?.to ?? target);
        refresh();
        setToast({
          message: done.totalChanges > 0 ? `이름을 바꾸고 링크 ${done.totalChanges}개를 고쳤어요.` : '이름을 바꿨어요.',
          undo: async () => {
            await flushAll();
            await window.nops.note.undoRename({ undoId: done.undoId });
            setSelected(from);
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
  }, [selected, refresh]);

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
      } else if (mod && e.altKey && e.code === 'KeyD') {
        e.preventDefault();
        void openDaily();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [renameCurrent, openDaily, graphOpen, dbOpen]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.undo ? 10000 : 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const tree = useMemo(() => buildTree(notes), [notes]);

  return (
    <div className="workspace">
      <aside className="sidebar">
        <header className="drag">
          <strong>{vault.name}</strong>
          <button className="link" onClick={onClose} title="다른 볼트 열기">
            ⇄
          </button>
        </header>
        <div className="sidebar__actions">
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
            <>
              <button className="new-note" onClick={() => setCreating(true)}>
                + 새 노트
              </button>
              <button className="new-note" onClick={() => void openDaily()} title="오늘의 노트 (⌘⌥D)">
                오늘
              </button>
              <button className="new-note" onClick={() => { setDbOpen(null); setGraphOpen((o) => !o); }} title="그래프 (⌘⇧G)">
                그래프
              </button>
              <button className="new-note" onClick={() => setSwitcher(true)} title="빠른 전환기 (⌘O)">
                ⌘O
              </button>
            </>
          )}
        </div>
        <input className="search" placeholder="전문 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="sidebar__tabs" role="tablist">
          <button role="tab" aria-selected={sideTab === 'files'} className={sideTab === 'files' ? 'active' : ''} onClick={() => setSideTab('files')}>
            파일
          </button>
          <button role="tab" aria-selected={sideTab === 'db'} className={sideTab === 'db' ? 'active' : ''} onClick={() => setSideTab('db')}>
            DB
          </button>
          <button role="tab" aria-selected={sideTab === 'tags'} className={sideTab === 'tags' ? 'active' : ''} onClick={() => setSideTab('tags')}>
            태그
          </button>
        </div>
        <button className="syncbar" onClick={() => setSyncOpen(true)} title="Google Drive 동기화" data-testid="sync-bar">
          ☁ {sync?.enabled ? syncStateText(sync) : '동기화 꺼짐'}
        </button>
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
          ) : sideTab === 'tags' ? (
            <TagPanel onOpen={setSelected} />
          ) : sideTab === 'db' ? (
            <DbList onOpen={(f) => { setGraphOpen(false); setDbOpen(f); }} />
          ) : (
            <TreeView nodes={tree} selected={selected} onSelect={setSelected} />
          )}
        </nav>
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
        ) : selected ? (
          <NoteEditor
            key={selected}
            path={selected}
            vaultId={vault.id}
            assets={assets}
            links={linkHost}
            focus={focus}
            noteLinkName={linkNameFor(selected, notes.map((n) => n.path))}
            onOpenLink={openLink}
            onRename={() => void renameCurrent()}
          />
        ) : (
          <p className="muted pad">왼쪽에서 노트를 선택하세요. ({notes.length}개) · ⌘O로 빠르게 찾을 수 있어요.</p>
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
              </div>
              {dockTab === 'links' ? <LinkPanel path={selected} onOpen={setSelected} /> : <LocalGraph path={selected} onOpen={setSelected} />}
            </div>
          )}
        </div>
      )}
      {switcher && (
        <QuickSwitcher notes={notes} onOpen={setSelected} onCreate={(n) => void createNote(n)} onClose={() => setSwitcher(false)} />
      )}
      {syncOpen && <SyncDialog status={sync} onClose={() => setSyncOpen(false)} onOpenNote={setSelected} />}
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
  depth = 0,
}: {
  nodes: TreeNode[];
  selected: string | null;
  onSelect: (p: string) => void;
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
              onClick={() => onSelect(n.path)}
            >
              {n.note.title}
            </button>
          ) : (
            <details open>
              <summary style={{ paddingLeft: 8 + depth * 14 }}>{n.name}</summary>
              <TreeView nodes={n.children} selected={selected} onSelect={onSelect} depth={depth + 1} />
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}
