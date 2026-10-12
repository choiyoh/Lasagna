import { useCallback, useEffect, useMemo, useState } from 'react';
import type { NoteSummary, SearchHit, VaultInfo } from '@nopsidian/ipc-contract';
import { createLinkResolver } from '@nopsidian/core/links';
import type { WikiLinkTarget } from '@nopsidian/editor/nops';
import { NoteEditor } from './NoteEditor';
import { useAssetStore } from './assets';

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

function Workspace({ vault, onClose }: { vault: VaultInfo; onClose: () => void }) {
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const assets = useAssetStore();

  const refresh = useCallback(() => void window.nops.note.list().then(setNotes), []);

  useEffect(() => {
    refresh();
    const offChanged = window.nops.on('note.changed', () => refresh());
    const offProgress = window.nops.on('index.progress', (p) =>
      setProgress(p.done >= p.total ? null : p),
    );
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
      if (note) setSelected(note.path);
    },
    [resolver, notes, selected],
  );

  const createNote = async (rawName: string) => {
    const name = rawName.trim().replace(/[\\/:*?"<>|]/g, '').replace(/\.md$/i, '');
    setCreating(false);
    if (!name) return;
    const path = `${name}.md`;
    const r = await window.nops.note.save({ path, content: `# ${name}\n`, baseHash: null });
    setSelected(r.status === 'copy' && r.copyPath ? r.copyPath : path);
    refresh();
  };

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
        {creating ? (
          <input
            className="search"
            autoFocus
            placeholder="새 노트 이름 (Enter)"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void createNote(e.currentTarget.value);
              if (e.key === 'Escape') setCreating(false);
            }}
            onBlur={() => setCreating(false)}
          />
        ) : (
          <button className="new-note" onClick={() => setCreating(true)}>
            + 새 노트
          </button>
        )}
        <input
          className="search"
          placeholder="전문 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
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
          ) : (
            <TreeView nodes={tree} selected={selected} onSelect={setSelected} />
          )}
        </nav>
      </aside>
      <main className="content">
        {selected ? (
          <NoteEditor key={selected} path={selected} vaultId={vault.id} assets={assets} onOpenLink={openLink} />
        ) : (
          <p className="muted pad">왼쪽에서 노트를 선택하세요. ({notes.length}개)</p>
        )}
      </main>
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
