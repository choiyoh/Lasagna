import { useEffect, useRef, useState } from 'react';
import type { SyncStatus } from '@nopsidian/ipc-contract';

const FAILED = new Set<SyncStatus['state']>(['error', 'offline', 'needsAuth', 'blocked']);

/** 사이드바 하단에 표시할 문구. null 이면 버튼 자체를 렌더하지 않는다. */
export function syncBarLabel(status: SyncStatus | null, recent: boolean): string | null {
  if (!status) return null;
  if (status.state === 'syncing') return '동기화 중…';
  if (FAILED.has(status.state)) return '동기화 실패';
  if (status.state === 'idle' && recent) return '방금 동기화됨';
  return null;
}

/** 동기화가 진행 중이거나 방금 끝났거나 실패했을 때만 보이는 상태 버튼. */
export function SyncBar({ status, onOpen }: { status: SyncStatus | null; onOpen: () => void }) {
  const [recent, setRecent] = useState(false);
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

  const label = syncBarLabel(status, recent);
  if (!label) return null;
  const failed = !!status && FAILED.has(status.state);
  return (
    <button
      className={failed ? 'syncbar syncbar--warn' : 'syncbar'}
      onClick={onOpen}
      title="Google Drive 동기화"
      data-testid="sync-bar"
    >
      {label}
    </button>
  );
}
