import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { buildAuthUrl, createPkce, exchangeCode, randomState, startLoopback } from '@nopsidian/sync-gdrive';
import type { SyncStatus } from '@nopsidian/ipc-contract';
import type { PlanSummary, RunSummary, SyncResponse, SyncWorkerData } from '../workers/sync/protocol';

type Tokens = SyncWorkerData['tokens'];

/** OS 키체인으로 문자열을 암호화/복호화한다(Electron safeStorage 를 감싼다 — 테스트에서 주입). */
export interface SecretBox {
  available(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(data: Buffer): string;
}

interface Credentials {
  clientId: string;
  clientSecret?: string;
  tokens?: Tokens;
}

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
    if (!this.box.available()) throw new Error('OS 키체인을 쓸 수 없어 로그인 정보를 안전하게 저장할 수 없어요');
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify({ enc: this.box.encrypt(JSON.stringify(c)).toString('base64') }), { mode: 0o600 });
  }

  clearTokens(): void {
    const c = this.load();
    if (c) this.save({ clientId: c.clientId, clientSecret: c.clientSecret });
  }
}

interface DeviceSettings {
  enabled: boolean;
  /** 첫 동기화 계획을 사용자가 확인하고 한 번 실행했는지 — 그 전에는 자동 동기화를 하지 않는다 */
  confirmedFirst: boolean;
  lastSync: number | null;
}

/** 볼트 이름으로 정한 식별자 — 두 기기에서 같은 이름의 볼트를 열면 같은 Drive 폴더를 쓴다. */
export const vaultKeyFor = (name: string) => createHash('sha256').update(`nopsidian:vault:${name.normalize('NFC')}`).digest('hex').slice(0, 16);

export interface SyncControllerOptions {
  credentials: CredentialStore;
  workerFile: string;
  openExternal: (url: string) => void;
  broadcast: (status: SyncStatus) => void;
  /** 주기·디바운스(테스트에서 줄인다) */
  intervalMs?: number;
  debounceMs?: number;
  fetch?: typeof fetch;
}

export class SyncController {
  private root: string | null = null;
  private name = '';
  private device: DeviceSettings = { enabled: false, confirmedFirst: false, lastSync: null };
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

  private get deviceFile() {
    return path.join(this.root!, '.nopsidian', 'sync', 'device.json');
  }

  status(): SyncStatus {
    const c = this.o.credentials.load();
    const connected = !!c?.tokens;
    const enabled = !!this.root && this.device.enabled;
    return {
      configured: !!c?.clientId,
      connected,
      enabled,
      confirmedFirst: this.device.confirmedFirst,
      state: !enabled ? 'off' : !connected ? 'needsAuth' : this.state === 'off' ? 'idle' : this.state,
      lastSync: this.device.lastSync,
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
      this.device = { ...this.device, ...(JSON.parse(readFileSync(this.deviceFile, 'utf8')) as Partial<DeviceSettings>) };
    } catch {
      this.device = { enabled: false, confirmedFirst: false, lastSync: null };
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
    this.o.credentials.save({ clientId, clientSecret: clientSecret || undefined, tokens: prev?.clientId === clientId ? prev.tokens : undefined });
    void this.stopWorker();
    this.emit();
  }

  async connect(): Promise<SyncStatus> {
    const c = this.o.credentials.load();
    if (!c?.clientId) throw new Error('먼저 Google 클라이언트 ID를 입력해 주세요');
    this.cancelConnect?.();
    const pkce = createPkce();
    const state = randomState();
    const loop = await startLoopback({ state });
    this.cancelConnect = loop.close;
    try {
      this.o.openExternal(buildAuthUrl({ clientId: c.clientId, redirectUri: loop.redirectUri, challenge: pkce.challenge, state }));
      const { code } = await loop.result;
      const tokens = await exchangeCode({
        clientId: c.clientId,
        clientSecret: c.clientSecret,
        fetch: this.o.fetch ?? fetch,
        code,
        verifier: pkce.verifier,
        redirectUri: loop.redirectUri,
      });
      if (!tokens.refreshToken) throw new Error('Google이 refresh token을 주지 않았어요. 클라이언트 유형이 "데스크톱 앱"인지 확인해 주세요');
      this.o.credentials.save({ ...c, tokens });
      await this.stopWorker();
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
    this.state = 'off';
    this.message = null;
    this.emit();
  }

  setEnabled(enabled: boolean): SyncStatus {
    if (!this.root) throw new Error('열린 볼트가 없어요');
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
    return this.call<PlanSummary>({ method: 'plan' });
  }

  async run(force: boolean): Promise<RunSummary> {
    if (this.running) throw new Error('이미 동기화 중이에요');
    this.running = true;
    this.state = 'syncing';
    this.emit();
    try {
      const r = await this.call<RunSummary>({ method: 'run', params: { force } });
      this.device.lastSync = Date.now();
      this.device.confirmedFirst = true;
      this.saveDevice();
      this.conflicts = r.conflictPaths;
      this.state = r.failed > 0 ? 'error' : 'idle';
      this.message = r.failed > 0 ? `${r.failed}개 파일을 동기화하지 못했어요` : null;
      return r;
    } catch (e) {
      const err = e as Error & { kind?: string };
      this.state = err.kind === 'auth' ? 'needsAuth' : err.kind === 'offline' ? 'offline' : /멈췄어요/.test(err.message) ? 'blocked' : 'error';
      this.message = err.message;
      if (err.kind === 'auth') this.o.credentials.clearTokens();
      throw e;
    } finally {
      this.running = false;
      this.emit();
    }
  }

  // ── 워커 ──────────────────────────────────────────────────────
  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const c = this.o.credentials.load();
    if (!this.root || !c?.tokens) throw Object.assign(new Error('Google 계정이 연결되지 않았어요'), { kind: 'auth' });
    const data: SyncWorkerData = {
      root: this.root,
      vaultKey: vaultKeyFor(this.name),
      vaultName: this.name,
      clientId: c.clientId,
      clientSecret: c.clientSecret,
      tokens: c.tokens,
    };
    const w = new Worker(this.o.workerFile, { workerData: data });
    w.on('message', (m: SyncResponse) => {
      if (m.type === 'tokens') {
        const cur = this.o.credentials.load();
        if (cur) this.o.credentials.save({ ...cur, tokens: m.tokens });
      } else if (m.type === 'response') {
        const call = this.calls.get(m.id);
        if (!call) return;
        this.calls.delete(m.id);
        if ('error' in m) call.reject(Object.assign(new Error(m.error), { kind: m.kind }));
        else call.resolve(m.result as never);
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

  private call<T>(req: { method: 'plan' } | { method: 'run'; params: { force: boolean } }): Promise<T> {
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
    this.failAll(new Error('동기화가 중단됐어요'));
    if (w) await w.terminate();
  }
}
