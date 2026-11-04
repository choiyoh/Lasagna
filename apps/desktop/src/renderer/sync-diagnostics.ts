import type { SyncDiagnostics, SyncStatus } from '@nopsidian/ipc-contract';
import { t, tPlural } from '@nopsidian/i18n';

const iso = (value: number | null): string => (value === null ? t('diag.none') : new Date(value).toISOString());

const yes = (value: boolean): string => (value ? t('diag.yes') : t('diag.no'));

/**
 * 진단 정보 복사용 텍스트. 비밀 값·토큰·이메일·폴더 ID/경로·노트 이름/경로는 절대 넣지 않는다.
 * 경로는 개수만, 폴더는 있음/없음/확인 못 함만 넣는다. 문구는 호출 시점 언어로 만든다.
 */
export function formatSyncDiagnostics(status: SyncStatus, d: SyncDiagnostics): string {
  const source =
    status.clientSource === 'builtin'
      ? t('diag.sourceBuiltin')
      : status.clientSource === 'custom'
        ? t('diag.sourceCustom')
        : t('diag.none');
  const failure = (value: { title: string; code: string; at: number }): string =>
    t('diag.failureValue', { title: value.title, code: value.code, at: iso(value.at) });
  const lines = [
    t('diag.title'),
    t('diag.created', { time: new Date().toISOString() }),
    '',
    t('diag.state', { state: status.state }),
    t('diag.enabled', { value: yes(status.enabled) }),
    t('diag.confirmedFirst', { value: yes(status.confirmedFirst) }),
    t('diag.lastSuccess', { value: iso(status.lastSync) }),
    t('diag.lastAttempt', { value: iso(status.lastAttempt) }),
    t('diag.pending', {
      value: d.pendingChanges === null ? t('diag.beforeCheck') : tPlural('count.files', d.pendingChanges),
    }),
    t('diag.conflicts', { count: status.conflicts.length }),
    '',
    t('diag.client', {
      value: d.clientIdSuffix === null ? t('diag.none') : t('diag.clientValue', { source, suffix: d.clientIdSuffix }),
    }),
    t('diag.clientSecret', { value: d.hasClientSecret ? t('diag.registered') : t('diag.notRegistered') }),
    t('diag.account', { value: status.connected ? t('diag.accountConnected') : t('diag.accountDisconnected') }),
    t('diag.tokenExpiry', {
      value: iso(d.tokenExpiresAt),
      state: d.tokenValid ? t('diag.valid') : t('diag.expired'),
    }),
    t('diag.refreshFailure', { value: d.lastRefreshFailure === null ? t('diag.none') : failure(d.lastRefreshFailure) }),
    '',
    t('diag.folder', {
      value: d.folder.checkedAt === null ? t('diag.folderUnknown') : d.folder.exists ? t('diag.folderExists') : t('diag.folderMissing'),
    }),
    t('diag.lastFailure', { value: d.lastFailure === null ? t('diag.none') : failure(d.lastFailure) }),
    '',
    t('diag.footer'),
  ];
  return `${lines.join('\n')}\n`;
}
