import { parentPort, workerData } from 'node:worker_threads';
import path from 'node:path';
import { merge3 } from '@nopsidian/core';
import {
  GoogleDriveClient,
  TokenProvider,
  buildPlan,
  executePlan,
  type SyncDeps,
  type SyncOp,
  type SyncPlan,
} from '@nopsidian/sync-gdrive';
import { FsLocalStore } from './fs-local-store';
import type { PlanSummary, RunSummary, SyncRequest, SyncResponse, SyncWorkerData } from './protocol';
import { SqliteSyncState } from './sqlite-state';
import { isSyncablePath } from './syncable';

const data = workerData as SyncWorkerData;
const port = parentPort!;
const post = (m: SyncResponse) => port.postMessage(m);

/** 이 워커가 말할 수 있는 호스트(ADR-0001): Google 인증·Drive API 뿐이다. */
const ALLOWED_HOSTS = new Set(['oauth2.googleapis.com', 'accounts.google.com', 'www.googleapis.com']);
const guardedFetch: typeof fetch = (input, init) => {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(raw);
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) {
    return Promise.reject(new Error(`허용되지 않은 주소: ${url.hostname}`));
  }
  return fetch(input, init);
};

const stateDir = path.join(data.root, '.nopsidian', 'sync');
const state = new SqliteSyncState({ dbPath: path.join(stateDir, 'state.sqlite'), baseDir: path.join(stateDir, 'base') });
const hashCache = new Map<string, { mtimeMs: number; size: number; hash: string }>();

const tokens = new TokenProvider({
  clientId: data.clientId,
  clientSecret: data.clientSecret,
  fetch: guardedFetch,
  tokens: data.tokens,
  onTokens: (t) => post({ type: 'tokens', tokens: t }),
});

const deps: SyncDeps = {
  drive: new GoogleDriveClient({
    fetch: guardedFetch,
    getAccessToken: () => tokens.getAccessToken(),
    vaultKey: data.vaultKey,
    vaultName: data.vaultName,
  }),
  local: new FsLocalStore(data.root, { cache: hashCache }),
  state,
  merge: merge3,
  isSyncable: isSyncablePath,
};

const describeOp = (op: SyncOp): { type: string; path: string; to?: string } =>
  'from' in op ? { type: op.type, path: op.from, to: op.to } : { type: op.type, path: op.path };

function summarizePlan(plan: SyncPlan): PlanSummary {
  const counts: Record<string, number> = {};
  for (const op of plan.ops) counts[op.type] = (counts[op.type] ?? 0) + 1;
  return {
    firstSync: plan.firstSync,
    blocked: plan.blocked,
    tracked: plan.tracked,
    counts,
    ops: plan.ops.slice(0, 300).map(describeOp),
    truncated: plan.ops.length > 300,
  };
}

function classify(e: unknown): 'auth' | 'offline' | 'other' {
  if (!(e instanceof Error)) return 'other';
  if (e.name === 'DriveAuthError' || e.name === 'AuthRevokedError') return 'auth';
  if (e.name === 'DriveApiError' && (e as { status?: number }).status === 0) return 'offline';
  if (e.name === 'OAuthError' || e instanceof TypeError) return 'offline';
  return 'other';
}

let busy = false;

port.on('message', async (req: SyncRequest) => {
  try {
    if (req.method === 'close') {
      state.close();
      post({ type: 'response', id: req.id, result: null });
      return process.exit(0);
    }
    if (busy) throw new Error('이미 동기화 중이에요');
    busy = true;
    try {
      const plan = await buildPlan(deps);
      if (req.method === 'plan') return post({ type: 'response', id: req.id, result: summarizePlan(plan) });
      const report = await executePlan(plan, deps, { force: req.params.force });
      const result: RunSummary = {
        pushed: report.pushed,
        pulled: report.pulled,
        merged: report.merged,
        deleted: report.deleted,
        conflicts: report.conflicts,
        failed: report.failed,
        conflictPaths: report.results.filter((r) => r.conflict).map((r) => r.copyPath ?? ('path' in r.op ? r.op.path : '')),
        errors: report.results
          .filter((r) => r.status === 'failed')
          .slice(0, 20)
          .map((r) => ({ path: 'path' in r.op ? r.op.path : r.op.from, message: r.error ?? '' })),
      };
      post({ type: 'response', id: req.id, result });
    } finally {
      busy = false;
    }
  } catch (e) {
    post({ type: 'response', id: req.id, error: e instanceof Error ? e.message : String(e), kind: classify(e) });
  }
});

post({ type: 'ready' });
