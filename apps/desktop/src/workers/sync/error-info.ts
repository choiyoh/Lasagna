import { DriveApiError } from '@nopsidian/sync-gdrive';
import type { SyncErrorDetails, SyncErrorKey, SyncErrorKind } from './protocol';

const RATE_LIMIT_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'dailyLimitExceeded']);

/** 워커 안의 예외를 직렬화 가능한 안정적인 분류 키로 바꾼다. */
export function errorDetails(e: unknown): SyncErrorDetails {
  const err = e instanceof Error ? e : new Error(String(e));
  const maybe = err as unknown as { status?: unknown; reason?: unknown; key?: string; code?: string };
  const status = typeof maybe.status === 'number' ? maybe.status : undefined;
  const reason = typeof maybe.reason === 'string' ? maybe.reason : undefined;

  let kind: SyncErrorKind = 'other';
  let key: SyncErrorKey = 'unknown';
  let code = 'UNKNOWN';

  if (err.name === 'DriveAuthError') {
    kind = 'auth';
    key = 'auth';
    code = 'HTTP 401';
  } else if (err.name === 'AuthRevokedError') {
    kind = 'auth';
    key = 'authRevoked';
    code = 'invalid_grant';
  } else if (err.name === 'OAuthError' || err instanceof TypeError) {
    kind = 'offline';
    key = 'network';
    code = 'NETWORK';
  } else if (err instanceof DriveApiError) {
    if (status === 0) {
      kind = 'offline';
      key = 'network';
      code = 'NETWORK';
    } else if (status === 401) {
      kind = 'auth';
      key = 'auth';
      code = 'HTTP 401';
    } else if (status === 403 && reason !== undefined) {
      if (reason === 'accessNotConfigured') {
        key = 'apiDisabled';
        code = 'HTTP 403 · accessNotConfigured';
      } else if (reason === 'storageQuotaExceeded') {
        key = 'quota';
        code = 'HTTP 403 · storageQuotaExceeded';
      } else if (RATE_LIMIT_REASONS.has(reason)) {
        key = 'rateLimit';
        code = 'HTTP 403 · rateLimitExceeded';
      } else {
        key = 'forbidden';
        code = `HTTP 403 · ${reason}`;
      }
    } else if (status === 403) {
      key = 'forbidden';
      code = 'HTTP 403';
    } else if (status === 404) {
      key = 'notFound';
      code = 'HTTP 404';
    } else if (status !== undefined && status >= 500) {
      key = 'server';
      code = `HTTP ${status}`;
    } else if (status === 429) {
      key = 'rateLimit';
      code = 'HTTP 429 · rateLimitExceeded';
    } else if (status !== undefined) {
      code = `HTTP ${status}`;
    }
  } else if (maybe.key === 'busy') {
    // 새 오류는 워커가 key 를 붙인다. 아래 문구 매칭은 그 전에 만든 오류·기록 호환용이다.
    // 워커가 붙인 코드로 판정한다(문구 매칭은 언어에 따라 깨진다).
    key = 'busy';
    code = 'BUSY';
  } else if (maybe.key === 'blocked' || maybe.code === 'BLOCKED') {
    key = 'blocked';
    code = 'BLOCKED';
  }

  return {
    error: err.message,
    kind,
    key,
    code,
    ...(status === undefined ? {} : { status }),
    ...(reason === undefined ? {} : { reason }),
  };
}

/** 401이면 refresh token으로 한 번 갱신하고 같은 읽기를 재시도한다. 갱신 실패는 그대로 올린다. */
export async function withRefreshOn401<T>(run: () => Promise<T>, refresh: () => Promise<unknown>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (!(e instanceof Error) || e.name !== 'DriveAuthError') throw e;
    await refresh();
    return run();
  }
}
