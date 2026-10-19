import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';

/** 힘 설정(슬라이더 값 0~1) */
export interface Forces {
  gravity: number;
  repulsion: number;
  linkDistance: number;
}

export const MAX_ITERATIONS = 700;
export const CHUNK = 4;
/** 거의 다 아는 배치를 다듬을 때 쓰는 반복 수 */
export const WARM_ITERATIONS = 120;

/**
 * ForceAtlas2 배치를 정해진 반복 수만큼만 돌린다(끝나면 멈춘다 — 끝없이 돌지 않는다).
 * 워커(layout-worker.ts)가 이걸 감싸고, 테스트는 워커 없이 직접 쓴다.
 */
export class LayoutRunner {
  graph: Graph;
  ids: string[];
  forces: Forces;
  iterations = 0;

  constructor(opts: { ids: string[]; positions: Float32Array; edges: Uint32Array; forces: Forces; warm?: boolean; fixed?: Uint8Array }) {
    this.ids = opts.ids;
    this.forces = opts.forces;
    this.graph = new Graph({ type: 'directed', multi: false });
    opts.ids.forEach((id, i) =>
      this.graph.addNode(id, { x: opts.positions[i * 2], y: opts.positions[i * 2 + 1], ...(opts.fixed?.[i] ? { fixed: true } : {}) }),
    );
    for (let i = 0; i < opts.edges.length; i += 2) {
      const a = opts.ids[opts.edges[i]!]!;
      const b = opts.ids[opts.edges[i + 1]!]!;
      if (a !== b && !this.graph.hasEdge(a, b)) this.graph.addEdge(a, b);
    }
    this.iterations = opts.warm ? MAX_ITERATIONS - WARM_ITERATIONS : 0;
    // 모든 노드가 고정이면 할 일이 없다 — 그대로 끝낸다(위치가 한 점도 바뀌지 않는다)
    if (opts.fixed && opts.ids.length > 0 && opts.fixed.every((f) => f === 1)) this.iterations = MAX_ITERATIONS;
    this.applyEdgeWeights();
  }

  get done(): boolean {
    return this.iterations >= MAX_ITERATIONS;
  }

  settings() {
    const n = this.graph.order;
    return {
      gravity: 0.05 + this.forces.gravity * 3,
      scalingRatio: 1 + this.forces.repulsion * 30,
      edgeWeightInfluence: 1,
      barnesHutOptimize: n > 300,
      // 시간이 지날수록 움직임을 식혀(slowDown 증가) 마지막에는 떨림 없이 가라앉게 한다
      slowDown: (1 + Math.log(n + 1)) * (1 + (this.iterations / MAX_ITERATIONS) * 3),
      adjustSizes: false,
    };
  }

  applyEdgeWeights() {
    // 링크 거리가 길수록 당기는 힘(가중치)을 약하게 한다.
    const w = 2.2 - this.forces.linkDistance * 2;
    this.graph.forEachEdge((e) => this.graph.setEdgeAttribute(e, 'weight', w));
  }

  /** 한 덩어리(CHUNK 반복) 돌린다. 이미 끝났으면 아무것도 안 한다. */
  step(): boolean {
    if (this.done) return true;
    forceAtlas2.assign(this.graph, { iterations: CHUNK, settings: this.settings() });
    this.iterations += CHUNK;
    return this.done;
  }

  /** 힘 슬라이더를 바꾸면 사용자가 다시 배치를 원하는 것이므로 고정을 풀고 일부를 다시 돈다. */
  setForces(forces: Forces) {
    this.forces = forces;
    this.graph.forEachNode((id) => this.graph.removeNodeAttribute(id, 'fixed'));
    this.iterations = Math.min(this.iterations, MAX_ITERATIONS - 300);
    this.applyEdgeWeights();
  }

  positions(): Float32Array {
    const out = new Float32Array(this.ids.length * 2);
    this.ids.forEach((id, i) => {
      out[i * 2] = this.graph.getNodeAttribute(id, 'x') as number;
      out[i * 2 + 1] = this.graph.getNodeAttribute(id, 'y') as number;
    });
    return out;
  }
}
