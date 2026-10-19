import { describe, expect, it } from 'vitest';
import { CHUNK, LayoutRunner, MAX_ITERATIONS, WARM_ITERATIONS } from './layout-core';

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

describe('LayoutRunner', () => {
  it('정해진 반복 수를 채우면 멈추고, 멈춘 뒤에는 더 움직이지 않는다', () => {
    const r = new LayoutRunner(setup(60));
    expect(run(r)).toBe(MAX_ITERATIONS / CHUNK);
    expect(r.done).toBe(true);
    const a = r.positions();
    r.step();
    r.step();
    expect(r.positions()).toEqual(a);
  });

  it('끝으로 갈수록 가라앉는다: 마지막 덩어리의 이동량이 처음보다 훨씬 작다', () => {
    const r = new LayoutRunner(setup(80));
    const delta = () => {
      const a = r.positions();
      r.step();
      const b = r.positions();
      return Math.max(...a.map((v, i) => Math.abs(v - b[i]!)));
    };
    const first = delta();
    while (r.iterations < MAX_ITERATIONS - CHUNK) r.step();
    const last = delta();
    expect(r.done).toBe(true);
    expect(last).toBeLessThan(first / 10);
  });

  it('다듬기(warm)는 WARM_ITERATIONS 만 돈다', () => {
    const r = new LayoutRunner({ ...setup(30), warm: true });
    expect(run(r)).toBe(WARM_ITERATIONS / CHUNK);
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
