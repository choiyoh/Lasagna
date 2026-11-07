import { describe, expect, it, vi } from 'vitest';
import { clearHover, drawBaseLabelUnlessHovered, drawsBaseLabel, labelX, resetHover, wireHover } from './hover-label';

describe('drawsBaseLabel', () => {
  it('skips the base label only for the node under the pointer', () => {
    expect(drawsBaseLabel('note-a', 'note-a')).toBe(false);
    expect(drawsBaseLabel('note-a', 'note-b')).toBe(true);
    expect(drawsBaseLabel('note-a', null)).toBe(true);
  });
});

describe('drawBaseLabelUnlessHovered', () => {
  const draw = vi.fn();

  it('skips the hovered node and draws every other node', () => {
    let hovered: string | null = 'note-a';
    const label = drawBaseLabelUnlessHovered<unknown, { key?: string }, unknown>(() => hovered, draw);
    label({}, { key: 'note-a' }, {});
    expect(draw).not.toHaveBeenCalled();
    label({}, { key: 'note-b' }, {});
    expect(draw).toHaveBeenCalledTimes(1);
    // hover 가 바뀌면 다음 호출부터 그 노드를 건너뛴다(호출 시점 판정).
    hovered = 'note-b';
    draw.mockClear();
    label({}, { key: 'note-a' }, {});
    label({}, { key: 'note-b' }, {});
    expect(draw).toHaveBeenCalledTimes(1);
  });

  it('draws when there is no hover and when the data has no key', () => {
    draw.mockClear();
    const label = drawBaseLabelUnlessHovered<unknown, { key?: string }, unknown>(() => null, draw);
    label({}, { key: 'note-a' }, {});
    label({}, {}, {});
    expect(draw).toHaveBeenCalledTimes(2);
  });
});

describe('resetHover', () => {
  it('clears both hover refs so a rebuilt graph starts without a hidden label', () => {
    const refs = { hover: { current: 'note-a' as string | null }, hoverNode: { current: 'note-a' as string | null } };
    resetHover(refs);
    expect(refs.hover.current).toBeNull();
    expect(refs.hoverNode.current).toBeNull();
  });
});

describe('wireHover / clearHover', () => {
  const fakeSigma = () => {
    const handlers = new Map<string, (e: { node: string }) => void>();
    return {
      on: (event: string, fn: (e: { node: string }) => void) => handlers.set(event, fn),
      fire: (event: string, node = '') => handlers.get(event)?.({ node }),
    };
  };

  it('enter/leave 배선이 refs 를 갱신하고 다시 그린다(배선을 지우면 실패)', () => {
    const sigma = fakeSigma();
    const refs = { hover: { current: null as string | null }, hoverNode: { current: null as string | null } };
    const refresh = vi.fn();
    wireHover(sigma, refs, refresh);
    sigma.fire('enterNode', 'note-a');
    expect(refs).toMatchObject({ hover: { current: 'note-a' }, hoverNode: { current: 'note-a' } });
    expect(refresh).toHaveBeenCalledTimes(1);
    sigma.fire('leaveNode');
    expect(refs).toMatchObject({ hover: { current: null }, hoverNode: { current: null } });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('캔버스를 바로 벗어나면 sigma 의 hoveredNode 까지 지우고 한 번 다시 그린다', () => {
    const refs = { hover: { current: 'note-a' }, hoverNode: { current: 'note-a' } };
    const sigma = { hoveredNode: 'note-a' as string | null, refresh: vi.fn() };
    clearHover(refs, sigma);
    expect(refs).toMatchObject({ hover: { current: null }, hoverNode: { current: null } });
    expect(sigma.hoveredNode).toBeNull(); // sigma 내부 상태도 정리(잔상 방지)
    expect(sigma.refresh).toHaveBeenCalledTimes(1);
    // 이미 hover 가 없으면 다시 그리지 않는다
    clearHover(refs, sigma);
    expect(sigma.refresh).toHaveBeenCalledTimes(1);
    // refs 는 비었지만 sigma 만 hover 인 경우에도 지우고 다시 그린다
    const stale = { hoveredNode: 'note-b' as string | null, refresh: vi.fn() };
    clearHover({ hover: { current: null }, hoverNode: { current: null } }, stale);
    expect(stale.hoveredNode).toBeNull();
    expect(stale.refresh).toHaveBeenCalledTimes(1);
  });
});

describe('labelX', () => {
  const place = (nodeX: number, nodeSize: number, textWidth: number, width: number) => labelX({ nodeX, nodeSize, textWidth, width });
  it('오른쪽 공간이 있으면 노드 오른쪽에 둔다', () => {
    expect(place(100, 5, 50, 400)).toBe(109);
  });
  it('오른쪽이 좁으면 노드와 겹치지 않게 왼쪽으로 옮긴다', () => {
    // 노드 오른쪽 380+5+4=389 에 라벨 100 → 넘침. 왼쪽: 380-5-4-100=271 (겹치지 않음)
    expect(place(380, 5, 100, 400)).toBe(271);
    // 왼쪽도 좁으면 잘리지 않게 오른쪽 정렬(왼쪽 여백 8)로 붙인다
    expect(place(200, 60, 500, 400)).toBe(8);
    // 노드가 아주 왼쪽이면 오른쪽 공간이 넉넉해 그대로 쓴다
    expect(place(10, 5, 50, 400)).toBe(19);
  });
  it('경계 조합에서 라벨이 노드 사각형과 겹치지 않는다', () => {
    const nodeX = 380;
    const nodeSize = 5;
    const textWidth = 100;
    const x = place(nodeX, nodeSize, textWidth, 400);
    const overlapsRight = x >= nodeX - nodeSize && x <= nodeX + nodeSize;
    const overlapsLeft = x + textWidth >= nodeX - nodeSize && x <= nodeX + nodeSize;
    expect(overlapsRight || overlapsLeft).toBe(false);
  });
});
