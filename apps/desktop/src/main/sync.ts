import { getLocale, t, type MessageKey } from '@nopsidian/i18n';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { buildAuthUrl, createPkce, exchangeCode, randomState, startLoopback } from '@nopsidian/sync-gdrive';
import type { SyncDiagnostics, SyncFailure, SyncStatus } from '@nopsidian/ipc-contract';
import { BUILTIN_CLIENT, type BuiltinClient } from './builtin-client';
import type { DiagnosticsSummary, PlanSummary, RunSummary, SyncResponse, SyncWorkerData } from '../workers/sync/protocol';

type Tokens = SyncWorkerData['tokens'];

/** OS 키체인으로 문자열을 암호화/복호화한다(Electron safeStorage 를 감싼다 — 테스트에서 주입). */
export interface SecretBox {
  available(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(data: Buffer): string;
}

interface Credentials {
  /** 사용자가 직접 입력한 클라이언트. 없으면 앱 내장 클라이언트를 쓴다. */
  clientId?: string;
  clientSecret?: string;
  tokens?: Tokens;
  /** 토큰이 어느 클라이언트에 발급됐는지. 없으면 예전 파일로 보고 clientId 소유로 본다. */
  tokenClientId?: string;
}

interface EffectiveClient {
  clientId: string;
  clientSecret?: string;
  source: 'builtin' | 'custom';
  tokens?: Tokens;
}

/** 오류 코드 → 사람이 읽는 제목·다음 행동·문서 단계. 원문 오류는 화면에 그대로 쓰지 않는다. */
const DOCS_BASE = 'https://github.com/choiyoh/Lasagna/blob/main/docs/sync-setup.md';
// 오류 코드 → 사전 키(제목·다음 행동). 문서 단계 anchor 는 문서 제목 그대로의 값이라 번역하지 않는다.
const FAILURES: Record<string, { code: string; title: MessageKey; action: MessageKey; anchor: string }> = {
  auth: { code: 'HTTP 401', title: 'sync.diag.auth.title', action: 'sync.diag.auth.action', anchor: '2-앱에서-연결' },
  authCheck: { code: 'HTTP 401', title: 'sync.diag.authCheck.title', action: 'sync.diag.authCheck.action', anchor: '문제-해결' },
  authRevoked: { code: 'invalid_grant', title: 'sync.diag.authRevoked.title', action: 'sync.diag.authRevoked.action', anchor: '2-앱에서-연결' },
  notConnected: { code: 'NOT_CONNECTED', title: 'sync.diag.notConnected.title', action: 'sync.diag.notConnected.action', anchor: '2-앱에서-연결' },
  apiDisabled: { code: 'HTTP 403 · accessNotConfigured', title: 'sync.diag.apiDisabled.title', action: 'sync.diag.apiDisabled.action', anchor: '1-google-cloud-설정-한-번만' },
  quota: { code: 'HTTP 403 · storageQuotaExceeded', title: 'sync.diag.quota.title', action: 'sync.diag.quota.action', anchor: '문제-해결' },
  rateLimit: { code: 'HTTP 429/403 · rateLimitExceeded', title: 'sync.diag.rateLimit.title', action: 'sync.diag.rateLimit.action', anchor: '문제-해결' },
  network: { code: 'NETWORK', title: 'sync.diag.network.title', action: 'sync.diag.network.action', anchor: '문제-해결' },
  server: { code: 'HTTP 5xx', title: 'sync.diag.server.title', action: 'sync.diag.server.action', anchor: '문제-해결' },
  notFound: { code: 'HTTP 404', title: 'sync.diag.notFound.title', action: 'sync.diag.notFound.action', anchor: '문제-해결' },
  forbidden: { code: 'HTTP 403', title: 'sync.diag.forbidden.title', action: 'sync.diag.forbidden.action', anchor: '문제-해결' },
  folderMissing: { code: 'FOLDER_MISSING', title: 'sync.diag.folderMissing.title', action: 'sync.diag.folderMissing.action', anchor: '3-두-번째-기기' },
  partial: { code: 'PARTIAL', title: 'sync.diag.partial.title', action: 'sync.diag.partial.action', anchor: '문제-해결' },
  blocked: { code: 'BLOCKED', title: 'sync.diag.blocked.title', action: 'sync.diag.blocked.action', anchor: '문제-해결' },
  busy: { code: 'BUSY', title: 'sync.diag.busy.title', action: 'sync.diag.busy.action', anchor: '문제-해결' },
  unknown: { code: 'UNKNOWN', title: 'sync.diag.unknown.title', action: 'sync.diag.unknown.action', anchor: '문제-해결' },
};

export interface FailureLike {
  name?: string;
  code?: string;
  key?: string;
  status?: number;
  reason?: string;
  kind?: string;
  message?: string;
}

const failureKey = (e: FailureLike): string => {
  if (e.key !== undefined && Object.hasOwn(FAILURES, e.key)) return e.key;
  if (e.code !== undefined && Object.hasOwn(FAILURES, e.code)) return e.code;
  // 예전 기기 상태·직접 만든 오류와의 호환용. 워커는 key 를 보낸다.
  if (e.code === 'HTTP 401') return 'auth';
  if (e.code === 'invalid_grant') return 'authRevoked';
  if (e.code?.includes('accessNotConfigured') === true) return 'apiDisabled';
  if (e.code?.includes('storageQuotaExceeded') === true) return 'quota';
  if (e.code?.includes('rateLimitExceeded') === true || e.code?.includes('dailyLimitExceeded') === true) return 'rateLimit';
  if (e.code === 'NETWORK') return 'network';
  if (e.code === 'FOLDER_MISSING') return 'folderMissing';
  if (e.code === 'HTTP 404') return 'notFound';
  if (e.code?.startsWith('HTTP 5') === true) return 'server';
  if (e.kind === 'auth' && e.message?.includes('연결되지 않았어요') === true) return 'notConnected';
  if (e.kind === 'auth') return 'auth';
  if (e.kind === 'offline') return 'network';
  if (e.name === 'DriveAuthError') return 'auth';
  if (e.name === 'AuthRevokedError') return 'authRevoked';
  if (e.name === 'DriveApiError') {
    if (e.status === 0) return 'network';
    if (e.status === 401) return 'auth';
    if (e.status === 429) return 'rateLimit';
    if (e.status === 403) {
      if (e.reason === 'accessNotConfigured') return 'apiDisabled';
      if (e.reason === 'storageQuotaExceeded') return 'quota';
      if (e.reason === 'rateLimitExceeded' || e.reason === 'userRateLimitExceeded' || e.reason === 'dailyLimitExceeded') return 'rateLimit';
    }
  }
  if (e.name === 'OAuthError' || e.name === 'TypeError') return 'network';
  if (e.key === 'blocked' || e.message?.includes('멈췄어요') === true) return 'blocked';
  if (e.key === 'busy' || e.message?.includes('이미 동기화 중') === true) return 'busy';
  return 'unknown';
};

/** 워커·메인 어디서 온 오류든 화면용 실패 한 건으로 정규화한다. */
export function syncFailureFor(e: FailureLike, at = Date.now()): SyncFailure {
  const key = failureKey(e);
  const f = FAILURES[key] ?? FAILURES.unknown!;
  // 서버·404·일반 403 은 실제 HTTP 상태를 접힌 코드에 남긴다.
  const code = (key === 'server' || key === 'notFound' || key === 'forbidden') && e.code !== undefined ? e.code : f.code;
  return { at, code, kind: key, title: t(f.title), action: t(f.action), docs: `${DOCS_BASE}#${f.anchor}` };
}

/** 저장된 실패(kind 가 있으면)를 지금 언어로 다시 만든다 — 언어를 바꿔도 옛 문장이 남지 않게. */
function localizedFailure(f: SyncFailure | null): SyncFailure | null {
  if (!f?.kind) return f;
  const entry = FAILURES[f.kind];
  return entry ? { ...f, title: t(entry.title), action: t(entry.action) } : f;
}

/** 로컬 진단에 쓰는 접미사. 클라이언트 ID 의 `.apps.googleusercontent.com` 은 빼고 보여 준다. */
export const credentialSuffix = (value: string): string => {
  const base = value.replace(/\.apps\.googleusercontent\.com$/i, '');
  return base.length <= 4 ? base : base.slice(-4);
};

/** 화면·복사 모두에서 쓰는 이메일 마스킹. 전체 이메일은 렌더러로 보내지 않는다. */
export const maskEmail = (email: string): string => {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '•••';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}***@${domain}`;
};

/** 클라이언트 ID·secret·토큰은 userData 에 암호화해 둔다. 볼트(동기화 대상)에는 절대 두지 않는다. */
export class CredentialStore {
  constructor(
    private readonly file: string,
    private readonly box: SecretBox,
  ) {}

  load(): Credentials | null {
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as { enc?: string };
      if (!raw.enc || !this.box.available()) return null;
      return JSON.parse(this.box.decrypt(Buffer.from(raw.enc, 'base64'))) as Credentials;
    } catch {
      return null;
    }
  }

  save(c: Credentials): void {
    if (!this.box.available()) throw new Error(t('main.sync.keychainUnavailable'));
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify({ enc: this.box.encrypt(JSON.stringify(c)).toString('base64') }), { mode: 0o600 });
    // mode 는 새로 만들 때만 적용되므로, 이미 있던 파일도 다시 0600 으로 맞춘다.
    try {
      chmodSync(this.file, 0o600);
    } catch {
      // Windows 등 권한 개념이 다른 OS 에서는 실패해도 괜찮다
    }
  }

  /** 직접 입력한 클라이언트 설정은 남기고 토큰만 지운다. 내장 클라이언트만 쓰던 파일은 통째로 지운다. */
  clearTokens(): void {
    const c = this.load();
    if (c?.clientId) {
      const keep: Credentials = { clientId: c.clientId };
      if (c.clientSecret !== undefined) keep.clientSecret = c.clientSecret;
      this.save(keep);
      return;
    }
    this.clear();
  }

  clear(): void {
    try {
      if (existsSync(this.file)) rmSync(this.file, { force: true });
    } catch {
      // 지우지 못해도 로그아웃 자체는 계속한다
    }
  }
}

interface DeviceSettings {
  enabled: boolean;
  /** 첫 동기화 계획을 사용자가 확인하고 한 번 실행했는지 — 그 전에는 자동 동기화를 하지 않는다 */
  confirmedFirst: boolean;
  lastSync: number | null;
  /** 마지막 실행·계획·확인 시도 */
  lastAttempt: number | null;
  lastFailure: SyncFailure | null;
  /** access token 갱신이 실패한 마지막 기록(성공하면 지운다) */
  lastRefreshFailure: SyncFailure | null;
  /** 마지막 '지금 확인'에서 읽은 폴더 상태(읽기 전용 캐시) */
  lastFolder: SyncDiagnostics['folder'] | null;
  /** 마지막으로 확인한 계정 이메일의 마스킹 값만 저장한다(원문은 저장하지 않는다) */
  lastAccountEmail: string | null;
}

const emptyDevice = (): DeviceSettings => ({
  enabled: false,
  confirmedFirst: false,
  lastSync: null,
  lastAttempt: null,
  lastFailure: null,
  lastRefreshFailure: null,
  lastFolder: null,
  lastAccountEmail: null,
});

/** 볼트 이름으로 정한 식별자 — 두 기기에서 같은 이름의 볼트를 열면 같은 Drive 폴더를 쓴다. */
export const vaultKeyFor = (name: string) => createHash('sha256').update(`nopsidian:vault:${name.normalize('NFC')}`).digest('hex').slice(0, 16);

export interface SyncControllerOptions {
  credentials: CredentialStore;
  workerFile: string;
  openExternal: (url: string) => void;
  broadcast: (status: SyncStatus) => void;
  /** 테스트에서 빌드 상수를 대체한다. 기본은 이 빌드에 주입된 값. */
  builtinClient?: BuiltinClient | null;
  /** 주기·디바운스(테스트에서 줄인다) */
  intervalMs?: number;
  debounceMs?: number;
  fetch?: typeof fetch;
}

export class SyncController {
  private root: string | null = null;
  private name = '';
  private device: DeviceSettings = emptyDevice();
  private worker: Worker | null = null;
  private calls = new Map<string, { resolve: (v: never) => void; reject: (e: Error) => void }>();
  private state: SyncStatus['state'] = 'off';
  private message: string | null = null;
  private conflicts: string[] = [];
  private running = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private interval: ReturnType<typeof setInterval> | undefined;
  private cancelConnect: (() => void) | null = null;

  constructor(private readonly o: SyncControllerOptions) {}

  private get builtinClient(): BuiltinClient | null {
    return this.o.builtinClient === undefined ? BUILTIN_CLIENT : this.o.builtinClient;
  }

  /** 토큰 소유자가 현재 클라이언트와 같을 때만 돌려준다(다른 클라이언트의 refresh token 재사용 금지). */
  private tokensFor(c: Credentials | null, clientId: string): Tokens | undefined {
    if (c?.tokens === undefined) return undefined;
    return (c.tokenClientId ?? c.clientId) === clientId ? c.tokens : undefined;
  }

  /** 직접 입력이 있으면 우선하고, 없으면 빌드에 내장된 클라이언트를 쓴다. */
  private effectiveClient(c = this.o.credentials.load()): EffectiveClient | null {
    if (c?.clientId) {
      const tokens = this.tokensFor(c, c.clientId);
      return { clientId: c.clientId, clientSecret: c.clientSecret, source: 'custom', ...(tokens === undefined ? {} : { tokens }) };
    }
    const builtin = this.builtinClient;
    if (builtin === null) return null;
    const tokens = this.tokensFor(c, builtin.clientId);
    return { ...builtin, source: 'builtin', ...(tokens === undefined ? {} : { tokens }) };
  }

  private get deviceFile() {
    return path.join(this.root!, '.nopsidian', 'sync', 'device.json');
  }

  status(): SyncStatus {
    const client = this.effectiveClient();
    const connected = client?.tokens !== undefined;
    const enabled = !!this.root && this.device.enabled;
    return {
      configured: client !== null,
      clientSource: client?.source ?? 'none',
      builtinClientAvailable: this.builtinClient !== null,
      connected,
      enabled,
      confirmedFirst: this.device.confirmedFirst,
      state: !enabled ? 'off' : !connected ? 'needsAuth' : this.state === 'off' ? 'idle' : this.state,
      lastSync: this.device.lastSync,
      lastAttempt: this.device.lastAttempt,
      message: this.message,
      conflicts: this.conflicts,
    };
  }

  private emit() {
    this.o.broadcast(this.status());
  }

  // ── 볼트 수명주기 ─────────────────────────────────────────────
  async attachVault(root: string, name: string) {
    await this.detachVault();
    this.root = root;
    this.name = name;
    try {
      const saved = JSON.parse(readFileSync(this.deviceFile, 'utf8')) as Partial<DeviceSettings>;
      this.device = { ...emptyDevice(), ...saved };
    } catch {
      this.device = emptyDevice();
    }
    this.state = 'off';
    this.message = null;
    this.conflicts = [];
    this.emit();
    this.schedule(3000);
    this.interval = setInterval(() => this.schedule(0), this.o.intervalMs ?? 120_000);
  }

  async detachVault() {
    clearTimeout(this.timer);
    clearInterval(this.interval);
    await this.stopWorker();
    this.root = null;
  }

  private saveDevice() {
    if (!this.root) return;
    mkdirSync(path.dirname(this.deviceFile), { recursive: true });
    writeFileSync(this.deviceFile, JSON.stringify(this.device, null, 2));
  }

  // ── 설정·연결 ─────────────────────────────────────────────────
  setClient(clientId: string, clientSecret?: string) {
    const prev = this.o.credentials.load();
    const same = prev?.clientId === clientId;
    const tokens = same ? this.tokensFor(prev, clientId) : undefined;
    this.o.credentials.save({
      clientId,
      clientSecret: clientSecret || undefined,
      ...(tokens === undefined ? {} : { tokens, tokenClientId: clientId }),
    });
    if (!same) {
      this.device.lastRefreshFailure = null;
      this.device.lastAccountEmail = null;
      this.saveDevice();
    }
    void this.stopWorker();
    this.emit();
  }

  /** 직접 입력한 클라이언트를 지우고 빌드에 내장된 클라이언트로 돌아간다. 토큰은 다시 로그인해야 한다. */
  useBuiltinClient(): SyncStatus {
    const builtin = this.builtinClient;
    if (builtin === null) throw new Error(t('main.sync.noBuiltinClient'));
    const prev = this.o.credentials.load();
    const keep = this.tokensFor(prev, builtin.clientId);
    if (keep === undefined) this.o.credentials.clear();
    else this.o.credentials.save({ tokens: keep, tokenClientId: builtin.clientId });
    this.device.lastRefreshFailure = null;
    this.device.lastAccountEmail = null;
    this.saveDevice();
    void this.stopWorker();
    this.emit();
    return this.status();
  }

  async connect(): Promise<SyncStatus> {
    const client = this.effectiveClient();
    if (client === null) throw new Error(t('main.sync.noClient'));
    this.cancelConnect?.();
    const pkce = createPkce();
    const state = randomState();
    const loop = await startLoopback({ state });
    this.cancelConnect = loop.close;
    try {
      this.o.openExternal(buildAuthUrl({ clientId: client.clientId, redirectUri: loop.redirectUri, challenge: pkce.challenge, state }));
      const { code } = await loop.result;
      const tokens = await exchangeCode({
        clientId: client.clientId,
        clientSecret: client.clientSecret,
        fetch: this.o.fetch ?? fetch,
        code,
        verifier: pkce.verifier,
        redirectUri: loop.redirectUri,
      });
      if (!tokens.refreshToken) throw new Error(t('main.sync.noRefreshToken'));
      this.o.credentials.save({ ...(this.o.credentials.load() ?? {}), tokens, tokenClientId: client.clientId });
      await this.stopWorker();
      this.device.lastRefreshFailure = null;
      this.device.lastAccountEmail = null;
      this.saveDevice();
      this.state = 'idle';
      this.message = null;
      this.emit();
      this.schedule(500);
      return this.status();
    } finally {
      loop.close();
      this.cancelConnect = null;
    }
  }

  async disconnect() {
    this.cancelConnect?.();
    await this.stopWorker();
    this.o.credentials.clearTokens();
    this.device.lastRefreshFailure = null;
    this.device.lastAccountEmail = null;
    this.saveDevice();
    this.state = 'off';
    this.message = null;
    this.emit();
  }

  setEnabled(enabled: boolean): SyncStatus {
    if (!this.root) throw new Error(t('main.err.noVault'));
    this.device.enabled = enabled;
    this.saveDevice();
    if (!enabled) void this.stopWorker();
    this.state = 'off';
    this.emit();
    if (enabled) this.schedule(500);
    return this.status();
  }

  // ── 실행 ──────────────────────────────────────────────────────
  /** 로컬 파일이 바뀌었다 — 잠시 뒤 동기화한다 */
  notifyLocalChange() {
    this.schedule(this.o.debounceMs ?? 10_000);
  }

  private schedule(ms: number) {
    clearTimeout(this.timer);
    if (!this.canAutoRun()) return;
    this.timer = setTimeout(() => void this.run(false).catch(() => undefined), ms);
  }

  private canAutoRun() {
    const s = this.status();
    return !!this.root && s.enabled && s.connected && this.device.confirmedFirst && s.state !== 'blocked' && s.state !== 'needsAuth';
  }

  async plan(): Promise<PlanSummary> {
    this.device.lastAttempt = Date.now();
    this.saveDevice();
    try {
      const result = await this.call<PlanSummary>({ method: 'plan' });
      this.emit();
      return result;
    } catch (e) {
      const failure = syncFailureFor(e as FailureLike);
      this.device.lastFailure = failure;
      this.saveDevice();
      this.emit();
      throw Object.assign(new Error(failure.title), { code: failure.code });
    }
  }

  async run(force: boolean): Promise<RunSummary> {
    if (this.running) throw Object.assign(new Error(t('main.err.syncBusy')), { key: 'busy', code: 'BUSY' });
    this.running = true;
    this.state = 'syncing';
    this.device.lastAttempt = Date.now();
    this.saveDevice();
    this.emit();
    try {
      const r = await this.call<RunSummary>({ method: 'run', params: { force } });
      if (r.failed === 0) this.device.lastSync = Date.now();
      this.device.confirmedFirst = true;
      this.device.lastFailure = r.failed > 0 ? syncFailureFor({ code: 'partial' }) : null;
      this.saveDevice();
      this.conflicts = r.conflictPaths;
      this.state = r.failed > 0 ? 'error' : 'idle';
      this.message = r.failed > 0 ? t('main.sync.failedCount', { n: r.failed }) : null;
      return r;
    } catch (e) {
      const err = e as Error & { kind?: string; key?: string; code?: string; status?: number; reason?: string };
      this.state = err.kind === 'auth' ? 'needsAuth' : err.kind === 'offline' ? 'offline' : (err as { key?: string }).key === 'blocked' || err.kind === 'blocked' ? 'blocked' : 'error';
      const failure = syncFailureFor(err);
      this.message = this.state === 'blocked' ? err.message : failure.title;
      this.device.lastFailure = failure;
      this.saveDevice();
      if (err.kind === 'auth') this.o.credentials.clearTokens();
      throw Object.assign(new Error(this.message), { kind: err.kind, code: failure.code });
    } finally {
      this.running = false;
      this.emit();
    }
  }

  // ── 진단 ──────────────────────────────────────────────────────
  private emptyFolder(): SyncDiagnostics['folder'] {
    return { name: this.name, path: this.name === '' ? 'Nopsidian' : `Nopsidian/${this.name}`, id: null, exists: false, checkedAt: null };
  }

  private diagnosticsBase(client: EffectiveClient | null): SyncDiagnostics {
    return {
      clientIdSuffix: client === null ? null : credentialSuffix(client.clientId),
      hasClientSecret: client?.clientSecret !== undefined && client.clientSecret !== '',
      accountEmail: this.device.lastAccountEmail,
      tokenExpiresAt: client?.tokens?.expiresAt ?? null,
      tokenValid: client?.tokens !== undefined && client.tokens.expiresAt > Date.now(),
      lastRefreshFailure: localizedFailure(this.device.lastRefreshFailure),
      pendingChanges: null,
      folder: this.device.lastFolder ?? this.emptyFolder(),
      lastFailure: localizedFailure(this.device.lastFailure),
    };
  }

  /** 네트워크 없이 저장된 값 + 로컬 스캔만. 연결 전이거나 스캔이 실패해도 화면은 열린다. */
  async diagnostics(): Promise<SyncDiagnostics> {
    const client = this.effectiveClient();
    const base = this.diagnosticsBase(client);
    if (!this.root || client?.tokens === undefined) return base;
    try {
      const r = await this.call<DiagnosticsSummary>({ method: 'diagnose', params: { remote: false } });
      return { ...base, pendingChanges: r.pendingChanges, tokenExpiresAt: r.tokenExpiresAt };
    } catch {
      return base;
    }
  }

  /**
   * '지금 확인' — 토큰 갱신과 Drive 폴더 읽기만 한다.
   * 업로드·다운로드·삭제·폴더 생성은 하지 않으며, 실패해도 예외 대신 마지막 실패를 담아 돌려준다.
   */
  async check(): Promise<SyncDiagnostics> {
    const client = this.effectiveClient();
    let base = this.diagnosticsBase(client);
    if (!this.root || client?.tokens === undefined) {
      const failure = syncFailureFor({ code: 'notConnected' });
      this.device.lastFailure = failure;
      this.saveDevice();
      return { ...base, lastFailure: failure, tokenValid: false };
    }
    try {
      const r = await this.call<DiagnosticsSummary>({ method: 'diagnose', params: { remote: true } });
      if (r.folder === null) throw new Error(t('main.sync.folderUnverified'));
      const folder: SyncDiagnostics['folder'] = { ...r.folder, checkedAt: r.checkedAt };
      this.device.lastFolder = folder;
      this.device.lastAccountEmail = r.accountEmail === null ? this.device.lastAccountEmail : maskEmail(r.accountEmail);
      // 첫 동기화 전에는 폴더가 없는 게 정상이다. 이미 동기화한 볼트에서만 실패로 기록한다.
      if (!folder.exists && this.device.confirmedFirst) {
        this.device.lastFailure = syncFailureFor({ code: 'folderMissing' }, r.checkedAt);
      } else if (folder.exists && this.device.lastFailure !== null) {
        // 연결·인증 문제는 이번 확인이 성공했으므로 지운다. 파일 동기화 실패(PARTIAL 등)는 남긴다.
        const code = this.device.lastFailure.code;
        const cleared = new Set([
          'FOLDER_MISSING',
          'NETWORK',
          'HTTP 401',
          'invalid_grant',
          'HTTP 403 · accessNotConfigured',
          'HTTP 403 · storageQuotaExceeded',
          'HTTP 429/403 · rateLimitExceeded',
        ]);
        if (cleared.has(code) || /^HTTP 5\d\d$/.test(code)) this.device.lastFailure = null;
      }
      this.saveDevice();
      base = this.diagnosticsBase(client);
      return {
        ...base,
        pendingChanges: r.pendingChanges,
        tokenExpiresAt: r.tokenExpiresAt,
        tokenValid: r.tokenExpiresAt > Date.now(),
        folder,
        lastFailure: localizedFailure(this.device.lastFailure),
      };
    } catch (e) {
      const key = failureKey(e as FailureLike);
      // 동기화 중이라 확인만 못한 경우는 '실패'가 아니다. 화면에는 알리고 기록은 남기지 않는다.
      if (key === 'busy') throw Object.assign(new Error(t('main.err.syncBusyRun')), { key: 'busy', code: 'BUSY' });
      const failure = syncFailureFor(key === 'auth' ? { key: 'authCheck', code: 'HTTP 401' } : (e as FailureLike));
      this.device.lastFailure = failure;
      // refresh token 이 invalid_grant 로 확실히 거부된 경우에만 로그아웃한다.
      const revoked = key === 'authRevoked';
      if (revoked) {
        this.o.credentials.clearTokens();
        this.device.lastAccountEmail = null;
      }
      this.saveDevice();
      if (revoked) {
        this.emit();
        base = this.diagnosticsBase(this.effectiveClient());
      }
      return {
        ...base,
        lastFailure: failure,
        tokenValid: key === 'auth' || revoked ? false : base.tokenValid,
      };
    }
  }

  // ── 워커 ──────────────────────────────────────────────────────
  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const client = this.effectiveClient();
    if (!this.root || client?.tokens === undefined) throw Object.assign(new Error(t('main.sync.notConnected')), { kind: 'auth', key: 'notConnected' });
    const data: SyncWorkerData = {
      root: this.root,
      vaultKey: vaultKeyFor(this.name),
      vaultName: this.name,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      tokens: client.tokens,
    };
    const tokenClientId = client.clientId;
    const w = new Worker(this.o.workerFile, { workerData: { ...data, locale: getLocale() } });
    w.on('message', (m: SyncResponse) => {
      if (m.type === 'response') {
        const call = this.calls.get(m.id);
        if (!call) return;
        this.calls.delete(m.id);
        if ('error' in m) call.reject(Object.assign(new Error(m.error), { kind: m.kind, key: m.key, code: m.code, status: m.status, reason: m.reason }));
        else call.resolve(m.result as never);
      } else if (m.type === 'tokenError') {
        this.device.lastRefreshFailure = syncFailureFor({ key: m.key, code: m.code, kind: m.kind, status: m.status, reason: m.reason, message: m.error }, m.at);
        this.saveDevice();
      } else if (m.type === 'tokens') {
        this.device.lastRefreshFailure = null;
        this.saveDevice();
        const cur = this.o.credentials.load();
        this.o.credentials.save({ ...(cur ?? {}), tokens: m.tokens, tokenClientId });
      } else if (m.type === 'fatal') {
        this.failAll(new Error(m.error));
      }
    });
    w.on('error', (e) => {
      this.failAll(e);
      this.worker = null;
    });
    w.on('exit', () => {
      this.worker = null;
    });
    this.worker = w;
    return w;
  }

  private failAll(e: Error) {
    for (const [, c] of this.calls) c.reject(e);
    this.calls.clear();
  }

  private call<T>(req: { method: 'plan' } | { method: 'run'; params: { force: boolean } } | { method: 'diagnose'; params: { remote: boolean } }): Promise<T> {
    const w = this.ensureWorker();
    const id = randomUUID();
    return new Promise<T>((resolve, reject) => {
      this.calls.set(id, { resolve: resolve as (v: never) => void, reject });
      w.postMessage({ ...req, id });
    });
  }

  private async stopWorker() {
    const w = this.worker;
    this.worker = null;
    this.failAll(new Error(t('main.sync.aborted')));
    if (w) await w.terminate();
  }
}
