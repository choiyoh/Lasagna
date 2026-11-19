import { describe, expect, it, vi } from 'vitest';
import { WATCH_QUIET_MS, closeWatcherAfterStart, closeWatcherThen, settleWatchStart, startWatchOrRelease, watchSettleMs } from './close-watcher';

describe('closeWatcherThen', () => {
  it('unsubscribe 가 끝난 뒤에만 정리하고 종료한다', async () => {
    let release!: () => void;
    const sub = { unsubscribe: () => new Promise<void>((resolve) => (release = resolve)) };
    const order: string[] = [];
    const done = closeWatcherThen(
      sub,
      () => order.push('cleanup'),
      () => order.push('exit'),
    );
    await Promise.resolve();
    expect(order).toEqual([]);

    release();
    await done;
    expect(order).toEqual(['cleanup', 'exit']);
  });

  it('unsubscribe 가 거부돼도 정리와 종료는 이어서 한다', async () => {
    const order: string[] = [];
    await closeWatcherThen(
      { unsubscribe: () => Promise.reject(new Error('native watcher')) },
      () => order.push('cleanup'),
      () => order.push('exit'),
    );
    expect(order).toEqual(['cleanup', 'exit']);
  });

  it('구독이 없으면 바로 정리하고 종료한다', async () => {
    const cleanup = vi.fn();
    const exit = vi.fn();
    await closeWatcherThen(undefined, cleanup, exit);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledOnce();
  });

  it('settleMs 만큼 기다린 뒤에 정리하고 종료한다', async () => {
    const order: string[] = [];
    const done = closeWatcherThen(
      { unsubscribe: () => Promise.resolve() },
      () => order.push('cleanup'),
      () => order.push('exit'),
      { settleMs: 20 },
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(order).toEqual([]);
    await done;
    expect(order).toEqual(['cleanup', 'exit']);
  });
});

describe('진행 중인 구독(subscribe)과 종료', () => {
  it('구독이 끝나기 전에는 정리·종료하지 않고, 끝난 뒤 unsubscribe 까지 마치고 종료한다', async () => {
    const order: string[] = [];
    let release!: (sub: { unsubscribe: () => Promise<void> }) => void;
    let lateSub: { unsubscribe: () => Promise<void> } | undefined;
    const watchStart = new Promise<unknown>((resolve) => {
      release = (s) => {
        lateSub = s;
        resolve(s);
      };
    });
    const done = closeWatcherAfterStart(
      watchStart,
      () => lateSub,
      () => order.push('cleanup'),
      () => order.push('exit'),
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(order).toEqual([]); // 구독이 아직 안 끝났으므로 아무것도 하지 않는다

    release({
      unsubscribe: async () => {
        order.push('unsubscribe');
      },
    });
    await done;
    expect(order).toEqual(['unsubscribe', 'cleanup', 'exit']);
  });

  it('구독이 실패해도 정리·종료는 이어서 한다', async () => {
    const order: string[] = [];
    await closeWatcherAfterStart(
      Promise.reject(new Error('subscribe failed')),
      () => undefined,
      () => order.push('cleanup'),
      () => order.push('exit'),
    );
    expect(order).toEqual(['cleanup', 'exit']);
  });

  it('진행 중 구독이 없으면 바로 정리·종료한다', async () => {
    const exit = vi.fn();
    await closeWatcherAfterStart(undefined, () => undefined, () => undefined, exit);
    expect(exit).toHaveBeenCalledOnce();
  });

  it('settleWatchStart 는 실패한 구독도 조용히 넘긴다', async () => {
    await expect(settleWatchStart(Promise.reject(new Error('nope')))).resolves.toBeUndefined();
    await expect(settleWatchStart(undefined)).resolves.toBeUndefined();
  });
});

describe('닫는 중에 끝난 구독', () => {
  it('closing 이면 그 자리에서 unsubscribe 하고, 그 완료까지 close 가 기다린 뒤 종료한다', async () => {
    const order: string[] = [];
    let closing = false;
    let releaseUnsub!: () => void;
    const sub = {
      unsubscribe: () => {
        order.push('unsub-start');
        return new Promise<void>((resolve) => (releaseUnsub = resolve)).then(() => {
          order.push('unsub-done');
        });
      },
    };
    let setSubCalled = false;
    // 구독이 해석되는 순간 이미 닫는 중인 상태
    closing = true;
    const start = startWatchOrRelease(Promise.resolve(sub), () => (setSubCalled = true), () => closing);
    const close = closeWatcherAfterStart(
      start,
      () => undefined, // worker 는 sub 를 설정하지 않았다(해제는 start 안에서 끝났다)
      () => order.push('cleanup'),
      () => order.push('exit'),
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(order).toEqual(['unsub-start']); // unsubscribe 완료 전에는 정리·종료하지 않는다
    releaseUnsub();
    await close;
    expect(order).toEqual(['unsub-start', 'unsub-done', 'cleanup', 'exit']);
    expect(setSubCalled).toBe(false);
  });

  it('닫는 중이 아니면 구독을 그대로 넘기고 해제하지 않는다', async () => {
    const sub = { unsubscribe: vi.fn() };
    let assigned: typeof sub | undefined;
    await startWatchOrRelease(Promise.resolve(sub), (started) => (assigned = started), () => false);
    expect(assigned).toBe(sub);
    expect(sub.unsubscribe).not.toHaveBeenCalled();
  });
});

describe('watchSettleMs', () => {
  it('이벤트가 없었으면 기다리지 않는다', () => {
    expect(watchSettleMs(0, 1000)).toBe(0);
  });

  it('마지막 이벤트에서 조용해질 때까지만 기다린다', () => {
    expect(watchSettleMs(1000, 1000)).toBe(WATCH_QUIET_MS);
    expect(watchSettleMs(1000, 1500)).toBe(WATCH_QUIET_MS - 500);
    expect(watchSettleMs(1000, 1000 + WATCH_QUIET_MS)).toBe(0);
    expect(watchSettleMs(1000, 999_999)).toBe(0);
  });
});
