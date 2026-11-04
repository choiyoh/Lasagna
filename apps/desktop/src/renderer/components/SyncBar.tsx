import { useEffect, useRef, useState } from 'react';
import { t } from '@nopsidian/i18n';
import type { SyncStatus } from '@nopsidian/ipc-contract';
import { useLocale } from '../useLocale';

const FAILED = new Set<SyncStatus['state']>(['error', 'offline', 'needsAuth', 'blocked']);

export interface SyncBarCopy {
  /** 사이드바에 보이는 짧은 문구 */
  label: string;
  /** hover title. 상태별 다음 행동을 알린다 */
  title: string;
  /** aria-live 로 읽어 줄 문장 */
  announcement: string;
}

/** 상태 → 사이드바 문구. null 이면 버튼 자체를 렌더하지 않는다. */
export function syncBarCopy(status: SyncStatus | null, recent: boolean): SyncBarCopy | null {
  if (!status) return null;
  switch (status.state) {
    case 'syncing':
      return  { label: t('syncbar.syncing'), title: t('syncbar.syncingTitle'), announcement: t('syncbar.syncingAnnounce') };
    case 'error':
      return {
        label: t('syncbar.error'),
        title: t('syncbar.errorTitle'),
        announcement: t('syncbar.errorAnnounce'),
      };
    case 'offline':
      return {
        label: t('syncbar.offline'),
        title: t('syncbar.offlineTitle'),
        announcement: t('syncbar.offlineAnnounce'),
      };
    case 'needsAuth':
      return {
        label: t('syncbar.needsAuth'),
        title: t('syncbar.needsAuthTitle'),
        announcement: t('syncbar.needsAuthAnnounce'),
      };
    case 'blocked':
      return {
        label: t('syncbar.blocked'),
        title: t('syncbar.blockedTitle'),
        announcement: t('syncbar.blockedAnnounce'),
      };
    case 'idle':
      return recent
        ? { label: t('syncbar.done'), title: t('syncbar.doneTitle'), announcement: t('syncbar.doneAnnounce') }
        : null;
    default:
      return null;
  }
}

/** 동기화가 진행 중이거나 방금 끝났거나 실패했을 때만 보이는 상태 버튼. */
export function SyncBar({ status, onOpen }: { status: SyncStatus | null; onOpen: () => void }) {
  const [recent, setRecent] = useState(false);
  useLocale();
  const prev = useRef<SyncStatus['state'] | undefined>(status?.state);

  useEffect(() => {
    const before = prev.current;
    prev.current = status?.state;
    if (before === 'syncing' && status?.state === 'idle') {
      setRecent(true);
      const t = setTimeout(() => setRecent(false), 1500);
      return () => clearTimeout(t);
    }
    if (status?.state !== 'idle') setRecent(false);
  }, [status?.state]);

  const copy = syncBarCopy(status, recent);
  const failed = !!status && FAILED.has(status.state);
  return (
    <>
      <span className="syncbar__live" role="status" aria-live="polite" aria-atomic="true">
        {copy?.announcement ?? ''}
      </span>
      {copy && (
        <div className="syncbar-slot">
          <button className={failed ? 'syncbar syncbar--warn' : 'syncbar'} onClick={onOpen} title={copy.title} data-testid="sync-bar">
            {copy.label}
          </button>
        </div>
      )}
    </>
  );
}
