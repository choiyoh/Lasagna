import { afterEach, describe, expect, it, vi } from 'vitest';
import { RECOVER_DELAYS_MS, WatchRecovery, recoverDelayMs } from './watch-recovery';

afterEach(() => vi.useRealTimers());

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => (resolve = res));
  return { promise, resolve };
}

describe('recoverDelayMs', () => {
  it('연속 실패가 늘수록 5초 → 30초로 물러난다', () => {
    expect(RECOVER_DELAYS_MS).toEqual([0, 5_000, 30_000]);
    expect(recoverDelayMs(0)).toBe(0);
    expect(recoverDelayMs(1)).toBe(5_000);
    expect(recoverDelayMs(2)).toBe(30_000);
    expect(recoverDelayMs(50)).toBe(30_000);
  });
});

describe('WatchRecovery', () => {
  it('첫 오류는 바로 복구하고, 복구 중 온 오류로 두 번 돌지 않는다', () => {
    const d = deferred();
    const run = vi.fn(() => d.promise);
    const onError = vi.fn();
    const r = new WatchRecovery({ run, onError });
    r.fail('첫 오류');
    expect(onError).toHaveBeenLastCalledWith('첫 오류');
    expect(run).toHaveBeenCalledTimes(1);
    r.fail('복구 중 오류');
    expect(onError).toHaveBeenLastCalledWith('복구 중 오류'); // 오류는 그래도 알린다
    expect(run).toHaveBeenCalledTimes(1); // 복구는 한 번에 하나만
  });

  it('복구가 성공하면 실패 횟수를 비워 다음 오류도 바로 복구한다', async () => {
    const d = deferred();
    const run = vi.fn(() => d.promise);
    const r = new WatchRecovery({ run });
    r.fail('첫 오류');
    d.resolve();
    await d.promise;
    r.fail('나중 오류');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('복구가 실패하면 5초, 그다음은 30초 뒤에 다시 시도한다', async () => {
    vi.useFakeTimers();
    const run = vi.fn(() => Promise.reject(new Error('감시 실패')));
    const onError = vi.fn();
    const r = new WatchRecovery({ run, onError });
    r.fail('오류1');
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenLastCalledWith('감시 실패');
    await vi.advanceTimersByTimeAsync(29_999);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(run).toHaveBeenCalledTimes(4); // 그 뒤로도 30초 간격
  });

  it('복구 중 새 오류가 있었으면 성공해도 바로 재시도하지 않는다', async () => {
    vi.useFakeTimers();
    const d = deferred();
    const run = vi.fn(() => d.promise);
    const r = new WatchRecovery({ run });
    r.fail('오류1'); // 즉시 복구 시작
    r.fail('오류2'); // 복구 중 — 실패 횟수만 늘어난다
    d.resolve();
    await d.promise;
    r.fail('오류3'); // 초기화되지 않아 곧바로는 재시도하지 않는다
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('stop() 은 예약된 복구를 취소하고 다시 시도하지 않는다', async () => {
    vi.useFakeTimers();
    const run = vi.fn(() => Promise.reject(new Error('감시 실패')));
    const onError = vi.fn();
    const r = new WatchRecovery({ run, onError });
    r.fail('오류1');
    await vi.advanceTimersByTimeAsync(0); // 실패 처리 → 5초 예약
    expect(run).toHaveBeenCalledTimes(1);
    r.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(1);
    const calls = onError.mock.calls.length;
    r.fail('닫은 뒤 오류');
    expect(onError).toHaveBeenCalledTimes(calls); // 닫은 뒤에는 알리지도 않는다
    expect(run).toHaveBeenCalledTimes(1);
  });
});
