import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { Hit, NoteRow } from '../workers/index/indexer';
import type { WorkerEvent, WorkerResponse } from '../workers/index/protocol';

type Listener = (e: WorkerEvent) => void;

/** IndexWorker와의 요청/응답 RPC. SQLite 연결은 워커만 가진다. */
export class IndexClient {
  private worker: Worker;
  private calls = new Map<string, { resolve: (v: never) => void; reject: (e: Error) => void }>();
  readonly ready: Promise<void>;

  constructor(
    root: string,
    onEvent: Listener,
  ) {
    this.worker = new Worker(path.join(__dirname, 'index-worker.cjs'), { workerData: { root } });
    this.ready = new Promise((resolve, reject) => {
      this.worker.on('message', (m: WorkerResponse | WorkerEvent) => {
        if (m.type === 'ready') resolve();
        else if (m.type === 'fatal') reject(new Error(m.error));
        else if (m.type === 'event') onEvent(m);
        else if (m.type === 'response') {
          const call = this.calls.get(m.id);
          if (!call) return;
          this.calls.delete(m.id);
          if ('error' in m) call.reject(new Error(m.error));
          else call.resolve(m.result as never);
        }
      });
      this.worker.on('error', reject);
    });
    // ready 전에 호출돼도 스캔이 끝난 뒤 처리되도록 호출자가 await ready 한다.
    this.ready.catch(() => undefined);
  }

  private call<T>(method: string, params?: unknown): Promise<T> {
    const id = randomUUID();
    return new Promise<T>((resolve, reject) => {
      this.calls.set(id, { resolve: resolve as (v: never) => void, reject });
      this.worker.postMessage({ id, method, params });
    });
  }

  list() {
    return this.call<NoteRow[]>('list');
  }
  assets() {
    return this.call<{ path: string; size: number }[]>('assets');
  }
  search(q: string, limit: number) {
    return this.call<Hit[]>('search', { q, limit });
  }
  async close() {
    await this.call('close').catch(() => undefined);
    await this.worker.terminate();
  }
}
