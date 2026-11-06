import { describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import {
  AuthRevokedError,
  DRIVE_FILE_SCOPE,
  OAuthError,
  TokenProvider,
  buildAuthUrl,
  challengeFor,
  createPkce,
  exchangeCode,
  randomState,
  refreshAccessToken,
  startLoopback,
} from './oauth.js';
import type { Tokens } from './oauth.js';

interface FetchCall {
  url: string;
  init: RequestInit;
}

/** 주입용 가짜 fetch — 호출 기록을 남기고 준비된 응답을 돌려준다. */
function fakeFetch(respond: (call: FetchCall) => Response | Promise<Response>): {
  fetchImpl: typeof fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const impl = (input: unknown, init?: RequestInit): Promise<Response> => {
    const call: FetchCall = { url: String(input), init: init ?? {} };
    calls.push(call);
    return Promise.resolve(respond(call));
  };
  return { fetchImpl: impl as unknown as typeof fetch, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** fetch 호출이 정확히 한 번 있었는지 확인하고 그 기록을 돌려준다. */
function onlyCall(calls: FetchCall[]): FetchCall {
  expect(calls).toHaveLength(1);
  const call = calls[0];
  if (call === undefined) throw new Error('fetch 호출 기록이 없다');
  return call;
}

function bodyOf(init: RequestInit): URLSearchParams {
  return new URLSearchParams(String(init.body));
}

/** 잠깐 열어 봐서 비어 있는 포트를 골라 준다(고정 포트로 테스트가 깨지지 않게). */
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address();
  const port = address !== null && typeof address !== 'string' ? address.port : 0;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

function tokens(over: Partial<Tokens> = {}): Tokens {
  return { accessToken: 'AT1', refreshToken: 'RT1', expiresAt: 1_000_000, ...over };
}

describe('createPkce / challengeFor / randomState', () => {
  it('verifier 는 43자 base64url 이고 challenge 는 sha256 의 base64url 이다', () => {
    const pkce = createPkce();
    expect(pkce.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pkce.challenge).toBe(challengeFor(pkce.verifier));
    expect(pkce.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('호출마다 새 값을 만든다', () => {
    expect(createPkce().verifier).not.toBe(createPkce().verifier);
    expect(randomState()).not.toBe(randomState());
  });

  it('RFC 7636 예제 벡터와 일치한다', () => {
    expect(challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('randomState 는 22자 base64url 이다', () => {
    expect(randomState()).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});

describe('buildAuthUrl', () => {
  const base = {
    clientId: 'cid',
    redirectUri: 'http://127.0.0.1:1234/callback',
    challenge: 'CH',
    state: 'ST',
  };

  it('설치형 앱 흐름의 필수 파라미터를 담는다', () => {
    const url = new URL(buildAuthUrl(base));
    expect(`${url.origin}${url.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect([...url.searchParams]).toEqual([
      ['response_type', 'code'],
      ['client_id', 'cid'],
      ['redirect_uri', 'http://127.0.0.1:1234/callback'],
      ['scope', DRIVE_FILE_SCOPE],
      ['state', 'ST'],
      ['code_challenge', 'CH'],
      ['code_challenge_method', 'S256'],
      ['access_type', 'offline'],
      ['prompt', 'consent'],
    ]);
    expect(url.searchParams.has('login_hint')).toBe(false);
  });

  it('scope 와 login_hint 를 덮어쓸 수 있다', () => {
    const url = new URL(buildAuthUrl({ ...base, scope: 'openid', loginHint: 'me@example.com' }));
    expect(url.searchParams.get('scope')).toBe('openid');
    expect(url.searchParams.get('login_hint')).toBe('me@example.com');
  });
});

describe('exchangeCode', () => {
  it('PKCE 본문으로 토큰 엔드포인트에 POST 하고 expiresAt 을 now 기준으로 계산한다', async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      jsonResponse({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }),
    );

    const result = await exchangeCode({
      clientId: 'cid',
      clientSecret: 'sec',
      fetch: fetchImpl,
      now: () => 1_000_000,
      code: 'CODE',
      verifier: 'VER',
      redirectUri: 'http://127.0.0.1:1234/callback',
    });

    const call = onlyCall(calls);
    expect(call.url).toBe('https://oauth2.googleapis.com/token');
    expect(call.init.method).toBe('POST');
    expect(new Headers(call.init.headers).get('content-type')).toBe(
      'application/x-www-form-urlencoded',
    );
    expect(bodyOf(call.init).toString()).toBe(
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: 'CODE',
        code_verifier: 'VER',
        redirect_uri: 'http://127.0.0.1:1234/callback',
        client_id: 'cid',
        client_secret: 'sec',
      }).toString(),
    );
    expect(result).toEqual({ accessToken: 'AT', refreshToken: 'RT', expiresAt: 4_600_000 });
  });

  it('client_secret 이 없으면 본문에 넣지 않는다', async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      jsonResponse({ access_token: 'AT', expires_in: 60 }),
    );

    await exchangeCode({
      clientId: 'cid',
      fetch: fetchImpl,
      code: 'CODE',
      verifier: 'VER',
      redirectUri: 'http://127.0.0.1:1234/callback',
    });

    expect(bodyOf(onlyCall(calls).init).has('client_secret')).toBe(false);
  });

  it('error 응답이면 OAuthError(code=error) 를 던지고 메시지에 code 값을 남기지 않는다', async () => {
    const { fetchImpl } = fakeFetch(() => jsonResponse({ error: 'invalid_client' }, 400));

    const promise = exchangeCode({
      clientId: 'cid',
      fetch: fetchImpl,
      code: 'SECRET-CODE',
      verifier: 'VER',
      redirectUri: 'http://127.0.0.1:1234/callback',
    });

    await expect(promise).rejects.toBeInstanceOf(OAuthError);
    await expect(promise).rejects.toMatchObject({ code: 'invalid_client' });

    let err: unknown = undefined;
    await promise.catch((e: unknown) => {
      err = e;
    });
    expect(err).toBeInstanceOf(OAuthError);
    expect((err as OAuthError).message).not.toContain('SECRET-CODE');
  });

  it('본문이 JSON 이 아니면 OAuthError 로 알린다', async () => {
    const { fetchImpl } = fakeFetch(() => new Response('<html>nope</html>', { status: 500 }));

    await expect(
      exchangeCode({
        clientId: 'cid',
        fetch: fetchImpl,
        code: 'C',
        verifier: 'V',
        redirectUri: 'http://127.0.0.1:1234/callback',
      }),
    ).rejects.toBeInstanceOf(OAuthError);
  });
});

describe('refreshAccessToken', () => {
  const base = { clientId: 'cid', refreshToken: 'OLD-RT' };

  it('갱신 본문을 만들고, 응답에 refresh_token 이 없으면 기존 값을 유지한다', async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      jsonResponse({ access_token: 'AT2', expires_in: 100 }),
    );

    const result = await refreshAccessToken({ ...base, fetch: fetchImpl, now: () => 5_000 });

    const call = onlyCall(calls);
    expect(call.url).toBe('https://oauth2.googleapis.com/token');
    expect(call.init.method).toBe('POST');
    expect(new Headers(call.init.headers).get('content-type')).toBe(
      'application/x-www-form-urlencoded',
    );
    expect(bodyOf(call.init).toString()).toBe(
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: 'OLD-RT',
        client_id: 'cid',
      }).toString(),
    );
    expect(result).toEqual({ accessToken: 'AT2', refreshToken: 'OLD-RT', expiresAt: 105_000 });
  });

  it('응답에 새 refresh_token 이 있으면 그것을 쓴다', async () => {
    const { fetchImpl } = fakeFetch(() =>
      jsonResponse({ access_token: 'AT2', refresh_token: 'NEW-RT', expires_in: 100 }),
    );

    const result = await refreshAccessToken({ ...base, fetch: fetchImpl, now: () => 0 });

    expect(result.refreshToken).toBe('NEW-RT');
  });

  it('invalid_grant 면 AuthRevokedError 로 알린다', async () => {
    const { fetchImpl } = fakeFetch(() => jsonResponse({ error: 'invalid_grant' }, 400));

    await expect(refreshAccessToken({ ...base, fetch: fetchImpl })).rejects.toBeInstanceOf(
      AuthRevokedError,
    );
  });

  it('다른 오류는 그대로 OAuthError 로 남는다', async () => {
    const { fetchImpl } = fakeFetch(() => jsonResponse({ error: 'invalid_client' }, 400));

    await expect(refreshAccessToken({ ...base, fetch: fetchImpl })).rejects.toMatchObject({
      name: 'OAuthError',
      code: 'invalid_client',
    });
  });
});

describe('TokenProvider', () => {
  it('만료 skew 전에는 캐시를 쓰고, 경계에 닿으면 한 번만 갱신한다', async () => {
    let now = 0;
    const { fetchImpl, calls } = fakeFetch(() =>
      jsonResponse({ access_token: 'AT2', expires_in: 3600 }),
    );
    const provider = new TokenProvider({
      clientId: 'cid',
      fetch: fetchImpl,
      now: () => now,
      tokens: tokens(),
    });

    expect(await provider.getAccessToken()).toBe('AT1');
    expect(calls).toHaveLength(0);

    now = 940_000; // expiresAt(1_000_000) - skew(60_000) 과 같은 순간 → 갱신
    expect(await provider.getAccessToken()).toBe('AT2');
    expect(calls).toHaveLength(1);
    expect(provider.current()).toEqual({
      accessToken: 'AT2',
      refreshToken: 'RT1',
      expiresAt: 940_000 + 3_600_000,
    });

    now = 4_470_000; // 아직 여유가 있다 → 캐시
    expect(await provider.getAccessToken()).toBe('AT2');
    expect(calls).toHaveLength(1);
  });

  it('current()는 사본이라 밖에서 고쳐도 내부 상태가 바뀌지 않는다', async () => {
    const { fetchImpl } = fakeFetch(() => jsonResponse({ access_token: 'AT2', expires_in: 3600 }));
    const provider = new TokenProvider({ clientId: 'cid', fetch: fetchImpl, tokens: tokens() });

    const copy = provider.current();
    copy.accessToken = 'HACKED';

    expect(provider.current().accessToken).toBe('AT1');
  });

  it('forceRefresh 는 만료 전이어도 refresh token 으로 한 번 갱신한다', async () => {
    const { fetchImpl, calls } = fakeFetch(() => jsonResponse({ access_token: 'AT2', expires_in: 3600 }));
    const onTokens = vi.fn();
    const provider = new TokenProvider({ clientId: 'cid', fetch: fetchImpl, now: () => 0, tokens: tokens(), onTokens });

    expect(await provider.getAccessToken()).toBe('AT1');
    expect(calls).toHaveLength(0);
    expect(await provider.forceRefresh()).toBe('AT2');
    expect(calls).toHaveLength(1);
    expect(onTokens).toHaveBeenCalledWith({ accessToken: 'AT2', refreshToken: 'RT1', expiresAt: 3_600_000 });
  });

  it('동시 호출은 하나의 갱신 요청을 공유하고 onTokens 는 한 번만 부른다', async () => {
    let release!: (res: Response) => void;
    const gate = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const { fetchImpl, calls } = fakeFetch(() => gate);
    const onTokens = vi.fn();
    const provider = new TokenProvider({
      clientId: 'cid',
      fetch: fetchImpl,
      now: () => 0,
      tokens: tokens({ expiresAt: 0 }),
      onTokens,
    });

    const waiting = [
      provider.getAccessToken(),
      provider.getAccessToken(),
      provider.getAccessToken(),
    ];
    expect(calls).toHaveLength(1);

    release(jsonResponse({ access_token: 'AT2', expires_in: 3600, refresh_token: 'RT2' }));

    expect(await Promise.all(waiting)).toEqual(['AT2', 'AT2', 'AT2']);
    expect(calls).toHaveLength(1);
    expect(onTokens).toHaveBeenCalledTimes(1);
    expect(onTokens).toHaveBeenCalledWith({
      accessToken: 'AT2',
      refreshToken: 'RT2',
      expiresAt: 3_600_000,
    });
  });

  it('onTokens 저장이 끝난 뒤에 getAccessToken 이 끝난다', async () => {
    const order: string[] = [];
    const { fetchImpl } = fakeFetch(() => jsonResponse({ access_token: 'AT2', expires_in: 3600 }));
    const provider = new TokenProvider({
      clientId: 'cid',
      fetch: fetchImpl,
      now: () => 0,
      tokens: tokens({ expiresAt: 0 }),
      onTokens: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push('saved');
      },
    });

    await provider.getAccessToken();
    order.push('returned');

    expect(order).toEqual(['saved', 'returned']);
  });

  it('갱신이 실패하면 다음 호출이 다시 시도한다', async () => {
    let attempt = 0;
    const { fetchImpl, calls } = fakeFetch(() =>
      attempt++ === 0
        ? jsonResponse({ error: 'invalid_grant' }, 400)
        : jsonResponse({ access_token: 'AT2', expires_in: 3600 }),
    );
    const provider = new TokenProvider({
      clientId: 'cid',
      fetch: fetchImpl,
      now: () => 0,
      tokens: tokens({ expiresAt: 0 }),
    });

    await expect(provider.getAccessToken()).rejects.toBeInstanceOf(AuthRevokedError);
    expect(await provider.getAccessToken()).toBe('AT2');
    expect(calls).toHaveLength(2);
  });
});

/** 아직 결과가 확정되지 않았는지 확인한다. */
async function settleState(result: Promise<unknown>, ms: number): Promise<'settled' | 'pending'> {
  const pending = Symbol('pending');
  const raced = await Promise.race([
    result.then(
      () => 'settled' as const,
      () => 'settled' as const,
    ),
    new Promise<typeof pending>((resolve) => setTimeout(() => resolve(pending), ms)),
  ]);
  return raced === pending ? 'pending' : raced;
}

describe('startLoopback', () => {
  it('state 가 맞는 code 콜백에 안내 페이지를 돌려주고 resolve 한 뒤 서버를 닫는다', async () => {
    const handle = await startLoopback({ state: 'ST' });
    expect(handle.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);

    const res = await fetch(`${handle.redirectUri}?code=CODE1&state=ST`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toBe(
      "default-src 'none'; style-src 'unsafe-inline'",
    );
    expect(await res.text()).toContain('연결됐어요. 이 창은 닫아도 돼요.');

    await expect(handle.result).resolves.toEqual({ code: 'CODE1' });

    handle.close();
    handle.close(); // 멱등
    await expect(fetch(`${handle.redirectUri}?code=CODE2&state=ST`)).rejects.toThrow();
  });

  it('지정한 포트로 열 수 있다', async () => {
    const port = await freePort();
    const handle = await startLoopback({ state: 'ST', port });
    expect(handle.redirectUri).toBe(`http://127.0.0.1:${port}/callback`);
    handle.close();
    await expect(handle.result).rejects.toBeInstanceOf(OAuthError);
  });

  it('state 가 다르면 400 을 돌려주고 계속 기다린다', async () => {
    const handle = await startLoopback({ state: 'ST' });

    const bad = await fetch(`${handle.redirectUri}?code=X&state=OTHER`);
    expect(bad.status).toBe(400);
    expect(await settleState(handle.result, 30)).toBe('pending');

    const ok = await fetch(`${handle.redirectUri}?code=CODE2&state=ST`);
    expect(ok.status).toBe(200);
    await expect(handle.result).resolves.toEqual({ code: 'CODE2' });
  });

  it('잘못된 경로는 404 이고 대기는 이어진다', async () => {
    const handle = await startLoopback({ state: 'ST' });

    const res = await fetch(new URL('/other', handle.redirectUri));
    expect(res.status).toBe(404);
    expect(await settleState(handle.result, 30)).toBe('pending');

    await fetch(`${handle.redirectUri}?code=CODE3&state=ST`);
    await expect(handle.result).resolves.toEqual({ code: 'CODE3' });
  });

  it('error 콜백이면 안내 페이지를 보여 주고 OAuthError 로 reject 한다', async () => {
    const handle = await startLoopback({ state: 'ST' });

    const res = await fetch(`${handle.redirectUri}?error=access_denied&state=ST`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('연결하지 못했어요');

    await expect(handle.result).rejects.toMatchObject({
      name: 'OAuthError',
      code: 'access_denied',
    });
    handle.close();
  });

  it('타임아웃이면 서버를 닫고 reject 한다', async () => {
    const handle = await startLoopback({ state: 'ST', timeoutMs: 30 });

    await expect(handle.result).rejects.toBeInstanceOf(OAuthError);
    await expect(fetch(`${handle.redirectUri}?code=X&state=ST`)).rejects.toThrow();
  });

  it('close()는 여러 번 불러도 안전하고 대기 중인 결과를 끝낸다', async () => {
    const handle = await startLoopback({ state: 'ST' });

    handle.close();
    handle.close();

    await expect(handle.result).rejects.toBeInstanceOf(OAuthError);
    await expect(fetch(`${handle.redirectUri}?code=X&state=ST`)).rejects.toThrow();
  });
});

describe('전체 흐름', () => {
  it('인증 URL → 루프백 콜백 → 토큰 교환 → 만료 후 갱신까지 이어진다', async () => {
    const state = randomState();
    const pkce = createPkce();
    const handle = await startLoopback({ state, timeoutMs: 2_000 });

    const authUrl = new URL(
      buildAuthUrl({
        clientId: 'cid',
        redirectUri: handle.redirectUri,
        challenge: pkce.challenge,
        state,
      }),
    );
    expect(authUrl.searchParams.get('redirect_uri')).toBe(handle.redirectUri);
    expect(authUrl.searchParams.get('state')).toBe(state);

    // 사용자가 브라우저에서 승인하면 Google 이 code 를 들고 redirect_uri 로 돌아온다.
    const [callbackPage, callback] = await Promise.all([
      fetch(`${handle.redirectUri}?code=REAL-CODE&state=${state}`),
      handle.result,
    ]);
    expect(callbackPage.status).toBe(200);
    expect(await callbackPage.text()).toContain('연결됐어요');
    expect(callback).toEqual({ code: 'REAL-CODE' });

    const { fetchImpl, calls } = fakeFetch(() =>
      jsonResponse({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }),
    );
    let now = 1_000;
    const tokens = await exchangeCode({
      clientId: 'cid',
      fetch: fetchImpl,
      now: () => now,
      code: callback.code,
      verifier: pkce.verifier,
      redirectUri: handle.redirectUri,
    });
    const provider = new TokenProvider({
      clientId: 'cid',
      fetch: fetchImpl,
      now: () => now,
      tokens,
    });

    const exchangeCall = onlyCall(calls);
    expect(bodyOf(exchangeCall.init).get('code_verifier')).toBe(pkce.verifier);
    expect(bodyOf(exchangeCall.init).get('redirect_uri')).toBe(handle.redirectUri);

    expect(await provider.getAccessToken()).toBe('AT'); // 아직 캐시
    expect(calls).toHaveLength(1);

    now = 3_601_000; // 만료 시각
    expect(await provider.getAccessToken()).toBe('AT');
    expect(calls).toHaveLength(2);
    expect(bodyOf(calls[1]?.init ?? {}).get('refresh_token')).toBe('RT');
  });
});
