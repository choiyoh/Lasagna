import type { AsyncSubscription } from '@parcel/watcher';

/** @parcel/watcher 의 Debounce 스레드가 마지막 이벤트 뒤 잠잠해지기까지 걸리는 시간(최대 500ms + 여유) */
export const WATCH_QUIET_MS = 700;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface CloseWatcherOptions {
  /**
   * unsubscribe 뒤 추가로 기다릴 시간(ms).
   * Debounce 스레드가 깨어 있는 동안 워커 isolate 가 watcher.node 를 unload 하면
   * 해제된 코드를 실행해 SIGSEGV 로 죽는다. 조용해질 시간을 준다.
   */
  settleMs?: number;
}

/**
 * 감시 구독을 먼저 정리한 뒤 워커를 끝낸다.
 * @parcel/watcher 의 unsubscribe 는 네이티브 async 작업이라, 완료 전에 process.exit 하면
 * 워커 환경이 정리된 뒤 콜백이 돌아와 napi_fatal_error(SIGABRT)가 난다.
 */
export async function closeWatcherThen(
  sub: Pick<AsyncSubscription, 'unsubscribe'> | undefined,
  cleanup: () => void,
  exit: () => void,
  opts: CloseWatcherOptions = {},
): Promise<void> {
  await sub?.unsubscribe().catch(() => undefined);
  if (opts.settleMs && opts.settleMs > 0) await sleep(opts.settleMs);
  cleanup();
  exit();
}

/** 마지막 감시 이벤트 시각을 기준으로 남은 조용한 시간. 이벤트가 없었으면 0. */
export function watchSettleMs(lastEventAt: number, now: number): number {
  if (!lastEventAt) return 0;
  return Math.max(0, Math.min(WATCH_QUIET_MS, WATCH_QUIET_MS - (now - lastEventAt)));
}
