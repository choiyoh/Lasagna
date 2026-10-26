import { describe, expect, it } from 'vitest';
import { CHUNK, COLD_MAX_ITERATIONS, CONVERGED_RATIO, LayoutRunner, RESUME_ITERATIONS, WARM_ITERATIONS, coldBudgetMs } from './layout-core';
import { stepMetrics } from './layout-metrics';

const forces = { gravity: 0.3, repulsion: 0.3, linkDistance: 0.5 };

/** 고리 + 대각선 몇 개인 그래프 */
function setup(k: number) {
  const ids = Array.from({ length: k }, (_, i) => `n${i}`);
  const pos = new Float32Array(k * 2);
  ids.forEach((_, i) => {
    pos[i * 2] = Math.cos(i) * (i + 1);
    pos[i * 2 + 1] = Math.sin(i) * (i + 1);
  });
  const e: number[] = [];
  for (let i = 0; i < k; i++) e.push(i, (i + 1) % k);
  for (let i = 0; i < k; i += 5) e.push(i, (i + 7) % k);
  return { ids, positions: pos, edges: new Uint32Array(e), forces };
}

const run = (r: LayoutRunner) => {
  let steps = 0;
  while (!r.step()) steps++;
  return steps + 1;
};

describe('coldBudgetMs', () => {
  it('노드 수에 따라 늘되 600~1500ms 안에 둔다', () => {
    expect(coldBudgetMs(0)).toBe(600);
    expect(coldBudgetMs(60)).toBe(600);
    expect(coldBudgetMs(320)).toBe(1182);
    expect(coldBudgetMs(500)).toBe(1500);
    expect(coldBudgetMs(2000)).toBe(1500);
  });

  it('노드가 늘수록 줄지 않는다', () => {
    const xs = [0, 60, 120, 320, 500, 800];
    for (let i = 1; i < xs.length; i++) expect(coldBudgetMs(xs[i]!)).toBeGreaterThanOrEqual(coldBudgetMs(xs[i - 1]!));
  });
});

describe('LayoutRunner', () => {
  it('콜드 배치는 수렴하면 상한 전에 멈추고, 멈춘 뒤에는 더 움직이지 않는다', () => {
    const r = new LayoutRunner(setup(60));
    expect(r.isCold).toBe(true);
    let steps = 0;
    while (!r.step()) steps++;
    expect(steps + 1).toBeLessThanOrEqual(COLD_MAX_ITERATIONS / CHUNK);
    expect(r.done).toBe(true);
    expect(r.lastStepRatio).toBeLessThan(CONVERGED_RATIO);
    expect(r.settled).toBe(true);
    const a = r.positions();
    r.step();
    r.step();
    expect(r.positions()).toEqual(a);
  });

  it('끝으로 갈수록 가라앉는다: 마지막 덩어리의 이동량이 처음보다 작다', () => {
    const r = new LayoutRunner(setup(80));
    const before = r.positions();
    r.step();
    const first = stepMetrics(before, r.positions()).maxStep;
    while (!r.step());
    expect(r.done).toBe(true);
    expect(r.lastStep).toBeLessThan(first);
    expect(r.lastStepRatio).toBeLessThan(CONVERGED_RATIO);
  });

  it('도는 중이던 배치를 이어받으면(resume) RESUME_ITERATIONS 만 돌고 고정하지 않는다', () => {
    const r = new LayoutRunner({ ...setup(30), resume: true });
    let steps = 0;
    while (!r.step()) steps++;
    expect(steps * CHUNK).toBeLessThanOrEqual(RESUME_ITERATIONS);
    expect(steps * CHUNK).toBeGreaterThan(RESUME_ITERATIONS - 2 * CHUNK);
  });

  it('다듬기(warm)는 WARM_ITERATIONS 만 돌고, 고정된 자리라 settled 이다', () => {
    const r = new LayoutRunner({ ...setup(30), warm: true });
    expect(run(r)).toBe(WARM_ITERATIONS / CHUNK);
    expect(r.settled).toBe(true);
  });

  it('고정한 노드는 움직이지 않는다', () => {
    const s = setup(40);
    const fixed = new Uint8Array(40).fill(1);
    fixed[3] = 0;
    fixed[4] = 0;
    const r = new LayoutRunner({ ...s, warm: true, fixed });
    run(r);
    const p = r.positions();
    for (let i = 0; i < 40; i++) {
      if (i === 3 || i === 4) continue;
      expect([p[i * 2], p[i * 2 + 1]]).toEqual([s.positions[i * 2], s.positions[i * 2 + 1]]);
    }
    expect(p[3 * 2] !== s.positions[3 * 2] || p[3 * 2 + 1] !== s.positions[3 * 2 + 1]).toBe(true);
  });

  it('모두 고정이면 곧바로 끝나고 한 점도 바뀌지 않는다(같은 그래프를 다시 열 때)', () => {
    const s = setup(40);
    const r = new LayoutRunner({ ...s, warm: true, fixed: new Uint8Array(40).fill(1) });
    expect(r.done).toBe(true);
    expect(r.positions()).toEqual(s.positions);
  });

  it('힘 슬라이더를 바꾸면 고정을 풀고 다시 돌았다가 또 멈춘다', () => {
    const r = new LayoutRunner({ ...setup(40), warm: true, fixed: new Uint8Array(40).fill(1) });
    r.setForces({ gravity: 0.8, repulsion: 0.1, linkDistance: 0.2 });
    expect(r.done).toBe(false);
    const before = r.positions();
    run(r);
    expect(r.done).toBe(true);
    expect(r.positions()).not.toEqual(before);
  });
});
