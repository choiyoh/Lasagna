import { describe, expect, it } from 'vitest';
import { splitUnits } from '../merge3.js';
import { assemble, parseNote, replaceBlock } from './parse.js';

import { generateNote as generate, randomGarbage } from '../testing/corpus.js';

function checkInvariants(src: string) {
  const note = parseNote(src);
  expect(assemble(note)).toBe(src);
  expect(splitUnits(src).join('')).toBe(src);
  let prev = note.frontmatter?.end ?? 0;
  for (const b of note.blocks) {
    expect(b.start).toBeGreaterThanOrEqual(prev);
    expect(b.end).toBeGreaterThan(b.start);
    expect(src.slice(b.start, b.end)).toBe(b.source);
    expect(b.lineEnd).toBeGreaterThanOrEqual(b.lineStart);
    // 같은 내용으로 교체해도 문서는 바뀌지 않는다
    expect(replaceBlock(note, b.index, b.source)).toBe(src);
    prev = b.end;
  }
  const lines = src.split('\n').length;
  for (const l of note.meta.links) {
    expect(l.line).toBeGreaterThanOrEqual(1);
    expect(l.line).toBeLessThanOrEqual(lines);
  }
}

describe('라운드트립 코퍼스', () => {
  it('합성 노트 500개가 바이트 단위로 보존된다', () => {
    for (let seed = 1; seed <= 500; seed++) {
      const src = generate(seed);
      try {
        checkInvariants(src);
      } catch (e) {
        throw new Error(`seed ${seed} 실패\n${JSON.stringify(src)}\n${e instanceof Error ? e.message : e}`);
      }
    }
  });

  it('임의의 깨진 입력 3000개에서도 예외 없이 보존된다', () => {
    for (let seed = 1; seed <= 3000; seed++) {
      const src = randomGarbage(seed);
      try {
        checkInvariants(src);
      } catch (e) {
        throw new Error(`garbage seed ${seed} 실패\n${JSON.stringify(src)}\n${e instanceof Error ? e.message : e}`);
      }
    }
  });
});
