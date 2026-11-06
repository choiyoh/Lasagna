import { setLocale, t } from '@nopsidian/i18n';
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
import { errorDetails, withRefreshOn401 } from './error-info';
import { FsLocalStore } from './fs-local-store';
import type {
  DiagnosticsSummary,
  PlanSummary,
  RunSummary,
  SyncRequest,
  SyncResponse,
  SyncWorkerData,
} from './protocol';
import { SqliteSyncState } from './sqlite-state';
import { isSyncablePath } from './syncable';
import { syncBusyError } from './errors';

const data = workerData as SyncWorkerData;
if (data.locale) setLocale(data.locale);
const port = parentPort!;
const post = (m: SyncResponse) => port.postMessage(m);

/** 이 워커가 말할 수 있는 호스트(ADR-0001): Google 인증·Drive API 뿐이다. */
const ALLOWED_HOSTS = new Set(['oauth2.googleapis.com', 'accounts.google.com', 'www.googleapis.com']);
const guardedFetch: typeof fetch = (input, init) => {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(raw);
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) {
    return Promise.reject(new Error(t('main.err.hostNotAllowed', { host: url.hostname })));
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

/** 갱신 실패는 요청 오류와 별도로 Main 에 알려 '마지막 갱신 실패'를 남긴다. */
async function accessToken(): Promise<string> {
  try {
    return await tokens.getAccessToken();
  } catch (e) {
    const info = errorDetails(e);
    post({ type: 'tokenError', at: Date.now(), ...info });
    throw e;
  }
}

const drive = new GoogleDriveClient({
  fetch: guardedFetch,
  getAccessToken: accessToken,
  vaultKey: data.vaultKey,
  vaultName: data.vaultName,
});

const deps: SyncDeps = {
  drive,
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

/** 로컬 스캔 + 상태 기록만으로 '이 기기에서 바뀐 파일' 수를 센다. 네트워크를 쓰지 않는다. */
async function diagnose(remote: boolean): Promise<DiagnosticsSummary> {
  const local = await deps.local.scan();
  const entries = await deps.state.entries();
  const localByPath = new Map(local.map((f) => [f.path, f]));
  const entryByPath = new Map(entries.map((e) => [e.path, e]));
  let pendingChanges = 0;
  for (const file of local) {
    const entry = entryByPath.get(file.path);
    if (!entry || entry.hash !== file.hash) pendingChanges += 1;
  }
  for (const entry of entries) {
    if (!localByPath.has(entry.path)) pendingChanges += 1;
  }

  // '지금 확인'만 토큰을 갱신하고 Drive 폴더·계정을 읽는다. 폴더를 만들지 않는다.
  const folder = remote ? await withRefreshOn401(() => drive.inspectVaultFolder(), () => tokens.forceRefresh()) : null;
  const accountEmail = remote ? await withRefreshOn401(() => drive.accountEmail(), () => tokens.forceRefresh()) : null;
  return { checkedAt: Date.now(), pendingChanges, folder, accountEmail, tokenExpiresAt: tokens.current().expiresAt };
}

let busy = false;

port.on('message', async (req: SyncRequest) => {
  try {
    if (req.method === 'close') {
      state.close();
      post({ type: 'response', id: req.id, result: null });
      return process.exit(0);
    }
    if (busy) throw syncBusyError();
    busy = true;
    try {
      if (req.method === 'diagnose') {
        const result = await diagnose(req.params.remote);
        return post({ type: 'response', id: req.id, result });
      }
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
    post({ type: 'response', id: req.id, ...errorDetails(e) });
  }
});

post({ type: 'ready' });
