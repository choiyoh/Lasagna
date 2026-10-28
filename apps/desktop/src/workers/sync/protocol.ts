import type { VaultFolderInfo } from '@nopsidian/sync-gdrive/types';

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

/** '지금 확인'이 워커에서 돌려주는 값. 폴더는 remote=false 이면 null. */
export interface DiagnosticsSummary {
  checkedAt: number;
  pendingChanges: number;
  folder: VaultFolderInfo | null;
  /** Drive about.user 에서 읽은 값(읽기 전용). 권한/응답에 따라 null. */
  accountEmail: string | null;
  tokenExpiresAt: number;
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

export type SyncErrorKind = 'auth' | 'offline' | 'other';

/** 워커 경계를 넘어도 유지되는 안정적인 분류 키. Main 은 name 대신 이 값을 쓴다. */
export type SyncErrorKey =
  | 'auth'
  | 'authRevoked'
  | 'apiDisabled'
  | 'quota'
  | 'rateLimit'
  | 'network'
  | 'server'
  | 'notFound'
  | 'forbidden'
  | 'busy'
  | 'blocked'
  | 'unknown';

export interface SyncErrorDetails {
  error: string;
  kind: SyncErrorKind;
  key: SyncErrorKey;
  /** 화면에 접어 보여 줄 기술 코드 */
  code: string;
  status?: number;
  reason?: string;
}

export type SyncRequest =
  | { id: string; method: 'plan' }
  | { id: string; method: 'run'; params: { force: boolean } }
  | { id: string; method: 'diagnose'; params: { remote: boolean } }
  | { id: string; method: 'close' };

export type SyncResponse =
  | { type: 'response'; id: string; result: unknown }
  | ({ type: 'response'; id: string } & SyncErrorDetails)
  | { type: 'ready' }
  | { type: 'fatal'; error: string }
  /** 갱신된 토큰 — Main 이 safeStorage 로 저장한다 */
  | { type: 'tokens'; tokens: SyncWorkerData['tokens'] }
  /** 토큰 갱신 실패 — 마지막 갱신 실패를 진단 화면에 남긴다 */
  | ({ type: 'tokenError'; at: number } & SyncErrorDetails);
