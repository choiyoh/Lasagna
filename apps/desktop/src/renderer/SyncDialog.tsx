import { useCallback, useEffect, useState } from 'react';
import type { SyncDiagnostics, SyncStatus } from '@nopsidian/ipc-contract';
import { formatDateTime, formatRelativeTime, t, tPlural, type MessageKey } from '@nopsidian/i18n';
import { useLocale } from './useLocale';
import { formatSyncDiagnostics } from './sync-diagnostics';
import { blockedPlanText, resultErrorText } from './sync-blocked';
import { userMessage } from './user-message';

type Plan = Awaited<ReturnType<typeof window.nops.sync.plan>>;
type Run = Awaited<ReturnType<typeof window.nops.sync.run>>;

const STATE_KEY: Record<SyncStatus['state'], MessageKey> = {
  off: 'sync.state.off',
  idle: 'sync.state.idle',
  syncing: 'sync.state.syncing',
  offline: 'sync.state.offline',
  error: 'sync.state.error',
  needsAuth: 'sync.state.needsAuth',
  blocked: 'sync.state.blocked',
};

const OP_KEY: Record<string, MessageKey> = {
  push: 'sync.op.push',
  pull: 'sync.op.pull',
  merge: 'sync.op.merge',
  trashLocal: 'sync.op.trashLocal',
  trashRemote: 'sync.op.trashRemote',
  moveLocal: 'sync.op.moveLocal',
  moveRemote: 'sync.op.moveRemote',
  record: 'sync.op.record',
  forget: 'sync.op.forget',
};

const opLabel = (type: string): string => (OP_KEY[type] ? t(OP_KEY[type]!) : type);

export const syncStateText = (s: SyncStatus | null): string => (s ? t(STATE_KEY[s.state]) : '');

const ago = (value: number | null) => (value ? formatRelativeTime(value) : t('sync.never'));

const at = (value: number | null) => (value === null ? t('common.none') : formatDateTime(value));

interface Props {
  status: SyncStatus | null;
  onClose: () => void;
  onOpenNote: (path: string) => void;
}

/** Google Drive 동기화 설정·실행 대화상자. 첫 동기화는 계획을 먼저 보여 주고 확인을 받는다. */
export function SyncDialog({ status, onClose, onOpenNote }: Props) {
  useLocale();
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [result, setResult] = useState<Run | null>(null);
  const [diag, setDiag] = useState<SyncDiagnostics | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (busy !== null || status?.state === 'syncing') return;
    let live = true;
    setDiagLoading(true);
    void window.nops.sync
      .diagnostics()
      .then((d) => live && setDiag(d))
      .catch(() => undefined)
      .finally(() => {
        if (live) setDiagLoading(false);
      });
    return () => {
      live = false;
    };
  }, [busy, status?.configured, status?.connected, status?.state]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const act = useCallback(async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(userMessage(e));
    } finally {
      setBusy(null);
    }
  }, []);

  const copyDiagnostics = useCallback(async () => {
    if (!status || !diag) return;
    try {
      await navigator.clipboard.writeText(formatSyncDiagnostics(status, diag));
      setCopied(t('sync.copied'));
    } catch {
      setCopied(t('sync.copyFailed'));
    }
    setTimeout(() => setCopied(null), 2500);
  }, [status, diag]);

  const s = status;
  const isBuiltin = s?.clientSource === 'builtin';
  const builtinAvailable = s?.builtinClientAvailable === true;
  const clientForm = (
    <>
      <input placeholder={t('sync.clientIdPlaceholder')} value={clientId} onChange={(e) => setClientId(e.target.value)} aria-label={t('sync.clientId')} />
      <input placeholder={t('sync.clientSecretPlaceholder')} value={secret} onChange={(e) => setSecret(e.target.value)} aria-label={t('sync.clientSecret')} type="password" />
      <div className="dialog__actions left">
        <button disabled={!clientId.trim() || !!busy} onClick={() => void act('client', () => window.nops.sync.setClient({ clientId: clientId.trim(), clientSecret: secret.trim() || undefined }).then(() => { setClientId(''); setSecret(''); }))}>
          {t('common.save')}
        </button>
        {builtinAvailable && s?.clientSource === 'custom' && (
          <button disabled={!!busy} onClick={() => void act('builtin', () => window.nops.sync.useBuiltin())}>
            {t('sync.useBuiltin')}
          </button>
        )}
      </div>
    </>
  );
  const connectAction = () =>
    act('connect', async () => {
      const next = await window.nops.sync.connect();
      if (!next.confirmedFirst) {
        setResult(null);
        setPlan(await window.nops.sync.plan());
      }
    });
  const tokenText = !s?.connected
    ? t('common.none')
    : diag === null
      ? t('sync.tokenChecking')
      : diag.tokenValid
        ? t('sync.tokenValid', { date: at(diag.tokenExpiresAt) })
        : t('sync.tokenExpired');
  const folder = diag?.folder;
  const folderText =
    folder === undefined || folder.checkedAt === null
      ? t('sync.folderUnknown')
      : folder.exists
        ? `${t('sync.folderExists')}${folder.id === null ? '' : t('sync.folderId', { id: folder.id })}`
        : t('sync.folderMissing');
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog syncdialog" role="dialog" aria-modal="true" aria-label={t('sync.title')}>
        <h2>{t('sync.title')}</h2>
        <p className="muted small">
          {t('sync.intro1')} <code>drive.file</code> {t('sync.intro2')}
        </p>

        {isBuiltin ? (
          <section>
            <h3>{t('sync.accountHeading', { n: 1 })}</h3>
            <p className="small">{t('sync.builtinHint')}</p>
            {s?.connected ? (
              <>
                <p className="small">{t('sync.accountConnected')}</p>
                <button disabled={!!busy} onClick={() => void act('disconnect', () => window.nops.sync.disconnect())}>{t('sync.disconnect')}</button>
              </>
            ) : (
              <button disabled={!s?.configured || !!busy} onClick={() => void connectAction()}>
                {busy === 'connect' ? t('sync.waitingLogin') : t('sync.loginGoogle')}
              </button>
            )}
            <details className="syncdialog__advanced">
              <summary className="muted small">{t('sync.advanced')}</summary>
              <p className="muted small">{t('sync.advancedHint')}</p>
              {clientForm}
            </details>
          </section>
        ) : (
          <>
            <section>
              <h3>{t('sync.clientHeading', { n: 1 })}</h3>
              {s?.clientSource === 'custom' ? (
                <p className="small">{t('sync.customSaved')}</p>
              ) : (
                <p className="muted small">{t('sync.noBuiltin')}</p>
              )}
              {clientForm}
            </section>

            <section>
              <h3>{t('sync.accountStep', { n: 2 })}</h3>
              {s?.connected ? (
                <>
                  <p className="small">{t('sync.accountConnected')}</p>
                  <button disabled={!!busy} onClick={() => void act('disconnect', () => window.nops.sync.disconnect())}>{t('sync.disconnect')}</button>
                </>
              ) : (
                <button disabled={!s?.configured || !!busy} onClick={() => void connectAction()}>
                  {busy === 'connect' ? t('sync.waitingLogin') : t('sync.loginAccount')}
                </button>
              )}
            </section>
          </>
        )}

        <section>
          <h3>{t('sync.vaultStep', { n: isBuiltin ? 2 : 3 })}</h3>
          <label className="small">
            <input type="checkbox" checked={!!s?.enabled} disabled={!s?.connected || !!busy} onChange={(e) => void act('enable', () => window.nops.sync.enable({ enabled: e.target.checked }))} /> {t('sync.enableVault')}
          </label>
          <p className="small" data-testid="sync-state">
            {syncStateText(s)}
            {s?.enabled && <> · {t('sync.last', { time: ago(s.lastSync) })}</>}
          </p>
          {s?.message && <p className="small warn">{s.message}</p>}
          <div className="dialog__actions left">
            <button disabled={!s?.enabled || !s.connected || !!busy || diagLoading} onClick={() => void act('plan', async () => { setResult(null); setPlan(await window.nops.sync.plan()); })}>
              {s?.confirmedFirst ? t('sync.syncNow') : t('sync.firstPreview')}
            </button>
          </div>
        </section>

        <section data-testid="sync-diagnostics">
          <h3>{t('sync.diagStep', { n: isBuiltin ? 3 : 4 })}</h3>
          <p className="small">
            {t('sync.clientLabel')}:{' '}
            {s?.clientSource === 'builtin' ? t('sync.clientBuiltin') : s?.clientSource === 'custom' ? t('sync.clientCustom') : t('sync.notRegistered')}
            {diag?.clientIdSuffix ? ` (…${diag.clientIdSuffix})` : ''}
            {' · '}{t('sync.secretLabel')}:{' '}
            {diag?.hasClientSecret ? t('sync.registered') : t('sync.notRegistered')}
          </p>
          <p className="small" data-testid="sync-account">
            {t('sync.accountLabel')}:{' '}
            {diag?.accountEmail ??
              (s?.connected
                ? diag?.folder.checkedAt
                  ? t('sync.emailUnreadable')
                  : t('sync.accountUnverified')
                : t('sync.accountDisconnected'))}
          </p>
          <p className="small" data-testid="sync-token">
            {t('sync.token')}: {tokenText}
          </p>
          {diag?.lastRefreshFailure && (
            <div className="syncdialog__failure" data-testid="sync-refresh-failure">
              <strong className="small">{t('sync.refreshFailed', { title: diag.lastRefreshFailure.title })}</strong>
              <p className="small">{diag.lastRefreshFailure.action}</p>
              <a href={diag.lastRefreshFailure.docs} target="_blank" rel="noreferrer">
                {t('sync.guideLink')}
              </a>
              <details>
                <summary className="muted small">{t('sync.errorCode', { code: diag.lastRefreshFailure.code })}</summary>
                <p className="muted small">{at(diag.lastRefreshFailure.at)}</p>
              </details>
            </div>
          )}
          <p className="small">
            {t('sync.lastSuccess', { time: s?.lastSync ? at(s.lastSync) : t('sync.notYet') })}
            {' · '}{t('sync.lastAttempt', { time: s?.lastAttempt ? at(s.lastAttempt) : t('sync.notYet') })}
          </p>
          <p className="small" data-testid="sync-pending">
            {t('sync.changedFiles', {
              value: diag?.pendingChanges === null || diag === null ? t('sync.beforeCheck') : tPlural('count.files', diag.pendingChanges),
            })}
            {' · '}
            {s && s.conflicts.length > 0 ? (
              <button
                className="link"
                data-testid="sync-conflicts-count"
                onClick={() => document.querySelector('[data-testid="sync-conflicts"]')?.scrollIntoView({ block: 'nearest' })}
              >
                {t('sync.conflictsLabel', { count: s.conflicts.length })}
              </button>
            ) : (
              <>{t('sync.conflictsZero')}</>
            )}
          </p>
          <p className="small" data-testid="sync-folder">
            {t('sync.folderLabel')}: {folder?.path ?? 'Nopsidian/…'} · {folderText}
            {folder?.checkedAt ? t('sync.folderCheckedAt', { time: at(folder.checkedAt) }) : ''}
          </p>
          {diag?.lastFailure && (
            <div className="syncdialog__failure" data-testid="sync-last-failure">
              <strong className="small">{diag.lastFailure.title}</strong>
              <p className="small">{diag.lastFailure.action}</p>
              <a href={diag.lastFailure.docs} target="_blank" rel="noreferrer">
                {t('sync.guideLink')}
              </a>
              <details>
                <summary className="muted small">{t('sync.errorCode', { code: diag.lastFailure.code })}</summary>
                <p className="muted small">{at(diag.lastFailure.at)}</p>
              </details>
            </div>
          )}
          <div className="dialog__actions left">
            <button
              data-testid="sync-check"
              disabled={!s?.connected || !!busy || diagLoading || s?.state === 'syncing'}
              onClick={() =>
                void act('check', async () => {
                  setCopied(null);
                  setDiag(await window.nops.sync.check());
                })
              }
            >
              {busy === 'check' || diagLoading ? t('sync.checking') : t('sync.check')}
            </button>
            <button data-testid="sync-copy-diagnostics" disabled={!diag} onClick={() => void copyDiagnostics()}>
              {t('sync.copyDiagnostics')}
            </button>
            {copied && <span className="muted small">{copied}</span>}
          </div>
          <p className="muted small">{t('sync.checkHint')}</p>
          <p className="muted small">{t('sync.copyHint')}</p>
        </section>

        {plan && (
          <section data-testid="sync-plan">
            <h3>{plan.firstSync ? t('sync.firstPlan') : t('sync.plan')}</h3>
            <p className="small">{Object.entries(plan.counts).map(([k, n]) => `${opLabel(k)} ${n}`).join(' · ') || t('sync.noChanges')}</p>
            {plan.blocked && <p className="small warn">{blockedPlanText(plan)}</p>}
            <ul className="syncdialog__ops">
              {plan.ops.slice(0, 60).map((o, i) => (
                <li key={i}>
                  <span className="muted">{opLabel(o.type)}</span> {o.path}
                  {o.to ? ` → ${o.to}` : ''}
                </li>
              ))}
              {plan.ops.length > 60 && <li className="muted">{t('entry.moreCount', { count: plan.ops.length - 60 })}</li>}
            </ul>
            <div className="dialog__actions">
              <button onClick={() => setPlan(null)}>{t('common.close')}</button>
              <button
                className="primary"
                disabled={!!busy || !s?.enabled}
                onClick={() => void act('run', async () => { const force = !!plan.blocked; setResult(await window.nops.sync.run({ force })); setPlan(null); })}
              >
                {plan.blocked ? t('sync.forceRun') : t('sync.run')}
              </button>
            </div>
            {s && !s.enabled && <p className="muted small">{t('sync.enableFirst')}</p>}
          </section>
        )}

        {result && (
          <section data-testid="sync-result">
            <p className="small">
              {t('sync.resultSummary', { pushed: result.pushed, pulled: result.pulled, merged: result.merged, deleted: result.deleted })}
              {result.failed > 0 && <span className="warn">{t('sync.resultFailed', { n: result.failed })}</span>}
            </p>
            {result.errors.map((e, i) => (
              <p key={i} className="small warn">
                {e.path}: {resultErrorText(e)}
              </p>
            ))}
          </section>
        )}

        {s && s.conflicts.length > 0 && (
          <section data-testid="sync-conflicts">
            <h3>{t('sync.conflictsHeading', { count: s.conflicts.length })}</h3>
            <p className="muted small">{t('sync.conflictsHint')}</p>
            <ul className="syncdialog__ops">
              {s.conflicts.map((p) => (
                <li key={p}><button className="link" onClick={() => { onOpenNote(p); onClose(); }}>{p}</button></li>
              ))}
            </ul>
          </section>
        )}

        {error && <p className="small warn" role="alert">{error}</p>}
        <div className="dialog__actions">
          <button onClick={onClose}>{t('common.close')}</button>
        </div>
      </div>
    </div>
  );
}
