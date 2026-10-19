import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ openExternal: vi.fn() }));

vi.mock('electron', () => ({ app: { on: vi.fn() }, session: {}, shell: { openExternal: mocks.openExternal } }));

const { SECURE_WEB_PREFERENCES, buildCsp, isPermissionAllowed, isTrustedUrl, openExternalSafe } = await import('./security');

describe('webPreferences 스냅샷', () => {
  it('보안 기본값이 바뀌지 않는다', () => {
    expect(SECURE_WEB_PREFERENCES).toMatchInlineSnapshot(`
      {
        "allowRunningInsecureContent": false,
        "contextIsolation": true,
        "experimentalFeatures": false,
        "nodeIntegration": false,
        "nodeIntegrationInSubFrames": false,
        "nodeIntegrationInWorker": false,
        "sandbox": true,
        "spellcheck": false,
        "webSecurity": true,
        "webviewTag": false,
      }
    `);
  });
});

describe('CSP', () => {
  it('운영 CSP에는 unsafe-inline 스크립트와 원격 connect가 없다', () => {
    const csp = buildCsp(false);
    expect(csp).toContain(`script-src 'self'`);
    expect(csp).not.toMatch(/script-src[^;]*unsafe/);
    expect(csp).toContain(`connect-src 'self'`);
    expect(csp).not.toContain('http:');
    expect(csp).toContain(`object-src 'none'`);
  });
});

describe('isTrustedUrl', () => {
  it('app 오리진과 개발 서버만 신뢰한다', () => {
    expect(isTrustedUrl('app://nopsidian/index.html')).toBe(true);
    expect(isTrustedUrl('https://evil.example/')).toBe(false);
    expect(isTrustedUrl('file:///etc/passwd')).toBe(false);
    expect(isTrustedUrl('http://localhost:5173/', 'http://localhost:5173/')).toBe(true);
    expect(isTrustedUrl('http://localhost:9999/', 'http://localhost:5173/')).toBe(false);
  });
});

describe('권한', () => {
  it('앱 화면의 클립보드 쓰기만 허용하고 나머지는 모두 거부한다', () => {
    expect(isPermissionAllowed('clipboard-sanitized-write', 'app://nopsidian/index.html')).toBe(true);
    expect(isPermissionAllowed('clipboard-sanitized-write', 'https://evil.example/')).toBe(false);
    for (const p of ['media', 'geolocation', 'notifications', 'clipboard-read', 'midi', 'openExternal', 'fullscreen']) {
      expect(isPermissionAllowed(p, 'app://nopsidian/index.html'), p).toBe(false);
    }
  });
});

describe('openExternalSafe', () => {
  beforeEach(() => mocks.openExternal.mockClear());

  it('http/https 만 시스템 브라우저로 한 번 연다', () => {
    expect(openExternalSafe('https://accounts.google.com/o/oauth2/v2/auth?client_id=x')).toBe(true);
    // 두 번 열면 브라우저 창이 두 개 뜬다(issue #6) — 정확히 한 번만 부른다
    expect(mocks.openExternal).toHaveBeenCalledTimes(1);
    expect(mocks.openExternal).toHaveBeenLastCalledWith('https://accounts.google.com/o/oauth2/v2/auth?client_id=x');
  });

  it('허용하지 않는 형식은 열지 않는다', () => {
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'vault://nopsidian/a.png', 'not a url', '']) {
      expect(openExternalSafe(url), url).toBe(false);
    }
    expect(mocks.openExternal).not.toHaveBeenCalled();
  });
});
