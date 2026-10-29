import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { AuthRevokedError, DriveApiError, DriveAuthError } from '@nopsidian/sync-gdrive';
import { errorDetails, withRefreshOn401 } from '../workers/sync/error-info';
import { CredentialStore, SyncController, credentialSuffix, maskEmail, syncFailureFor, vaultKeyFor, type SecretBox } from './sync';

/** 테스트용 가짜 키체인: 뒤집기만 한다(평문이 파일에 남지 않는지 확인하려는 용도) */
const box = (available = true): SecretBox => ({
  available: () => available,
  encrypt: (p) => Buffer.from([...p].reverse().join('')),
  decrypt: (d) => [...d.toString()].reverse().join(''),
});
const tmpFile = () => path.join(mkdtempSync(path.join(tmpdir(), 'nops-sync-')), 'auth', 'sync-auth.json');

describe('CredentialStore', () => {
  it('저장하고 다시 읽는다. 파일에 평문이 남지 않는다', () => {
    const file = tmpFile();
    const store = new CredentialStore(file, box());
    store.save({ clientId: 'abc.apps.googleusercontent.com', clientSecret: 'shh', tokens: { accessToken: 'AT', refreshToken: 'RT-secret', expiresAt: 1 } });
    expect(store.load()).toMatchObject({ clientId: 'abc.apps.googleusercontent.com', tokens: { refreshToken: 'RT-secret' } });
    const raw = readFileSync(file, 'utf8');
    expect(raw).not.toContain('RT-secret');
    expect(raw).not.toContain('shh');
  });
  it('키체인을 쓸 수 없으면 저장을 거부한다', () => {
    expect(() => new CredentialStore(tmpFile(), box(false)).save({ clientId: 'x'.repeat(12) })).toThrow(/키체인/);
  });
  it('파일이 없거나 깨졌거나 키체인이 없으면 null', () => {
    expect(new CredentialStore(tmpFile(), box()).load()).toBeNull();
  });
  it('내장 클라이언트만 쓰던 파일은 clearTokens 로 통째로 지운다', () => {
    const file = tmpFile();
    const store = new CredentialStore(file, box());
    store.save({ tokens: { accessToken: 'a', refreshToken: 'r', expiresAt: 1 }, tokenClientId: 'b'.repeat(12) });
    store.clearTokens();
    expect(store.load()).toBeNull();
    expect(existsSync(file)).toBe(false);
  });
  it('clearTokens 는 클라이언트 설정만 남긴다', () => {
    const store = new CredentialStore(tmpFile(), box());
    store.save({ clientId: 'c'.repeat(12), tokens: { accessToken: 'a', refreshToken: 'r', expiresAt: 1 } });
    store.clearTokens();
    expect(store.load()).toEqual({ clientId: 'c'.repeat(12) });
  });
  it('load() 가 실패해도(키체인 없음·복호화 실패) 파일에 남은 토큰을 지운다', () => {
    const file = tmpFile();
    const store = new CredentialStore(file, box());
    store.save({ clientId: 'c'.repeat(12), tokens: { accessToken: 'a', refreshToken: 'r', expiresAt: 1 } });
    // 키체인을 쓸 수 없게 되어 load() 가 null 을 돌려주는 상황
    const blind = new CredentialStore(file, box(false));
    expect(blind.load()).toBeNull();
    blind.clearTokens();
    expect(existsSync(file)).toBe(false);

    // 파일이 아예 없어도 조용히 끝난다
    expect(() => new CredentialStore(file, box(false)).clearTokens()).not.toThrow();
  });
  it('이미 있던 파일에 다시 저장해도 권한을 0600 으로 맞춘다', () => {
    const file = tmpFile();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, '{}', { mode: 0o644 });
    const store = new CredentialStore(file, box());
    store.save({ clientId: 'c'.repeat(12) });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(store.load()).toMatchObject({ clientId: 'c'.repeat(12) });
  });
});

describe('내장 클라이언트 우선순위', () => {
  const builtin = { clientId: 'builtin-1234.apps.googleusercontent.com', clientSecret: 'builtin-secret' };
  const controller = (store: CredentialStore) =>
    new SyncController({
      credentials: store,
      workerFile: '/unused/worker.cjs',
      openExternal: () => undefined,
      broadcast: () => undefined,
      builtinClient: builtin,
    });

  it('직접 입력이 없으면 내장 클라이언트를 쓰고, 토큰이 없으면 로그인 전 상태다', () => {
    const c = controller(new CredentialStore(tmpFile(), box()));
    expect(c.status()).toMatchObject({
      configured: true,
      clientSource: 'builtin',
      builtinClientAvailable: true,
      connected: false,
    });
  });

  it('직접 입력 클라이언트가 있으면 내장보다 우선하고 예전 토큰도 유지한다', () => {
    const store = new CredentialStore(tmpFile(), box());
    store.save({ clientId: 'custom-client', tokens: { accessToken: 'a', refreshToken: 'r', expiresAt: 1 } });
    const c = controller(store);
    expect(c.status()).toMatchObject({
      configured: true,
      clientSource: 'custom',
      connected: true,
    });
    // 같은 클라이언트를 다시 저장해도 기존 토큰을 유지한다.
    c.setClient('custom-client', 'custom-secret');
    expect(c.status()).toMatchObject({ clientSource: 'custom', connected: true });
    expect(store.load()?.tokenClientId).toBe('custom-client');
  });

  it('내장 토큰은 다른 클라이언트로 바꿀 때 재사용하지 않는다', () => {
    const store = new CredentialStore(tmpFile(), box());
    store.save({ tokens: { accessToken: 'a', refreshToken: 'r', expiresAt: 1 }, tokenClientId: builtin.clientId });
    const c = controller(store);
    expect(c.status()).toMatchObject({ clientSource: 'builtin', connected: true });

    c.setClient('custom-client');
    expect(c.status()).toMatchObject({ clientSource: 'custom', connected: false });
    expect(store.load()?.tokens).toBeUndefined();

    expect(c.useBuiltinClient()).toMatchObject({ clientSource: 'builtin', connected: false });
    expect(store.load()).toBeNull();
  });
});

describe('vaultKeyFor', () => {
  it('같은 이름이면 같은 키, 다르면 다른 키, 한글 정규화에 무관', () => {
    expect(vaultKeyFor('내 볼트')).toBe(vaultKeyFor('내 볼트'.normalize('NFD')));
    expect(vaultKeyFor('a')).not.toBe(vaultKeyFor('b'));
    expect(vaultKeyFor('a')).toMatch(/^[0-9a-f]{16}$/);
  });
});


describe('withRefreshOn401', () => {
  it('401이면 refresh token으로 한 번 갱신하고 같은 읽기를 재시도한다', async () => {
    let attempts = 0;
    const refresh = vi.fn(async () => 'new-token');
    const result = await withRefreshOn401(async () => {
      if (attempts++ === 0) throw new DriveAuthError();
      return 'folder';
    }, refresh);
    expect(result).toBe('folder');
    expect(attempts).toBe(2);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('401이 아니면 갱신하지 않고, 갱신 거부는 그대로 올린다', async () => {
    const refresh = vi.fn(async () => undefined);
    await expect(withRefreshOn401(async () => { throw new TypeError('offline'); }, refresh)).rejects.toBeInstanceOf(TypeError);
    expect(refresh).not.toHaveBeenCalled();

    await expect(withRefreshOn401(async () => { throw new DriveAuthError(); }, async () => { throw new AuthRevokedError(); })).rejects.toBeInstanceOf(AuthRevokedError);
  });
});

describe('동기화 진단 문구', () => {
  it('오류 상태·사유를 사람이 읽는 문구와 문서 링크로 바꾼다', () => {
    expect(syncFailureFor({ name: 'DriveAuthError' }, 1)).toMatchObject({ code: 'HTTP 401', title: 'Google 로그인이 만료됐어요' });
    expect(syncFailureFor({ name: 'DriveApiError', status: 403, reason: 'accessNotConfigured' }, 2)).toMatchObject({
      code: 'HTTP 403 · accessNotConfigured',
      title: 'Google Drive API가 꺼져 있어요',
    });
    expect(syncFailureFor({ name: 'DriveApiError', status: 403, reason: 'storageQuotaExceeded' }, 3)).toMatchObject({
      code: 'HTTP 403 · storageQuotaExceeded',
      title: 'Google Drive 저장 공간이 부족해요',
    });
    expect(syncFailureFor({ name: 'DriveApiError', status: 429 }, 4)).toMatchObject({ code: 'HTTP 429/403 · rateLimitExceeded' });
    expect(syncFailureFor({ name: 'DriveApiError', status: 0 }, 5)).toMatchObject({ code: 'NETWORK' });
    expect(syncFailureFor({ code: 'folderMissing' }, 6)).toMatchObject({ code: 'FOLDER_MISSING' });
    expect(syncFailureFor({ kind: 'auth', message: 'Google 계정이 연결되지 않았어요' }, 7)).toMatchObject({
      code: 'NOT_CONNECTED',
      title: 'Google 계정이 연결되지 않았어요',
    });
    expect(syncFailureFor({ message: '삭제가 너무 많아 멈췄어요' }, 8)).toMatchObject({ code: 'BLOCKED' });
    expect(syncFailureFor({ code: 'HTTP 403 · accessNotConfigured' }, 9)).toMatchObject({ code: 'HTTP 403 · accessNotConfigured' });
    expect(syncFailureFor({ code: 'HTTP 403 · storageQuotaExceeded' }, 10)).toMatchObject({ title: 'Google Drive 저장 공간이 부족해요' });
  });

  it('실제 Drive 오류 클래스(가짜 fetch가 만든 오류)도 같은 문구로 바꾼다', () => {
    expect(syncFailureFor(new DriveAuthError())).toMatchObject({ code: 'HTTP 401' });
    expect(syncFailureFor(new DriveApiError('x', 403, 'accessNotConfigured'))).toMatchObject({ code: 'HTTP 403 · accessNotConfigured' });
    expect(syncFailureFor(new DriveApiError('x', 403, 'storageQuotaExceeded'))).toMatchObject({ code: 'HTTP 403 · storageQuotaExceeded' });
    expect(syncFailureFor(new DriveApiError('x', 403, 'rateLimitExceeded'))).toMatchObject({ code: 'HTTP 429/403 · rateLimitExceeded' });
    expect(syncFailureFor(new DriveApiError('x', 429))).toMatchObject({ code: 'HTTP 429/403 · rateLimitExceeded' });
    expect(syncFailureFor(new DriveApiError('x', 0))).toMatchObject({ code: 'NETWORK' });
    expect(syncFailureFor(new TypeError('fetch failed'))).toMatchObject({ code: 'NETWORK' });
    expect(syncFailureFor({ key: 'server', code: 'HTTP 503' })).toMatchObject({
      code: 'HTTP 503',
      title: 'Google 쪽 일시 오류예요',
      action: '잠시 뒤 다시 시도하세요',
    });
    expect(syncFailureFor({ key: 'notFound', code: 'HTTP 404' })).toMatchObject({
      code: 'HTTP 404',
      title: 'Drive에서 파일이나 폴더를 찾을 수 없어요',
    });
    expect(syncFailureFor({ key: 'rateLimit', code: 'HTTP 403 · rateLimitExceeded' })).toMatchObject({
      code: 'HTTP 429/403 · rateLimitExceeded',
    });
  });

  it('워커가 JSON 경계로 보낸 key/status/reason 만으로 분류한다', () => {
    const cases: Array<[unknown, { code: string; title: string }]> = [
      [new DriveAuthError(), { code: 'HTTP 401', title: 'Google 로그인이 만료됐어요' }],
      [new DriveApiError('x', 403, 'accessNotConfigured'), { code: 'HTTP 403 · accessNotConfigured', title: 'Google Drive API가 꺼져 있어요' }],
      [new DriveApiError('x', 403, 'storageQuotaExceeded'), { code: 'HTTP 403 · storageQuotaExceeded', title: 'Google Drive 저장 공간이 부족해요' }],
      [new DriveApiError('x', 403, 'rateLimitExceeded'), { code: 'HTTP 429/403 · rateLimitExceeded', title: 'Google이 잠시 요청을 제한했어요' }],
      [new DriveApiError('x', 429), { code: 'HTTP 429/403 · rateLimitExceeded', title: 'Google이 잠시 요청을 제한했어요' }],
      [new DriveApiError('x', 0), { code: 'NETWORK', title: '인터넷에 연결되지 않았어요' }],
      [new TypeError('fetch failed'), { code: 'NETWORK', title: '인터넷에 연결되지 않았어요' }],
      [new DriveApiError('x', 503), { code: 'HTTP 503', title: 'Google 쪽 일시 오류예요' }],
      [new DriveApiError('x', 502), { code: 'HTTP 502', title: 'Google 쪽 일시 오류예요' }],
      [new DriveApiError('x', 404), { code: 'HTTP 404', title: 'Drive에서 파일이나 폴더를 찾을 수 없어요' }],
      [new DriveApiError('x', 403), { code: 'HTTP 403', title: 'Drive 접근 권한이 없어요' }],
      [new DriveApiError('x', 403, 'dailyLimitExceeded'), { code: 'HTTP 429/403 · rateLimitExceeded', title: 'Google이 잠시 요청을 제한했어요' }],
    ];
    for (const [error, expected] of cases) {
      const wire = JSON.parse(JSON.stringify({ type: 'response', id: 'id', ...errorDetails(error) })) as {
        key: string;
        code: string;
        status?: number;
        reason?: string;
      };
      expect(syncFailureFor({ key: wire.key, code: wire.code, status: wire.status, reason: wire.reason })).toMatchObject(expected);
    }
  });

  it('모든 문구에 docs/sync-setup.md 단계 링크가 붙는다', () => {
    const f = syncFailureFor({ code: 'rateLimit' });
    expect(f.docs).toContain('docs/sync-setup.md#');
    expect(f.action).toContain('다시');
  });

  it('클라이언트 접미사는 Google 도메인을 빼고 끝 4자리만 남긴다', () => {
    expect(credentialSuffix('1234567890-abcdefghijk.apps.googleusercontent.com')).toBe('hijk');
    expect(credentialSuffix('short')).toBe('hort');
  });

  it('이메일은 앞 2자와 도메인만 남긴다', () => {
    expect(maskEmail('someone@example.com')).toBe('so***@example.com');
    expect(maskEmail('a@example.com')).toBe('a***@example.com');
    expect(maskEmail('invalid')).toBe('•••');
  });
});


/** 실제 worker 대신 '지금 확인' 응답만 흉내 내는 최소 워커. */
function fakeSyncWorker(remote: object | object[]): string {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'nops-sync-worker-')), 'worker.cjs');
  writeFileSync(
    file,
    `const { parentPort } = require('node:worker_threads');
const responses = ${JSON.stringify(Array.isArray(remote) ? remote : [remote])};
let n = 0;
parentPort.on('message', (m) => {
  if (m.method !== 'diagnose') return;
  if (m.params.remote) {
    const response = responses[Math.min(n++, responses.length - 1)];
    parentPort.postMessage({ type: 'response', id: m.id, ...response });
  } else {
    parentPort.postMessage({ type: 'response', id: m.id, result: { checkedAt: 1, pendingChanges: 0, folder: null, accountEmail: null, tokenExpiresAt: Date.now() + 600000 } });
  }
});
parentPort.postMessage({ type: 'ready' });
`,
  );
  return file;
}

async function controllerFor(remote: object | object[]) {
  const root = mkdtempSync(path.join(tmpdir(), 'nops-sync-vault-'));
  const store = new CredentialStore(tmpFile(), box());
  store.save({
    clientId: 'c'.repeat(12),
    tokens: { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 600_000 },
  });
  const controller = new SyncController({
    credentials: store,
    workerFile: fakeSyncWorker(remote),
    openExternal: () => undefined,
    broadcast: () => undefined,
    intervalMs: 60_000,
  });
  await controller.attachVault(root, 'v');
  return { controller, store };
}

describe('진단 확인의 실패 처리', () => {
  it('BUSY는 이전의 실제 실패를 덮지 않고 화면에만 알린다', async () => {
    const { controller } = await controllerFor([
      { error: 'Google 쪽 일시 오류', kind: 'other', key: 'server', code: 'HTTP 503' },
      { error: '이미 동기화 중이에요', kind: 'other', key: 'busy', code: 'BUSY' },
    ]);
    try {
      const first = await controller.check();
      expect(first.lastFailure).toMatchObject({ code: 'HTTP 503' });
      await expect(controller.check()).rejects.toThrow('지금 동기화 중이에요');
      const diagnostics = await controller.diagnostics();
      expect(diagnostics.lastFailure).toMatchObject({ code: 'HTTP 503' });
    } finally {
      await controller.detachVault();
    }
  });

  it('401은 토큰을 유지하고 invalid_grant만 지운다', async () => {
    const auth = await controllerFor({ error: 'Drive 인증 실패', kind: 'auth', key: 'auth', code: 'HTTP 401' });
    try {
      const diagnostics = await auth.controller.check();
      expect(diagnostics.lastFailure).toMatchObject({ code: 'HTTP 401', title: 'Google 로그인을 확인하지 못했어요' });
      expect(auth.store.load()?.tokens).toBeDefined();
    } finally {
      await auth.controller.detachVault();
    }

    const revoked = await controllerFor({ error: '연결 해제', kind: 'auth', key: 'authRevoked', code: 'invalid_grant' });
    try {
      const diagnostics = await revoked.controller.check();
      expect(diagnostics.lastFailure).toMatchObject({ code: 'invalid_grant' });
      expect(revoked.store.load()?.tokens).toBeUndefined();
    } finally {
      await revoked.controller.detachVault();
    }
  });
});
