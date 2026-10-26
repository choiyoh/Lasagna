import { describe, expect, it } from 'vitest';
import type { GraphData } from '@nopsidian/ipc-contract';
import { adjacency, planLayout, type Point } from './layout-plan';

/** 줄 모양 그래프 n0 - n1 - … - n(k-1) */
function chain(k: number, extra: [number, number][] = []): GraphData {
  const edges = Array.from({ length: k - 1 }, (_, i) => ({ source: `n${i}`, target: `n${i + 1}` }));
  for (const [a, b] of extra) edges.push({ source: `n${a}`, target: `n${b}` });
  const deg = new Map<string, number>();
  for (const e of edges) for (const id of [e.source, e.target]) deg.set(id, (deg.get(id) ?? 0) + 1);
  return { nodes: Array.from({ length: k }, (_, i) => ({ id: `n${i}`, label: `n${i}`, kind: 'note' as const, degree: deg.get(`n${i}`) ?? 0 })), edges } as GraphData;
}
const positionsOf = (d: GraphData): Map<string, Point> => new Map(d.nodes.map((n, i) => [n.id, [i * 10, i * 5] as Point]));

describe('planLayout', () => {
  it('처음 열면(아는 자리 없음) 아무것도 고정하지 않고 결정적인 해바라기 배열에서 시작한다', () => {
    const d = chain(30);
    const a = planLayout(d, new Map());
    const b = planLayout(d, new Map());
    expect(a.warm).toBe(false);
    expect(a.fixed.size).toBe(0);
    expect([...a.positions]).toEqual([...b.positions]);
  });

  it('같은 구조를 다시 받으면(노트 본문만 바뀜) 모든 노드를 고정한다 — 다시 배치하지 않는다', () => {
    const d = chain(40);
    const plan = planLayout(d, positionsOf(d), adjacency(d));
    expect(plan.warm).toBe(true);
    expect(plan.fixed.size).toBe(40);
    expect(plan.positions.get('n7')).toEqual([70, 35]);
  });

  it('저장된 배치로 다시 열면(이전 연결 정보 없음) 아는 노드는 모두 고정한다', () => {
    const d = chain(40);
    expect(planLayout(d, positionsOf(d)).fixed.size).toBe(40);
  });

  it('링크가 하나 늘면 그 두 노드와 이웃만 움직이고 나머지는 고정한다', () => {
    const before = chain(40);
    const after = chain(40, [[3, 30]]);
    const plan = planLayout(after, positionsOf(before), adjacency(before));
    const free = after.nodes.map((n) => n.id).filter((id) => !plan.fixed.has(id));
    expect(free.sort()).toEqual(['n2', 'n29', 'n3', 'n30', 'n31', 'n4'].sort());
  });

  it('새 노드는 이웃의 가운데 근처에서 시작하고(멀리서 날아오지 않음) 이웃과 함께 움직인다', () => {
    const before = chain(40);
    const after = chain(41); // n40 이 n39 에 붙는다
    const plan = planLayout(after, positionsOf(before), adjacency(before));
    const [x, y] = plan.positions.get('n40')!;
    expect(Math.hypot(x - 390, y - 195)).toBeLessThan(3);
    expect(plan.fixed.has('n40')).toBe(false);
    expect(plan.fixed.has('n39')).toBe(false);
    expect(plan.fixed.has('n0')).toBe(true);
  });

  it('모르는 노드가 5% 를 넘으면 처음부터 다시 배치한다(고정 없음)', () => {
    const d = chain(20);
    const known = new Map([...positionsOf(d)].slice(0, 15));
    const plan = planLayout(d, known);
    expect(plan.warm).toBe(false);
    expect(plan.fixed.size).toBe(0);
  });
});

describe('planLayout: 색인·동기화로 노드가 늘어나는 동안', () => {
  it('화면에 떠 있는 그래프를 이어받을 때는 아는 노드가 절반 이상이면 처음부터 다시 배치하지 않는다', () => {
    const before = chain(20);
    const after = chain(30); // 새 노드 10개(33%)
    const plan = planLayout(after, positionsOf(before), adjacency(before));
    expect(plan.warm).toBe(true);
    expect(plan.fixed.has('n0')).toBe(true);
    expect(plan.fixed.has('n25')).toBe(false);
  });

  it('절반도 모르면(다른 노트의 로컬 그래프 등) 이어받아도 처음부터 다시 배치한다', () => {
    const before = chain(10);
    const after = chain(30);
    expect(planLayout(after, positionsOf(before), adjacency(before)).warm).toBe(false);
  });
});
