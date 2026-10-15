import { useEffect, useMemo, useRef, useState } from 'react';
import type { GraphData, GraphSettings } from '@nopsidian/ipc-contract';
import { GraphView } from './GraphView';
import { DEFAULT_GRAPH_SETTINGS, GROUP_PALETTE } from './settings';

const EMPTY: GraphData = { nodes: [], edges: [] };

/** 마지막으로 받은 그래프 데이터(다시 열 때 바로 그리고, 새 데이터는 뒤에서 받는다) */
const dataCache = new Map<string, { data: GraphData; sig: string }>();
/** 내용이 같은지 빠르게 비교하기 위한 서명 */
const signature = (d: GraphData) => `${d.nodes.map((n) => `${n.id}\u0001${n.label}\u0001${n.degree}`).join('\u0002')}\u0003${d.edges.map((e) => `${e.source}\u0001${e.target}`).join('\u0002')}`;

/** 노트 변경을 디바운스해 그래프 데이터를 다시 받는다. 같은 내용이면 그래프를 다시 만들지 않는다. */
function useGraphData(load: () => Promise<GraphData>, deps: unknown[], cacheKey?: string): GraphData {
  const [data, setData] = useState<GraphData>(() => (cacheKey && dataCache.get(cacheKey)?.data) || EMPTY);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () =>
      void load().then((d) => {
        if (!alive) return;
        if (!cacheKey) return setData(d);
        const sig = signature(d);
        const hit = dataCache.get(cacheKey);
        if (hit && hit.sig === sig) return setData(hit.data);
        dataCache.set(cacheKey, { data: d, sig });
        setData(d);
      });
    run();
    const off = window.nops.on('note.changed', () => {
      clearTimeout(timer);
      timer = setTimeout(run, 600);
    });
    return () => {
      alive = false;
      clearTimeout(timer);
      off();
    };
  }, deps);
  return data;
}

interface ScreenProps {
  /** 그래프 데이터 캐시를 볼트별로 나눈다 */
  vaultId?: string;
  current: string | null;
  onOpen: (path: string) => void;
  onClose: () => void;
}

/** 전역 그래프 화면: 필터·그룹·표시 옵션·힘 설정을 `.nopsidian/graph.json` 에 저장한다. */
export function GraphScreen({ vaultId, current, onOpen, onClose }: ScreenProps) {
  const [settings, setSettings] = useState<GraphSettings>(DEFAULT_GRAPH_SETTINGS);
  const loaded = useRef(false);

  useEffect(() => {
    void window.nops.graph.getSettings().then((s) => {
      if (s) setSettings(s);
      loaded.current = true;
    });
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    const t = setTimeout(() => void window.nops.graph.setSettings(settings), 500);
    return () => clearTimeout(t);
  }, [settings]);

  const { includeTags, includeUnresolved, includeOrphans } = settings;
  const data = useGraphData(
    () => window.nops.graph.global({ includeTags, includeUnresolved, includeOrphans }),
    [includeTags, includeUnresolved, includeOrphans],
    vaultId ? `${vaultId}:${includeTags}:${includeUnresolved}:${includeOrphans}` : undefined,
  );

  // 그래프 검색: 이름으로 노드를 찾아 그 자리로 화면을 옮긴다
  const [find, setFind] = useState('');
  const [focus, setFocus] = useState<{ id: string; tick: number } | null>(null);
  const matches = useMemo(() => {
    const q = find.trim().toLowerCase();
    if (!q) return [];
    return data.nodes.filter((n) => n.label.toLowerCase().includes(q)).sort((a, b) => b.degree - a.degree).slice(0, 8);
  }, [find, data]);
  const goTo = (id: string) => {
    setFocus((f) => ({ id, tick: (f?.tick ?? 0) + 1 }));
    setFind('');
  };

  const patch = (p: Partial<GraphSettings>) => setSettings((s) => ({ ...s, ...p }));
  const force = (k: keyof GraphSettings['forces'], v: number) => setSettings((s) => ({ ...s, forces: { ...s.forces, [k]: v } }));

  return (
    <div className="graphscreen" data-testid="graph-screen">
      <div className="graphscreen__bar">
        <strong>그래프</strong>
        <input
          className="graphscreen__filter"
          placeholder="필터: 단어 tag:#x path:폴더 -제외"
          value={settings.filter}
          onChange={(e) => patch({ filter: e.target.value })}
          aria-label="그래프 필터"
        />
        <div className="graphscreen__find">
          <input
            placeholder="노드 찾기"
            value={find}
            onChange={(e) => setFind(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && matches[0]) goTo(matches[0].id);
              // 찾는 말이 있으면 Esc 는 지우기만, 비어 있으면 그래프를 닫는다(앱 단축키로 넘긴다)
              if (e.key === 'Escape' && find) {
                e.stopPropagation();
                setFind('');
              }
            }}
            aria-label="노드 찾기"
          />
          {matches.length > 0 && (
            <ul className="graphscreen__matches" role="listbox" aria-label="찾은 노드">
              {matches.map((n) => (
                <li key={n.id}>
                  <button role="option" aria-selected={false} onMouseDown={(e) => e.preventDefault()} onClick={() => goTo(n.id)}>
                    {n.label} <span className="muted small">{n.degree}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button onClick={onClose} title="노트로 돌아가기 (Esc)">
          닫기
        </button>
      </div>
      <div className="graphscreen__body">
        <aside className="graphscreen__side">
          <label>
            <input type="checkbox" checked={includeTags} onChange={(e) => patch({ includeTags: e.target.checked })} /> 태그
          </label>
          <label>
            <input type="checkbox" checked={includeUnresolved} onChange={(e) => patch({ includeUnresolved: e.target.checked })} /> 미해결 링크
          </label>
          <label>
            <input type="checkbox" checked={includeOrphans} onChange={(e) => patch({ includeOrphans: e.target.checked })} /> 연결 없는 노트
          </label>
          <label>
            <input type="checkbox" checked={settings.arrows} onChange={(e) => patch({ arrows: e.target.checked })} /> 화살표
          </label>
          <h4>힘</h4>
          {(
            [
              ['gravity', '중심력'],
              ['repulsion', '반발력'],
              ['linkDistance', '링크 거리'],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="graphscreen__slider">
              <span>{label}</span>
              <input type="range" min={0} max={1} step={0.05} value={settings.forces[k]} onChange={(e) => force(k, Number(e.target.value))} aria-label={label} />
            </label>
          ))}
          <h4>색 그룹</h4>
          {settings.groups.map((g, i) => (
            <div key={i} className="graphscreen__group">
              <input
                type="color"
                value={g.color}
                onChange={(e) => patch({ groups: settings.groups.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)) })}
                aria-label="그룹 색"
              />
              <input
                value={g.query}
                placeholder="tag:#x"
                onChange={(e) => patch({ groups: settings.groups.map((x, j) => (j === i ? { ...x, query: e.target.value } : x)) })}
                aria-label="그룹 질의"
              />
              <button onClick={() => patch({ groups: settings.groups.filter((_, j) => j !== i) })} aria-label="그룹 삭제">
                ×
              </button>
            </div>
          ))}
          <button
            onClick={() => patch({ groups: [...settings.groups, { query: '', color: GROUP_PALETTE[settings.groups.length % GROUP_PALETTE.length]! }].slice(0, 20) })}
          >
            + 그룹 추가
          </button>
        </aside>
        <GraphView data={data} settings={settings} current={current} onOpen={onOpen} testId="graph-global" cacheKey="global" focus={focus} />
      </div>
    </div>
  );
}

interface LocalProps {
  path: string;
  onOpen: (path: string) => void;
}

/** 오른쪽 패널의 로컬 그래프: 현재 노트를 따라간다. */
export function LocalGraph({ path, onOpen }: LocalProps) {
  const [depth, setDepth] = useState(1);
  const [direction, setDirection] = useState<'both' | 'out' | 'in'>('both');
  const data = useGraphData(() => window.nops.graph.local({ path, depth, direction }), [path, depth, direction]);
  return (
    <div className="localgraph" data-testid="local-graph">
      <div className="localgraph__bar">
        <label>
          깊이{' '}
          <select value={depth} onChange={(e) => setDepth(Number(e.target.value))} aria-label="깊이">
            {[1, 2, 3, 4, 5].map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
        <select value={direction} onChange={(e) => setDirection(e.target.value as typeof direction)} aria-label="방향">
          <option value="both">양방향</option>
          <option value="out">나가는</option>
          <option value="in">들어오는</option>
        </select>
      </div>
      <GraphView data={data} settings={DEFAULT_GRAPH_SETTINGS} current={path} onOpen={onOpen} testId="graph-local" />
    </div>
  );
}
