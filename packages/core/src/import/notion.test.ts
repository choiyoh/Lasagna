import { describe, expect, it } from 'vitest';
import { convertNotionExport, cleanEntryPath, stripNotionId, type ZipEntry } from './notion.js';

const enc = new TextEncoder();
const E = (path: string, text: string | Uint8Array): ZipEntry => ({ path, data: typeof text === 'string' ? enc.encode(text) : text });
const ID1 = '0123456789abcdef0123456789abcdef';
const ID2 = 'fedcba9876543210fedcba9876543210';
const ID3 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ID4 = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const get = (r: ReturnType<typeof convertNotionExport>, p: string) => {
  const f = r.files.find((x) => x.path === p);
  if (!f) throw new Error(`없음: ${p} (있는 것: ${r.files.map((x) => x.path).join(', ')})`);
  return typeof f.data === 'string' ? f.data : new TextDecoder().decode(f.data);
};

describe('이름 정리', () => {
  it('ID 접미사를 떼고 확장자는 지킨다', () => {
    expect(stripNotionId(`내 페이지 ${ID1}.md`)).toBe('내 페이지.md');
    expect(stripNotionId(`폴더 ${ID1}`)).toBe('폴더');
    expect(stripNotionId('그림.png')).toBe('그림.png');
  });
  it('위험한 경로는 버린다', () => {
    expect(cleanEntryPath('../x.md')).toBeNull();
    expect(cleanEntryPath('a/../../x.md')).toBeNull();
    expect(cleanEntryPath('__MACOSX/a.md')).toBeNull();
    expect(cleanEntryPath('a/b.md')).toBe('a/b.md');
  });
});

describe('convertNotionExport', () => {
  const entries = [
    E(`프로젝트 ${ID1}.md`, `# 프로젝트\n\n하위: [상세](프로젝트%20${ID1}/상세%20${ID2}.md) 와 [밖](https://example.com)\n\n![그림](프로젝트%20${ID1}/그림.png)\n\n<aside>\n💡 팁입니다\n</aside>\n\n[없는 페이지](없음%20${ID4}.md)\n`),
    E(`프로젝트 ${ID1}/상세 ${ID2}.md`, `# 상세\n\n[돌아가기](../프로젝트%20${ID1}.md)\n`),
    E(`프로젝트 ${ID1}/그림.png`, new Uint8Array([1, 2, 3])),
    E(`할 일 ${ID3}.csv`, 'Name,Status,Score\n첫 일,진행,3\n둘째 일,완료,5\n세번째,진행,\n'),
    E(`할 일 ${ID3}/첫 일 ${ID4}.md`, '# 첫 일\n\nStatus: 진행\nScore: 3\n\n본문 내용\n'),
    E(`할 일 ${ID3}/둘째 일 ${ID1}.md`, '# 둘째 일\n\nStatus: 완료\nScore: 5\n'),
    E('__MACOSX/._x', 'x'),
  ];
  const r = convertNotionExport(entries, { rootFolder: 'Notion 가져오기' });

  it('페이지와 첨부 이름·위치', () => {
    const paths = r.files.map((f) => f.path).sort();
    expect(paths).toContain('Notion 가져오기/프로젝트.md');
    expect(paths).toContain('Notion 가져오기/프로젝트/상세.md');
    expect(paths).toContain('Notion 가져오기/프로젝트/그림.png');
    expect(paths.some((p) => p.includes('__MACOSX'))).toBe(false);
  });
  it('내부 링크는 위키링크, 없는 페이지는 글자만, 외부 링크·이미지', () => {
    const md = get(r, 'Notion 가져오기/프로젝트.md');
    expect(md).toContain('[[상세]]');
    expect(md).toContain('[밖](https://example.com)');
    expect(md).toContain('![그림](%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8/%EA%B7%B8%EB%A6%BC.png)');
    expect(md).toContain('> [!note]');
    expect(md).toContain('💡 팁입니다');
    expect(md).not.toContain('(없음');
    expect(get(r, 'Notion 가져오기/프로젝트/상세.md')).toContain('[[프로젝트|돌아가기]]');
  });
  it('데이터베이스: _db.yaml, 속성은 프런트매터로, 본문 유지, CSV 에만 있는 행도 생성', () => {
    const yaml = get(r, 'Notion 가져오기/할 일/_db.yaml');
    expect(yaml).toContain('title: 할 일');
    expect(yaml).toContain('Status:');
    expect(yaml).toContain('Score:');
    const first = get(r, 'Notion 가져오기/할 일/첫 일.md');
    expect(first).toMatch(/^---\n[\s\S]*Status: 진행[\s\S]*Score: 3[\s\S]*---\n/);
    expect(first).toContain('본문 내용');
    expect(first).not.toContain('# 첫 일');
    expect(get(r, 'Notion 가져오기/할 일/세번째.md')).toContain('Status: 진행');
    expect(r.files.some((f) => f.path.endsWith('.csv'))).toBe(false);
    expect(r.stats).toMatchObject({ databases: 1, rows: 3 });
  });
  it('이름이 겹치면 번호를 붙인다', () => {
    const x = convertNotionExport([E(`a ${ID1}.md`, '# a'), E(`a ${ID2}.md`, '# a')]);
    expect(x.files.map((f) => f.path).sort()).toEqual(['a (2).md', 'a.md']);
  });
});
