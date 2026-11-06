/**
 * Google OAuth 2.0 (설치형 앱) 흐름 — PKCE + loopback 리다이렉트.
 *
 * Electron 에 의존하지 않는 순수 Node 모듈이라 그대로 테스트할 수 있다. 브라우저 창 열기, 토큰 저장,
 * 시스템 시계는 모두 호출하는 쪽(Main)이 주입한다. `fetch` 도 주입받는다(테스트·프록시 대응).
 *
 * 보안 메모: 토큰 값과 인증 code 는 에러 메시지·로그에 남기지 않는다. `client_secret` 은 설치형
 * 앱에서 비밀이 아니지만, 콘솔에 등록한 경우에만 함께 보낸다.
 */

import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { t, type MessageKey } from '@nopsidian/i18n';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** Drive 앱이 쓰는 최소 권한 — 앱이 직접 만들거나 연 파일만 접근할 수 있다. */
export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const CALLBACK_PATH = '/callback';
const DEFAULT_LOOPBACK_TIMEOUT_MS = 300_000;
const DEFAULT_SKEW_MS = 60_000;
/** 안내 페이지는 외부 리소스를 쓰지 않으므로 인라인 스타일만 허용한다. */
const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'";

/** PKCE 코드 검증 쌍. verifier 는 비밀로 두고 challenge 만 인증 URL 에 싣는다. */
export interface Pkce {
  verifier: string;
  challenge: string;
}

/** RFC 7636 의 S256 변환 — base64url(sha256(verifier)). 테스트에서 노출한다. */
export function challengeFor(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/** verifier 32바이트(43자 base64url)와 그 challenge 를 새로 만든다. */
export function createPkce(): Pkce {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: challengeFor(verifier) };
}

/** CSRF 방지용 state — 16바이트 랜덤 base64url(22자). */
export function randomState(): string {
  return randomBytes(16).toString('base64url');
}

/** 인증 URL 을 만든다. `access_type=offline` + `prompt=consent` 라야 refresh_token 이 온다. */
export function buildAuthUrl(a: {
  clientId: string;
  redirectUri: string;
  challenge: string;
  state: string;
  scope?: string;
  loginHint?: string;
}): string {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', a.clientId);
  url.searchParams.set('redirect_uri', a.redirectUri);
  url.searchParams.set('scope', a.scope ?? DRIVE_FILE_SCOPE);
  url.searchParams.set('state', a.state);
  url.searchParams.set('code_challenge', a.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  if (a.loginHint !== undefined && a.loginHint !== '')
    url.searchParams.set('login_hint', a.loginHint);
  return url.toString();
}

/** 인증 흐름이 실패했을 때(OAuth 오류 응답 포함). `code` 는 Google 이 준 `error` 값. */
export class OAuthError extends Error {
  constructor(
    /** 번역 전 코드(사전 키). 표시하는 쪽이 지금 언어로 번역한다. */
    public readonly key: MessageKey,
    public readonly code?: string,
    public readonly params: Record<string, string | number> = {},
  ) {
    super(key);
    this.name = 'OAuthError';
  }
}

/** refresh_token 이 더 이상 유효하지 않을 때(invalid_grant) — 사용자가 연결을 해제했다. */
export class AuthRevokedError extends Error {
  readonly key: MessageKey = 'sync.err.revoked';
  readonly params: Record<string, string | number> = {};
  constructor() {
    super('sync.err.revoked');
    this.name = 'AuthRevokedError';
  }
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  /** 만료 시각(epoch ms) */
  expiresAt: number;
}

export interface TokenRequestBase {
  clientId: string;
  clientSecret?: string;
  /** 주입받는 fetch — 테스트에서 가짜 구현을 끼운다. */
  fetch: typeof fetch;
  /** 시계 주입(기본 `Date.now`). */
  now?: () => number;
}

/** 토큰 엔드포인트 응답 중 우리가 쓰는 필드. */
interface TokenResponseJson {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  error?: unknown;
}

interface ParsedTokens {
  accessToken: string;
  expiresAt: number;
  /** 응답에 새 refresh_token 이 없으면 undefined — 호출한 쪽이 기존 값을 유지한다. */
  refreshToken?: string;
}

async function postToken(
  params: URLSearchParams,
  fetchImpl: typeof fetch,
  nowMs: number,
): Promise<ParsedTokens> {
  const res = await fetchImpl(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  let json: TokenResponseJson | undefined;
  try {
    json = (await res.json()) as TokenResponseJson;
  } catch {
    json = undefined;
  }

  const error = typeof json?.error === 'string' ? json.error : undefined;
  if (error !== undefined || res.ok === false) {
    // 메시지에 code·토큰 값을 넣지 않는다.
    throw new OAuthError('sync.err.tokenRejected', error);
  }

  const accessToken = json?.access_token;
  const expiresIn = Number(json?.expires_in);
  if (typeof accessToken !== 'string' || accessToken === '' || !Number.isFinite(expiresIn)) {
    throw new OAuthError('sync.err.tokenBadResponse');
  }

  const refreshToken =
    typeof json?.refresh_token === 'string' && json.refresh_token !== ''
      ? json.refresh_token
      : undefined;

  return { accessToken, expiresAt: nowMs + expiresIn * 1000, refreshToken };
}

/** 인증 code 를 토큰으로 교환한다. code 는 한 번만 쓸 수 있다. */
export async function exchangeCode(
  a: TokenRequestBase & { code: string; verifier: string; redirectUri: string },
): Promise<Tokens> {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code: a.code,
    code_verifier: a.verifier,
    redirect_uri: a.redirectUri,
    client_id: a.clientId,
  });
  if (a.clientSecret !== undefined && a.clientSecret !== '')
    params.set('client_secret', a.clientSecret);

  const parsed = await postToken(params, a.fetch, (a.now ?? Date.now)());
  // 교환 응답에 refresh_token 이 없으면 갱신할 수 없다 → 빈 문자열로 두고 호출한 쪽이 판단한다.
  return {
    accessToken: parsed.accessToken,
    refreshToken: parsed.refreshToken ?? '',
    expiresAt: parsed.expiresAt,
  };
}

/** 만료된 access_token 을 갱신한다. 응답에 refresh_token 이 없으면 기존 값을 유지한다. */
export async function refreshAccessToken(
  a: TokenRequestBase & { refreshToken: string },
): Promise<Tokens> {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: a.refreshToken,
    client_id: a.clientId,
  });
  if (a.clientSecret !== undefined && a.clientSecret !== '')
    params.set('client_secret', a.clientSecret);

  let parsed: ParsedTokens;
  try {
    parsed = await postToken(params, a.fetch, (a.now ?? Date.now)());
  } catch (e) {
    if (e instanceof OAuthError && e.code === 'invalid_grant') throw new AuthRevokedError();
    throw e;
  }

  return {
    accessToken: parsed.accessToken,
    refreshToken: parsed.refreshToken ?? a.refreshToken,
    expiresAt: parsed.expiresAt,
  };
}

/**
 * access_token 을 필요할 때 갱신해 주는 얇은 캐시. 만료 skew(기본 60초) 안이면 그대로 쓰고,
 * 아니면 갱신한다. 동시에 여러 요청이 들어와도 갱신 요청은 하나만 나간다.
 */
export class TokenProvider {
  private tokens: Tokens;
  private pending: Promise<string> | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly clientId: string;
  private readonly clientSecret: string | undefined;
  private readonly now: () => number;
  private readonly onTokens: ((t: Tokens) => void | Promise<void>) | undefined;
  private readonly skewMs: number;

  constructor(
    a: TokenRequestBase & {
      tokens: Tokens;
      /** 갱신 결과를 저장하는 훅(디스크 기록 등). getAccessToken 이 끝나기 전에 호출된다. */
      onTokens?: (t: Tokens) => void | Promise<void>;
      /** 만료로 보는 여유 시간(기본 60초) */
      skewMs?: number;
    },
  ) {
    this.tokens = { ...a.tokens };
    this.fetchImpl = a.fetch;
    this.clientId = a.clientId;
    this.clientSecret = a.clientSecret;
    this.now = a.now ?? Date.now;
    this.onTokens = a.onTokens;
    this.skewMs = a.skewMs ?? DEFAULT_SKEW_MS;
  }

  /** 지금까지의 토큰 사본(저장·표시용). 바꾸려면 갱신을 거쳐야 한다. */
  current(): Tokens {
    return { ...this.tokens };
  }

  async getAccessToken(): Promise<string> {
    const now = this.now();
    if (this.tokens.expiresAt - this.skewMs > now) return this.tokens.accessToken;
    return this.refresh();
  }

  /** '지금 확인'이 Drive 401을 받았을 때 만료 시각과 무관하게 refresh token으로 한 번 갱신한다. */
  forceRefresh(): Promise<string> {
    return this.refresh();
  }

  /** 진행 중인 갱신이 있으면 그걸 함께 기다린다. */
  private refresh(): Promise<string> {
    if (this.pending === null) {
      this.pending = this.doRefresh().finally(() => {
        this.pending = null;
      });
    }
    return this.pending;
  }

  private async doRefresh(): Promise<string> {
    const next = await refreshAccessToken({
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      fetch: this.fetchImpl,
      now: this.now,
      refreshToken: this.tokens.refreshToken,
    });
    this.tokens = next;
    // 저장 실패는 삼키지 않는다 — 재시작 뒤에 refresh_token 을 잃으면 다시 로그인해야 한다.
    if (this.onTokens !== undefined) await this.onTokens(next);
    return next.accessToken;
  }
}

export interface LoopbackHandle {
  /** Google 콘솔에 등록하는 리다이렉트 주소(실제로 열린 포트). */
  redirectUri: string;
  /** 인증 성공 시 code 로 resolve, 거부·타임아웃·close 시 OAuthError 로 reject. */
  result: Promise<{ code: string }>;
  /** 서버를 닫는다. 여러 번 불러도 안전하다. */
  close(): void;
}

/** 외부 리소스 없는 안내 페이지. */
function page(title: string, message: string): string {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
</head>
<body style="margin:0;padding:64px 24px;font:16px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1f2328;text-align:center">
<p style="margin:0;font-size:20px;font-weight:600">${message}</p>
</body>
</html>
`;
}

function sendPage(res: ServerResponse, status: number, html: string, onFlushed?: () => void): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Security-Policy', PAGE_CSP);
  // 브라우저가 소켓을 붙잡고 있으면 서버가 닫히지 않으므로 응답마다 끊는다.
  res.setHeader('Connection', 'close');
  res.end(html, onFlushed);
}

/**
 * localhost 에만 바인딩한 임시 HTTP 서버로 리다이렉트를 받는다(설치형 앱 표준 흐름).
 * `state` 가 다른 콜백은 남의 요청일 수 있으므로 400 만 돌려주고 계속 기다린다.
 */
export async function startLoopback(a: {
  state: string;
  timeoutMs?: number;
  port?: number;
}): Promise<LoopbackHandle> {
  const timeoutMs = a.timeoutMs ?? DEFAULT_LOOPBACK_TIMEOUT_MS;
  const server = createServer();

  let resolveResult!: (v: { code: string }) => void;
  let rejectResult!: (e: unknown) => void;
  const result = new Promise<{ code: string }>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  // 호출한 쪽이 result 를 await 하지 않아도 unhandled rejection 경고가 나지 않게 한다.
  result.catch(() => undefined);

  let done = false;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const shutdown = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (closed) return;
    closed = true;
    server.close();
    // 응답 중인 소켓은 남기고, 붙잡고 있는 유휴 소켓만 정리한다.
    server.closeIdleConnections();
  };

  /** 결과를 확정하고 서버를 닫는다. 이미 확정됐으면 아무것도 하지 않는다. */
  const finish = (settle: () => void): void => {
    if (done) return;
    done = true;
    shutdown();
    settle();
  };

  server.on('request', (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== CALLBACK_PATH) {
      sendPage(res, 404, page(t('sync.page.notFoundTitle'), t('sync.page.notFoundBody')));
      return;
    }
    if (url.searchParams.get('state') !== a.state) {
      // 공격자나 다른 흐름의 콜백일 수 있으므로 결과를 확정하지 않고 계속 기다린다.
      sendPage(res, 400, page(t('sync.page.badRequestTitle'), t('sync.page.badRequestBody')));
      return;
    }

    const error = url.searchParams.get('error');
    if (error !== null) {
      sendPage(res, 200, page(t('sync.page.failTitle'), t('sync.page.failBody')), () => {
        finish(() => rejectResult(new OAuthError('sync.err.denied', error)));
      });
      return;
    }

    const code = url.searchParams.get('code');
    if (code === null || code === '') {
      sendPage(res, 200, page(t('sync.page.failTitle'), t('sync.page.failBody')), () => {
        finish(() => rejectResult(new OAuthError('sync.err.noCode')));
      });
      return;
    }

    sendPage(res, 200, page(t('sync.page.doneTitle'), t('sync.page.doneBody')), () => {
      finish(() => resolveResult({ code }));
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(a.port ?? 0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  // 대기 중 서버 오류(포트 회수 등)는 조용히 매달리지 말고 알린다.
  server.on('error', () => {
    finish(() => rejectResult(new OAuthError('sync.err.serverError')));
  });

  timer = setTimeout(() => {
    finish(() => rejectResult(new OAuthError('sync.err.timeout')));
  }, timeoutMs);

  const address = server.address();
  const port = address !== null && typeof address !== 'string' ? address.port : (a.port ?? 0);

  return {
    redirectUri: `http://127.0.0.1:${port}${CALLBACK_PATH}`,
    result,
    close: () => {
      finish(() => rejectResult(new OAuthError('sync.err.cancelled')));
    },
  };
}
