/** 두 번째 실행에서 앞으로 가져올 수 있는 최소 창 표면(단위 테스트용). */
export interface RestorableWindow {
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
}

/**
 * 두 번째 실행: 기존 창을 복원하고 앞으로 가져온다.
 * e2e 백그라운드 모드에서는 창을 드러내거나 포커스를 빼앗지 않는다(사용자 화면 보호).
 */
export function revealExistingWindow(win: RestorableWindow | null | undefined, opts: { background: boolean }): boolean {
  if (!win || opts.background) return false;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  return true;
}
