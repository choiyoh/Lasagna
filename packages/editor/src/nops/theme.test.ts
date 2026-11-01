import { afterEach, describe, expect, it, vi } from 'vitest';
import { isEffectiveDark, onEffectiveThemeChange } from './theme';
import { createSourceEditor } from './source-editor';

type MediaListener = (e: { matches: boolean }) => void;

function stubMedia(initial: boolean) {
  const listeners = new Set<MediaListener>();
  const mql = {
    matches: initial,
    addEventListener: vi.fn((_type: string, cb: MediaListener) => listeners.add(cb)),
    removeEventListener: vi.fn((_type: string, cb: MediaListener) => listeners.delete(cb)),
  };
  vi.stubGlobal('matchMedia', vi.fn(() => mql));
  return { mql, listeners };
}

afterEach(() => {
  delete document.documentElement.dataset.theme;
  vi.unstubAllGlobals();
});

describe('isEffectiveDark', () => {
  it('앱 라이트는 OS 다크여도 라이트다', () => {
    stubMedia(true);
    document.documentElement.dataset.theme = 'light';
    expect(isEffectiveDark()).toBe(false);
  });

  it('앱 다크는 OS 라이트여도 다크다', () => {
    stubMedia(false);
    document.documentElement.dataset.theme = 'dark';
    expect(isEffectiveDark()).toBe(true);
  });

  it('시스템은 OS 설정을 따른다', () => {
    stubMedia(false);
    document.documentElement.dataset.theme = 'system';
    expect(isEffectiveDark()).toBe(false);

    stubMedia(true);
    document.documentElement.dataset.theme = 'system';
    expect(isEffectiveDark()).toBe(true);
  });

  it('data-theme 이 없으면 OS 설정을 따른다', () => {
    stubMedia(true);
    expect(isEffectiveDark()).toBe(true);
    stubMedia(false);
    expect(isEffectiveDark()).toBe(false);
  });
});

describe('source editor', () => {
  it('oneDark 를 쓰는 다크 소스 모드에서도 편집기 배경은 투명(앱 배경)이다', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const ed = createSourceEditor(host, { text: '# hi', onChange: () => {}, dark: true });
    const editor = host.querySelector('.cm-editor') as HTMLElement;
    expect(editor).not.toBeNull();
    const bg = getComputedStyle(editor).backgroundColor;
    expect(bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)').toBe(true);
    // jsdom 의 cascade 는 CodeMirror 의 동적 클래스 우선순위를 재현하지 못한다.
    // 실제로 생성된 규칙이 oneDark 배경을 투명으로 덮는지 확인한다.
    const rules = [...document.querySelectorAll('style')].map((s) => s.textContent ?? '').join('\n');
    expect(rules).toMatch(/\.cm-editor \{background-color: transparent !important;\}/);
    expect(rules).toMatch(/\.cm-gutters \{background-color: transparent !important; border-right: none;\}/);
    ed.destroy();
  });
});

describe('onEffectiveThemeChange', () => {  it('nops:theme 과 OS 테마 변경을 모두 구독하고 해제한다', () => {
    const { mql, listeners } = stubMedia(false);
    const cb = vi.fn();
    const off = onEffectiveThemeChange(cb);

    window.dispatchEvent(new CustomEvent('nops:theme', { detail: 'dark' }));
    expect(cb).toHaveBeenCalledTimes(1);

    for (const l of listeners) l({ matches: true });
    expect(cb).toHaveBeenCalledTimes(2);

    off();
    expect(mql.removeEventListener).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new CustomEvent('nops:theme', { detail: 'light' }));
    expect(cb).toHaveBeenCalledTimes(2);
  });
});
