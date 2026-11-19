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

/**
 * 구독을 시작하고, 구독이 끝난 시점에 이미 닫는 중이면 **그 자리에서 해제까지 마친다**.
 * 돌려주는 약속은 닫는 중이었을 때 unsubscribe 완료 뒤에 resolve 하므로,
 * close 가 이 약속을 기다리면 "해제가 끝나기 전에 exit" 하는 창이 없다.
 */
export async function startWatchOrRelease<T extends Pick<AsyncSubscription, 'unsubscribe'>>(
  pending: Promise<T>,
  setSub: (sub: T) => void,
  isClosing: () => boolean,
): Promise<void> {
  const started = await pending;
  if (isClosing()) {
    await started.unsubscribe().catch(() => undefined);
    return;
  }
  setSub(started);
}

/**
 * 진행 중인 구독(subscribe)이 끝날 때까지 기다린다(성공·실패 모두).
 * 구독 완료 전에 워커를 끝내면 네이티브 콜백이 죽은 환경에서 돌아 napi_fatal_error(SIGABRT)로 프로세스가 죽는다.
 */
export async function settleWatchStart(watchStart: Promise<unknown> | undefined): Promise<void> {
  await watchStart?.catch(() => undefined);
}

/** 구독 시작을 기다린 **뒤** 감시를 정리하고 끝낸다(닫는 도중 구독이 시작되는 창을 없앤다). */
export async function closeWatcherAfterStart(
  watchStart: Promise<unknown> | undefined,
  current: () => Pick<AsyncSubscription, 'unsubscribe'> | undefined,
  cleanup: () => void,
  exit: () => void,
  opts: CloseWatcherOptions = {},
): Promise<void> {
  await settleWatchStart(watchStart);
  await closeWatcherThen(current(), cleanup, exit, opts);
}

/** 마지막 감시 이벤트 시각을 기준으로 남은 조용한 시간. 이벤트가 없었으면 0. */
export function watchSettleMs(lastEventAt: number, now: number): number {
  if (!lastEventAt) return 0;
  return Math.max(0, Math.min(WATCH_QUIET_MS, WATCH_QUIET_MS - (now - lastEventAt)));
}
