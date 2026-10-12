import { describe, expect, it } from 'vitest';
import { sha256Hex, text, utf8 } from '../hash.js';
import type { SyncEntry } from '../types.js';
import { MemoryState } from './memory-state.js';

const entry = (path: string, driveId = 'f1'): SyncEntry => ({ path, driveId, hash: sha256Hex(path), revision: 'r1' });

describe('MemoryState entries', () => {
  it('경로순으로 돌려주고 같은 경로는 덮어쓴다', async () => {
    const state = new MemoryState();
    await state.put(entry('b.md'));
    await state.put(entry('a.md'));
    await state.put(entry('a.md', 'f2'));

    expect((await state.entries()).map((e) => [e.path, e.driveId])).toEqual([
      ['a.md', 'f2'],
      ['b.md', 'f1'],
    ]);
  });

  it('돌려준 객체를 고쳐도 저장된 기록은 그대로다', async () => {
    const state = new MemoryState();
    await state.put(entry('a.md'));

    const first = await state.entries();
    first[0]!.revision = 'r99';
    first[0]!.path = 'x.md';

    expect(await state.entries()).toEqual([entry('a.md')]);
  });

  it('넘긴 객체를 나중에 고쳐도 저장된 기록은 그대로다', async () => {
    const state = new MemoryState();
    const e = entry('a.md');
    await state.put(e);

    e.revision = 'r99';

    expect((await state.entries())[0]?.revision).toBe('r1');
  });

  it('remove 는 그 경로만 지운다', async () => {
    const state = new MemoryState();
    await state.put(entry('a.md'));
    await state.put(entry('b.md'));

    await state.remove('a.md');

    expect((await state.entries()).map((e) => e.path)).toEqual(['b.md']);
  });
});

describe('MemoryState base 스냅샷', () => {
  it('없으면 null', async () => {
    const state = new MemoryState();

    expect(await state.getBase('a.md')).toBeNull();
  });

  it('저장·조회가 왕복하고 바이트는 복사된다', async () => {
    const state = new MemoryState();
    const src = utf8('base');
    await state.putBase('a.md', src);

    src[0] = 88; // 넘긴 배열을 고쳐도 저장된 값은 그대로
    expect(text((await state.getBase('a.md')) ?? new Uint8Array())).toBe('base');

    const read = await state.getBase('a.md');
    read![0] = 89; // 돌려받은 배열을 고쳐도 마찬가지
    expect(text((await state.getBase('a.md')) ?? new Uint8Array())).toBe('base');
  });

  it('빈 파일도 null 이 아니다', async () => {
    const state = new MemoryState();
    await state.putBase('a.md', utf8(''));

    expect(await state.getBase('a.md')).toEqual(new Uint8Array());
  });

  it('removeBase 는 그 경로의 스냅샷만 지운다', async () => {
    const state = new MemoryState();
    await state.putBase('a.md', utf8('A'));
    await state.putBase('b.md', utf8('B'));

    await state.removeBase('a.md');

    expect(await state.getBase('a.md')).toBeNull();
    expect(text((await state.getBase('b.md')) ?? new Uint8Array())).toBe('B');
  });
});
