import { describe, expect, it, vi } from 'vitest';
import { clampLabelX, clearHover, drawBaseLabelUnlessHovered, drawsBaseLabel, resetHover, wireHover } from './hover-label';

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

  it('캔버스를 바로 벗어나면 hover 를 지우고 한 번 다시 그린다', () => {
    const refs = { hover: { current: 'note-a' }, hoverNode: { current: 'note-a' } };
    const refresh = vi.fn();
    clearHover(refs, refresh);
    expect(refs).toMatchObject({ hover: { current: null }, hoverNode: { current: null } });
    expect(refresh).toHaveBeenCalledTimes(1);
    // 이미 hover 가 없으면 다시 그리지 않는다
    clearHover(refs, refresh);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe('clampLabelX', () => {
  it('오른쪽으로 넘치면 안쪽으로 당기고, 왼쪽 여백보다 앞으로는 가지 않는다', () => {
    expect(clampLabelX(100, 50, 400, 0)).toBe(100); // 넘치지 않음
    expect(clampLabelX(380, 100, 400, 0)).toBe(292); // 400-8-100
    expect(clampLabelX(10, 500, 400, 0)).toBe(8); // 아주 긴 라벨은 왼쪽 여백에 붙는다
  });
});
