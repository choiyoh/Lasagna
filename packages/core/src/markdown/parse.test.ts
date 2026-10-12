import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assemble, parseNote, replaceBlock } from './parse.js';

const fixture = (name: string) =>
  readFileSync(path.join(__dirname, '../../../../fixtures/vaults/basic', name), 'utf8');

describe('parseNote: 프런트매터', () => {
  const note = parseNote(fixture('클린 코드.md'));

  it('id·제목·별칭·태그를 읽는다', () => {
    expect(note.meta.id).toBe('01JA7Z3K9V6Q8M2N4P5R7S9T0W');
    expect(note.meta.title).toBe('클린 코드');
    expect(note.meta.aliases).toEqual(['Clean Code']);
    expect(note.meta.tags.filter((t) => t.source === 'frontmatter').map((t) => t.tag)).toEqual(['독서', '개발']);
  });

  it('프런트매터 속성의 위키링크는 relation 링크가 된다', () => {
    const rel = note.meta.links.filter((l) => l.kind === 'relation').map((l) => l.target);
    expect(rel).toEqual(['리팩터링', '소프트웨어 장인']);
  });

  it('깨진 YAML도 원문을 보존하고 오류만 기록한다', () => {
    const bad = '---\nfoo: [unclosed\n---\n본문\n';
    const n = parseNote(bad);
    expect(n.frontmatter?.error).toBeTruthy();
    expect(assemble(n)).toBe(bad);
    expect(n.blocks[0]?.source).toBe('본문');
  });

  it('프런트매터가 없으면 null', () => {
    expect(parseNote('# 제목\n').frontmatter).toBeNull();
    expect(parseNote('--- 가로줄이 아님\n').frontmatter).toBeNull();
  });
});

describe('parseNote: 링크·태그·제목·블록 ID', () => {
  const note = parseNote(fixture('클린 코드.md'));

  it('위키링크를 대상·제목·블록·별칭으로 분해하고 줄 번호를 기록한다', () => {
    const wiki = note.meta.links.filter((l) => l.kind === 'wikilink');
    expect(wiki).toEqual([{ kind: 'wikilink', target: '리팩터링', heading: '1장', alias: '1장', line: 18 }]);
  });

  it('임베드 크기는 alias로, 코드 안 링크는 무시한다', () => {
    const embeds = note.meta.links.filter((l) => l.kind === 'embed');
    expect(embeds.map((l) => [l.target, l.alias])).toEqual([
      ['diagram.png', '400'],
      ['attachments/a.png', undefined],
    ]);
    expect(note.meta.links.some((l) => l.target.includes('코드'))).toBe(false);
  });

  it('마크다운 링크: 외부 URL 제외, 상대 경로는 디코딩·조각 분리', () => {
    const md = note.meta.links.filter((l) => l.kind === 'md');
    expect(md).toHaveLength(1);
    expect(md[0]).toMatchObject({ target: 'notes/other note.md', heading: '섹션' });
  });

  it('인라인 태그만 잡고 코드 안 해시·제목 표기는 무시한다', () => {
    const inline = note.meta.tags.filter((t) => t.source === 'inline').map((t) => t.tag);
    expect(inline).toEqual(['리뷰']);
  });

  it('제목(슬러그 포함)과 블록 ID를 추출한다', () => {
    expect(note.meta.headings).toEqual([{ level: 1, text: '요약', slug: '요약', line: 10 }]);
    expect(note.meta.blockIds.map((b) => b.id).sort()).toEqual(['b7k2', 'c91x', 'table1']);
    const table = note.blocks.find((b) => b.kind === 'table')!;
    expect(table.blockId).toBe('table1');
  });
});

describe('parseNote: 블록 분류', () => {
  const note = parseNote(fixture('클린 코드.md'));

  it('콜아웃과 컬럼 펜스를 인식한다', () => {
    const callout = note.blocks.find((b) => b.kind === 'callout')!;
    expect(callout.callout).toEqual({ type: 'note', fold: '-', title: '접힌 콜아웃 제목' });
    const fences = note.blocks.filter((b) => b.fence).map((b) => [b.kind, b.fence?.name, b.fence?.colons]);
    expect(fences).toEqual([
      ['fence-open', 'columns', 4],
      ['fence-open', 'column', 3],
      ['fence-close', '', 3],
      ['fence-open', 'column', 3],
      ['fence-close', '', 3],
      ['fence-close', '', 4],
    ]);
  });

  it('코드·수식 블록은 별도 종류다', () => {
    const kinds = note.blocks.map((b) => b.kind);
    expect(kinds).toContain('code');
    expect(kinds).toContain('math');
    expect(kinds).toContain('table');
  });
});

describe('바이트 보존', () => {
  it('블록과 사이 공백으로 재조립하면 원문과 같다', () => {
    const src = fixture('클린 코드.md');
    expect(assemble(parseNote(src))).toBe(src);
  });

  it('CRLF·끝 공백·탭도 그대로 유지한다', () => {
    const src = '# 제목  \r\n\r\n본문\t\r\n\r\n\r\n- a\r\n- b\r\n';
    expect(assemble(parseNote(src))).toBe(src);
  });

  it('replaceBlock은 해당 블록만 바꾸고 나머지 바이트는 건드리지 않는다', () => {
    const src = '# A\n\n\n본문1   \n\n- x\n';
    const note = parseNote(src);
    const out = replaceBlock(note, 1, '바뀐 본문');
    expect(out).toBe('# A\n\n\n바뀐 본문\n\n- x\n');
  });
});
