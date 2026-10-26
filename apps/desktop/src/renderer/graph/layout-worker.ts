/// <reference lib="webworker" />
import { LayoutRunner, coldBudgetMs, type Forces } from './layout-core';

export type { Forces } from './layout-core';

/** 메인 스레드를 막지 않도록 ForceAtlas2를 워커에서 돌린다. */
export type LayoutIn =
  | {
      type: 'init';
      ids: string[];
      positions: Float32Array;
      edges: Uint32Array;
      forces: Forces;
      /** 거의 모든 위치를 저장된 배치에서 가져왔으면 조금만 다듬는다 */
      warm?: boolean;
      /** 아직 도는 중이던 배치를 이어받는다(고정 없이, 이미 어느 정도 자리 잡은 상태에서 식히며 마무리) */
      resume?: boolean;
      /** 1 인 노드는 움직이지 않는다(연결이 그대로인 기존 노드) */
      fixed?: Uint8Array;
    }
  | { type: 'forces'; forces: Forces }
  | { type: 'stop' };
export type LayoutOut = { type: 'positions'; positions: Float32Array; done: boolean; busy: boolean; settled: boolean };

/**
 * 첫 페인트 전에 계산해 두는 시간은 노드 수로 정한다(layout-core 의 coldBudgetMs).
 * 이 안에 수렴하면 화면에는 **완성된 배치 한 장만** 보인다 — 예전에는 700회를 2.8초에 나눠 보여 줘서
 * 진입할 때마다 2초 넘게 흔들렸다. 넘으면 그 시점 배치로 먼저 그리고 아래 FINISH_MS 만큼만 더 다듬는다.
 */
/** 예산을 넘긴 큰 볼트의 마지막 다듬기(화면에서 움직이는 시간) */
const FINISH_MS = 400;

let runner: LayoutRunner | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
/** 0 이 아니면 이 시각까지만 화면 갱신을 이어 간다(예산 초과 볼트) */
let finishUntil = 0;

function post(busy: boolean) {
  if (!runner) return;
  const positions = runner.positions();
  (self as unknown as Worker).postMessage({ type: 'positions', positions, done: runner.done, busy, settled: runner.settled } satisfies LayoutOut, [positions.buffer]);
}

function tick() {
  timer = undefined;
  if (!runner) return;
  // 시간 예산이 끝났으면 마지막 자리로 멈추고 "배치 중"을 닫는다(문구가 남은 채 멈추지 않게)
  if (finishUntil && performance.now() >= finishUntil) {
    finishUntil = 0;
    post(false);
    return;
  }
  runner.step();
  post(!runner.done);
  if (runner.done) return;
  timer = setTimeout(tick, 16);
}

self.onmessage = (ev: MessageEvent<LayoutIn>) => {
  const msg = ev.data;
  clearTimeout(timer);
  timer = undefined;
  if (msg.type === 'stop') {
    runner = null;
    finishUntil = 0;
    return;
  }
  if (msg.type === 'forces') {
    if (!runner) return;
    runner.setForces(msg.forces);
    finishUntil = 0;
    return tick();
  }
  runner = new LayoutRunner(msg);
  finishUntil = 0;
  // 첫 페인트 전에 끝까지(또는 시간 예산까지) 계산한다. warm/resume 은 원래 횟수가 작아 바로 끝난다.
  const t0 = performance.now();
  const budget = runner.isCold ? coldBudgetMs(msg.ids.length) : Infinity;
  while (!runner.done && performance.now() - t0 < budget) runner.step();
  post(!runner.done);
  if (!runner.done) {
    finishUntil = performance.now() + FINISH_MS;
    timer = setTimeout(tick, 16);
  }
};
