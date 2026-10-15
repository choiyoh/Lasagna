/// <reference lib="webworker" />
import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';

/** 메인 스레드를 막지 않도록 ForceAtlas2를 워커에서 돌린다. */
export interface Forces {
  gravity: number;
  repulsion: number;
  linkDistance: number;
}
export type LayoutIn =
  | { type: 'init'; ids: string[]; positions: Float32Array; edges: Uint32Array; forces: Forces; /** 거의 모든 위치를 저장된 배치에서 가져왔으면 조금만 다듬는다 */ warm?: boolean }
  | { type: 'forces'; forces: Forces }
  | { type: 'stop' };
export type LayoutOut = { type: 'positions'; positions: Float32Array; done: boolean };

const MAX_ITERATIONS = 700;
const CHUNK = 4;
/** 처음 배치를 화면에 내보내기 전에 미리 돌리는 한도 */
const WARMUP_ITERATIONS = 160;
const WARMUP_MS = 400;

let graph: Graph | null = null;
let forces: Forces = { gravity: 0.3, repulsion: 0.3, linkDistance: 0.5 };
let ids: string[] = [];
let iterations = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

function settings() {
  const n = graph?.order ?? 0;
  return {
    gravity: 0.05 + forces.gravity * 3,
    scalingRatio: 1 + forces.repulsion * 30,
    edgeWeightInfluence: 1,
    barnesHutOptimize: n > 300,
    // 시간이 지날수록 움직임을 식혀(slowDown 증가) 마지막에는 떨림 없이 가라앉게 한다
    slowDown: (1 + Math.log(n + 1)) * (1 + (iterations / MAX_ITERATIONS) * 3),
    adjustSizes: false,
  };
}

function applyEdgeWeights() {
  // 링크 거리가 길수록 당기는 힘(가중치)을 약하게 한다.
  const w = 2.2 - forces.linkDistance * 2;
  graph?.forEachEdge((e) => graph!.setEdgeAttribute(e, 'weight', w));
}

function post(done: boolean) {
  if (!graph) return;
  const out = new Float32Array(ids.length * 2);
  ids.forEach((id, i) => {
    out[i * 2] = graph!.getNodeAttribute(id, 'x') as number;
    out[i * 2 + 1] = graph!.getNodeAttribute(id, 'y') as number;
  });
  (self as unknown as Worker).postMessage({ type: 'positions', positions: out, done } satisfies LayoutOut, [out.buffer]);
}

function tick() {
  if (!graph) return;
  forceAtlas2.assign(graph, { iterations: CHUNK, settings: settings() });
  iterations += CHUNK;
  const done = iterations >= MAX_ITERATIONS;
  post(done);
  if (!done) timer = setTimeout(tick, 16);
}

function restart() {
  clearTimeout(timer);
  iterations = Math.min(iterations, MAX_ITERATIONS - 300);
  applyEdgeWeights();
  tick();
}

self.onmessage = (ev: MessageEvent<LayoutIn>) => {
  const msg = ev.data;
  if (msg.type === 'stop') {
    clearTimeout(timer);
    graph = null;
    return;
  }
  if (msg.type === 'forces') {
    forces = msg.forces;
    return restart();
  }
  clearTimeout(timer);
  ids = msg.ids;
  forces = msg.forces;
  graph = new Graph({ type: 'directed', multi: false });
  ids.forEach((id, i) => graph!.addNode(id, { x: msg.positions[i * 2], y: msg.positions[i * 2 + 1] }));
  for (let i = 0; i < msg.edges.length; i += 2) {
    const a = ids[msg.edges[i]!]!;
    const b = ids[msg.edges[i + 1]!]!;
    if (a !== b && !graph.hasEdge(a, b)) graph.addEdge(a, b);
  }
  iterations = msg.warm ? MAX_ITERATIONS - 120 : 0;
  applyEdgeWeights();
  // 처음 배치는 화면에 보이기 전에 미리 돌려 둔다(가장 격렬한 초반 움직임을 보여 주지 않으려고)
  if (!msg.warm) {
    const t0 = performance.now();
    while (iterations < WARMUP_ITERATIONS && performance.now() - t0 < WARMUP_MS) {
      forceAtlas2.assign(graph, { iterations: CHUNK, settings: settings() });
      iterations += CHUNK;
    }
  }
  tick();
};
