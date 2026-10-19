import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyWatchEvents, type PendingBatch, type WatchEvent, type WatchFs } from './watch-events';

const ROOT = path.join(path.sep, 'vault');
const relOf = (p: string) => path.relative(ROOT, p).split(path.sep).join('/');
const at = (rel: string) => path.join(ROOT, rel);
const ev = (rel: string, type: WatchEvent['type']): WatchEvent => ({ path: at(rel), type });

/** 테스트용 가짜 파일 트리 — 실제 파일 시스템이나 감시자 없이 분류 규칙만 본다 */
function fakeFs(tree: Record<string, 'dir' | 'file'>): WatchFs {
  return {
    async stat(p) {
      const kind = tree[relOf(p)];
      if (!kind) throw new Error(`ENOENT: ${p}`);
      return { isDirectory: () => kind === 'dir' };
    },
    async readdir(p) {
      const dir = relOf(p);
      const out: string[] = [];
      for (const key of Object.keys(tree)) {
        if (key.slice(0, Math.max(0, key.lastIndexOf('/'))) === dir) out.push(key.slice(key.lastIndexOf('/') + 1));
      }
      return out;
    },
  };
}

const dump = (b: PendingBatch) => ({ notes: Object.fromEntries(b.notes), assets: Object.fromEntries(b.assets) });

describe('classifyWatchEvents', () => {
  it('폴더 create 이벤트는 안의 파일을 훑어 전부 add 로 넣는다', async () => {
    const fs = fakeFs({
      새폴더: 'dir',
      '새폴더/a.md': 'file',
      '새폴더/그림.png': 'file',
      '새폴더/하위': 'dir',
      '새폴더/하위/b.md': 'file',
      '다른폴더/c.md': 'file',
    });
    const batch = await classifyWatchEvents([ev('새폴더', 'create')], ROOT, fs);
    expect(dump(batch)).toEqual({
      notes: { '새폴더/a.md': 'add', '새폴더/하위/b.md': 'add' },
      assets: { '새폴더/그림.png': 'add' },
    });
  });

  it('폴더 update 이벤트도 똑같이 훑는다', async () => {
    const fs = fakeFs({ 새폴더: 'dir', '새폴더/a.md': 'file' });
    const batch = await classifyWatchEvents([ev('새폴더', 'update')], ROOT, fs);
    expect(dump(batch)).toEqual({ notes: { '새폴더/a.md': 'add' }, assets: {} });
  });

  it('점 폴더·node_modules·임시 파일은 건너뛴다', async () => {
    const fs = fakeFs({
      새폴더: 'dir',
      '새폴더/.nopsidian/x.md': 'file',
      '새폴더/.git/y.md': 'file',
      '새폴더/node_modules/z.md': 'file',
      '새폴더/메모.nops-tmp-1-abc.md': 'file',
      '새폴더/그림.nops-tmp-1-abc.png': 'file',
      '새폴더/진짜.md': 'file',
    });
    const batch = await classifyWatchEvents([ev('새폴더', 'create')], ROOT, fs);
    expect(dump(batch)).toEqual({ notes: { '새폴더/진짜.md': 'add' }, assets: {} });
  });

  it('없는 경로는 무시한다', async () => {
    const fs = fakeFs({});
    const batch = await classifyWatchEvents([ev('사라진폴더', 'create'), ev('사라진노트.md', 'update')], ROOT, fs);
    expect(dump(batch)).toEqual({ notes: {}, assets: {} });
  });

  it('일반 파일 이벤트는 종류(create/update/delete)대로 분류한다', async () => {
    const fs = fakeFs({ '노트.md': 'file', '그림.png': 'file' });
    const batch = await classifyWatchEvents(
      [
        ev('노트.md', 'create'),
        ev('그림.png', 'update'),
        ev('지운노트.md', 'delete'),
        ev('지운그림.png', 'delete'),
        ev('임시.nops-tmp-1-abc.png', 'create'),
      ],
      ROOT,
      fs,
    );
    expect(dump(batch)).toEqual({
      notes: { '노트.md': 'add', '지운노트.md': 'unlink' },
      assets: { '그림.png': 'change', '지운그림.png': 'unlink' },
    });
  });

  it('폴더 delete 이벤트는 안을 훑지 않는다', async () => {
    const fs = fakeFs({ 새폴더: 'dir', '새폴더/a.md': 'file' });
    const batch = await classifyWatchEvents([ev('새폴더', 'delete')], ROOT, fs);
    expect(dump(batch)).toEqual({ notes: {}, assets: { 새폴더: 'unlink' } });
  });

  it('점 폴더나 볼트 밖 경로의 이벤트는 무시한다', async () => {
    const fs = fakeFs({ '.nopsidian/index.sqlite': 'file', 'a.md': 'file' });
    const batch = await classifyWatchEvents(
      [ev('.nopsidian/index.sqlite', 'create'), { path: path.join(ROOT, '..', '밖.md'), type: 'create' }],
      ROOT,
      fs,
    );
    expect(dump(batch)).toEqual({ notes: {}, assets: {} });
  });
});
