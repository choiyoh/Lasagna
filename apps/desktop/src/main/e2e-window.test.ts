import { describe, expect, it, vi } from 'vitest';
import { BACKGROUND_BOUNDS, backgroundWindowOptions, presentBackgroundWindow, type PresentableWindow } from './e2e-window';

const fakeWindow = () => {
  const calls: string[] = [];
  const win: PresentableWindow = {
    setBounds: vi.fn(() => calls.push('setBounds')),
    setOpacity: vi.fn(() => calls.push('setOpacity')),
    showInactive: vi.fn(() => calls.push('showInactive')),
    setIgnoreMouseEvents: vi.fn(() => calls.push('setIgnoreMouseEvents')),
    setFocusable: vi.fn(() => calls.push('setFocusable')),
    webContents: { focus: vi.fn(() => calls.push('webContents.focus')) },
  };
  return { win, calls };
};

describe('presentBackgroundWindow', () => {
  it('클릭 통과·투명·비활성 표시를 적용한다(포커스 불가는 기본 꺼짐)', () => {
    const { win } = fakeWindow();
    presentBackgroundWindow(win);
    expect(win.setIgnoreMouseEvents).toHaveBeenCalledWith(true); // 사용자의 클릭을 가로채지 않는다
    expect(win.setFocusable).not.toHaveBeenCalled();
    expect(win.setOpacity).toHaveBeenCalledWith(0);
    expect(win.showInactive).toHaveBeenCalledTimes(1); // show() 로 포커스를 가져오지 않는다
    expect(win.setBounds).toHaveBeenCalledWith({ x: -20000, y: -20000, width: 1200, height: 800 });
    expect(win.webContents.focus).toHaveBeenCalledTimes(1); // CDP 입력용 DOM 포커스
  });

  it('unfocusable 옵션을 주면 포커스 불가로도 만든다', () => {
    const { win } = fakeWindow();
    presentBackgroundWindow(win, { unfocusable: true });
    expect(win.setFocusable).toHaveBeenCalledWith(false);
    expect(win.setIgnoreMouseEvents).toHaveBeenCalledWith(true);
  });

  it('setFocusable 이 없는 창에서도 죽지 않는다(플랫폼 차이)', () => {
    const { win } = fakeWindow();
    delete (win as { setFocusable?: unknown }).setFocusable;
    expect(() => presentBackgroundWindow(win, { unfocusable: true })).not.toThrow();
    expect(win.setIgnoreMouseEvents).toHaveBeenCalledWith(true);
  });
});

describe('backgroundWindowOptions', () => {
  it('e2e 에서는 생성 순간부터 숨김·투명·화면 밖', () => {
    expect(backgroundWindowOptions(true)).toEqual({ show: false, opacity: 0, x: BACKGROUND_BOUNDS.x, y: BACKGROUND_BOUNDS.y });
    expect(BACKGROUND_BOUNDS.x).toBeLessThan(0);
  });

  it('배포(비 e2e) 실행에서는 창 옵션이 이전과 같다(빈 객체)', () => {
    expect(backgroundWindowOptions(false)).toEqual({});
  });
});
