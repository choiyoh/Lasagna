import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerEvent, WorkerResponse } from '../workers/index/protocol';
import { IndexClient, type WorkerLike } from './index-client';

/** 테스트용 워커: 실제 스레드 대신 이벤트를 손으로 흘려보낸다 */
class FakeWorker extends EventEmitter implements WorkerLike {
  readonly posted: { id: string; method: string; params?: unknown }[] = [];
  terminated = false;

  postMessage(message: unknown) {
    this.posted.push(message as { id: string; method: string });
  }
  async terminate() {
    this.terminated = true;
    this.emit('exit', 0);
  }
  /** 워커가 준비됐다고 알린다 */
  ready() {
    this.emit('message', { type: 'ready' } satisfies WorkerResponse);
  }
  /** 요청 하나에 응답한다 */
  respond(id: string, result: unknown) {
    this.emit('message', { type: 'response', id, result } satisfies WorkerResponse);
  }
  /** 워커가 죽는다('error' → 'exit' 순서) */
  crash(message = 'worker died') {
    this.emit('error', new Error(message));
    this.emit('exit', 1);
  }
}

function makeClient() {
  const workers: FakeWorker[] = [];
  const events: WorkerEvent[] = [];
  const client = new IndexClient('/vault', (e) => events.push(e), () => {
    const w = new FakeWorker();
    workers.push(w);
    return w;
  });
  return { client, workers, events, current: () => workers[workers.length - 1] as FakeWorker };
}

describe('IndexClient', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => undefined));
  afterEach(() => vi.restoreAllMocks());

  it('워커가 죽으면 보낸 호출을 한국어 오류로 거부하고 새 워커로 다시 시작한다', async () => {
    const { client, workers, current } = makeClient();
    current().ready();
    await client.ready;
    const call = client.list();
    expect(current().posted).toHaveLength(1);

    current().crash('힙 한도 초과');
    await expect(call).rejects.toThrow('색인 작업이 멈춰 다시 시작하고 있어요');
    expect(workers).toHaveLength(2);
    expect(console.warn).toHaveBeenCalled();
  });

  it('error 이벤트만 와도 다시 시작한다', async () => {
    const { client, workers } = makeClient();
    workers[0].ready();
    await client.ready;
    const call = client.list();
    workers[0].emit('error', new Error('힙 한도 초과'));
    await expect(call).rejects.toThrow('색인 작업이 멈춰 다시 시작하고 있어요');
    expect(workers).toHaveLength(2);
  });

  it('재시작한 워커가 준비되면 그때 만든 호출이 새 워커에서 처리된다', async () => {
    const { client, workers } = makeClient();
    workers[0].ready();
    await client.ready;
    workers[0].crash();

    const call = client.list(); // 재시작 중에 만든 호출
    const fresh = workers[1];
    expect(fresh.posted).toHaveLength(0); // ready 전에는 보내지 않는다
    fresh.ready();
    expect(fresh.posted).toHaveLength(1);
    fresh.respond(fresh.posted[0].id, ['a.md']);
    await expect(call).resolves.toEqual(['a.md']);
  });

  it('새 워커도 ready 전에 죽으면 못 보낸 호출은 다음 워커로 넘어간다', async () => {
    const { client, workers } = makeClient();
    workers[0].ready();
    await client.ready;
    workers[0].crash();
    const call = client.list();
    workers[1].crash(); // 새 워커가 ready 전에 또 죽는다
    expect(workers).toHaveLength(3);

    workers[2].ready();
    expect(workers[2].posted).toHaveLength(1);
    workers[2].respond(workers[2].posted[0].id, []);
    await expect(call).resolves.toEqual([]);
  });

  it('재시작한 워커가 fatal 이면 기다리던 호출을 거부한다(영원히 기다리지 않는다)', async () => {
    const { client, workers } = makeClient();
    workers[0].ready();
    await client.ready;
    workers[0].crash();
    const call = client.list();
    workers[1].emit('message', { type: 'fatal', error: '색인 DB 를 열지 못했어요' } satisfies WorkerResponse);
    await expect(call).rejects.toThrow('색인 DB 를 열지 못했어요');
  });

  it('close() 는 죽은 워커의 응답을 끝없이 기다리지 않는다', async () => {
    vi.useFakeTimers();
    try {
      const { client, workers } = makeClient();
      workers[0].ready();
      const done = client.close(); // 가짜 워커는 close 에 응답하지 않는다
      await vi.advanceTimersByTimeAsync(3_000);
      await done;
      expect(workers[0].terminated).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ready 는 재시작하면 새 워커의 약속으로 바뀐다', async () => {
    const { client, workers } = makeClient();
    workers[0].ready();
    const first = client.ready;
    await first;
    workers[0].crash();

    const second = client.ready;
    expect(second).not.toBe(first);
    workers[1].ready();
    await expect(second).resolves.toBeUndefined();
  });

  it('60초 안에 재시작 한도를 넘으면 멈추고 호출을 거부한다', async () => {
    const { client, workers } = makeClient();
    for (let i = 0; i < 3; i++) {
      workers[i].ready();
      await client.ready;
      workers[i].crash();
    }
    expect(workers).toHaveLength(4); // 처음 + 3번 재시작
    workers[3].ready();
    workers[3].crash(); // 네 번째 실패 → 포기
    expect(workers).toHaveLength(4);
    await expect(client.list()).rejects.toThrow(/자동 재시작을 멈췄어요/);
  });

  it('close() 는 재시작하지 않고 워커를 정리한다', async () => {
    const { client, workers } = makeClient();
    workers[0].ready();
    await client.ready;

    const done = client.close();
    const closeReq = workers[0].posted.find((m) => m.method === 'close');
    expect(closeReq).toBeDefined();
    workers[0].respond(closeReq?.id ?? '', null);
    await done;

    expect(workers[0].terminated).toBe(true);
    expect(workers).toHaveLength(1); // exit 가 와도 재시작하지 않는다
  });

  it('close() 는 응답 뒤 워커가 스스로 exit 할 때까지 기다린다', async () => {
    const { client, workers } = makeClient();
    workers[0].ready();
    await client.ready;

    const done = client.close();
    workers[0].respond(workers[0].posted[0]!.id, null);
    await new Promise((r) => setTimeout(r, 20));
    expect(workers[0].terminated).toBe(false);
    workers[0].emit('exit', 0);
    await done;
    expect(workers[0].terminated).toBe(true);
  });

  it('close() 는 대기 중인 호출을 거부한다', async () => {
    const { client, workers } = makeClient();
    workers[0].ready();
    await client.ready;
    const call = client.list();
    const done = client.close();
    await expect(call).rejects.toThrow('색인을 닫았어요');
    workers[0].respond(workers[0].posted[1].id, null);
    await done;
  });

  it('워커 이벤트는 그대로 리스너로 전달한다', async () => {
    const { client, workers, events } = makeClient();
    workers[0].ready();
    await client.ready;
    workers[0].emit('message', { type: 'event', name: 'index.watchError', payload: { message: '감시 실패' } } satisfies WorkerEvent);
    expect(events).toEqual([{ type: 'event', name: 'index.watchError', payload: { message: '감시 실패' } }]);
  });
});
