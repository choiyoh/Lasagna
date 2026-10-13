import { parentPort, workerData } from 'node:worker_threads';
import { subscribe, type AsyncSubscription } from '@parcel/watcher';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { Indexer } from './indexer';
import type { WorkerRequest, WorkerResponse, WorkerEvent } from './protocol';

const port = parentPort!;
const root = (workerData as { root: string }).root;
const ix = new Indexer(root);
// macOS의 /var → /private/var 같은 심볼릭 링크 때문에 감시 이벤트 경로는 realpath 기준으로 온다.
const watchRoot = realpathSync(root);

const post = (m: WorkerResponse | WorkerEvent) => port.postMessage(m);

const pending = new Map<string, 'add' | 'change' | 'unlink'>();
const pendingAssets = new Map<string, 'add' | 'change' | 'unlink'>();
let timer: NodeJS.Timeout | undefined;

/** 300ms 디바운스로 모아서 처리한다. 같은 파일의 이벤트는 마지막 것만 남긴다. */
function flush() {
  timer = undefined;
  const assetBatch = [...pendingAssets];
  pendingAssets.clear();
  for (const [rel, kind] of assetBatch) {
    const exists = ix.syncAssetFile(rel);
    post({ type: 'event', name: 'asset.changed', payload: { path: rel, kind: exists ? (kind === 'unlink' ? 'change' : kind) : 'unlink' } });
  }
  const batch = [...pending];
  pending.clear();
  const results = batch.map(([rel, kind]) => {
    const ok = kind === 'unlink' ? (ix.removeFile(rel), false) : ix.indexFile(rel);
    return { rel, kind: ok ? kind : ('unlink' as const), hash: ok ? ix.hashOf(rel) : undefined };
  });
  ix.resolveLinks();
  for (const r of results) {
    post({
      type: 'event',
      name: 'note.changed',
      payload: { path: r.rel, kind: r.kind, ...(r.hash ? { hash: r.hash } : {}) },
    });
  }
}

let sub: AsyncSubscription | undefined;
async function startWatching() {
  sub = await subscribe(
    watchRoot,
    (err, events) => {
      if (err) return;
      for (const e of events) {
        const rel = path.relative(watchRoot, e.path).split(path.sep).join('/');
        if (rel.split('/').some((seg) => seg.startsWith('.'))) continue;
        const kind = e.type === 'delete' ? 'unlink' : e.type === 'create' ? 'add' : 'change';
        if (rel.toLowerCase().endsWith('.md')) pending.set(rel, kind);
        else if (!rel.includes('.nops-tmp-')) pendingAssets.set(rel, kind);
      }
      timer ??= setTimeout(flush, 300);
    },
    { ignore: ['**/.nopsidian/**', '**/.git/**', '**/node_modules/**'] },
  );
}

port.on('message', (req: WorkerRequest) => {
  try {
    switch (req.method) {
      case 'list':
        return post({ type: 'response', id: req.id, result: ix.list() });
      case 'query': {
        const { name, args } = req.params;
        const allowed = ['backlinkContexts', 'outgoingLinks', 'unlinkedMentions', 'notesByTag', 'tags', 'headingsOf', 'blocksOf', 'globalGraph', 'localGraph', 'databases', 'queryDatabase', 'rowDatabase', 'databaseRowPaths', 'databaseFolders'];
        if (!allowed.includes(name)) throw new Error(`허용되지 않은 질의: ${name}`);
        const fn = (ix as unknown as Record<string, (...a: unknown[]) => unknown>)[name]!;
        return post({ type: 'response', id: req.id, result: fn.apply(ix, args) });
      }
      case 'assets':
        return post({ type: 'response', id: req.id, result: ix.listAssets() });
      case 'search':
        return post({ type: 'response', id: req.id, result: ix.search(req.params.q, req.params.limit) });
      case 'close':
        void sub?.unsubscribe();
        ix.close();
        post({ type: 'response', id: req.id, result: null });
        return process.exit(0);
    }
  } catch (e) {
    post({ type: 'response', id: req.id, error: e instanceof Error ? e.message : String(e) });
  }
});

// 시작 시 증분 스캔 → 감시 시작. 진행률은 이벤트로 알린다.
try {
  let last = 0;
  ix.scan((done, total) => {
    const now = Date.now();
    if (done === total || now - last > 100) {
      last = now;
      post({ type: 'event', name: 'index.progress', payload: { done, total } });
    }
  });
  post({ type: 'ready' });
  void startWatching();
} catch (e) {
  post({ type: 'fatal', error: e instanceof Error ? e.message : String(e) });
}
