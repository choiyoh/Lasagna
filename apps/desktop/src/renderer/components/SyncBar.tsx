import { useEffect, useRef, useState } from 'react';
import type { SyncStatus } from '@nopsidian/ipc-contract';

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
      return { label: '동기화 중…', title: 'Google Drive 동기화 중', announcement: '동기화 중입니다.' };
    case 'error':
      return {
        label: '동기화 오류',
        title: '일부 파일을 동기화하지 못했어요. 눌러서 확인하세요.',
        announcement: '일부 파일을 동기화하지 못했습니다.',
      };
    case 'offline':
      return {
        label: '오프라인',
        title: '오프라인 — 연결되면 자동으로 다시 시도해요.',
        announcement: '오프라인입니다. 연결되면 자동으로 다시 시도합니다.',
      };
    case 'needsAuth':
      return {
        label: '재연결 필요',
        title: 'Google 계정을 다시 연결해 주세요.',
        announcement: 'Google 계정을 다시 연결해야 합니다.',
      };
    case 'blocked':
      return {
        label: '동기화 멈춤',
        title: '삭제가 많아 동기화를 멈췄어요. 눌러서 확인하세요.',
        announcement: '삭제가 많아 동기화를 멈췄습니다. 확인이 필요합니다.',
      };
    case 'idle':
      return recent
        ? { label: '방금 동기화됨', title: 'Google Drive 동기화 완료', announcement: '동기화가 완료되었습니다.' }
        : null;
    default:
      return null;
  }
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
