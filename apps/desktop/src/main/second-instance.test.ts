import { describe, expect, it, vi } from 'vitest';
import { revealExistingWindow, type RestorableWindow } from './second-instance';

const fake = (minimized: boolean) => {
  const calls: string[] = [];
  const win: RestorableWindow = {
    isMinimized: () => minimized,
    restore: vi.fn(() => calls.push('restore')),
    show: vi.fn(() => calls.push('show')),
    focus: vi.fn(() => calls.push('focus')),
  };
  return { win, calls };
};

describe('두 번째 실행 창 복원', () => {
  it('최소화된 창은 복원하고 보여 주며 포커스를 준다', () => {
    const { win, calls } = fake(true);
    expect(revealExistingWindow(win, { background: false })).toBe(true);
    expect(calls).toEqual(['restore', 'show', 'focus']);
  });

  it('최소화되지 않은 창은 복원 없이 보여 주고 포커스를 준다', () => {
    const { win, calls } = fake(false);
    revealExistingWindow(win, { background: false });
    expect(calls).toEqual(['show', 'focus']);
  });

  it('e2e 백그라운드 모드에서는 창을 드러내지 않는다', () => {
    const { win, calls } = fake(true);
    expect(revealExistingWindow(win, { background: true })).toBe(false);
    expect(calls).toEqual([]);
  });

  it('창이 없으면 아무 것도 하지 않는다', () => {
    expect(revealExistingWindow(null, { background: false })).toBe(false);
  });
});
