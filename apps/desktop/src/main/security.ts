import { app, session, shell, type BrowserWindowConstructorOptions, type WebContents } from 'electron';

export const APP_ORIGIN = 'app://nopsidian';

/** 모든 창이 공유하는 webPreferences. 스냅샷 테스트로 고정한다(security.test.ts). */
export const SECURE_WEB_PREFERENCES = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  webviewTag: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  experimentalFeatures: false,
  spellcheck: false,
} as const satisfies NonNullable<BrowserWindowConstructorOptions['webPreferences']>;

export function buildCsp(dev: boolean): string {
  const base = [
    `default-src 'self' app:`,
    `script-src 'self'${dev ? ` 'unsafe-inline'` : ''}`,
    `style-src 'self' 'unsafe-inline'`,
    `object-src 'none'`,
    `base-uri 'none'`,
    `form-action 'none'`,
    `frame-ancestors 'none'`,
    `img-src 'self' vault: data:`,
    `media-src 'self' vault:`,
    `font-src 'self' data:`,
    `connect-src 'self'${dev ? ' ws://localhost:* http://localhost:*' : ''}`,
  ];
  return base.join('; ');
}

/** 외부 링크는 http/https만, 시스템 브라우저로 연다. */
export function openExternalSafe(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    void shell.openExternal(u.toString());
    return true;
  } catch {
    return false;
  }
}

/** 앱 오리진인지(개발 중에는 Vite dev 서버 포함) 확인한다. */
export function isTrustedUrl(url: string, devServerUrl?: string): boolean {
  try {
    const u = new URL(url);
    if (u.origin === APP_ORIGIN || `${u.protocol}//${u.host}` === APP_ORIGIN) return true;
    if (devServerUrl && u.origin === new URL(devServerUrl).origin) return true;
  } catch {
    // fallthrough
  }
  return false;
}

export function hardenWebContents(wc: WebContents, devServerUrl?: string) {
  wc.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    if (!isTrustedUrl(url, devServerUrl)) {
      e.preventDefault();
      openExternalSafe(url);
    }
  });
  wc.on('will-attach-webview', (e) => e.preventDefault());
}

export function installSessionPolicy() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);
  app.on('web-contents-created', (_e, wc) => {
    wc.on('will-attach-webview', (ev) => ev.preventDefault());
  });
}
