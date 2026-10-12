import { describe, expect, it } from 'vitest';
import { planMoves, type VaultNote } from './rename-links.js';

const note = (path: string, content: string): VaultNote => ({ path, content });
const apply = (notes: VaultNote[], moves: { from: string; to: string }[], assets: string[] = []) => {
  const plan = planMoves({ notes, assets, moves });
  return { plan, byPath: Object.fromEntries(plan.edits.map((e) => [e.path, e.content])) };
};

describe('이름 바꾸기', () => {
  const notes = [
    note('독서/클린 코드.md', '# 클린 코드\n'),
    note('a.md', '[[클린 코드]] [[클린 코드#1장|1장]] ![[클린 코드]] [[클린 코드#^b1]]\n'),
    note('b.md', '---\n관련: ["[[클린 코드]]"]\n---\n`[[클린 코드]]` 코드 안은 그대로\n\n```\n[[클린 코드]]\n```\n[[클린 코드]]\n'),
  ];

  it('모든 링크 형태의 대상만 바뀌고 제목·별칭·블록 표기는 보존된다', () => {
    const { byPath, plan } = apply(notes, [{ from: '독서/클린 코드.md', to: '독서/클린 코드 2판.md' }]);
    expect(byPath['a.md']).toBe('[[클린 코드 2판]] [[클린 코드 2판#1장|1장]] ![[클린 코드 2판]] [[클린 코드 2판#^b1]]\n');
    expect(byPath['b.md']).toBe('---\n관련: ["[[클린 코드 2판]]"]\n---\n`[[클린 코드]]` 코드 안은 그대로\n\n```\n[[클린 코드]]\n```\n[[클린 코드 2판]]\n');
    expect(plan.totalChanges).toBe(4 + 2);
    expect(plan.edits.map((e) => e.path).sort()).toEqual(['a.md', 'b.md']);
  });

  it('제목이나 별칭으로 해석되는 링크는 파일 이름이 바뀌어도 그대로 둔다', () => {
    const n = [
      note('원본.md', '---\naliases: [별칭]\n---\n# 제목 노트\n'),
      note('x.md', '[[제목 노트]] [[별칭]] [[원본]]\n'),
    ];
    const { byPath } = apply(n, [{ from: '원본.md', to: '새 이름.md' }]);
    expect(byPath['x.md']).toBe('[[제목 노트]] [[별칭]] [[새 이름]]\n');
  });

  it('`.md`를 붙여 쓴 링크는 확장자를 유지한다', () => {
    const n = [note('old.md', '# o\n'), note('x.md', '[[old.md]] [[old]]\n')];
    expect(apply(n, [{ from: 'old.md', to: 'new.md' }]).byPath['x.md']).toBe('[[new.md]] [[new]]\n');
  });

  it('바뀐 이름이 다른 노트와 겹쳐 모호해지면 경로로 쓴다', () => {
    const n = [note('a/old.md', '# o\n'), note('new.md', '# 루트의 new\n'), note('x.md', '[[old]]\n')];
    // a/old → a/new : 이름 `new`는 루트의 new.md(더 짧은 경로)가 차지하므로 경로 표기가 필요하다
    expect(apply(n, [{ from: 'a/old.md', to: 'a/new.md' }]).byPath['x.md']).toBe('[[a/new]]\n');
  });

  it('해석되지 않는 링크는 건드리지 않는다', () => {
    const n = [note('old.md', '# o\n'), note('x.md', '[[없는 노트]] [[old]]\n')];
    expect(apply(n, [{ from: 'old.md', to: 'new.md' }]).byPath['x.md']).toBe('[[없는 노트]] [[new]]\n');
  });
});

describe('폴더 이동', () => {
  it('이름만으로 해석되던 링크는 폴더가 바뀌어도 그대로라 편집이 없다', () => {
    const n = [note('a/노트.md', '# n\n'), note('x.md', '[[노트]]\n')];
    expect(planMoves({ notes: n, moves: [{ from: 'a/노트.md', to: 'b/c/노트.md' }] }).edits).toEqual([]);
  });

  it('경로를 쓴 링크는 새 경로로 바뀐다', () => {
    const n = [note('a/노트.md', '# n\n'), note('x.md', '[[a/노트]] [[a/노트#제목|보기]]\n')];
    expect(apply(n, [{ from: 'a/노트.md', to: 'b/노트.md' }]).byPath['x.md']).toBe('[[b/노트]] [[b/노트#제목|보기]]\n');
  });

  it('여러 파일을 한꺼번에 옮겨도(폴더 이름 변경) 서로의 링크가 맞는다', () => {
    const n = [note('old/a.md', '[[old/b]] [[b]]\n'), note('old/b.md', '[[old/a]]\n'), note('x.md', '[[old/a]] [[b]]\n')];
    const { byPath } = apply(n, [
      { from: 'old/a.md', to: 'new/a.md' },
      { from: 'old/b.md', to: 'new/b.md' },
    ]);
    expect(byPath['old/a.md']).toBe('[[new/b]] [[b]]\n');
    expect(byPath['old/b.md']).toBe('[[new/a]]\n');
    expect(byPath['x.md']).toBe('[[new/a]] [[b]]\n');
  });
});

describe('마크다운 링크와 첨부', () => {
  it('상대 경로 링크를 다시 계산한다(퍼센트 인코딩·조각 유지)', () => {
    const n = [
      note('docs/old name.md', '# o\n'),
      note('docs/sub/x.md', '[a](../old%20name.md#섹션) [b](../old%20name.md)\n'),
    ];
    const { byPath } = apply(n, [{ from: 'docs/old name.md', to: 'docs/new name.md' }]);
    expect(byPath['docs/sub/x.md']).toBe('[a](../new%20name.md#섹션) [b](../new%20name.md)\n');
  });

  it('옮긴 노트 자신의 상대 링크·이미지 경로도 새 위치 기준으로 바뀐다', () => {
    const n = [note('notes/a.md', '![](../attachments/p.png) [b](b.md) [[b]]\n'), note('notes/b.md', '# b\n')];
    const { byPath, plan } = apply(n, [{ from: 'notes/a.md', to: 'notes/deep/a.md' }], ['attachments/p.png']);
    expect(byPath['notes/a.md']).toBe('![](../../attachments/p.png) [b](../b.md) [[b]]\n');
    expect(plan.edits[0]!.newPath).toBe('notes/deep/a.md');
  });

  it('첨부를 옮기면 그 첨부를 가리키는 마크다운·위키 임베드가 따라간다', () => {
    const n = [note('n/x.md', '![](../a/p.png) ![[p.png]] ![[a/p.png]]\n')];
    const { byPath } = apply(n, [{ from: 'a/p.png', to: 'b/p.png' }], ['a/p.png']);
    expect(byPath['n/x.md']).toBe('![](../b/p.png) ![[p.png]] ![[b/p.png]]\n');
  });

  it('외부 URL·앵커·없는 파일은 그대로', () => {
    const n = [note('old.md', '# o\n'), note('x.md', '[e](https://a.com/old.md) [h](#old) [m](missing.md)\n')];
    expect(planMoves({ notes: n, moves: [{ from: 'old.md', to: 'new.md' }] }).edits).toEqual([]);
  });

  it('공백이 든 새 경로는 안전하게 인코딩한다', () => {
    const n = [note('old.md', '# o\n'), note('x.md', '[a](old.md)\n')];
    expect(apply(n, [{ from: 'old.md', to: '내 폴더/new name.md' }]).byPath['x.md']).toBe('[a](내%20폴더/new%20name.md)\n');
  });
});

describe('보존 속성', () => {
  it('바뀌지 않은 부분의 바이트(CRLF 포함)는 그대로다', () => {
    const n = [note('old.md', '# o\n'), note('x.md', '앞  \r\n\r\n[[old]]\r\n뒤\t\r\n')];
    expect(apply(n, [{ from: 'old.md', to: 'new.md' }]).byPath['x.md']).toBe('앞  \r\n\r\n[[new]]\r\n뒤\t\r\n');
  });

  it('이동하지 않은 노트 사이에는 아무 계획도 만들지 않는다', () => {
    const n = [note('a.md', '[[b]]\n'), note('b.md', '# b\n')];
    expect(planMoves({ notes: n, moves: [] }).edits).toEqual([]);
  });
});
