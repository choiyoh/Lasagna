import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { on: vi.fn() }, session: {}, shell: {} }));

const { SECURE_WEB_PREFERENCES, buildCsp, isTrustedUrl } = await import('./security');

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
