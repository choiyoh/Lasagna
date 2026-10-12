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
  it('프런트매터 title → 첫 H1 → 파일명', () => {
    expect(deriveTitle('a/b.md', '---\ntitle: x\n---\n# 클린 코드\n본문')).toBe('x');
    expect(deriveTitle('a/b.md', '---\naliases: [y]\n---\n# 클린 코드\n본문')).toBe('클린 코드');
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

  describe('파서 연동', () => {
    it('제목은 프런트매터 title → H1 → 파일명 순서', () => {
      put('a.md', '---\ntitle: 프런트매터 제목\n---\n# H1');
      put('b.md', '# H1 제목');
      put('c.md', '본문');
      ix.scan();
      expect(ix.list().map((n) => n.title)).toEqual(['프런트매터 제목', 'H1 제목', 'c']);
    });

    it('위키링크를 해석하고 백링크·미해결 링크·태그·별칭을 저장한다', () => {
      put('독서/클린 코드.md', '---\naliases: [Clean Code]\ntags: [독서]\n---\n# 클린 코드\n[[리팩터링]]을 읽자 #개발');
      put('독서/리팩터링.md', '# 리팩터링\n[[Clean Code|클린 코드]] 그리고 [[없는 노트]]');
      ix.scan();
      expect(ix.backlinks('독서/리팩터링.md')).toEqual([{ path: '독서/클린 코드.md', kind: 'wikilink' }]);
      expect(ix.backlinks('독서/클린 코드.md')).toEqual([{ path: '독서/리팩터링.md', kind: 'wikilink' }]);
      expect(ix.unresolvedLinks()).toEqual([{ path: '독서/리팩터링.md', target: '없는 노트' }]);
      expect(ix.tags()).toEqual([
        { tag: '개발', count: 1 },
        { tag: '독서', count: 1 },
      ]);
    });

    it('새 노트가 생기면 미해결 링크가 해석되고, 삭제하면 다시 미해결이 된다', () => {
      put('a.md', '# A\n[[B]]');
      ix.scan();
      expect(ix.unresolvedLinks()).toHaveLength(1);
      put('B.md', '# B');
      ix.indexFile('B.md');
      expect(ix.unresolvedLinks()).toHaveLength(0);
      expect(ix.backlinks('B.md')).toEqual([{ path: 'a.md', kind: 'wikilink' }]);
      rmSync(path.join(root, 'B.md'));
      ix.indexFile('B.md');
      expect(ix.unresolvedLinks()).toEqual([{ path: 'a.md', target: 'B' }]);
    });

    it('프런트매터 relation은 relation 링크로 백링크에 잡힌다', () => {
      put('책.md', '---\n관련 노트: ["[[저자]]"]\n---\n# 책');
      put('저자.md', '# 저자');
      ix.scan();
      expect(ix.backlinks('저자.md')).toEqual([{ path: '책.md', kind: 'relation' }]);
    });

    it('`[[#제목]]`은 같은 노트를 가리키며 자기 자신은 백링크에 나오지 않는다', () => {
      put('a.md', '# A\n## 소제목\n[[#소제목]]');
      ix.scan();
      expect(ix.backlinks('a.md')).toEqual([]);
      expect(ix.unresolvedLinks()).toEqual([]);
    });

    it('재인덱싱하면 이전 링크·태그가 남지 않는다', () => {
      put('a.md', '# A\n[[B]] #old');
      put('B.md', '# B');
      ix.scan();
      put('a.md', '# A\n본문만');
      const t = new Date(Date.now() + 5000);
      utimesSync(path.join(root, 'a.md'), t, t);
      ix.scan();
      expect(ix.backlinks('B.md')).toEqual([]);
      expect(ix.tags()).toEqual([]);
    });
  });
});
