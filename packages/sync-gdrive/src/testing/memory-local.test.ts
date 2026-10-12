import { describe, expect, it } from 'vitest';
import { sha256Hex, text, utf8 } from '../hash.js';
import { MemoryLocal } from './memory-local.js';

describe('MemoryLocal.scan', () => {
  it('경로순으로 hash·size 를 채워 돌려준다', async () => {
    const local = new MemoryLocal();
    await local.write('b.md', utf8('BB'));
    await local.write('a.md', utf8('A'));

    expect(await local.scan()).toEqual([
      { path: 'a.md', hash: sha256Hex('A'), size: 1 },
      { path: 'b.md', hash: sha256Hex('BB'), size: 2 },
    ]);
    expect(local.paths()).toEqual(['a.md', 'b.md']);
  });

  it('한글 내용도 UTF-8 바이트 길이로 센다', async () => {
    const local = new MemoryLocal();
    local.edit('a.md', '한글');

    expect(await local.scan()).toEqual([{ path: 'a.md', hash: sha256Hex('한글'), size: 6 }]);
  });
});

describe('MemoryLocal.write / read', () => {
  it('쓴 내용과 LocalFile 을 돌려주고 호출 순서를 기록한다', async () => {
    const local = new MemoryLocal();

    const file = await local.write('a.md', utf8('A'));
    await local.write('b.md', utf8('B'));

    expect(file).toEqual({ path: 'a.md', hash: sha256Hex('A'), size: 1 });
    expect(local.writes).toEqual(['a.md', 'b.md']);
    expect(text(await local.read('a.md'))).toBe('A');
  });

  it('없는 경로를 읽으면 Error', async () => {
    const local = new MemoryLocal();

    await expect(local.read('a.md')).rejects.toThrow('없는 경로: a.md');
  });

  it('넘긴 바이트와 돌려준 바이트는 각각 복사본이다', async () => {
    const local = new MemoryLocal();
    const src = utf8('A');
    await local.write('a.md', src);

    src[0] = 66;
    expect(text(await local.read('a.md'))).toBe('A');

    const read = await local.read('a.md');
    read[0] = 67;
    expect(text(await local.read('a.md'))).toBe('A');
  });
});

describe('MemoryLocal.trash', () => {
  it('내용을 휴지통 기록에 남기고 경로는 지운다', async () => {
    const local = new MemoryLocal();
    const src = utf8('A');
    await local.write('a.md', src);

    await local.trash('a.md');
    src[0] = 66; // 원본 배열을 고쳐도 휴지통 내용은 그대로다

    expect(local.trashed).toEqual([{ path: 'a.md', content: utf8('A') }]);
    expect(local.paths()).toEqual([]);
    expect(local.writes).toEqual(['a.md']); // 휴지통 이동은 쓰기가 아니다
  });

  it('없는 경로는 Error 이고 휴지통 기록도 남지 않는다', async () => {
    const local = new MemoryLocal();

    await expect(local.trash('a.md')).rejects.toThrow('없는 경로: a.md');
    expect(local.trashed).toEqual([]);
  });
});

describe('MemoryLocal.move', () => {
  it('내용을 그대로 옮기고 기록은 남기지 않는다', async () => {
    const local = new MemoryLocal();
    await local.write('a.md', utf8('A'));

    await local.move('a.md', '폴더/b.md');

    expect(local.paths()).toEqual(['폴더/b.md']);
    expect(text(await local.read('폴더/b.md'))).toBe('A');
    expect(local.writes).toEqual(['a.md']);
  });

  it('대상이 이미 있으면 Error 이고 양쪽 모두 그대로다', async () => {
    const local = new MemoryLocal();
    await local.write('a.md', utf8('A'));
    await local.write('b.md', utf8('B'));

    await expect(local.move('a.md', 'b.md')).rejects.toThrow('이미 있는 경로: b.md');
    expect(text(await local.read('a.md'))).toBe('A');
    expect(text(await local.read('b.md'))).toBe('B');
  });

  it('없는 from 이면 Error', async () => {
    const local = new MemoryLocal();

    await expect(local.move('a.md', 'b.md')).rejects.toThrow('없는 경로: a.md');
  });

  it('같은 경로로 옮기면 아무 일도 없다', async () => {
    const local = new MemoryLocal();
    await local.write('a.md', utf8('A'));

    await local.move('a.md', 'a.md');

    expect(local.paths()).toEqual(['a.md']);
    expect(text(await local.read('a.md'))).toBe('A');
  });
});

describe('MemoryLocal 도우미', () => {
  it('edit 은 쓰기 기록 없이 내용만 바꾼다', async () => {
    const local = new MemoryLocal();
    await local.write('a.md', utf8('A'));

    local.edit('a.md', '고침');
    local.edit('새.md', '새 파일');

    expect(local.writes).toEqual(['a.md']);
    expect(local.contentOf('a.md')).toBe('고침');
    expect(local.paths()).toEqual(['a.md', '새.md']);
  });

  it('remove 는 휴지통 기록 없이 지운다', async () => {
    const local = new MemoryLocal();
    await local.write('a.md', utf8('A'));

    local.remove('a.md');

    expect(local.trashed).toEqual([]);
    expect(local.paths()).toEqual([]);
    expect(local.contentOf('a.md')).toBeUndefined();
    expect(() => local.remove('a.md')).toThrow('없는 경로: a.md');
  });

  it('exists 는 파일이 있는지만 본다', async () => {
    const local = new MemoryLocal();

    expect(await local.exists('a.md')).toBe(false);
    await local.write('a.md', utf8('A'));
    expect(await local.exists('a.md')).toBe(true);
  });
});
