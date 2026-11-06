import { t } from '@nopsidian/i18n';
import { parentPort, workerData } from 'node:worker_threads';
import { subscribe, type AsyncSubscription } from '@parcel/watcher';
import { realpathSync } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import { Indexer } from './indexer';
import { WatchRecovery } from './watch-recovery';
import { closeWatcherThen, watchSettleMs } from './close-watcher';
import { classifyWatchEvents, type PendingKind, type WatchEvent } from './watch-events';
import type { WorkerRequest, WorkerResponse, WorkerEvent } from './protocol';

const port = parentPort!;
const root = (workerData as { root: string }).root;
const ix = new Indexer(root);
// macOS의 /var → /private/var 같은 심볼릭 링크 때문에 감시 이벤트 경로는 realpath 기준으로 온다.
const watchRoot = realpathSync(root);

const post = (m: WorkerResponse | WorkerEvent) => port.postMessage(m);

const pending = new Map<string, PendingKind>();
const pendingAssets = new Map<string, PendingKind>();
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
/** 마지막 감시 이벤트를 받은 시각. 닫을 때 디바운스 스레드가 잠잠해질 시간을 계산한다 */
let lastWatchEventAt = 0;
/** 감시 이벤트 묶음을 받은 순서대로 처리하는 사슬 */
let eventChain: Promise<void> = Promise.resolve();
/** 증분 재스캔을 한 줄로 세우는 사슬(시작 직후 스캔과 복구 스캔이 겹치지 않게) */
let scanChain: Promise<void> = Promise.resolve();

/** 증분 재스캔: 감시가 놓친 사이의 변화(바뀐 것·지워진 것)를 화면에 알린다. */
function rescan(): Promise<void> {
  const next = scanChain.then(async () => {
    const late = await ix.scanParallel();
    for (const rel of late.changedPaths.slice(0, 500)) post({ type: 'event', name: 'note.changed', payload: { path: rel, kind: 'change' } });
    for (const rel of late.removedPaths.slice(0, 500)) post({ type: 'event', name: 'note.changed', payload: { path: rel, kind: 'unlink' } });
  });
  scanChain = next.catch(() => undefined); // 실패해도 다음 스캔은 이어서 돈다
  return next;
}

/** 오류를 알리고 복구(재구독 + 증분 스캔)를 예약한다. 복구는 하나만, 실패가 이어지면 물러나서. */
const recovery = new WatchRecovery({
  onError: (message) => post({ type: 'event', name: 'index.watchError', payload: { message } }),
  run: async () => {
    await sub?.unsubscribe().catch(() => undefined);
    sub = undefined;
    await startWatching();
    await rescan();
  },
});

/** 감시를 새로 건다. 구독 자체가 실패하면 복구 스케줄러가 물러나며 다시 시도한다. */
async function startWatching() {
  sub = await subscribe(
    watchRoot,
    (err, events) => {
      lastWatchEventAt = Date.now();
      if (err) {
        recovery.fail(err.message);
        return;
      }
      // 분류가 실패해도 워커를 죽이지 않는다 — 복구(재구독 + 스캔)로 따라잡는다
      // 폴더 확인(stat)이 비동기라 묶음끼리 순서가 뒤바뀌지 않게 한 줄로 세운다(create 뒤 delete 가 먼저 반영되면 지운 노트가 되살아난다)
      eventChain = eventChain
        .then(() => collectEvents(events))
        .catch((e) => recovery.fail(e instanceof Error ? e.message : String(e)));
    },
    { ignore: ['**/.nopsidian/**', '**/.git/**', '**/node_modules/**'] },
  );
}

/** 감시 이벤트를 pending 큐에 모은다. 새로 만든 폴더는 이벤트가 안 오므로 안을 훑어서 채운다. */
async function collectEvents(events: WatchEvent[]) {
  // 폴더인지 보는 데만 쓰므로 심볼릭 링크를 따라가지 않는 lstat 을 넘긴다
  const batch = await classifyWatchEvents(events, watchRoot, { stat: lstat, readdir });
  for (const [rel, kind] of batch.notes) pending.set(rel, kind);
  for (const [rel, kind] of batch.assets) pendingAssets.set(rel, kind);
  timer ??= setTimeout(flush, 300);
}

port.on('message', async (req: WorkerRequest) => {
  try {
    switch (req.method) {
      case 'list':
        return post({ type: 'response', id: req.id, result: ix.list() });
      case 'query': {
        const { name, args } = req.params;
        const allowed = ['backlinkContexts', 'outgoingLinks', 'unlinkedMentions', 'notesByTag', 'tags', 'headingsOf', 'blocksOf', 'globalGraph', 'localGraph', 'databases', 'queryDatabase', 'rowDatabase', 'databaseRowPaths', 'databaseFolders'];
        if (!allowed.includes(name)) throw new Error(t('main.err.queryNotAllowed', { name }));
        const fn = (ix as unknown as Record<string, (...a: unknown[]) => unknown>)[name]!;
        return post({ type: 'response', id: req.id, result: fn.apply(ix, args) });
      }
      case 'assets':
        return post({ type: 'response', id: req.id, result: ix.listAssets() });
      case 'search':
        return post({ type: 'response', id: req.id, result: ix.search(req.params.q, req.params.limit) });
      case 'close':
        recovery.stop();
        await closeWatcherThen(
          sub,
          () => {
            sub = undefined;
            ix.close();
            post({ type: 'response', id: req.id, result: null });
          },
          () => process.exit(0),
          { settleMs: watchSettleMs(lastWatchEventAt, Date.now()) },
        );
        return;
    }
  } catch (e) {
    post({ type: 'response', id: req.id, error: e instanceof Error ? e.message : String(e) });
  }
});

// 시작 시 증분 스캔(파일이 많으면 파싱을 여러 스레드에 나눈다) → 감시 시작 → 한 번 더 증분 스캔.
// 첫 스캔이 끝나고 감시가 시작되기 전에 생긴 변화는 감시가 못 보므로, 감시를 건 뒤 한 번 더 훑어 놓친 것을 잡는다.
let lastProgress = 0;
ix.scanParallel((done, total) => {
  const now = Date.now();
  if (done === total || now - lastProgress > 100) {
    lastProgress = now;
    post({ type: 'event', name: 'index.progress', payload: { done, total } });
  }
})
  .then(async () => {
    post({ type: 'ready' });
    try {
      await startWatching();
    } catch (e) {
      // 감시를 못 걸어도 색인 자체는 살아 있어야 한다 — 복구 스케줄러가 물러나며 다시 시도한다
      recovery.fail(e instanceof Error ? e.message : String(e));
    }
    await rescan();
  })
  .catch((e) => post({ type: 'fatal', error: e instanceof Error ? e.message : String(e) }));
