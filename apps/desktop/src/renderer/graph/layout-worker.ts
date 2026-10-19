/// <reference lib="webworker" />
import { LayoutRunner, type Forces } from './layout-core';

export type { Forces } from './layout-core';

/** 메인 스레드를 막지 않도록 ForceAtlas2를 워커에서 돌린다. 정해진 반복 수를 채우면 멈춘다. */
export type LayoutIn =
  | {
      type: 'init';
      ids: string[];
      positions: Float32Array;
      edges: Uint32Array;
      forces: Forces;
      /** 거의 모든 위치를 저장된 배치에서 가져왔으면 조금만 다듬는다 */
      warm?: boolean;
      /** 1 인 노드는 움직이지 않는다(연결이 그대로인 기존 노드) */
      fixed?: Uint8Array;
    }
  | { type: 'forces'; forces: Forces }
  | { type: 'stop' };
export type LayoutOut = { type: 'positions'; positions: Float32Array; done: boolean };

/** 처음 배치를 화면에 내보내기 전에 미리 돌리는 한도 */
const WARMUP_ITERATIONS = 160;
const WARMUP_MS = 400;

let runner: LayoutRunner | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

function post() {
  if (!runner) return;
  const positions = runner.positions();
  (self as unknown as Worker).postMessage({ type: 'positions', positions, done: runner.done } satisfies LayoutOut, [positions.buffer]);
}

function tick() {
  if (!runner) return;
  runner.step();
  post();
  if (!runner.done) timer = setTimeout(tick, 16);
}

self.onmessage = (ev: MessageEvent<LayoutIn>) => {
  const msg = ev.data;
  clearTimeout(timer);
  if (msg.type === 'stop') {
    runner = null;
    return;
  }
  if (msg.type === 'forces') {
    if (!runner) return;
    runner.setForces(msg.forces);
    return tick();
  }
  runner = new LayoutRunner(msg);
  // 처음 배치는 화면에 보이기 전에 미리 돌려 둔다(가장 격렬한 초반 움직임을 보여 주지 않으려고)
  if (!msg.warm) {
    const t0 = performance.now();
    while (runner.iterations < WARMUP_ITERATIONS && performance.now() - t0 < WARMUP_MS) runner.step();
  }
  if (runner.done) return post(); // 다듬을 것이 없다(모두 고정) — 한 번 알리고 끝
  tick();
};
