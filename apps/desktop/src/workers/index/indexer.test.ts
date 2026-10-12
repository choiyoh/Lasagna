import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Indexer, deriveTitle } from './indexer';

let root: string;
let ix: Indexer;

const put = (rel: string, body: string) => {
  const full = path.join(root, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, body);
};

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'nops-ix-'));
  ix = new Indexer(root);
});
afterEach(() => {
  ix.close();
  rmSync(root, { recursive: true, force: true });
});

describe('deriveTitle', () => {
  it('첫 H1, 프런트매터 무시, 없으면 파일명', () => {
    expect(deriveTitle('a/b.md', '---\ntitle: x\n---\n# 클린 코드\n본문')).toBe('클린 코드');
    expect(deriveTitle('a/메모.md', '본문만')).toBe('메모');
  });
});

describe('Indexer', () => {
  it('md 파일만, 점 폴더 제외하고 인덱싱한다', () => {
    put('a.md', '# A\n안녕');
    put('dir/b.md', '# B');
    put('.nopsidian/x.md', '# hidden');
    put('c.txt', 'no');
    expect(ix.scan().changed).toBe(2);
    expect(ix.list().map((n) => n.path)).toEqual(['a.md', 'dir/b.md']);
  });

  it('바뀌지 않은 파일은 재처리하지 않고, 삭제를 반영한다', () => {
    put('a.md', '# A');
    put('b.md', '# B');
    ix.scan();
    expect(ix.scan()).toEqual({ changed: 0, removed: 0 });
    rmSync(path.join(root, 'b.md'));
    expect(ix.scan().removed).toBe(1);
    expect(ix.list().map((n) => n.path)).toEqual(['a.md']);
  });

  it('수정된 파일을 다시 인덱싱한다', () => {
    put('a.md', '# A\n사과');
    ix.scan();
    put('a.md', '# A\n바나나 맛있다');
    const t = new Date(Date.now() + 5000);
    utimesSync(path.join(root, 'a.md'), t, t);
    expect(ix.scan().changed).toBe(1);
    expect(ix.search('바나나').map((h) => h.path)).toEqual(['a.md']);
    expect(ix.search('사과')).toEqual([]);
  });

  it('한글 부분 일치: 3글자 이상은 FTS, 2글자는 LIKE 대체', () => {
    put('book.md', '# 클린 코드\n핵심은 읽기 쉬운 코드다');
    ix.scan();
    expect(ix.search('읽기 쉬운')[0]?.path).toBe('book.md');
    expect(ix.search('코드')[0]?.path).toBe('book.md');
    expect(ix.search('없는말')).toEqual([]);
  });

  it('FTS 특수문자와 LIKE 와일드카드를 안전하게 처리한다', () => {
    put('a.md', '# A\n100% 확실 "인용"');
    ix.scan();
    expect(ix.search('"인용"').length).toBe(1);
    expect(ix.search('%').length).toBe(1);
    expect(ix.search('_x')).toEqual([]);
  });

  it('indexFile은 삭제된 파일을 제거한다', () => {
    put('a.md', '# A');
    ix.scan();
    rmSync(path.join(root, 'a.md'));
    expect(ix.indexFile('a.md')).toBe(false);
    expect(ix.list()).toEqual([]);
  });

  it('스키마 버전이 다르면 인덱스를 비우고 재구축한다', () => {
    put('a.md', '# A');
    ix.scan();
    ix.db.prepare(`UPDATE meta SET value='0' WHERE key='schema_version'`).run();
    ix.close();
    ix = new Indexer(root);
    expect(ix.list()).toEqual([]);
    expect(ix.scan().changed).toBe(1);
  });
});
