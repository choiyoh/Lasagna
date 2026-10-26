import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import { stepMetrics } from './layout-metrics';

/** 힘 설정(슬라이더 값 0~1) */
export interface Forces {
  gravity: number;
  repulsion: number;
  linkDistance: number;
}

/**
 * 감쇠(에너지) 기준 반복 수. **정지 상한이 아니다** — 콜드 배치는 이동량이 bbox의 0.1% 미만이
 * 되는 순간 멈추고(COLD_MAX_ITERATIONS 는 안전 상한), 이 값은 alpha 를 식히는 시간축이다.
 * warm 은 이 지점에서 120회만 더 다듬는다.
 */
export const MAX_ITERATIONS = 700;
export const CHUNK = 4;
/** 거의 다 아는 배치를 다듬을 때 쓰는 반복 수 */
export const WARM_ITERATIONS = 120;
/** 도는 중이던 배치를 이어받을 때 남겨 두는 반복 수 */
export const RESUME_ITERATIONS = 400;
/** 콜드 배치를 수렴까지 돌릴 때의 상한(시간 예산은 워커가 따로 건다) */
export const COLD_MAX_ITERATIONS = 2600;
/** 이 비율(bbox 대비 이동량)보다 작으면 "가라앉았다"로 본다 — 리뷰 기준 0.1% */
export const CONVERGED_RATIO = 0.001;
/** 연속 두 덩어리가 조용해야 멈춘다(한 번의 우연한 정지로 끝내지 않는다) */
export const CONVERGED_CHUNKS = 2;
/** 첫 페인트 전에 계산해 두는 시간(노드 수 기반). 큰 볼트도 이 상한을 넘기지 않는다. */
export function coldBudgetMs(nodes: number): number {
  const n = Math.max(0, nodes);
  return Math.round(Math.min(1500, Math.max(600, 350 + n * 2.6)));
}

/**
 * 콜드 배치의 감쇠. 기본 감쇠(1~4배)로는 300 노드에서 wanderRatio 가 2.9 였고,
 * 14~182배로 식히면 1.35 로 내려간다(경로가 한 방향에 가까워진다). 화면에 보이지 않는 동안
 * 한 번에 끝내므로 느려도 사용자는 기다릴 뿐 흔들림을 보지 않는다.
 */
const COLD_DAMPING = 32;
const COLD_DAMPING_RAMP = 20;

/**
 * ForceAtlas2 배치를 정해진 반복 수만큼만 돌린다(끝나면 멈춘다 — 끝없이 돌지 않는다).
 * 콜드 배치는 수렴(bbox의 0.1% 미만 이동이 두 덩어리 연속)하면 상한 전에 멈춘다.
 * 워커(layout-worker.ts)가 이걸 감싸고, 테스트는 워커 없이 직접 쓴다.
 */
export class LayoutRunner {
  graph: Graph;
  ids: string[];
  forces: Forces;
  iterations = 0;
  /** 마지막 덩어리에서 가장 많이 움직인 거리 (콜드 배치에서만 갱신) */
  lastStep = 0;
  /**
   * 남은 에너지(1 → 0). d3-force 의 alpha 처럼 식으며, alpha 가 낮을수록 감쇠가 강해진다.
   * 종료는 반복 횟수가 아니라 이동량(bbox 대비)이 결정한다 — alpha 는 "얼마나 더 움직일 수 있는가"다.
   */
  alpha = 1;
  /** 마지막 덩어리의 이동량 / bbox (콜드 배치에서만 갱신) */
  lastStepRatio = 1;
  private cold: boolean;
  /** 이동량을 재는가(콜드·resume). warm 은 고정된 자리만 다듬으므로 잴 필요가 없다 */
  private track: boolean;
  private maxIterations: number;
  private quietChunks = 0;
  private before: Float32Array;
  private after: Float32Array;

  constructor(opts: { ids: string[]; positions: Float32Array; edges: Uint32Array; forces: Forces; warm?: boolean; resume?: boolean; fixed?: Uint8Array }) {
    this.ids = opts.ids;
    this.forces = opts.forces;
    // 화면 밖에서 처음부터 끝까지 계산하는 콜드 배치만 수렴 판정을 쓴다.
    // warm/resume 은 "몇 회만 다듬는다"는 기존 계약을 지킨다.
    this.cold = !opts.warm && !opts.resume;
    this.track = this.cold || !!opts.resume;
    this.maxIterations = this.cold ? COLD_MAX_ITERATIONS : MAX_ITERATIONS;
    this.before = new Float32Array(opts.ids.length * 2);
    this.after = new Float32Array(opts.ids.length * 2);
    this.graph = new Graph({ type: 'directed', multi: false });
    opts.ids.forEach((id, i) =>
      this.graph.addNode(id, { x: opts.positions[i * 2], y: opts.positions[i * 2 + 1], ...(opts.fixed?.[i] ? { fixed: true } : {}) }),
    );
    for (let i = 0; i < opts.edges.length; i += 2) {
      const a = opts.ids[opts.edges[i]!]!;
      const b = opts.ids[opts.edges[i + 1]!]!;
      if (a !== b && !this.graph.hasEdge(a, b)) this.graph.addEdge(a, b);
    }
    this.iterations = opts.warm ? MAX_ITERATIONS - WARM_ITERATIONS : opts.resume ? MAX_ITERATIONS - RESUME_ITERATIONS : 0;
    // 모든 노드가 고정이면 할 일이 없다 — 그대로 끝낸다(위치가 한 점도 바뀌지 않는다)
    if (opts.fixed && opts.ids.length > 0 && opts.fixed.every((f) => f === 1)) this.iterations = this.maxIterations;
    this.applyEdgeWeights();
  }

  get done(): boolean {
    return this.iterations >= this.maxIterations;
  }

  /** 지금이 콜드 배치인가(수렴 판정·강한 감쇠를 쓰는 구간) */
  get isCold(): boolean {
    return this.cold;
  }

  /** 마지막 덩어리가 bbox의 0.1% 미만으로 움직였는가 — 캐시를 "끝난 배치"로 저장해도 되는가 */
  get settled(): boolean {
    return this.track ? this.lastStepRatio < CONVERGED_RATIO : true;
  }

  settings() {
    const n = this.graph.order;
    // alpha 가 1 → 0 으로 식을수록 감쇠가 세진다(같은 힘에서 더 조금씩 움직인다)
    const heat = 1 - this.alpha;
    const damping = this.cold ? COLD_DAMPING * (1 + heat * COLD_DAMPING_RAMP) : 1 + heat * 3;
    return {
      gravity: 0.05 + this.forces.gravity * 3,
      scalingRatio: 1 + this.forces.repulsion * 30,
      edgeWeightInfluence: 1,
      barnesHutOptimize: n > 300,
      // 시간이 지날수록 움직임을 식혀(slowDown 증가) 마지막에는 떨림 없이 가라앉게 한다
      slowDown: (1 + Math.log(n + 1)) * damping,
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
    if (!this.track) {
      forceAtlas2.assign(this.graph, { iterations: CHUNK, settings: this.settings() });
      this.iterations += CHUNK;
      this.alpha = Math.max(0, 1 - this.iterations / MAX_ITERATIONS);
      return this.done;
    }
    this.readInto(this.before);
    forceAtlas2.assign(this.graph, { iterations: CHUNK, settings: this.settings() });
    this.iterations += CHUNK;
    this.readInto(this.after);
    // 한 덩어리만큼 에너지를 식힌다(다음 덩어리의 감쇠에 쓰인다)
    this.alpha = Math.max(0, 1 - this.iterations / MAX_ITERATIONS);
    const { maxStep, ratio } = stepMetrics(this.before, this.after);
    this.lastStep = maxStep;
    this.lastStepRatio = ratio;
    if (this.cold) {
      this.quietChunks = ratio < CONVERGED_RATIO ? this.quietChunks + 1 : 0;
      // 수렴하면 상한까지 채우지 않고 끝낸다(남은 반복은 화면에서 의미가 없다)
      if (this.quietChunks >= CONVERGED_CHUNKS) this.iterations = this.maxIterations;
    }
    return this.done;
  }

  /** 힘 슬라이더를 바꾸면 사용자가 다시 배치를 원하는 것이므로 고정을 풀고 일부를 다시 돈다. */
  setForces(forces: Forces) {
    this.forces = forces;
    this.graph.forEachNode((id) => this.graph.removeNodeAttribute(id, 'fixed'));
    // 슬라이더는 사용자가 움직이는 동안의 변화라 콜드 감쇠(느린 크리핑)가 아니라 기존 감쇠로 되돌린다.
    this.cold = false;
    this.track = false;
    this.maxIterations = MAX_ITERATIONS;
    this.iterations = Math.min(this.iterations, MAX_ITERATIONS - 300);
    // 사용자가 힘을 바꾼 것은 "다시 가열"이다 — 남은 에너지를 올려 눈에 보이게 움직인다
    this.alpha = Math.max(this.alpha, 0.35);
    this.applyEdgeWeights();
  }

  private readInto(out: Float32Array): void {
    this.ids.forEach((id, i) => {
      out[i * 2] = this.graph.getNodeAttribute(id, 'x') as number;
      out[i * 2 + 1] = this.graph.getNodeAttribute(id, 'y') as number;
    });
  }

  positions(): Float32Array {
    const out = new Float32Array(this.ids.length * 2);
    this.readInto(out);
    return out;
  }
}
