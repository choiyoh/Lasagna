import { describe, expect, it, vi } from 'vitest';
import { drawBaseLabelUnlessHovered, drawsBaseLabel, resetHover } from './hover-label';

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
