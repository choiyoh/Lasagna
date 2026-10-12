import { describe, expect, it } from 'vitest';
import { applyEdits, findLinkSpans } from './link-spans.js';

const targets = (src: string) => findLinkSpans(src).map((s) => [s.kind, s.rawTarget, src.slice(s.targetStart, s.targetEnd)]);

describe('findLinkSpans', () => {
  it('위키링크·임베드·별칭·제목·블록: 대상 구간만 정확히 가리킨다', () => {
    const src = '[[노트]] [[폴더/노트#제목|별칭]] ![[img.png|300]] [[노트#^id]] [[ 공백 ]]\n';
    expect(targets(src)).toEqual([
      ['wikilink', '노트', '노트'],
      ['wikilink', '폴더/노트', '폴더/노트'],
      ['embed', 'img.png', 'img.png'],
      ['wikilink', '노트', '노트'],
      ['wikilink', ' 공백 ', ' 공백 '],
    ]);
  });

  it('프런트매터 relation, 코드·인라인 코드 안은 제외', () => {
    const src = '---\n관련: ["[[저자]]"]\n---\n본문 `[[코드]]`\n\n```\n[[블록]]\n```\n[[진짜]]\n';
    expect(targets(src).map((t) => [t[0], t[1]])).toEqual([
      ['relation', '저자'],
      ['wikilink', '진짜'],
    ]);
  });

  it('마크다운 링크·이미지: 경로 구간만(조각·제목 제외), 외부 URL은 제외', () => {
    const src = '[a](notes/b.md#섹션) ![i](img/a%20b.png "제목") [x](https://e.com/a.md) [y](<내 폴더/c d.md>) [z](#앵커)\n';
    const spans = findLinkSpans(src);
    expect(spans.map((s) => [s.kind, s.rawTarget, s.angle, s.encoded])).toEqual([
      ['md', 'notes/b.md', false, false],
      ['embed', 'img/a%20b.png', false, true],
      ['md', '내 폴더/c d.md', true, false],
    ]);
    for (const s of spans) expect(src.slice(s.targetStart, s.targetEnd)).toBe(s.rawTarget);
  });

  it('괄호가 든 경로와 CRLF', () => {
    const src = '앞\r\n[a](x(1)/b.md) [[노트]]\r\n';
    const spans = findLinkSpans(src);
    expect(spans.map((s) => s.rawTarget)).toEqual(['x(1)/b.md', '노트']);
    for (const s of spans) expect(src.slice(s.targetStart, s.targetEnd)).toBe(s.rawTarget);
  });
});

describe('applyEdits', () => {
  it('여러 편집을 위치가 어긋나지 않게 적용하고, 겹치면 거부한다', () => {
    expect(applyEdits('abcdef', [{ start: 0, end: 1, text: 'XX' }, { start: 4, end: 6, text: '' }])).toBe('XXbcd');
    expect(() => applyEdits('abcdef', [{ start: 0, end: 3, text: '' }, { start: 2, end: 4, text: '' }])).toThrow();
  });
});
