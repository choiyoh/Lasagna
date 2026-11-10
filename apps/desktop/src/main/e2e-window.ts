/**
 * e2e 백그라운드 모드에서 창을 '사용자 화면·클릭을 방해하지 않는' 상태로 만든다.
 *
 * macOS 는 **투명(alpha 0) 창도 hit-test** 하므로, 화면 안에 남아 있으면 그 영역 클릭이 Lasagna 로 가
 * 사용자의 클릭·포커스를 빼앗을 수 있다. 그래서 클릭을 통과시키고(`setIgnoreMouseEvents`) 포커스도 받지 않게 한다.
 * Playwright 의 입력은 CDP 로 들어가므로 이 설정과 무관하게 동작한다.
 *
 * 배포 앱에서는 이 함수를 **호출하지 않는다**(main 이 백그라운드 판정일 때만 부른다).
 */
/** e2e 백그라운드 창의 생성 시점 상태 — ready-to-show 전에 화면에 보이지 않게 한다. */
export const BACKGROUND_BOUNDS = { x: -20000, y: -20000, width: 1200, height: 800 } as const;

/**
 * BrowserWindow 생성자에 넣을 e2e 전용 옵션. 배포 실행에서는 빈 객체라 기존과 같다.
 * 생성 직후부터 `show:false` + 투명 + 화면 밖으로 두어, ready-to-show 전 과도 구간에도 보이지 않는다.
 */
export function backgroundWindowOptions(enabled: boolean): {
  show?: boolean;
  opacity?: number;
  x?: number;
  y?: number;
} {
  if (!enabled) return {};
  return { show: false, opacity: 0, x: BACKGROUND_BOUNDS.x, y: BACKGROUND_BOUNDS.y };
}

export interface PresentableWindow {
  setBounds(bounds: { x: number; y: number; width: number; height: number }): void;
  setOpacity(opacity: number): void;
  showInactive(): void;
  setIgnoreMouseEvents(ignore: boolean): void;
  setFocusable?(focusable: boolean): void;
  webContents: { focus(): void };
}

export interface PresentOptions {
  /**
   * 창을 포커스 불가로 만든다(활성화 자체를 막음). 기본은 끔 — Playwright 키보드 입력이
   * 창 포커스에 기대는 경우가 있어, 검증 전에는 켜지 않는다(클릭 통과만으로도 클릭 탈취는 막힌다).
   */
  unfocusable?: boolean;
}

export function presentBackgroundWindow(win: PresentableWindow, opts: PresentOptions = {}): void {
  // 화면 밖을 노리되 macOS 가 화면 안으로 clamp 하므로, 투명 + 클릭 통과 + 포커스 불가로 사용자에게 보이지 않게 한다.
  win.setBounds(BACKGROUND_BOUNDS);
  win.setOpacity(0);
  // 클릭은 절대 받지 않는다(사용자가 그 영역을 눌러도 앱이 활성화되지 않는다).
  win.setIgnoreMouseEvents(true);
  if (opts.unfocusable === true) win.setFocusable?.(false);
  win.showInactive();
  // 창이 비활성이어도 DOM 포커스·입력은 되도록 webContents 에 포커스를 준다(CDP 입력용).
  win.webContents.focus();
}
