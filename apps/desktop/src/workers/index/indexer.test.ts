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

  describe('백링크 문맥', () => {
    it('링크가 놓인 블록의 문맥을 줄 번호와 함께 돌려준다', () => {
      put('a.md', '# A\n\n첫 문단이다\n\n[[B]]를 참고한 문단\n');
      put('B.md', '# B');
      ix.scan();
      expect(ix.backlinkContexts('B.md')).toEqual([
        { path: 'a.md', title: 'A', kind: 'wikilink', line: 5, snippet: '[[B]]를 참고한 문단' },
      ]);
    });

    it('자기 자신 링크는 빼고 path→line 순으로 정렬한다', () => {
      put('a.md', '# A\n[[B]] 그리고 [[#A]]');
      put('z.md', '# Z\n\n[[B]]');
      put('B.md', '# B');
      ix.scan();
      expect(ix.backlinkContexts('B.md').map((c) => [c.path, c.line])).toEqual([
        ['a.md', 2],
        ['z.md', 3],
      ]);
    });

    it('문맥 블록이 없는 링크(프런트매터 relation)는 스니펫이 빈 문자열', () => {
      put('책.md', '---\n관련: "[[저자]]"\n---\n# 책');
      put('저자.md', '# 저자');
      ix.scan();
      expect(ix.backlinkContexts('저자.md')).toEqual([
        { path: '책.md', title: '책', kind: 'relation', line: 1, snippet: '' },
      ]);
    });

    it('여러 줄 문맥은 공백 한 칸으로 정리하고 160자를 넘으면 자른다', () => {
      const long = `긴 문단 ${'가'.repeat(200)}`;
      put('a.md', `# A\n\n${long}\n둘째 줄 [[B]]\n`);
      put('B.md', '# B');
      ix.scan();
      const [ctx] = ix.backlinkContexts('B.md');
      expect(ctx!.line).toBe(4);
      expect(ctx!.snippet).toBe(`${long} 둘째 줄 [[B]]`.slice(0, 160) + '…');
      expect(ctx!.snippet).toHaveLength(161);
    });
  });

  describe('아웃고잉 링크', () => {
    it('미해결 링크는 resolvedPath가 null, 같은 노트 [[#제목]]은 자기 자신', () => {
      put('a.md', '# A\n## 소제목\n[[B]] [[#소제목]] [없는](nope.md)\n');
      put('B.md', '# B');
      ix.scan();
      expect(ix.outgoingLinks('a.md')).toEqual([
        { target: '', resolvedPath: 'a.md', kind: 'wikilink', heading: '소제목', block: null, line: 3 },
        { target: 'B', resolvedPath: 'B.md', kind: 'wikilink', heading: null, block: null, line: 3 },
        { target: 'nope.md', resolvedPath: null, kind: 'md', heading: null, block: null, line: 3 },
      ]);
    });

    it('임베드와 블록 앵커도 담고 줄→대상 순으로 정렬한다', () => {
      put('a.md', '# A\n\n![[C]] 와 [[B#^블록1]]\n');
      put('B.md', '# B\n## 소제목');
      put('C.md', '# C');
      ix.scan();
      expect(ix.outgoingLinks('a.md')).toEqual([
        { target: 'B', resolvedPath: 'B.md', kind: 'wikilink', heading: null, block: '블록1', line: 3 },
        { target: 'C', resolvedPath: 'C.md', kind: 'embed', heading: null, block: null, line: 3 },
      ]);
    });

    it('링크가 없는 노트와 없는 노트는 빈 배열', () => {
      put('a.md', '# A\n본문만');
      ix.scan();
      expect(ix.outgoingLinks('a.md')).toEqual([]);
      expect(ix.outgoingLinks('없는 노트.md')).toEqual([]);
    });
  });

  describe('링크 안 된 언급', () => {
    it('제목·별칭이 링크 없이 나온 블록을 찾고, 이미 링크한 노트·자기 자신은 뺀다', () => {
      put('클린 코드.md', '---\naliases: [Clean Code]\n---\n# 클린 코드\n\n클린 코드 정리\n');
      put('멘션.md', '# 멘션\n\n클린 코드를 읽었다\n\nClean Code도 읽었다\n');
      put('링크.md', '# 링크\n\n[[클린 코드]]와 클린 코드\n');
      put('임베드.md', '# 임베드\n\n![[클린 코드]] 그리고 클린 코드\n');
      ix.scan();
      expect(ix.unlinkedMentions('클린 코드.md')).toEqual([
        { path: '멘션.md', title: '멘션', line: 3, snippet: '클린 코드를 읽었다' },
        { path: '멘션.md', title: '멘션', line: 5, snippet: 'Clean Code도 읽었다' },
      ]);
    });

    it('한글 조사는 허용하고, 앞뒤에 영문·숫자가 붙으면 뺀다', () => {
      put('Rust.md', '# Rust');
      put('a.md', '# a\n\nRust를 배우자\n\nRust의 책\n\nRusty는 다르다\n\nRust2024\n\nMyRust도 아니다\n');
      ix.scan();
      expect(ix.unlinkedMentions('Rust.md')).toEqual([
        { path: 'a.md', title: 'a', line: 3, snippet: 'Rust를 배우자' },
        { path: 'a.md', title: 'a', line: 5, snippet: 'Rust의 책' },
      ]);
    });

    it('코드 블록과 인라인 코드 안의 출현은 뺀다', () => {
      put('리팩터링.md', '# 리팩터링');
      put('a.md', '# a\n\n```\n리팩터링 코드\n```\n\n`리팩터링`은 코드다\n\n리팩터링은 좋다\n');
      ix.scan();
      expect(ix.unlinkedMentions('리팩터링.md')).toEqual([
        { path: 'a.md', title: 'a', line: 9, snippet: '리팩터링은 좋다' },
      ]);
    });

    it('이미 위키링크·마크다운 링크 텍스트 안에 있는 출현은 뺀다', () => {
      put('리팩터링.md', '# 리팩터링');
      put('다른 노트.md', '# 다른 노트');
      put(
        'a.md',
        '# a\n\n[[다른 노트|리팩터링]] 표시 텍스트\n\n[리팩터링](other.md) 링크 텍스트\n\n![[리팩터링.png]]\n',
      );
      ix.scan();
      expect(ix.unlinkedMentions('리팩터링.md')).toEqual([]);
    });

    it('같은 블록은 한 번만 세고, path→line 순으로 limit까지 자른다', () => {
      put('리팩터링.md', '# 리팩터링');
      put('a.md', '# a\n\n리팩터링 리팩터링 리팩터링\n\n리팩터링 하나\n');
      put('b.md', '# b\n\n다음 파일 리팩터링\n');
      ix.scan();
      expect(ix.unlinkedMentions('리팩터링.md').map((m) => [m.path, m.line])).toEqual([
        ['a.md', 3],
        ['a.md', 5],
        ['b.md', 3],
      ]);
      expect(ix.unlinkedMentions('리팩터링.md', 1).map((m) => [m.path, m.line])).toEqual([
        ['a.md', 3],
      ]);
    });

    it('2글자 이하 제목과 없는 노트는 빈 배열', () => {
      put('AB.md', '# AB');
      put('a.md', '# a\n\nAB는 나온다\n');
      ix.scan();
      expect(ix.unlinkedMentions('AB.md')).toEqual([]);
      expect(ix.unlinkedMentions('없는 노트.md')).toEqual([]);
    });
  });

  describe('태그별 노트', () => {
    it('태그와 하위 태그를 포함하고, 접두어만 같은 태그는 뺀다', () => {
      put('a.md', '# a\n#독서');
      put('b.md', '# b\n#독서/소설');
      put('c.md', '# c\n#독서/소설/한국');
      put('d.md', '# d\n#독서가');
      put('e.md', '---\ntags: [독서]\n---\n# e\n#독서');
      ix.scan();
      expect(ix.notesByTag('독서')).toEqual([
        { path: 'a.md', title: 'a' },
        { path: 'b.md', title: 'b' },
        { path: 'c.md', title: 'c' },
        { path: 'e.md', title: 'e' },
      ]);
      expect(ix.notesByTag('독서/소설').map((n) => n.path)).toEqual(['b.md', 'c.md']);
      expect(ix.notesByTag('없음')).toEqual([]);
    });
  });

  describe('첨부 인덱스', () => {
    it('.md가 아닌 파일만, 점 폴더 제외하고 목록에 넣는다', () => {
      put('a.md', '# A');
      put('attachments/사진.png', 'x');
      put('docs/보고서.pdf', 'pdfdata');
      put('.nopsidian/skip.bin', 'no');
      put('attachments/.hidden', 'no');
      ix.scan();
      expect(ix.listAssets()).toEqual([
        { path: 'attachments/사진.png', size: 1 },
        { path: 'docs/보고서.pdf', size: 7 },
      ]);
    });

    it('syncAssetFile: 추가·크기 변경·삭제를 반영한다', () => {
      ix.scan();
      put('attachments/a.png', '12');
      expect(ix.syncAssetFile('attachments/a.png')).toBe(true);
      put('attachments/a.png', '12345');
      ix.syncAssetFile('attachments/a.png');
      expect(ix.listAssets()).toEqual([{ path: 'attachments/a.png', size: 5 }]);
      rmSync(path.join(root, 'attachments/a.png'));
      expect(ix.syncAssetFile('attachments/a.png')).toBe(false);
      expect(ix.listAssets()).toEqual([]);
    });

    it('재스캔하면 사라진 첨부가 정리된다', () => {
      put('x.png', '1');
      ix.scan();
      rmSync(path.join(root, 'x.png'));
      ix.scan();
      expect(ix.listAssets()).toEqual([]);
    });

    it('저장 중 임시 파일은 첨부로 보지 않는다', () => {
      put('attachments/a.png.nops-tmp-1-abc', 'x');
      ix.scan();
      expect(ix.listAssets()).toEqual([]);
    });
  });

  describe('블록 목록(blocksOf)', () => {
    it('코드·수식 블록과 단독 ^id 줄은 빼고, ID가 있으면 함께 돌려준다', () => {
      put('a.md', '# 제목\n\n첫 문단 ^b1\n\n```ts\ncode\n```\n\n둘째 문단\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n^t1\n');
      ix.scan();
      const blocks = ix.blocksOf('a.md');
      expect(blocks.map((b) => [b.type, b.text, b.id])).toEqual([
        ['heading', '제목', null],
        ['paragraph', '첫 문단', 'b1'],
        ['paragraph', '둘째 문단', null],
        ['table', 'ab12', 't1'],
      ]);
      expect(blocks[1]!.line).toBe(3);
    });

    it('긴 블록은 80자로 줄이고 없는 노트는 빈 목록', () => {
      put('b.md', `${'가'.repeat(120)}\n`);
      ix.scan();
      expect(ix.blocksOf('b.md')[0]!.text).toBe(`${'가'.repeat(80)}…`);
      expect(ix.blocksOf('nope.md')).toEqual([]);
    });

    it('headingsOf는 줄 순서로 돌려준다', () => {
      put('c.md', '# A\n\n## B\n\n### C\n');
      ix.scan();
      expect(ix.headingsOf('c.md').map((h) => [h.level, h.text, h.line])).toEqual([[1, 'A', 1], [2, 'B', 3], [3, 'C', 5]]);
    });
  });
});
