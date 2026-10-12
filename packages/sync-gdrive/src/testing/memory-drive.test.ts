import { describe, expect, it } from 'vitest';
import { sha256Hex, text, utf8 } from '../hash.js';
import { RevisionConflictError } from '../types.js';
import { MemoryDrive } from './memory-drive.js';

describe('MemoryDrive.upload', () => {
  it('새 파일은 f1/r1 로 만들고 hash 는 실제 내용에서 계산한다', async () => {
    const drive = new MemoryDrive();
    const f = await drive.upload({ path: 'a.md', bytes: utf8('안'), hash: sha256Hex('안') });

    expect(f).toEqual({ id: 'f1', path: 'a.md', hash: sha256Hex('안'), revision: 'r1', size: utf8('안').length });
    expect(drive.calls).toEqual(['upload:a.md']);
    expect(drive.paths()).toEqual(['a.md']);
  });

  it('해시가 내용과 다르면 저장하지 않는다', async () => {
    const drive = new MemoryDrive();

    await expect(drive.upload({ path: 'a.md', bytes: utf8('안'), hash: sha256Hex('다른 내용') })).rejects.toThrow('hash 불일치: a.md');
    expect(drive.paths()).toEqual([]);
  });

  it('이미 있는 경로에 새 파일을 만들려 하면 덮어쓰지도 중복 id 를 만들지도 않는다', async () => {
    const drive = new MemoryDrive();
    await drive.upload({ path: 'a.md', bytes: utf8('v1'), hash: sha256Hex('v1') });

    await expect(drive.upload({ path: 'a.md', bytes: utf8('v2'), hash: sha256Hex('v2') })).rejects.toThrow('이미 있는 경로: a.md');
    const list = await drive.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe('f1');
    expect(drive.contentOf('a.md')).toBe('v1');
  });

  it('existing 의 revision 이 다르면 RevisionConflictError 를 던지고 내용을 건드리지 않는다', async () => {
    const drive = new MemoryDrive();
    const f = await drive.upload({ path: 'a.md', bytes: utf8('v1'), hash: sha256Hex('v1') });
    const changed = drive.putExternal('a.md', '사람이 고침'); // revision 이 r2 로 올라간다

    const err = await drive.upload({ path: 'a.md', bytes: utf8('v2'), hash: sha256Hex('v2'), existing: { id: f.id, revision: f.revision } }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RevisionConflictError);
    expect((err as RevisionConflictError).path).toBe('a.md');
    expect(drive.contentOf('a.md')).toBe('사람이 고침');
    expect((await drive.list())[0]?.revision).toBe(changed.revision);
  });

  it('revision 이 맞으면 내용을 갈아 끼우고 revision 을 올린다', async () => {
    const drive = new MemoryDrive();
    const f = await drive.upload({ path: 'a.md', bytes: utf8('v1'), hash: sha256Hex('v1') });

    const g = await drive.upload({ path: 'a.md', bytes: utf8('v2!'), hash: sha256Hex('v2!'), existing: { id: f.id, revision: f.revision } });

    expect(g).toEqual({ id: 'f1', path: 'a.md', hash: sha256Hex('v2!'), revision: 'r2', size: 3 });
    expect(drive.contentOf('a.md')).toBe('v2!');
  });

  it('없는 id 로 교체하려 하면 Error', async () => {
    const drive = new MemoryDrive();

    await expect(drive.upload({ path: 'a.md', bytes: utf8('v'), hash: sha256Hex('v'), existing: { id: 'f9', revision: 'r1' } })).rejects.toThrow('없는 파일: f9');
  });

  it('넘긴 바이트를 나중에 고쳐도 저장된 내용은 그대로다', async () => {
    const drive = new MemoryDrive();
    const bytes = utf8('v1');
    await drive.upload({ path: 'a.md', bytes, hash: sha256Hex(bytes) });

    bytes[0] = 88;
    expect(drive.contentOf('a.md')).toBe('v1');
  });
});

describe('MemoryDrive.list / download', () => {
  it('경로순으로 돌려주고 휴지통 파일은 뺀다', async () => {
    const drive = new MemoryDrive();
    await drive.upload({ path: 'b.md', bytes: utf8('B'), hash: sha256Hex('B') });
    await drive.upload({ path: 'a.md', bytes: utf8('A'), hash: sha256Hex('A') });
    await drive.trash('f1');

    expect((await drive.list()).map((f) => f.path)).toEqual(['a.md']);
  });

  it('list 가 돌려준 객체를 고쳐도 내부 상태는 그대로다', async () => {
    const drive = new MemoryDrive();
    await drive.upload({ path: 'a.md', bytes: utf8('A'), hash: sha256Hex('A') });

    const first = await drive.list();
    first[0]!.path = 'x.md';
    first[0]!.revision = 'r99';

    expect((await drive.list()).map((f) => f.path)).toEqual(['a.md']);
    expect((await drive.list())[0]?.revision).toBe('r1');
  });

  it('download 는 바이트 복사본을 준다', async () => {
    const drive = new MemoryDrive();
    await drive.upload({ path: 'a.md', bytes: utf8('A'), hash: sha256Hex('A') });

    const bytes = await drive.download('f1');
    bytes[0] = 66;

    expect(text(await drive.download('f1'))).toBe('A');
  });

  it('없는 id 는 Error', async () => {
    const drive = new MemoryDrive();

    await expect(drive.download('f1')).rejects.toThrow('없는 파일: f1');
  });
});

describe('MemoryDrive.move', () => {
  it('id 는 유지, 경로만 바꾸고 revision 은 바꾸지 않는다', async () => {
    const drive = new MemoryDrive();
    await drive.upload({ path: 'a.md', bytes: utf8('A'), hash: sha256Hex('A') });

    const moved = await drive.move('f1', '폴더/b.md');

    expect(moved).toEqual({ id: 'f1', path: '폴더/b.md', hash: sha256Hex('A'), revision: 'r1', size: 1 });
    expect(drive.paths()).toEqual(['폴더/b.md']);
    expect(drive.calls).toEqual(['upload:a.md', 'move:f1:폴더/b.md']);
  });

  it('대상 경로에 다른 파일이 있으면 Error 이고 아무것도 바뀌지 않는다', async () => {
    const drive = new MemoryDrive();
    await drive.upload({ path: 'a.md', bytes: utf8('A'), hash: sha256Hex('A') });
    await drive.upload({ path: 'b.md', bytes: utf8('B'), hash: sha256Hex('B') });

    await expect(drive.move('f1', 'b.md')).rejects.toThrow('이미 있는 경로: b.md');
    expect(drive.paths()).toEqual(['a.md', 'b.md']);
    expect(drive.contentOf('b.md')).toBe('B');
  });

  it('없는 id 는 Error', async () => {
    const drive = new MemoryDrive();

    await expect(drive.move('f1', 'b.md')).rejects.toThrow('없는 파일: f1');
  });
});

describe('MemoryDrive.trash', () => {
  it('목록에서 빠지고 내용도 더는 못 읽는다', async () => {
    const drive = new MemoryDrive();
    await drive.upload({ path: 'a.md', bytes: utf8('A'), hash: sha256Hex('A') });

    await drive.trash('f1');

    expect(drive.paths()).toEqual([]);
    expect(drive.contentOf('a.md')).toBeUndefined();
    await expect(drive.download('f1')).rejects.toThrow('없는 파일: f1');
    // 실패한 호출도 시도이므로 기록에 남는다
    expect(drive.calls).toEqual(['upload:a.md', 'trash:f1', 'download:f1']);
  });

  it('없는 id 는 Error', async () => {
    const drive = new MemoryDrive();

    await expect(drive.trash('f1')).rejects.toThrow('없는 파일: f1');
  });
});

describe('MemoryDrive 외부(사람) 조작', () => {
  it('putExternal: 새 경로는 새 파일, 있는 경로는 내용 교체 + revision 증가', async () => {
    const drive = new MemoryDrive();
    const created = drive.putExternal('a.md', '처음');

    expect(created).toEqual({ id: 'f1', path: 'a.md', hash: sha256Hex('처음'), revision: 'r1', size: utf8('처음').length });
    expect(drive.calls).toEqual([]); // 사람 조작은 호출 기록에 남지 않는다

    const changed = drive.putExternal('a.md', utf8('고침'));
    expect(changed).toEqual({ id: 'f1', path: 'a.md', hash: sha256Hex('고침'), revision: 'r2', size: utf8('고침').length });
    expect(drive.paths()).toEqual(['a.md']);
  });

  it('putExternal 도 넘긴 배열을 복사해 둔다', async () => {
    const drive = new MemoryDrive();
    const bytes = utf8('v1');
    drive.putExternal('a.md', bytes);

    bytes[0] = 88;
    expect(drive.contentOf('a.md')).toBe('v1');
  });

  it('removeExternal: 휴지통으로 보내면 목록에서 빠진다', async () => {
    const drive = new MemoryDrive();
    drive.putExternal('a.md', 'A');

    drive.removeExternal('a.md');

    expect(drive.paths()).toEqual([]);
    expect(drive.contentOf('a.md')).toBeUndefined();
  });

  it('removeExternal: 없는 경로는 Error', () => {
    const drive = new MemoryDrive();

    expect(() => drive.removeExternal('a.md')).toThrow('없는 경로: a.md');
  });

  it('휴지통으로 간 경로는 다시 올릴 수 있다', async () => {
    const drive = new MemoryDrive();
    await drive.upload({ path: 'a.md', bytes: utf8('A'), hash: sha256Hex('A') });
    await drive.trash('f1');

    const f = await drive.upload({ path: 'a.md', bytes: utf8('A2'), hash: sha256Hex('A2') });

    expect(f.id).toBe('f2'); // id 는 재사용하지 않는다
    expect(drive.contentOf('a.md')).toBe('A2');
  });
});

describe('MemoryDrive.offline', () => {
  it('모든 메서드가 offline 로 실패하고 호출 기록도 남기지 않는다', async () => {
    const drive = new MemoryDrive();
    const f = await drive.upload({ path: 'a.md', bytes: utf8('A'), hash: sha256Hex('A') });
    drive.offline = true;

    await expect(drive.list()).rejects.toThrow('offline');
    await expect(drive.download(f.id)).rejects.toThrow('offline');
    await expect(drive.upload({ path: 'b.md', bytes: utf8('B'), hash: sha256Hex('B') })).rejects.toThrow('offline');
    await expect(drive.move(f.id, 'b.md')).rejects.toThrow('offline');
    await expect(drive.trash(f.id)).rejects.toThrow('offline');

    expect(drive.calls).toEqual(['upload:a.md']);
    expect(drive.paths()).toEqual(['a.md']);
  });

  it('offline 을 풀면 다시 동작한다', async () => {
    const drive = new MemoryDrive();
    drive.offline = true;
    await expect(drive.list()).rejects.toThrow('offline');

    drive.offline = false;

    expect(await drive.list()).toEqual([]);
    expect(drive.calls).toEqual(['list']);
  });
});

describe('MemoryDrive 호출 기록', () => {
  it('메서드 호출 순서를 그대로 남긴다', async () => {
    const drive = new MemoryDrive();
    const f = await drive.upload({ path: 'a.md', bytes: utf8('A'), hash: sha256Hex('A') });
    await drive.download(f.id);
    await drive.move(f.id, 'b.md');
    await drive.trash(f.id);
    await drive.list();

    expect(drive.calls).toEqual(['upload:a.md', 'download:f1', 'move:f1:b.md', 'trash:f1', 'list']);
  });
});
