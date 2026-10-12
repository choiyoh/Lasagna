import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { on: vi.fn() }, session: {}, shell: {} }));

const { SECURE_WEB_PREFERENCES, buildCsp, isPermissionAllowed, isTrustedUrl } = await import('./security');

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
