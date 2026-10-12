/** SyncWorker ↔ Main 메시지. 네트워크(Drive·OAuth)는 이 워커만 쓴다. */
export interface SyncWorkerData {
  root: string;
  vaultKey: string;
  vaultName: string;
  clientId: string;
  clientSecret?: string;
  tokens: { accessToken: string; refreshToken: string; expiresAt: number };
}

export interface PlanSummary {
  firstSync: boolean;
  blocked: string | null;
  tracked: number;
  counts: Record<string, number>;
  /** 화면에 보여 줄 작업 목록(최대 300개) */
  ops: { type: string; path: string; to?: string }[];
  truncated: boolean;
}

export interface RunSummary {
  pushed: number;
  pulled: number;
  merged: number;
  deleted: number;
  conflicts: number;
  failed: number;
  /** 충돌 사본·충돌 표식이 남은 노트 */
  conflictPaths: string[];
  /** 앞쪽 몇 건의 실패 사유 */
  errors: { path: string; message: string }[];
}

export type SyncRequest =
  | { id: string; method: 'plan' }
  | { id: string; method: 'run'; params: { force: boolean } }
  | { id: string; method: 'close' };

export type SyncResponse =
  | { type: 'response'; id: string; result: unknown }
  | { type: 'response'; id: string; error: string; kind: 'auth' | 'offline' | 'other' }
  | { type: 'ready' }
  | { type: 'fatal'; error: string }
  /** 갱신된 토큰 — Main 이 safeStorage 로 저장한다 */
  | { type: 'tokens'; tokens: SyncWorkerData['tokens'] };
