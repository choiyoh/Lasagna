// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphData } from '@nopsidian/ipc-contract';
import { clearGraphDataCache, GRAPH_REFRESH_DEBOUNCE_MS, useGraphData } from './graph-data';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const make = (extraEdge = false): GraphData =>
  ({
    nodes: [
      { id: 'a.md', label: 'a', kind: 'note', degree: 1 },
      { id: 'b.md', label: 'b', kind: 'note', degree: extraEdge ? 2 : 1 },
      { id: 'c.md', label: 'c', kind: 'note', degree: extraEdge ? 1 : 0 },
    ],
    edges: [{ source: 'a.md', target: 'b.md' }, ...(extraEdge ? [{ source: 'b.md', target: 'c.md' }] : [])],
  }) as GraphData;

let listeners: (() => void)[] = [];
let container: HTMLDivElement;
let root: Root;
const seen: GraphData[] = [];

function Probe({ load, cacheKey }: { load: () => Promise<GraphData>; cacheKey?: string }) {
  seen.push(useGraphData(load, [], cacheKey));
  return null;
}

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};
const noteChanged = async () => {
  act(() => listeners.forEach((l) => l()));
  await act(async () => {
    vi.advanceTimersByTime(GRAPH_REFRESH_DEBOUNCE_MS);
  });
  await flush();
};

beforeEach(() => {
  vi.useFakeTimers();
  listeners = [];
  seen.length = 0;
  clearGraphDataCache();
  (window as unknown as { nops: unknown }).nops = {
    on: (_name: string, cb: () => void) => {
      listeners.push(cb);
      return () => (listeners = listeners.filter((l) => l !== cb));
    },
  };
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

describe('useGraphData', () => {
  for (const cacheKey of [undefined, 'global']) {
    it(`노트 본문만 바뀌어(같은 구조) 다시 받아도 같은 객체를 돌려준다 — 그래프를 다시 배치하지 않는다 (cacheKey=${cacheKey ?? '없음(로컬 그래프)'})`, async () => {
      const load = vi.fn(async () => make());
      act(() => root.render(<Probe load={load} cacheKey={cacheKey} />));
      await flush();
      const first = seen.at(-1)!;
      expect(first.nodes).toHaveLength(3);
      const renders = seen.length;
      for (let i = 0; i < 5; i++) await noteChanged(); // 글자를 칠 때마다 자동 저장 → note.changed
      expect(load).toHaveBeenCalledTimes(6);
      expect(seen.length).toBe(renders); // 다시 그리지도 않는다
      expect(seen.at(-1)).toBe(first);
    });
  }

  it('같은 그래프를 다른 순서로 받아도 같은 객체를 돌려준다', async () => {
    let flip = false;
    act(() => root.render(<Probe load={async () => (flip ? { nodes: [...make().nodes].reverse(), edges: make().edges } : make())} />));
    await flush();
    const first = seen.at(-1)!;
    flip = true;
    await noteChanged();
    expect(seen.at(-1)).toBe(first);
  });

  it('링크가 바뀌면 새 데이터를 돌려준다', async () => {
    let extra = false;
    act(() => root.render(<Probe load={async () => make(extra)} />));
    await flush();
    const first = seen.at(-1)!;
    extra = true;
    await noteChanged();
    expect(seen.at(-1)).not.toBe(first);
    expect(seen.at(-1)!.edges).toHaveLength(2);
  });

  it('불러오기가 실패해도 지금 그래프를 그대로 둔다(처리되지 않은 거부 없음)', async () => {
    let fail = false;
    act(() => root.render(<Probe load={() => (fail ? Promise.reject(new Error('닫힘')) : Promise.resolve(make()))} />));
    await flush();
    const first = seen.at(-1)!;
    fail = true;
    await noteChanged();
    expect(seen.at(-1)).toBe(first);
  });
});
