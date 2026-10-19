import { useEffect, useRef, useState } from 'react';
import type { GraphData } from '@nopsidian/ipc-contract';

const EMPTY: GraphData = { nodes: [], edges: [] };

/** 마지막으로 받은 그래프 데이터(다시 열 때 바로 그리고, 새 데이터는 뒤에서 받는다) */
const dataCache = new Map<string, { data: GraphData; sig: string }>();

/**
 * 내용(노드·이름·연결 수·링크)이 같은지 빠르게 비교하기 위한 서명. 순서와 무관하다
 * (색인 질의가 같은 그래프를 다른 순서로 돌려줘도 — 예: 병렬 스캔 뒤 — 다시 배치하지 않게).
 */
export const graphSignature = (d: GraphData) =>
  `${d.nodes
    .map((n) => `${n.id}\u0001${n.label}\u0001${n.degree}\u0001${n.kind}`)
    .sort()
    .join('\u0002')}\u0003${d.edges
    .map((e) => `${e.source}\u0001${e.target}`)
    .sort()
    .join('\u0002')}`;

/** 노트를 바꿀 때마다 그래프 데이터를 다시 받는 간격(디바운스) */
export const GRAPH_REFRESH_DEBOUNCE_MS = 600;

/**
 * 노트 변경을 디바운스해 그래프 데이터를 다시 받는다. **구조가 같으면 이전 객체를 그대로 돌려준다.**
 * 그래프 화면은 `data` 가 바뀔 때마다 그래프·sigma·배치 워커를 새로 만들기 때문에, 여기서 같은 내용의 새 객체를
 * 넘기면 글자 하나 칠 때마다(자동 저장 → note.changed) 그래프 전체가 다시 배치되며 흔들린다.
 */
export function useGraphData(load: () => Promise<GraphData>, deps: unknown[], cacheKey?: string): GraphData {
  const [data, setData] = useState<GraphData>(() => (cacheKey && dataCache.get(cacheKey)?.data) || EMPTY);
  const sigRef = useRef<string | null>(cacheKey ? (dataCache.get(cacheKey)?.sig ?? null) : null);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () =>
      void load()
        .then((d) => {
          if (!alive) return;
          const sig = graphSignature(d);
          if (sig === sigRef.current) return; // 같은 구조: 다시 그리지 않는다
          sigRef.current = sig;
          if (cacheKey) dataCache.set(cacheKey, { data: d, sig });
          setData(d);
        })
        .catch(() => {
          // 볼트를 닫는 중 등: 지금 그래프를 그대로 둔다
        });
    run();
    const off = window.nops.on('note.changed', () => {
      clearTimeout(timer);
      timer = setTimeout(run, GRAPH_REFRESH_DEBOUNCE_MS);
    });
    return () => {
      alive = false;
      clearTimeout(timer);
      off();
    };
  }, deps);
  return data;
}

/** 테스트용: 모듈 캐시를 비운다 */
export function clearGraphDataCache() {
  dataCache.clear();
}
