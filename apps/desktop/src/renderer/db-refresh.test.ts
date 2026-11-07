import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReload } from './db-refresh';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createReload', () => {
  it('노트·첨부 변경은 디바운스하고, 언어 변경은 즉시 읽는다', () => {
    const run = vi.fn();
    const reload = createReload(500, run);
    reload.schedule();
    reload.schedule(); // 500ms 안에 또 바뀌면 한 번만
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(499);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);

    reload.now();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('언어 변경이 대기 중인 예약을 취소해 같은 갱신을 두 번 하지 않는다', () => {
    const run = vi.fn();
    const reload = createReload(500, run);
    reload.schedule();
    reload.now();
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(run).toHaveBeenCalledTimes(1); // 예약이 취소돼 중복 호출 없음
  });
});
