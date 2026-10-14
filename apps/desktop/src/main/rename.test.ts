import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyRename, expandMoves, planRename, undoRename, type VaultSnapshot } from './rename';

let root: string;
const put = (rel: string, content: string) => {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), content);
};
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');
const snapshot = (): VaultSnapshot => {
  const notes: VaultSnapshot['notes'] = [];
  const assets: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else if (e.name.endsWith('.md')) notes.push({ path: r, content: read(r) });
      else assets.push(r);
    }
  };
  walk(root, '');
  return { notes, assets };
};
const run = (from: string, to: string) => {
  const { plan, moves } = planRename(root, snapshot(), from, to);
  return { plan, moves, ...applyRename(root, moves, plan) };
};

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'nops-rename-'));
});

describe('expandMoves', () => {
  it('노트는 확장자를 생략해도 .md를 유지하고, 없는 경로·덮어쓰기·자기 안으로 이동·점 이름은 거부한다', () => {
    put('a.md', '# a');
    put('dir/b.md', '# b');
    put('exists.md', '# e');
    expect(expandMoves(root, 'a.md', '새 이름')).toEqual([{ from: 'a.md', to: '새 이름.md' }]);
    expect(() => expandMoves(root, 'nope.md', 'x.md')).toThrow('없는 경로');
    expect(() => expandMoves(root, 'a.md', 'exists.md')).toThrow('이미 있는 경로');
    expect(() => expandMoves(root, 'a.md', 'a.md')).toThrow('이름이 같아요');
    expect(() => expandMoves(root, 'dir', 'dir/sub')).toThrow('자기 자신 안');
    expect(() => expandMoves(root, 'a.md', '.hidden/x.md')).toThrow('점');
    expect(() => expandMoves(root, 'a.md', '../밖.md')).toThrow();
  });

  it('폴더는 안의 모든 파일(첨부 포함)을 파일 단위로 펼친다', () => {
    put('old/a.md', '# a');
    put('old/sub/b.md', '# b');
    put('old/img.png', 'x');
    expect(expandMoves(root, 'old', 'new').map((m) => m.to).sort()).toEqual(['new/a.md', 'new/img.png', 'new/sub/b.md']);
  });
});

describe('applyRename', () => {
  it('파일을 옮기고 링크를 고치되, 나머지 바이트는 그대로 둔다', () => {
    put('독서/클린 코드.md', '# 클린 코드\n');
    put('a.md', '앞  \n\n[[클린 코드#1장|1장]] 끝\n');
    const r = run('독서/클린 코드.md', '독서/클린 코드 2판.md');
    expect(existsSync(path.join(root, '독서/클린 코드.md'))).toBe(false);
    expect(read('독서/클린 코드 2판.md')).toBe('# 클린 코드\n');
    expect(read('a.md')).toBe('앞  \n\n[[클린 코드 2판#1장|1장]] 끝\n');
    expect(r.plan.totalChanges).toBe(1);
  });

  it('폴더 이름 변경: 비게 된 원래 폴더는 정리되고 내부 링크는 맞게 바뀐다', () => {
    put('old/a.md', '[[old/b]]\n');
    put('old/b.md', '# b\n');
    put('x.md', '[[old/a]]\n');
    run('old', 'new');
    expect(existsSync(path.join(root, 'old'))).toBe(false);
    expect(read('new/a.md')).toBe('[[new/b]]\n');
    expect(read('x.md')).toBe('[[new/a]]\n');
  });

  it('옮긴 노트의 상대 경로 이미지 링크도 새 위치에 맞게 바뀐다', () => {
    put('attachments/p.png', 'x');
    put('a.md', '![](attachments/p.png)\n');
    run('a.md', 'deep/er/a.md');
    expect(read('deep/er/a.md')).toBe('![](../../attachments/p.png)\n');
  });

  it('실행 도중 실패하면 이동과 내용이 모두 원래대로 돌아온다', () => {
    put('a.md', '[[b]]\n');
    put('b.md', '# b\n');
    const { plan, moves } = planRename(root, snapshot(), 'b.md', 'c.md');
    // 링크가 바뀔 노트의 새 경로에 폴더를 만들어 쓰기를 실패시킨다
    mkdirSync(path.join(root, 'a.md.nops-block'), { recursive: true });
    const bad = { ...plan, edits: [...plan.edits, { path: 'a.md', newPath: 'a.md.nops-block', content: 'x', changes: 1 }] };
    expect(() => applyRename(root, moves, bad)).toThrow();
    expect(existsSync(path.join(root, 'b.md'))).toBe(true);
    expect(existsSync(path.join(root, 'c.md'))).toBe(false);
    expect(read('a.md')).toBe('[[b]]\n');
  });
});

describe('undoRename', () => {
  it('이동과 링크를 원래대로 되돌린다', () => {
    put('a.md', '[[old]]\n');
    put('old.md', '# o\n');
    const { undoId } = run('old.md', 'folder/new.md');
    expect(read('a.md')).toBe('[[new]]\n');
    const r = undoRename(root, undoId);
    expect(r).toEqual({ restored: 1, skipped: [] });
    expect(read('a.md')).toBe('[[old]]\n');
    expect(existsSync(path.join(root, 'old.md'))).toBe(true);
    expect(existsSync(path.join(root, 'folder'))).toBe(false);
  });

  it('그 뒤에 사용자가 같은 노트를 또 고쳤다면 그 노트는 덮어쓰지 않고 건너뛴다', () => {
    put('a.md', '[[old]]\n');
    put('old.md', '# o\n');
    const { undoId } = run('old.md', 'new.md');
    writeFileSync(path.join(root, 'a.md'), '[[new]] 사용자가 고침\n');
    const r = undoRename(root, undoId);
    expect(r.skipped).toEqual(['a.md']);
    expect(read('a.md')).toBe('[[new]] 사용자가 고침\n');
    expect(existsSync(path.join(root, 'old.md'))).toBe(true);
  });

  it('기록이 없으면 오류', () => {
    expect(() => undoRename(root, 'nope-123')).toThrow('기록이 없어요');
  });
});
