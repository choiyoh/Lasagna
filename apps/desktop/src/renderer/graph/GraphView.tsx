import { useEffect, useMemo, useRef, useState } from 'react';
import Graph from 'graphology';
import Sigma from 'sigma';
import { EdgeArrowProgram, EdgeRectangleProgram } from 'sigma/rendering';
import type { GraphData, GraphSettings } from '@nopsidian/ipc-contract';
import { colorForNode, filterNodes, matchesQuery, parseGraphQuery } from './filter';
import type { LayoutIn, LayoutOut } from './layout-worker';
import { WARM_KNOWN_SAVED, adjacency, planLayout, type Point } from './layout-plan';
import { alpha, mix, readPalette, type GraphPalette } from './palette';
import { NodeGlowProgram } from './node-glow';
import { LEGACY_GLOBAL_KEY, loadLayout, saveLayout } from './layout-cache';
import { SETTLE_WINDOW_MS, SPINNER_DELAY_MS, isSettled, statsText } from './settle';
import { webglAvailable } from './webgl';
import { EmptyState } from '../components/EmptyState';
import { drawsBaseLabel } from './hover-label';

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
  /** 필터가 0건일 때 "필터 지우기" — 없으면 버튼을 숨긴다(로컬 그래프) */
  onClearFilter?: () => void;
}


/** sigma + graphology 로 그래프를 그린다. 레이아웃은 워커에서 돌고, 위치만 받아 갱신한다. */
export function GraphView({ data, settings, current, onOpen, testId, cacheKey, focus, onClearFilter }: Props) {
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
  /** sigma 가 실제로 hover 중인 노드(검색 포커스와 구분한다) */
  const hoverNode = useRef<string | null>(null);
  const live = useRef({ settings, current, onOpen });
  live.current = { settings, current, onOpen };
  const [stats, setStats] = useState('');
  /** WebGL 을 못 쓰면 그래프 대신 안내를 보여 준다(사유가 있으면 함께 보여 준다) */
  const [glFailure, setGlFailure] = useState<{ message: string } | null>(null);
  /**
   * 캔버스를 언제 보여 줄지. 저장된(수렴한) 배치가 이 그래프의 노드를 거의 다 덮으면
   * 워커를 기다리지 않고 **저장된 자리로 바로** 그린다(Obsidian 처럼 진입 시 재배치하지 않는다).
   * 콜드일 때만 첫 배치가 끝날 때까지 숨긴다.
   */
  const [ready, setReady] = useState(() => {
    if (!cacheKey || data.nodes.length === 0) return false;
    const cached = loadLayout(cacheKey, LEGACY_GLOBAL_KEY);
    if (!cached.found) return false;
    // 개수가 아니라 같은 id 를 덮는지 본다(다른 볼트·크게 바뀐 그래프에서 낡은 자리를 비추지 않게)
    let known = 0;
    for (const n of data.nodes) if (cached.positions.has(n.id)) known++;
    return known / data.nodes.length >= WARM_KNOWN_SAVED;
  });
  /** 실제 움직임이 잦아들었는가 — 반복 횟수가 아니라 화면 이동량에서 파생한다 */
  const [settled, setSettled] = useState(false);
  /** 400ms 넘게 안 가라앉을 때만 작은 스피너를 보여 준다 */
  const [slow, setSlow] = useState(false);
  const settledRef = useRef(false);
  const settleBase = useRef<Float32Array | null>(null);
  const settleAt = useRef(0);
  /** 노드별 기본 색(연결이 많을수록 강조색에 가깝게). 테마가 바뀌거나 그래프를 다시 만들면 비운다 */
  const tint = useRef(new Map<string, string>());
  /** 테마가 바뀌면 다시 읽는다 */
  const pal = useRef<GraphPalette>(readPalette());

  const parsedRef = useRef(parseGraphQuery(settings.filter));
  const parsed = useMemo(() => parseGraphQuery(settings.filter), [settings.filter]);
  const filterKey = settings.filter + JSON.stringify(settings.groups);
  /** 필터와 일치하는 노드 수(0이면 안내를 띄운다) */
  const matchCount = useMemo(() => filterNodes(data.nodes, settings.filter).length, [data, settings.filter]);
  const filteredOut = settings.filter.trim().length > 0 && matchCount === 0;
  const matchRef = useRef(matchCount);
  matchRef.current = matchCount;

  // 가라앉기 전에도 잠깐이면 스피너를 띄우지 않는다(첫 프레임에서 깜빡이지 않게)
  useEffect(() => {
    if (settled) {
      setSlow(false);
      return;
    }
    const t = setTimeout(() => setSlow(true), SPINNER_DELAY_MS);
    return () => clearTimeout(t);
  }, [settled]);

  // 데이터가 바뀔 때마다 그래프와 워커를 새로 만든다. 이전 위치는 id 기준으로 이어 받는다.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    settledRef.current = false;
    settleBase.current = null;
    settleAt.current = 0;
    setSettled(false);
    // WebGL 을 못 쓰는 환경(원격 데스크톱·가상 머신·GPU 차단 목록)에서는 sigma 가 예외를 던진다.
    // 앱을 죽이는 대신 그래프 자리에 안내를 보여 주고, 노트·링크 기능은 그대로 쓴다.
    if (!webglAvailable()) {
      setGlFailure({ message: '' });
      return;
    }
    const prev = graphRef.current;
    const graph = new Graph({ type: 'directed', multi: false });
    // 이전 자리: 지금 그래프가 있으면 그 자리를, 처음 열면 저장해 둔 배치를 쓴다
    const cached = loadLayout(cacheKey, cacheKey ? LEGACY_GLOBAL_KEY : undefined);
    const prevPos = new Map<string, Point>();
    if (prev) prev.forEachNode((id, a) => prevPos.set(id, [a.x as number, a.y as number]));
    else for (const [id, p] of cached.positions) prevPos.set(id, p);
    // 연결이 그대로인 노드는 고정하고, 바뀐 곳만 움직인다(같은 그래프를 다시 열거나 링크 하나가 늘어도 전체가 흔들리지 않게)
    const plan = planLayout(data, prevPos, prev ? prevAdj.current : undefined);
    // 지난 배치가 아직 도는 중이었다면(열자마자 노트가 바뀐 경우) 고정하지 않고 이어서 돌린다.
    // 저장된 배치가 "수렴하지 않은"(done:false) 것이면 고정하지 않고 이어서 다듬는다(resume)
    const settled = !prev ? cached.done : prevFinished.current;
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
          // 호버 라벨이 같은 자리를 한 번 더 그리므로 기본 라벨은 숨긴다(글자 겹침 방지).
          const key = (data as { key?: string }).key;
          if (key && !drawsBaseLabel(key, hoverNode.current)) return;
          const p = pal.current;
          const size = settings.labelSize;
          ctx.font = `${settings.labelWeight} ${size}px ${settings.labelFont}`;
          const x = data.x + data.size + 4;
          const y = data.y + size / 3;
          // 배경색 테두리(후광)로 선·점 위에서도 글자가 또렷하게 보인다
          ctx.lineWidth = 3;
          ctx.lineJoin = 'round';
          ctx.strokeStyle = alpha(p.bg, p.dark ? 0.9 : 0.95);
          ctx.strokeText(data.label, x, y);
          ctx.fillStyle = p.fg;
          ctx.fillText(data.label, x, y);
        },
        defaultDrawNodeHover: (ctx, data, settings) => {
          const p = pal.current;
          ctx.beginPath();
          ctx.arc(data.x, data.y, data.size + 5, 0, Math.PI * 2);
          ctx.fillStyle = alpha(p.accent, p.dark ? 0.22 : 0.16);
          ctx.fill();
          if (data.label) {
            const size = settings.labelSize + 1;
            ctx.font = `600 ${size}px ${settings.labelFont}`;
            const x = data.x + data.size + 8;
            const y = data.y + size / 3;
            ctx.lineWidth = 4;
            ctx.lineJoin = 'round';
            ctx.strokeStyle = alpha(p.bg, p.dark ? 0.92 : 0.96);
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
    const keepView = plan.warm && prev !== null && view.current !== null;
    if (keepView) {
      sigma.setCustomBBox(view.current!.bbox);
      sigma.getCamera().setState(view.current!.camera);
    }
    // 저장된 자리로 여는 경우(웜)는 이미 그릴 것이 있다 — 워커가 다듬는 동안에도 바로 보여 준다.
    // (콜드일 때만 첫 배치가 끝날 때까지 캔버스를 숨긴다)
    if (plan.warm) setReady(true);
    // 수렴하지 않은 파일 캐시로 처음 열 때는 그 자리를 그대로 보여 주고, 워커의 이어서 다듬기는
    // 화면에 반영하지 않고 저장만 한다(다음 진입에서 더 나은 자리로 열린다). 화면이 튀지 않는다.
    const paintOnly = !prev && cached.found && !cached.done;
    view.current = null;

    // 배치가 도는 동안에는 첫 페인트의 bbox 로 화면 틀을 고정한다(카메라는 레이아웃과 독립).
    // 사용자가 이미 줌·이동해 둔 화면(keepView/custom bbox)은 건드리지 않는다.
    let frozenBBox = false;
    const freezeView = () => {
      if (frozenBBox || keepView || sigma.getCustomBBox()) return;
      const b = sigma.getBBox();
      if (!b) return;
      sigma.setCustomBBox(b);
      frozenBBox = true;
    };
    sigma.on('clickNode', ({ node }) => {
      if (node.startsWith('#') || node.startsWith('?')) return;
      live.current.onOpen(node);
    });
    sigma.on('enterNode', ({ node }) => {
      hover.current = node;
      hoverNode.current = node;
      sigma.refresh({ skipIndexation: true });
    });
    sigma.on('leaveNode', () => {
      hover.current = null;
      hoverNode.current = null;
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
    /** 워커가 한 번이라도 자리를 보냈는가(보내기 전에 닫으면 저장하지 않는다) */
    let gotFirst = false;
    /** 저장할 좌표: 화면 노드가 아니라 워커가 마지막으로 계산한 목표 자리 */
    const snapshot = (): Map<string, [number, number]> => {
      const out = new Map<string, [number, number]>();
      ids.forEach((id, i) => out.set(id, [target[i * 2]!, target[i * 2 + 1]!]));
      return out;
    };
    let raf = 0;
    let finished = false;
    /** 마지막으로 받은 배치가 실제로 수렴했는가(캐시를 done 으로 저장해도 되는가) */
    let layoutSettled = false;
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
      // 배치 중에는 bbox·정규화를 다시 계산하지 않는다 — 화면 배율이 흔들리지 않고(리뷰 원인 4),
      // 색인 비용도 들지 않는다. 마지막에 한 번만 전체 refresh 로 자동 맞춤한다.
      sigma.refresh({ skipIndexation: true });
      if (moving) raf = requestAnimationFrame(follow);
      else if (finished) {
        // 수렴이 끝났을 때만 한 번 자동 맞춤한다(그 전까지 배율이 흔들리지 않게 bbox 를 고정했다)
        if (frozenBBox) sigma.setCustomBBox(null);
        sigma.refresh();
        saveLayout(cacheKey, snapshot(), layoutSettled);
      }
    };
    const warm = plan.warm && settled;
    // 도는 중이던 배치를 이어받을 때는 캔버스를 숨기지 않는다(숨기면 데이터가 갱신될 때마다 깜빡인다)
    const resume = plan.warm && !settled;
    if (!plan.warm) setReady(false);
    worker.onmessage = (ev: MessageEvent<LayoutOut>) => {
      const { positions, done, busy, settled: converged } = ev.data;
      gotFirst = true;
      target.set(positions);
      finished = done;
      layoutSettled = converged;
      if (done) prevFinished.current = true;
      if (first) {
        first = false;
        if (paintOnly) {
          // 캐시 자리를 이미 보여 주고 있다 — 이번 계산 결과는 저장만 하고 화면은 그대로 둔다
          if (finished) saveLayout(cacheKey, snapshot(), layoutSettled);
        } else {
          // 미리 돌려 둔 첫 배치는 곧바로 보여 주고(자리 잡기), 이후 변화만 부드럽게 따라간다
          attrs.forEach((a, i) => {
            a.x = target[i * 2]!;
            a.y = target[i * 2 + 1]!;
          });
          // 여기서 한 번 전체 refresh 해야 최종 bbox 로 화면이 맞는다(이후에는 skipIndexation)
          sigma.refresh();
          setReady(true);
          if (finished) saveLayout(cacheKey, snapshot(), layoutSettled);
          else freezeView();
        }
      } else if (!raf) {
        freezeView();
        raf = requestAnimationFrame(follow);
      }
      // 반복 횟수(done)가 아니라 실제 이동량으로 "배치 중"을 끝낸다(캔버스가 멈춘 뒤에도 문구가 남지 않게)
      const now = performance.now();
      // 워커가 명시적으로 멈추면(busy=false) 이동량과 무관하게 문구를 닫는다(예산 초과 볼트)
      let nowSettled = settledRef.current || done || !busy;
      if (!nowSettled) {
        const base = settleBase.current;
        if (!base) {
          settleBase.current = positions.slice();
          settleAt.current = now;
        } else if (now - settleAt.current >= SETTLE_WINDOW_MS) {
          nowSettled = isSettled(base, positions, now - settleAt.current);
          settleBase.current = positions.slice();
          settleAt.current = now;
        }
      }
      if (nowSettled !== settledRef.current) {
        settledRef.current = nowSettled;
        setSettled(nowSettled);
      }
      setStats(statsText(ids.length, graph.size, nowSettled, matchRef.current));
      // 예산 안에 수렴하지 못해 잠시 멈춘 배치도 남긴다 — 다음 진입에서 이어서 다듬는다(done:false)
      if (!done && !busy) saveLayout(cacheKey, snapshot(), false);
    };
    const fixed = warm ? Uint8Array.from(ids, (id) => (plan.fixed.has(id) ? 1 : 0)) : undefined;
    const init: LayoutIn = { type: 'init', ids, positions: pos, edges: new Uint32Array(edgeArr), forces: live.current.settings.forces, warm, resume, ...(fixed ? { fixed } : {}) };
    workerForces.current = init.forces;
    worker.postMessage(init);
    // 캐시 자리를 보여 주며 뒤에서 다듬는 경우(paintOnly)는 화면이 이미 정적이다 — 문구·스피너를 켜지 않는다
    setStats(statsText(ids.length, graph.size, paintOnly, matchRef.current));
    if (paintOnly) {
      settledRef.current = true;
      setSettled(true);
    }

    return () => {
      cancelAnimationFrame(raf);
      view.current = { bbox: sigma.getCustomBBox() ?? sigma.getBBox(), camera: sigma.getCamera().getState() };
      // 도중에 닫아도 다음 진입이 콜드가 되지 않게, 계산된 마지막 자리를 수렴 여부와 함께 남긴다.
      // (수렴 전이면 done:false 로 저장돼 다음에는 고정 없이 이어서 다듬는다)
      if (gotFirst) saveLayout(cacheKey, snapshot(), layoutSettled);
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

  // 필터 일치 수가 바뀌면 통계 문구(0 / 320)도 바로 따라간다
  useEffect(() => {
    const g = graphRef.current;
    if (!g) return;
    setStats(statsText(data.nodes.length, g.size, settledRef.current, matchCount));
  }, [matchCount, data]);

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
          {filteredOut && (
            <div className="graphview__empty">
              <EmptyState
                title="조건에 맞는 노드가 없어요"
                description="필터를 지우거나 조건을 바꿔 보세요."
                onReset={onClearFilter}
                resetLabel="필터 지우기"
              />
            </div>
          )}
          <span className="graphview__stats muted small" data-testid={`${testId}-stats`}>
            {slow && <i className="graphview__spin" role="img" aria-label="배치 중" />}
            {stats}
          </span>
        </>
      )}
    </div>
  );
}
