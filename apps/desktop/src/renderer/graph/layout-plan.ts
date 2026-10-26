import type { GraphData } from '@nopsidian/ipc-contract';

/** 저장된 배치에서 시작할 때 / 화면에 떠 있는 그래프를 이어받을 때 warm 으로 보는 최소 비율 */
export const WARM_KNOWN_SAVED = 0.95;
export const WARM_KNOWN_LIVE = 0.5;

export type Point = [number, number];

export interface LayoutPlan {
  /** 노드별 시작 위치(데이터의 노드 순서와 같다) */
  positions: Map<string, Point>;
  /** 배치 계산에서 움직이지 않을 노드(이전 자리를 그대로 둔다) */
  fixed: Set<string>;
  /** 이전 자리를 아는 노드 수 */
  known: number;
  /** 거의 모든 자리를 알면 처음부터 다시 배치하지 않고 바뀐 곳만 다듬는다 */
  warm: boolean;
}

/** 이웃 집합(방향 무시, 자기 자신 제외) */
export function adjacency(data: GraphData): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const n of data.nodes) adj.set(n.id, new Set());
  for (const e of data.edges) {
    if (e.source === e.target || !adj.has(e.source) || !adj.has(e.target)) continue;
    adj.get(e.source)!.add(e.target);
    adj.get(e.target)!.add(e.source);
  }
  return adj;
}

const sameSet = (a: Set<string> | undefined, b: Set<string>) => !!a && a.size === b.size && [...b].every((x) => a.has(x));

/**
 * 데이터가 바뀌었을 때 노드를 어디서 시작하고, 어떤 노드를 고정할지 정한다.
 *
 * 그래프가 "지진 난 것처럼" 흔들리던 원인은, 노트가 저장될 때마다(같은 구조여도) 그래프를 새로 만들고
 * 모든 노드를 풀어 놓은 채 ForceAtlas2 를 다시 돌린 것이다. 여기서는
 * - 자리를 아는 노드 중 연결이 그대로인 노드는 고정하고,
 * - 새로 생긴 노드·연결이 바뀐 노드와 그 이웃만 움직이게 한다.
 * - 새 노드는 이미 자리가 있는 이웃들의 가운데 근처에서 시작한다(멀리서 날아오지 않게).
 * 자리를 하나도 모르면(처음 열 때) 아무것도 고정하지 않고 해바라기 배열에서 시작한다.
 */
export function planLayout(data: GraphData, prevPos: Map<string, Point>, prevAdj?: Map<string, Set<string>>): LayoutPlan {
  const adj = adjacency(data);
  const n = data.nodes.length;
  const positions = new Map<string, Point>();
  // 연결이 많은 노드를 가운데에 두는 해바라기 배열(무작위 없이 항상 같다)
  const rank = new Map<string, number>();
  [...data.nodes].sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id)).forEach((nd, i) => rank.set(nd.id, i));
  let known = 0;
  const unknown: string[] = [];
  for (const nd of data.nodes) {
    const p = prevPos.get(nd.id);
    if (p) {
      known++;
      positions.set(nd.id, [p[0], p[1]]);
    } else unknown.push(nd.id);
  }
  // 이미 그래프가 떠 있을 때(prevAdj 가 있음) 절반 이상의 자리를 알면 이어서 다듬는다. 색인이 끝나기 전이나 동기화 중에
  // 노드가 조금씩 늘어나는 동안 매번 처음부터 다시 배치하면 그래프가 계속 뒤집히기 때문이다.
  const warm = n > 0 && known / n >= (prevAdj ? WARM_KNOWN_LIVE : WARM_KNOWN_SAVED);
  unknown.forEach((id, j) => {
    const k = rank.get(id) ?? 0;
    const placed = warm ? [...adj.get(id)!].map((x) => positions.get(x)).filter((p): p is Point => !!p) : [];
    if (placed.length > 0) {
      // 이웃들의 가운데에서 조금 떨어진 곳(황금각으로 퍼뜨려 서로 겹치지 않게)
      const cx = placed.reduce((s, p) => s + p[0], 0) / placed.length;
      const cy = placed.reduce((s, p) => s + p[1], 0) / placed.length;
      const a = (j + 1) * 2.399963229728653;
      positions.set(id, [cx + Math.cos(a) * 2, cy + Math.sin(a) * 2]);
    } else {
      const angle = k * 2.399963229728653; // 황금각
      const radius = 4 * Math.sqrt(k + 0.5);
      positions.set(id, [Math.cos(angle) * radius, Math.sin(angle) * radius]);
    }
  });

  const fixed = new Set<string>();
  if (!warm) return { positions, fixed, known, warm };
  // 움직일 노드: 새 노드 + (이전 연결을 알면) 연결이 바뀐 노드, 그리고 그 이웃
  const touched = new Set<string>(unknown);
  if (prevAdj) for (const [id, s] of adj) if (!sameSet(prevAdj.get(id), s)) touched.add(id);
  const free = new Set<string>(touched);
  for (const id of touched) for (const x of adj.get(id) ?? []) free.add(x);
  for (const nd of data.nodes) if (!free.has(nd.id)) fixed.add(nd.id);
  return { positions, fixed, known, warm };
}
