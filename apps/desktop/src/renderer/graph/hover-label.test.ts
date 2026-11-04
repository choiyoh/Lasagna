import { describe, expect, it } from 'vitest';
import { drawsBaseLabel } from './hover-label';

describe('drawsBaseLabel', () => {
  it('skips the base label only for the node under the pointer', () => {
    expect(drawsBaseLabel('note-a', 'note-a')).toBe(false);
    expect(drawsBaseLabel('note-a', 'note-b')).toBe(true);
    expect(drawsBaseLabel('note-a', null)).toBe(true);
  });
});
