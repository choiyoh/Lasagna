import { getLocale, t, type Locale } from '@nopsidian/i18n';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { Hit, NoteRow } from '../workers/index/indexer';
import type { IndexQuery, WorkerEvent, WorkerResponse } from '../workers/index/protocol';

type Listener = (e: WorkerEvent) => void;

/** 워커가 멈췄을 때 대기 중인 호출에 주는 오류 */
const WORKER_DOWN = 'main.index.workerDown';
/** 재시작 한도를 넘겼을 때 */
const GAVE_UP = 'main.index.gaveUp';
/** 우리가 닫는 중이라 더는 응답을 받을 수 없을 때 */
const CLOSED = 'main.index.closed';
/** 60초 안에 이만큼 넘게 멈추면 재시작을 포기한다 */
const MAX_RESTARTS = 3;
const RESTART_WINDOW_MS = 60_000;
/** 닫을 때 워커의 응답을 기다리는 최대 시간 */
const CLOSE_TIMEOUT_MS = 3_000;

/** 테스트에서 가짜 워커를 끼워 넣기 위한 최소 표면(`node:worker_threads` 의 Worker 가 이걸 만족한다) */
export interface WorkerLike {
  on(event: 'message', listener: (m: WorkerResponse | WorkerEvent) => void): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
  on(event: 'exit', listener: (code: number) => void): unknown;
  postMessage(message: unknown): void;
  terminate(): Promise<unknown> | void;
}

interface PendingCall {
  req: { id: string; method: string; params?: unknown };
  resolve: (v: never) => void;
  reject: (e: Error) => void;
}

/** IndexWorker와의 요청/응답 RPC. SQLite 연결은 워커만 가진다. */
export class IndexClient {
  private worker!: WorkerLike;
  private calls = new Map<string, PendingCall>();
  /** 재시작 중이라 아직 못 보낸 호출 — 새 워커가 ready 하면 한꺼번에 보낸다 */
  private waiting = new Set<string>();
  private readyPromise: Promise<void> = Promise.resolve();
  private rejectReady: ((e: Error) => void) | undefined;
  private createWorker: (locale: Locale) => WorkerLike;
  /** 워커가 문구를 만들 때 쓰는 언어(시작 시 넘기고, 앱 언어가 바뀌면 함께 알린다) */
  private locale: Locale = getLocale();
  private restarting = false;
  private gaveUp = false;
  private closed = false;
  /** 최근 재시작 시각 — `RESTART_WINDOW_MS` 안에 `MAX_RESTARTS` 를 넘으면 포기한다 */
  private restarts: number[] = [];
  /** 현재 워커의 exit 약속 — close 가 terminate 전에 정상 종료를 기다린다 */
  private workerExit: Promise<void> = Promise.resolve();

  constructor(
    root: string,
    private readonly onEvent: Listener,
    createWorker?: (locale: Locale) => WorkerLike,
  ) {
    this.createWorker =
      createWorker ??
      (() =>
        new Worker(path.join(__dirname, 'index-worker.cjs'), {
          // 워커는 별도 스레드라 자기 i18n 상태가 있다 — 시작 언어를 넘긴다(sync 워커와 같은 방식).
          workerData: { root, locale: getLocale() },
          // 파싱은 일회용 파서 스레드가 맡는다. 색인 스레드의 힙 한도는 쓰레기가 끝없이 쌓이지 않게 하는 안전장치(큰 노트 하나는 수 MB)
          resourceLimits: { maxOldGenerationSizeMb: 256 },
        }));
    this.spawn();
  }

  /** 지금 워커의 준비 상태. 재시작하면 새 워커의 것으로 바뀐다(호출할 때마다 `await index.ready`). */
  get ready(): Promise<void> {
    return this.readyPromise;
  }

  /** 앱 언어가 바뀌면 워커에도 알린다(다음 문구부터 새 언어). */
  setLocale(locale: Locale): void {
    this.locale = locale;
    try {
      this.worker?.postMessage({ id: randomUUID(), method: 'setLocale', params: { locale } });
    } catch {
      // 워커가 이미 죽었으면 다음 spawn 이 새 언어로 뜬다
    }
  }

  /** 워커를 띄우고 이 워커의 ready 약속으로 갈아 끼운다. */
  private spawn() {
    const worker = this.createWorker(this.locale);
    this.worker = worker;
    let resolveReady!: () => void;
    let rejectReady!: (e: Error) => void;
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    ready.catch(() => undefined); // 아무도 안 기다릴 때 처리되지 않은 거부가 되지 않게
    this.readyPromise = ready;
    this.rejectReady = rejectReady;
    this.workerExit = new Promise<void>((resolve) => worker.on('exit', () => resolve()));

    worker.on('message', (m) => {
      if (worker !== this.worker) return; // 이미 갈아 끼운 워커가 늦게 보낸 메시지는 무시
      if (m.type === 'ready') {
        this.restarting = false;
        resolveReady();
        this.flushWaiting();
      } else if (m.type === 'fatal') {
        this.restarting = false;
        rejectReady(new Error(m.error));
        // 재시작을 기다리던 호출은 보낼 곳이 없다 — 영원히 기다리지 않게 거부한다
        for (const id of [...this.waiting]) this.fail(id, new Error(m.error));
      } else if (m.type === 'event') this.onEvent(m);
      else if (m.type === 'response') {
        const call = this.calls.get(m.id);
        if (!call) return;
        this.calls.delete(m.id);
        if ('error' in m) call.reject(new Error(m.error));
        else call.resolve(m.result as never);
      }
    });
    worker.on('error', (err) => this.handleDeath(worker, err));
    worker.on('exit', (code) => this.handleDeath(worker, new Error(t('main.index.workerExit', { code }))));
  }

  /** 워커가 죽었다: 보낸 요청을 거부하고 새 워커로 다시 시작한다(닫는 중이면 아무것도 안 한다). */
  private handleDeath(worker: WorkerLike, err: Error) {
    if (worker !== this.worker || this.closed || this.gaveUp) return;
    this.rejectReady?.(new Error(t(WORKER_DOWN)));
    this.failSent(new Error(t(WORKER_DOWN)));
    this.restart(err);
  }

  private restart(err: Error) {
    const now = Date.now();
    this.restarts = this.restarts.filter((t) => now - t < RESTART_WINDOW_MS);
    if (this.restarts.length >= MAX_RESTARTS) {
      this.giveUp(err.message);
      return;
    }
    this.restarts.push(now);
    console.warn(`[index] ${t('main.index.restart', { n: this.restarts.length, max: MAX_RESTARTS, message: err.message })}`);
    this.restarting = true;
    try {
      this.spawn();
    } catch (e) {
      this.giveUp(e instanceof Error ? e.message : String(e));
    }
  }

  /** 더는 재시작하지 않는다: 준비 약속과 대기 중인 호출을 모두 거부한다. */
  private giveUp(reason: string) {
    this.gaveUp = true;
    this.restarting = false;
    console.warn(`[index] ${t(GAVE_UP)}: ${reason}`);
    this.readyPromise = Promise.reject(new Error(t(GAVE_UP)));
    this.readyPromise.catch(() => undefined);
    this.failAll(new Error(t(GAVE_UP)));
  }

  private call<T>(method: string, params?: unknown): Promise<T> {
    const id = randomUUID();
    const req = { id, method, params };
    return new Promise<T>((resolve, reject) => {
      this.calls.set(id, { req, resolve: resolve as (v: never) => void, reject });
      this.send(req);
    });
  }

  /** 재시작 중에 만든 호출은 새 워커가 ready 한 뒤에 보낸다 — 잃거나 거부하지 않는다. */
  private send(req: { id: string; method: string; params?: unknown }) {
    if (this.closed) return this.post(req); // 닫는 중: 종료 요청은 곧바로 보낸다
    if (this.gaveUp) return this.fail(req.id, new Error(t(GAVE_UP)));
    if (this.restarting) {
      this.waiting.add(req.id);
      return;
    }
    this.post(req);
  }

  private post(req: { id: string; method: string; params?: unknown }) {
    try {
      this.worker.postMessage(req);
    } catch (e) {
      this.fail(req.id, e instanceof Error ? e : new Error(String(e)));
    }
  }

  private flushWaiting() {
    for (const id of this.waiting) {
      const call = this.calls.get(id);
      if (call) this.post(call.req);
    }
    this.waiting.clear();
  }

  private fail(id: string, e: Error) {
    const call = this.calls.get(id);
    if (!call) return;
    this.calls.delete(id);
    this.waiting.delete(id);
    call.reject(e);
  }

  /** 이미 보낸 요청만 거부한다 — 재시작을 기다리는 요청은 새 워커가 ready 하면 보낸다. */
  private failSent(e: Error) {
    for (const [id, call] of this.calls) {
      if (this.waiting.has(id)) continue;
      this.calls.delete(id);
      call.reject(e);
    }
  }

  private failAll(e: Error) {
    for (const [, call] of this.calls) call.reject(e);
    this.calls.clear();
    this.waiting.clear();
  }

  list() {
    return this.call<NoteRow[]>('list');
  }
  /** 읽기 전용 인덱스 질의를 워커에서 실행한다 */
  query<T>(name: IndexQuery, ...args: unknown[]) {
    return this.call<T>('query', { name, args });
  }
  assets() {
    return this.call<{ path: string; size: number }[]>('assets');
  }
  search(q: string, limit: number) {
    return this.call<Hit[]>('search', { q, limit });
  }
  async close() {
    this.closed = true;
    this.failAll(new Error(t(CLOSED)));
    if (!this.gaveUp) {
      // 워커가 이미 죽었으면 응답이 오지 않는다 — 잠깐만 기다리고 강제로 끝낸다
      let timer: ReturnType<typeof setTimeout> | undefined;
      let responded = false;
      await Promise.race([
        this.call('close').then(() => {
          responded = true;
        }).catch(() => undefined),
        new Promise<void>((resolve) => (timer = setTimeout(resolve, CLOSE_TIMEOUT_MS))),
      ]);
      clearTimeout(timer);
      // 워커가 close 응답(unsubscribe 완료)을 보낸 뒤 스스로 exit 할 시간을 준다.
      // 응답 전에 바로 terminate 하면 네이티브 구독 정리와 teardown 이 겹칠 수 있다.
      if (responded) {
        await Promise.race([this.workerExit, new Promise<void>((resolve) => setTimeout(resolve, 200))]);
      }
    }
    await this.worker.terminate();
  }
}
