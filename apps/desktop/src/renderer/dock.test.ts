// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { DOCK_BREAKPOINT, dockAvailable, loadDockMode, nextDockMode, resolveDockOpen, saveDockMode } from './dock';

beforeEach(() => localStorage.clear());

describe('resolveDockOpen', () => {
  it('auto 는 1,340px 이하에서 접고 그보다 넓으면 편다', () => {
    expect(resolveDockOpen('auto', 1440)).toBe(true);
    expect(resolveDockOpen('auto', 920)).toBe(false);
  });

  it('경계값 1,339 / 1,340 / 1,341 — 열어도 본문 668px이 유지되는 폭', () => {
    expect(DOCK_BREAKPOINT).toBe(1340);
    expect(resolveDockOpen('auto', 1339)).toBe(false);
    expect(resolveDockOpen('auto', 1340)).toBe(false);
    expect(resolveDockOpen('auto', 1341)).toBe(true);
  });

  it('사용자가 고른 값은 창 폭이 바뀌어도 그대로다', () => {
    for (const w of [640, 1200, 1340, 1341, 1440]) {
      expect(resolveDockOpen('closed', w)).toBe(false);
      expect(resolveDockOpen('open', w)).toBe(true);
    }
  });

  it('사용자가 직접 연 경우 좁은 창에서도 유지한다', () => {
    expect(resolveDockOpen('open', 920)).toBe(true);
    expect(resolveDockOpen('closed', 1440)).toBe(false);
  });
});

describe('dockAvailable', () => {
  it('노트를 볼 때만 도크가 있다', () => {
    expect(dockAvailable({ hasNote: true, dbOpen: false, graphOpen: false })).toBe(true);
    expect(dockAvailable({ hasNote: false, dbOpen: false, graphOpen: false })).toBe(false);
    expect(dockAvailable({ hasNote: true, dbOpen: true, graphOpen: false })).toBe(false);
    expect(dockAvailable({ hasNote: true, dbOpen: false, graphOpen: true })).toBe(false);
  });
});

describe('dock mode 저장', () => {
  it('처음에는 auto 이고, 고른 값을 기억한다', () => {
    expect(loadDockMode()).toBe('auto');
    saveDockMode('closed');
    expect(loadDockMode()).toBe('closed');
    saveDockMode('open');
    expect(loadDockMode()).toBe('open');
  });

  it('깨진 값은 auto 로 본다', () => {
    localStorage.setItem('nops.dock', 'nope');
    expect(loadDockMode()).toBe('auto');
  });

  it('토글은 지금 상태의 반대 값을 고른 것으로 남긴다', () => {
    expect(nextDockMode(true)).toBe('closed');
    expect(nextDockMode(false)).toBe('open');
  });
});
