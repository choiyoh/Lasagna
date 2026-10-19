import { useEffect, useMemo, useRef, useState } from 'react';
import Graph from 'graphology';
import Sigma from 'sigma';
import { EdgeArrowProgram, EdgeRectangleProgram } from 'sigma/rendering';
import type { GraphData, GraphSettings } from '@nopsidian/ipc-contract';
import { colorForNode, matchesQuery, parseGraphQuery } from './filter';
import type { LayoutIn, LayoutOut } from './layout-worker';
import { adjacency, planLayout, type Point } from './layout-plan';
import { mix, readPalette, type GraphPalette } from './palette';
import { NodeGlowProgram } from './node-glow';
import { webglAvailable } from './webgl';

interface Props {
  data: GraphData;
  settings: GraphSettings;
  /** 강조할 노트(현재 열린 노트 / 로컬 그래프의 중심) */
  current: string | null;
  onOpen: (path: string) => void;
  /** E2E·디버그용 식별자 */
  testId: string;
  /** 있으면 레이아웃 위치를 localStorage 에 캐시해 다음에 열 때 바로 보여 준다 */
  cacheKey?: string;
  /** 그래프 검색: 이 노드로 화면을 옮기고 잠깐 강조한다(tick 이 바뀔 때마다) */
  focus?: { id: string; tick: number } | null;
}

const CACHE_PREFIX = 'nops.graph.layout.';

function loadLayout(key: string | undefined): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>();
  if (!key) return out;
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_PREFIX + key) ?? '{}') as Record<string, [number, number]>;
    for (const [id, p] of Object.entries(raw)) if (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) out.set(id, p);
  } catch {
    /* 캐시는 없어도 된다 */
  }
  return out;
}

function saveLayout(key: string | undefined, graph: Graph): void {
  if (!key) return;
  try {
    const raw: Record<string, [number, number]> = {};
    graph.forEachNode((id, a) => {
      raw[id] = [Math.round((a.x as number) * 100) / 100, Math.round((a.y as number) * 100) / 100];
    });
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(raw));
  } catch {
    /* 용량 초과 등은 무시 */
  }
}


/** sigma + graphology 로 그래프를 그린다. 레이아웃은 워커에서 돌고, 위치만 받아 갱신한다. */
export function GraphView({ data, settings, current, onOpen, testId, cacheKey, focus }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  /** 지난번 데이터의 이웃 집합(무엇이 바뀌었는지 가려 바뀐 노드만 움직이려고) */
  const prevAdj = useRef<Map<string, Set<string>> | undefined>(undefined);
  /** 지난 배치가 끝까지 가라앉았는가(도중이면 고정하지 않고 이어서 끝까지 돌린다) */
  const prevFinished = useRef(false);
  /** 워커가 지금 쓰고 있는 힘 설정(같은 값을 다시 보내 배치를 처음부터 다시 돌리지 않게) */
  const workerForces = useRef<GraphSettings['forces'] | null>(null);
  /** 다시 만들 때 화면 틀(정규화 범위)과 카메라를 이어 받는다 — 고정된 노드가 화면에서도 제자리에 있게 */
  const view = useRef<{ bbox: { x: [number, number]; y: [number, number] }; camera: { x: number; y: number; ratio: number; angle: number } } | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const hover = useRef<string | null>(null);
  const live = useRef({ settings, current, onOpen });
  live.current = { settings, current, onOpen };
  const [stats, setStats] = useState('');
  /** WebGL 을 못 쓰면 그래프 대신 안내를 보여 준다(사유가 있으면 함께 보여 준다) */
  const [glFailure, setGlFailure] = useState<{ message: string } | null>(null);
  /** 첫 배치가 도착하기 전에는 캔버스를 숨겨 두었다가 부드럽게 나타낸다(초반의 요동을 보여 주지 않는다) */
  const [ready, setReady] = useState(false);
  /** 노드별 기본 색(연결이 많을수록 강조색에 가깝게). 테마가 바뀌거나 그래프를 다시 만들면 비운다 */
  const tint = useRef(new Map<string, string>());
  /** 테마가 바뀌면 다시 읽는다 */
  const pal = useRef<GraphPalette>(readPalette());

  const parsedRef = useRef(parseGraphQuery(settings.filter));
  const parsed = useMemo(() => parseGraphQuery(settings.filter), [settings.filter]);
  const filterKey = settings.filter + JSON.stringify(settings.groups);

  // 데이터가 바뀔 때마다 그래프와 워커를 새로 만든다. 이전 위치는 id 기준으로 이어 받는다.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    // WebGL 을 못 쓰는 환경(원격 데스크톱·가상 머신·GPU 차단 목록)에서는 sigma 가 예외를 던진다.
    // 앱을 죽이는 대신 그래프 자리에 안내를 보여 주고, 노트·링크 기능은 그대로 쓴다.
    if (!webglAvailable()) {
      setGlFailure({ message: '' });
      return;
    }
    const prev = graphRef.current;
    const graph = new Graph({ type: 'directed', multi: false });
    // 이전 자리: 지금 그래프가 있으면 그 자리를, 처음 열면 저장해 둔 배치를 쓴다
    const prevPos = new Map<string, Point>();
    if (prev) prev.forEachNode((id, a) => prevPos.set(id, [a.x as number, a.y as number]));
    else for (const [id, p] of loadLayout(cacheKey)) prevPos.set(id, p);
    // 연결이 그대로인 노드는 고정하고, 바뀐 곳만 움직인다(같은 그래프를 다시 열거나 링크 하나가 늘어도 전체가 흔들리지 않게)
    const plan = planLayout(data, prevPos, prev ? prevAdj.current : undefined);
    // 지난 배치가 아직 도는 중이었다면(열자마자 노트가 바뀐 경우) 고정하지 않고 처음부터 끝까지 이어서 돌린다.
    // 저장된 배치(localStorage)는 다 가라앉은 것만 저장하므로 고정해도 된다.
    const settled = !prev || prevFinished.current;
    prevFinished.current = false;
    prevAdj.current = adjacency(data);
    const maxDegree = data.nodes.reduce((m, nd) => Math.max(m, nd.degree), 1);
    tint.current.clear();
    data.nodes.forEach((node) => {
      const [x, y] = plan.positions.get(node.id)!;
      graph.addNode(node.id, {
        label: node.label,
        size: 3 + Math.min(Math.sqrt(node.degree) * 2.3, 20),
        x,
        y,
        color: pal.current.note,
        kind: node.kind,
      });
    });
    for (const e of data.edges) {
      if (e.source !== e.target && graph.hasNode(e.source) && graph.hasNode(e.target) && !graph.hasEdge(e.source, e.target)) {
        graph.addEdge(e.source, e.target, { size: 1, color: pal.current.edge });
      }
    }
    graphRef.current = graph;
    const nodeIndex = new Map(data.nodes.map((nd) => [nd.id, nd]));
    parsedRef.current = parseGraphQuery(live.current.settings.filter);

    sigmaRef.current?.kill();
    let sigma: Sigma;
    try {
      sigma = new Sigma(graph, el, {
        allowInvalidContainer: true,
        renderEdgeLabels: false,
        labelRenderedSizeThreshold: 5,
        labelFont: "'Pretendard', 'Apple SD Gothic Neo', 'Malgun Gothic', system-ui, sans-serif",
        labelSize: 12,
        labelWeight: '500',
        labelDensity: 0.7,
        labelGridCellSize: 110,
        zIndex: true,
        stagePadding: 70,
        defaultDrawNodeLabel: (ctx, data, settings) => {
          if (!data.label) return;
          const p = pal.current;
          const size = settings.labelSize;
          ctx.font = `${settings.labelWeight} ${size}px ${settings.labelFont}`;
          const x = data.x + data.size + 4;
          const y = data.y + size / 3;
          // 배경색 테두리(후광)로 선·점 위에서도 글자가 또렷하게 보인다
          ctx.lineWidth = 3;
          ctx.lineJoin = 'round';
          ctx.strokeStyle = p.dark ? 'rgba(25, 25, 25, 0.85)' : 'rgba(255, 255, 255, 0.9)';
          ctx.strokeText(data.label, x, y);
          ctx.fillStyle = p.fg;
          ctx.fillText(data.label, x, y);
        },
        defaultDrawNodeHover: (ctx, data, settings) => {
          const p = pal.current;
          ctx.beginPath();
          ctx.arc(data.x, data.y, data.size + 5, 0, Math.PI * 2);
          ctx.fillStyle = p.dark ? 'rgba(143, 143, 245, 0.22)' : 'rgba(91, 91, 214, 0.16)';
          ctx.fill();
          if (data.label) {
            const size = settings.labelSize + 1;
            ctx.font = `600 ${size}px ${settings.labelFont}`;
            const x = data.x + data.size + 8;
            const y = data.y + size / 3;
            ctx.lineWidth = 4;
            ctx.lineJoin = 'round';
            ctx.strokeStyle = p.dark ? 'rgba(25, 25, 25, 0.9)' : 'rgba(255, 255, 255, 0.95)';
            ctx.strokeText(data.label, x, y);
            ctx.fillStyle = p.fg;
            ctx.fillText(data.label, x, y);
          }
        },
        defaultEdgeType: live.current.settings.arrows ? 'arrow' : 'line',
        defaultNodeType: 'glow',
        nodeProgramClasses: { glow: NodeGlowProgram },
        edgeProgramClasses: { arrow: EdgeArrowProgram, line: EdgeRectangleProgram },
        nodeReducer: (id, attrs) => {
          const { settings: s, current: cur } = live.current;
          const node = nodeIndex.get(id);
          const out = { ...attrs };
          if (!node) return out;
          const p = pal.current;
          let base = tint.current.get(id);
          if (!base) {
            // 연결이 많은 노트일수록 강조색에 가까워진다(허브가 한눈에 보이게)
            const t = node.kind === 'note' ? Math.min(1, Math.log2(1 + node.degree) / Math.log2(1 + maxDegree)) : 0;
            base = node.kind === 'tag' ? p.tag : node.kind === 'unresolved' ? p.unresolved : mix(p.note, p.accent, t * 0.6);
            tint.current.set(id, base);
          }
          out.color = colorForNode(node, s.groups, base);
          out.zIndex = 1;
          if (!matchesQuery(node, parsedRef.current)) {
            out.color = p.dim;
            out.label = '';
            out.zIndex = 0;
          }
          const h = hover.current;
          if (h) {
            if (h === id) {
              out.color = p.accent;
              out.zIndex = 3;
              out.forceLabel = true;
            } else if (graph.areNeighbors(h, id)) {
              out.color = p.accent;
              out.zIndex = 2;
              out.forceLabel = true;
            } else {
              out.color = p.dim;
              out.label = '';
              out.zIndex = 0;
            }
          }
          if (id === cur) {
            out.color = p.accent;
            out.size = (out.size ?? 4) * 1.35;
            out.forceLabel = true;
            out.zIndex = 3;
          }
          return out;
        },
        edgeReducer: (edge, attrs) => {
          const h = hover.current;
          const p = pal.current;
          if (h) return graph.hasExtremity(edge, h) ? { ...attrs, color: p.edgeHot, size: 1.4, zIndex: 1 } : { ...attrs, color: p.edgeFaded };
          return { ...attrs, color: p.edge };
        },
      });
    } catch (err) {
      // sigma(내부는 regl)는 WebGL 컨텍스트를 못 만들면 예외를 던진다.
      // 절반만 만들어진 것을 붙잡아 둘 수 없으니 참조를 비우고 안내 화면으로 바꾼다.
      sigmaRef.current = null;
      setGlFailure({ message: err instanceof Error ? err.message : String(err) });
      return;
    }
    sigmaRef.current = sigma;
    // 바뀐 곳만 다듬는 경우(warm·고정)는 이전 화면 틀과 카메라를 그대로 쓴다. 그러지 않으면 새 노드 하나로 범위가 바뀌어
    // 그래프 전체가 커졌다 작아지며(재정규화) 흔들려 보이고, 사용자가 확대·이동한 화면도 처음으로 돌아간다.
    const keepView = plan.warm && settled && prev !== null && view.current !== null;
    if (keepView) {
      sigma.setCustomBBox(view.current!.bbox);
      sigma.getCamera().setState(view.current!.camera);
    }
    view.current = null;
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
    // 워커가 보내 주는 위치는 '목표'일 뿐이고, 화면의 노드는 목표를 향해 부드럽게 따라간다.
    // 배치 계산의 미세한 진동이 그대로 보이지 않고, 노드가 갑자기 튀지도 않는다.
    const target = new Float32Array(pos);
    let raf = 0;
    let finished = false;
    let first = true;
    // 노드 속성 객체를 한 번만 찾아 두고 직접 고친다(프레임마다 1만 번 이벤트·조회를 하면 느리다).
    // 화면 갱신은 아래 `sigma.refresh()` 가 한 번에 한다.
    const attrs = ids.map((id) => graph.getNodeAttributes(id) as { x: number; y: number });
    // 노드가 많으면(수천 개) 화면 갱신 한 번이 무거우므로 두 프레임에 한 번만 갱신해 입력·스크롤이 끊기지 않게 한다
    const heavy = attrs.length > 2500;
    const ease = heavy ? 0.3 : 0.18;
    let skip = false;
    const follow = () => {
      raf = 0;
      if (heavy && (skip = !skip)) {
        raf = requestAnimationFrame(follow);
        return;
      }
      let moving = false;
      for (let i = 0; i < attrs.length; i++) {
        const a = attrs[i]!;
        const dx = target[i * 2]! - a.x;
        const dy = target[i * 2 + 1]! - a.y;
        if (Math.abs(dx) < 0.02 && Math.abs(dy) < 0.02) {
          a.x = target[i * 2]!;
          a.y = target[i * 2 + 1]!;
          continue;
        }
        moving = true;
        a.x += dx * ease;
        a.y += dy * ease;
      }
      sigma.refresh();
      if (moving) raf = requestAnimationFrame(follow);
      else if (finished) saveLayout(cacheKey, graph);
    };
    const warm = plan.warm && settled;
    if (!warm) setReady(false);
    worker.onmessage = (ev: MessageEvent<LayoutOut>) => {
      const { positions, done } = ev.data;
      target.set(positions);
      finished = done;
      if (done) prevFinished.current = true;
      if (first) {
        // 미리 돌려 둔 첫 배치는 곧바로 보여 주고(자리 잡기), 이후 변화만 부드럽게 따라간다
        first = false;
        attrs.forEach((a, i) => {
          a.x = target[i * 2]!;
          a.y = target[i * 2 + 1]!;
        });
        sigma.refresh();
        setReady(true);
      } else if (!raf) raf = requestAnimationFrame(follow);
      setStats(`${ids.length}개 노드 · ${graph.size}개 링크${done ? '' : ' · 배치 중…'}`);
    };
    const fixed = warm ? Uint8Array.from(ids, (id) => (plan.fixed.has(id) ? 1 : 0)) : undefined;
    const init: LayoutIn = { type: 'init', ids, positions: pos, edges: new Uint32Array(edgeArr), forces: live.current.settings.forces, warm, ...(fixed ? { fixed } : {}) };
    workerForces.current = init.forces;
    worker.postMessage(init);
    setStats(`${ids.length}개 노드 · ${graph.size}개 링크`);

    return () => {
      cancelAnimationFrame(raf);
      view.current = { bbox: sigma.getCustomBBox() ?? sigma.getBBox(), camera: sigma.getCamera().getState() };
      // 다 가라앉은 배치만 저장한다(도중에 닫은 배치를 저장하면 다음에 열 때 그 자리에 고정돼 덜 정리된 채 남는다)
      if (finished) {
        // 화면이 아직 목표를 따라가는 중이어도 저장은 최종 자리로 한다
        attrs.forEach((a, i) => {
          a.x = target[i * 2]!;
          a.y = target[i * 2 + 1]!;
        });
        saveLayout(cacheKey, graph);
      }
      worker.postMessage({ type: 'stop' } satisfies LayoutIn);
      worker.terminate();
      sigma.kill();
      if (sigmaRef.current === sigma) sigmaRef.current = null;
      workerRef.current = null;
    };
  }, [data]);

  // 앱 테마(라이트·다크·시스템)가 바뀌면 색만 다시 읽어 칠한다
  useEffect(() => {
    const redraw = () => {
      pal.current = readPalette();
      tint.current.clear();
      sigmaRef.current?.refresh();
    };
    window.addEventListener('nops:theme', redraw);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', redraw);
    return () => {
      window.removeEventListener('nops:theme', redraw);
      mq.removeEventListener('change', redraw);
    };
  }, []);

  // 필터·그룹·강조가 바뀌면 다시 칠하기만 한다.
  useEffect(() => {
    parsedRef.current = parsed;
    sigmaRef.current?.refresh({ skipIndexation: true });
  }, [parsed, filterKey, current]);

  // 그래프 검색으로 고른 노드로 이동
  useEffect(() => {
    const s = sigmaRef.current;
    if (!focus || !s || !graphRef.current?.hasNode(focus.id)) return;
    const d = s.getNodeDisplayData(focus.id);
    if (d) void s.getCamera().animate({ x: d.x, y: d.y, ratio: 0.3 }, { duration: 450 });
    hover.current = focus.id;
    s.refresh({ skipIndexation: true });
    const t = setTimeout(() => {
      if (hover.current !== focus.id) return;
      hover.current = null;
      sigmaRef.current?.refresh({ skipIndexation: true });
    }, 2500);
    return () => clearTimeout(t);
  }, [focus]);

  // 화살표 토글
  useEffect(() => {
    sigmaRef.current?.setSetting('defaultEdgeType', settings.arrows ? 'arrow' : 'line');
  }, [settings.arrows]);

  // 힘 슬라이더
  const { gravity, repulsion, linkDistance } = settings.forces;
  useEffect(() => {
    // 마운트 직후(그리고 값이 그대로일 때)는 보내지 않는다. 예전에는 그래프를 열 때마다 이 효과가 'forces' 를 보내
    // 워커가 고정을 풀고 300번을 다시 돌렸다(다시 열 때마다·로컬 그래프에서 노트를 바꿀 때마다 흔들림).
    const cur = workerForces.current;
    if (!workerRef.current || (cur && cur.gravity === gravity && cur.repulsion === repulsion && cur.linkDistance === linkDistance)) return;
    workerForces.current = { gravity, repulsion, linkDistance };
    workerRef.current.postMessage({ type: 'forces', forces: { gravity, repulsion, linkDistance } } satisfies LayoutIn);
  }, [gravity, repulsion, linkDistance]);

  return (
    <div className="graphview" data-testid={testId}>
      {glFailure ? (
        <div className="graphview__fallback" role="status" data-testid={`${testId}-fallback`}>
          <strong>WebGL을 사용할 수 없어요</strong>
          <p className="muted small">이 컴퓨터(또는 원격·가상 환경)에서는 그래프를 그릴 수 없어요. 노트와 링크 기능은 그대로 쓸 수 있어요.</p>
          {glFailure.message && (
            <pre className="graphview__error muted small">
              <code>{glFailure.message}</code>
            </pre>
          )}
        </div>
      ) : (
        <>
          <div ref={host} className={ready ? 'graphview__canvas ready' : 'graphview__canvas'} />
          <span className="graphview__stats muted small" data-testid={`${testId}-stats`}>
            {stats}
          </span>
        </>
      )}
    </div>
  );
}
