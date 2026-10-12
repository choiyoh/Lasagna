import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FsLocalStore, type HashCache } from './fs-local-store';

const utf8 = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array) => new TextDecoder().decode(b);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** scan 이 읽은 해시를 그대로 보관하는 캐시(테스트에서 값 변조·흔적 확인용) */
class MapCache implements HashCache {
  readonly map = new Map<string, { mtimeMs: number; size: number; hash: string }>();
  get(p: string) {
    return this.map.get(p);
  }
  set(p: string, v: { mtimeMs: number; size: number; hash: string }) {
    this.map.set(p, v);
  }
  delete(p: string) {
    this.map.delete(p);
  }
}

let root: string;
let store: FsLocalStore;

const abs = (rel: string) => path.join(root, rel);

/** 폴더를 만들고 파일 하나 쓴다(테스트 준비용) */
function put(rel: string, body: string) {
  mkdirSync(path.dirname(abs(rel)), { recursive: true });
  writeFileSync(abs(rel), body);
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'nops-sync-'));
  store = new FsLocalStore(root);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('scan', () => {
  it('동기화 대상만 경로순으로 돌려준다', async () => {
    put('b.md', 'b');
    put('a/c.md', 'c');
    put('.nopsidian/config.json', '{}');
    put('.nopsidian/trash/old.md', '지워진 것');
    put('.git/config', '[core]');
    put('.obsidian/app.json', '{}');
    put('.DS_Store', 'x');
    await expect(store.scan()).resolves.toEqual([
      { path: '.nopsidian/config.json', hash: sha('{}'), size: 2 },
      { path: '.obsidian/app.json', hash: sha('{}'), size: 2 },
      { path: 'a/c.md', hash: sha('c'), size: 1 },
      { path: 'b.md', hash: sha('b'), size: 1 },
    ]);
  });

  it('파일 이름을 NFC 로 정규화한다', async () => {
    put('한글.md'.normalize('NFD'), '본문');
    const files = await store.scan();
    expect(files.map((f) => f.path)).toEqual(['한글.md']);
    expect(files[0].path).toBe('한글.md'.normalize('NFC'));
  });

  it('심볼릭 링크는 따라가지 않는다(파일·폴더 모두)', async () => {
    put('real.md', 'real');
    symlinkSync(abs('real.md'), abs('link.md'));
    const outside = mkdtempSync(path.join(tmpdir(), 'nops-sync-out-'));
    writeFileSync(path.join(outside, 'inside.md'), 'x');
    symlinkSync(outside, abs('link-dir'));
    try {
      expect((await store.scan()).map((f) => f.path)).toEqual(['real.md']);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('큰 파일도 스트림으로 해시한다', async () => {
    const body = 'x'.repeat(300_000);
    put('big.bin', body);
    await expect(store.scan()).resolves.toEqual([
      { path: 'big.bin', hash: sha(body), size: body.length },
    ]);
  });

  describe('해시 캐시', () => {
    it('mtime+size 가 같으면 캐시 해시를 쓴다(파일을 다시 읽지 않음)', async () => {
      const cache = new MapCache();
      const cached = new FsLocalStore(root, { cache });
      put('note.md', '원본');
      await cached.scan();
      expect(cache.map.get('note.md')!.hash).toBe(sha('원본'));

      // 캐시 값만 바꿔 둔다 — 두 번째 scan 이 파일을 다시 읽으면 이 값이 나올 수 없다
      cache.map.set('note.md', { ...cache.map.get('note.md')!, hash: 'sentinel' });
      await expect(cached.scan()).resolves.toEqual([
        { path: 'note.md', hash: 'sentinel', size: utf8('원본').length },
      ]);
    });

    it('내용이 바뀌면(mtime 또는 size) 다시 해시한다', async () => {
      const cache = new MapCache();
      const cached = new FsLocalStore(root, { cache });
      put('note.md', '원본');
      await cached.scan();
      put('note.md', '바뀐 내용');
      const [file] = await cached.scan();
      expect(file.hash).toBe(sha('바뀐 내용'));
      expect(cache.map.get('note.md')!.size).toBe(utf8('바뀐 내용').length);
    });

    it('사라진 경로는 캐시에서 지운다', async () => {
      const cache = new MapCache();
      const cached = new FsLocalStore(root, { cache });
      put('a.md', 'a');
      put('b.md', 'b');
      await cached.scan();
      rmSync(abs('a.md'));
      await cached.scan();
      expect([...cache.map.keys()]).toEqual(['b.md']);
    });
  });
});

describe('read / exists', () => {
  it('상대 경로를 읽는다', async () => {
    put('a/b.md', '본문');
    expect(text(await store.read('a/b.md'))).toBe('본문');
  });

  it('없는 파일이면 던진다', async () => {
    await expect(store.read('none.md')).rejects.toThrow();
  });

  it('탈출 시도는 거부한다', async () => {
    await expect(store.read('../밖.md')).rejects.toThrow(/벗어나는/);
    await expect(store.read('/etc/passwd')).rejects.toThrow(/벗어나는/);
  });

  it('폴더가 아닌 것이 있는지 본다', async () => {
    put('note.md', 'x');
    mkdirSync(abs('dir'));
    symlinkSync(abs('note.md'), abs('link.md'));
    symlinkSync(abs('dir'), abs('link-dir'));
    symlinkSync(abs('nowhere.md'), abs('broken.md'));
    expect(await store.exists('note.md')).toBe(true);
    expect(await store.exists('none.md')).toBe(false);
    expect(await store.exists('dir')).toBe(false);
    expect(await store.exists('link.md')).toBe(true); // 링크를 따라가면 파일이 있다
    expect(await store.exists('link-dir')).toBe(false); // 폴더를 가리키는 링크
    expect(await store.exists('broken.md')).toBe(false); // 끊어진 링크
  });
});

describe('write', () => {
  it('상위 폴더를 만들고 원자적으로 쓴다', async () => {
    const bytes = utf8('본문');
    await expect(store.write('a/b.md', bytes)).resolves.toEqual({
      path: 'a/b.md',
      hash: sha('본문'),
      size: bytes.length,
    });
    expect(text(await store.read('a/b.md'))).toBe('본문');
    // atomicWrite 의 임시 파일이 남지 않았는지
    expect(readdirSync(abs('a'))).toEqual(['b.md']);
  });

  it('쓴 결과를 캐시에 넣어 다음 scan 이 읽지 않게 한다', async () => {
    const cache = new MapCache();
    const cached = new FsLocalStore(root, { cache });
    await cached.scan();
    await cached.write('note.md', utf8('본문'));
    cache.map.set('note.md', { ...cache.map.get('note.md')!, hash: 'sentinel' });
    await expect(cached.scan()).resolves.toEqual([
      { path: 'note.md', hash: 'sentinel', size: utf8('본문').length },
    ]);
  });

  it('탈출 시도는 거부한다', async () => {
    await expect(store.write('../밖.md', utf8('x'))).rejects.toThrow(/벗어나는/);
  });
});

describe('trash', () => {
  it('시각 폴더 아래 원래 경로로 옮긴다(내용 보존, 원본 없음)', async () => {
    const at = new Date(2026, 9, 12, 20, 9, 24);
    const s = new FsLocalStore(root, { now: () => at });
    put('폴더/note.md', '본문');
    await s.trash('폴더/note.md');
    const dest = '.nopsidian/trash/20261012-200924/폴더/note.md';
    expect(text(await s.read(dest))).toBe('본문');
    expect(existsSync(abs('폴더/note.md'))).toBe(false);
    expect(await s.exists('폴더/note.md')).toBe(false);
  });

  it('같은 이름이 이미 있으면 번호를 붙인다', async () => {
    const at = new Date(2026, 9, 12, 20, 9, 24);
    const s = new FsLocalStore(root, { now: () => at });
    put('note.md', '첫 번째');
    await s.trash('note.md');
    put('note.md', '두 번째');
    await s.trash('note.md');
    const dir = '.nopsidian/trash/20261012-200924';
    expect(text(await s.read(`${dir}/note.md`))).toBe('첫 번째');
    expect(text(await s.read(`${dir}/note (2).md`))).toBe('두 번째');
  });

  it('없는 파일이면 던진다', async () => {
    await expect(store.trash('none.md')).rejects.toThrow('없는 경로: none.md');
  });

  it('탈출 시도는 거부한다', async () => {
    await expect(store.trash('../밖.md')).rejects.toThrow(/벗어나는/);
  });
});

describe('move', () => {
  it('상위 폴더를 만들고 옮기며 빈 상위 폴더는 남긴다', async () => {
    put('a/b.md', '본문');
    await store.move('a/b.md', 'c/d/e.md');
    expect(text(await store.read('c/d/e.md'))).toBe('본문');
    expect(await store.exists('a/b.md')).toBe(false);
    expect(existsSync(abs('a'))).toBe(true);

    const files = await store.scan();
    expect(files.map((f) => f.path)).toEqual(['c/d/e.md']);
  });

  it('대상이 이미 있으면 던진다', async () => {
    put('a.md', 'a');
    put('b.md', 'b');
    await expect(store.move('a.md', 'b.md')).rejects.toThrow('이미 있는 경로: b.md');
    expect(text(await store.read('a.md'))).toBe('a');
  });

  it('원본이 없으면 던진다', async () => {
    await expect(store.move('none.md', 'b.md')).rejects.toThrow('없는 경로: none.md');
  });

  it('옮긴 뒤 캐시에서 원본을 지운다', async () => {
    const cache = new MapCache();
    const cached = new FsLocalStore(root, { cache });
    put('a.md', 'a');
    await cached.scan();
    await cached.move('a.md', 'sub/b.md');
    expect(cache.map.has('a.md')).toBe(false);
  });

  it('탈출 시도는 거부한다', async () => {
    put('a.md', 'a');
    await expect(store.move('a.md', '../밖.md')).rejects.toThrow(/벗어나는/);
    await expect(store.move('../밖.md', 'b.md')).rejects.toThrow(/벗어나는/);
  });
});
