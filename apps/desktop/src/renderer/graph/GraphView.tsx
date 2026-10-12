import { useEffect, useMemo, useRef, useState } from 'react';
import Graph from 'graphology';
import Sigma from 'sigma';
import { EdgeArrowProgram, EdgeRectangleProgram } from 'sigma/rendering';
import type { GraphData, GraphSettings } from '@nopsidian/ipc-contract';
import { colorForNode, matchesQuery, parseGraphQuery } from './filter';
import type { LayoutIn, LayoutOut } from './layout-worker';
import { NOTE_COLOR, TAG_COLOR, UNRESOLVED_COLOR } from './settings';

interface Props {
  data: GraphData;
  settings: GraphSettings;
  /** 강조할 노트(현재 열린 노트 / 로컬 그래프의 중심) */
  current: string | null;
  onOpen: (path: string) => void;
  /** E2E·디버그용 식별자 */
  testId: string;
}

const DIM = '#3a3a44';

/** sigma + graphology 로 그래프를 그린다. 레이아웃은 워커에서 돌고, 위치만 받아 갱신한다. */
export function GraphView({ data, settings, current, onOpen, testId }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const hover = useRef<string | null>(null);
  const live = useRef({ settings, current, onOpen });
  live.current = { settings, current, onOpen };
  const [stats, setStats] = useState('');

  const parsedRef = useRef(parseGraphQuery(settings.filter));
  const parsed = useMemo(() => parseGraphQuery(settings.filter), [settings.filter]);
  const filterKey = settings.filter + JSON.stringify(settings.groups);

  // 데이터가 바뀔 때마다 그래프와 워커를 새로 만든다. 이전 위치는 id 기준으로 이어 받는다.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const prev = graphRef.current;
    const graph = new Graph({ type: 'directed', multi: false });
    const n = data.nodes.length;
    data.nodes.forEach((node, i) => {
      const old = prev?.hasNode(node.id) ? prev.getNodeAttributes(node.id) : null;
      const angle = (i / Math.max(n, 1)) * Math.PI * 2;
      const radius = 10 + Math.sqrt(n) * 3;
      graph.addNode(node.id, {
        label: node.label,
        size: 3 + Math.sqrt(node.degree) * 2.2,
        x: old ? (old.x as number) : Math.cos(angle) * radius + Math.random(),
        y: old ? (old.y as number) : Math.sin(angle) * radius + Math.random(),
        color: NOTE_COLOR,
        kind: node.kind,
      });
    });
    for (const e of data.edges) {
      if (e.source !== e.target && graph.hasNode(e.source) && graph.hasNode(e.target) && !graph.hasEdge(e.source, e.target)) {
        graph.addEdge(e.source, e.target, { size: 1, color: '#55556a' });
      }
    }
    graphRef.current = graph;
    const nodeIndex = new Map(data.nodes.map((nd) => [nd.id, nd]));
    parsedRef.current = parseGraphQuery(live.current.settings.filter);

    sigmaRef.current?.kill();
    const sigma = new Sigma(graph, el, {
      allowInvalidContainer: true,
      renderEdgeLabels: false,
      labelRenderedSizeThreshold: 6,
      labelColor: { color: '#c8c8d4' },
      defaultEdgeType: live.current.settings.arrows ? 'arrow' : 'line',
      edgeProgramClasses: { arrow: EdgeArrowProgram, line: EdgeRectangleProgram },
      nodeReducer: (id, attrs) => {
        const { settings: s, current: cur } = live.current;
        const node = nodeIndex.get(id);
        const out = { ...attrs };
        if (!node) return out;
        out.color = colorForNode(node, s.groups, node.kind === 'tag' ? TAG_COLOR : node.kind === 'unresolved' ? UNRESOLVED_COLOR : NOTE_COLOR);
        if (!matchesQuery(node, parsedRef.current)) {
          out.color = DIM;
          out.label = '';
          out.zIndex = 0;
        }
        const h = hover.current;
        if (h && h !== id && !graph.areNeighbors(h, id)) {
          out.color = DIM;
          out.label = '';
        }
        if (id === cur) {
          out.highlighted = true;
          out.forceLabel = true;
        }
        return out;
      },
      edgeReducer: (edge, attrs) => {
        const h = hover.current;
        if (h && !graph.hasExtremity(edge, h)) return { ...attrs, hidden: true };
        return attrs;
      },
    });
    sigmaRef.current = sigma;
    sigma.on('clickNode', ({ node }) => {
      if (node.startsWith('#') || node.startsWith('?')) return;
      live.current.onOpen(node);
    });
    sigma.on('enterNode', ({ node }) => {
      hover.current = node;
      sigma.refresh({ skipIndexation: true });
    });
    sigma.on('leaveNode', () => {
      hover.current = null;
      sigma.refresh({ skipIndexation: true });
    });

    // 레이아웃 워커
    const ids = data.nodes.map((nd) => nd.id);
    const index = new Map(ids.map((id, i) => [id, i]));
    const pos = new Float32Array(ids.length * 2);
    ids.forEach((id, i) => {
      pos[i * 2] = graph.getNodeAttribute(id, 'x') as number;
      pos[i * 2 + 1] = graph.getNodeAttribute(id, 'y') as number;
    });
    const edgeArr: number[] = [];
    graph.forEachEdge((_e, _a, s, t) => edgeArr.push(index.get(s)!, index.get(t)!));
    const worker = new Worker(new URL('./layout-worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    worker.onmessage = (ev: MessageEvent<LayoutOut>) => {
      const { positions, done } = ev.data;
      ids.forEach((id, i) => {
        if (!graph.hasNode(id)) return;
        graph.mergeNodeAttributes(id, { x: positions[i * 2]!, y: positions[i * 2 + 1]! });
      });
      sigma.refresh();
      setStats(`${ids.length}개 노드 · ${graph.size}개 링크${done ? '' : ' · 배치 중…'}`);
    };
    const init: LayoutIn = { type: 'init', ids, positions: pos, edges: new Uint32Array(edgeArr), forces: live.current.settings.forces };
    worker.postMessage(init);
    setStats(`${ids.length}개 노드 · ${graph.size}개 링크`);

    return () => {
      worker.postMessage({ type: 'stop' } satisfies LayoutIn);
      worker.terminate();
      sigma.kill();
      if (sigmaRef.current === sigma) sigmaRef.current = null;
      workerRef.current = null;
    };
  }, [data]);

  // 필터·그룹·강조가 바뀌면 다시 칠하기만 한다.
  useEffect(() => {
    parsedRef.current = parsed;
    sigmaRef.current?.refresh({ skipIndexation: true });
  }, [parsed, filterKey, current]);

  // 화살표 토글
  useEffect(() => {
    sigmaRef.current?.setSetting('defaultEdgeType', settings.arrows ? 'arrow' : 'line');
  }, [settings.arrows]);

  // 힘 슬라이더
  const { gravity, repulsion, linkDistance } = settings.forces;
  useEffect(() => {
    workerRef.current?.postMessage({ type: 'forces', forces: { gravity, repulsion, linkDistance } } satisfies LayoutIn);
  }, [gravity, repulsion, linkDistance]);

  return (
    <div className="graphview" data-testid={testId}>
      <div ref={host} className="graphview__canvas" />
      <span className="graphview__stats muted small" data-testid={`${testId}-stats`}>
        {stats}
      </span>
    </div>
  );
}
