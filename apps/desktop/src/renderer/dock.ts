/**
 * 오른쪽 링크 도크를 언제 펼칠지 정한다.
 *
 * 창이 좁을 때 도크가 300px 를 계속 붙잡으면 본문이 248px 까지 눌린다(920px 창).
 * 그래서 1,340px 이하에서는 기본으로 접고, 사용자가 직접 연 경우만 그 선택을 기억한다.
 * (1,340은 도크를 열어도 본문 668px이 유지되는 마지막 폭이다)
 * 도크는 노트를 보고 있을 때만 뜻이 있다(DB·전체 그래프 화면에서는 숨긴다).
 */
export const DOCK_BREAKPOINT = 1340;
const KEY = 'nops.dock';

/** auto = 창 폭을 따른다. open/closed = 사용자가 직접 고른 값(기억한다). */
export type DockMode = 'auto' | 'open' | 'closed';

export function resolveDockOpen(mode: DockMode, width: number): boolean {
  if (mode === 'open') return true;
  if (mode === 'closed') return false;
  return width > DOCK_BREAKPOINT;
}

/** 지금 상태에서 토글을 누르면 될 값 */
export function nextDockMode(open: boolean): DockMode {
  return open ? 'closed' : 'open';
}

/** 노트를 보고 있을 때만 도크가 의미 있다 — DB·그래프 화면에는 붙이지 않는다 */
export function dockAvailable(s: { hasNote: boolean; dbOpen: boolean; graphOpen: boolean }): boolean {
  return s.hasNote && !s.dbOpen && !s.graphOpen;
}

export function loadDockMode(): DockMode {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'open' || v === 'closed' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function saveDockMode(mode: DockMode): void {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* 저장 못 해도 이번 실행에는 적용된다 */
  }
}
