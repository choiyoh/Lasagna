import { describe, expect, it } from 'vitest';
import { renderNoteBody, wrapHtmlDocument } from './html.js';

const opts = {
  resolveNote: (t: string) => (t === '있는노트' ? '있는노트.html' : null),
  resolveAsset: (t: string) => (t === 'a.png' ? 'assets/a.png' : null),
  embedNote: (t: string, h: string | null, b: string | null) => (t === '있는노트' ? `<p>발췌:${h ?? ''}${b ?? ''}</p>` : null),
};

describe('renderNoteBody', () => {
  it('프런트매터는 빼고 기본 마크다운을 HTML 로', () => {
    const h = renderNoteBody('---\ntitle: x\n---\n# 제목\n\n**굵게** 와 `코드`\n', opts);
    expect(h).toContain('<h1 id="제목">제목</h1>');
    expect(h).toContain('<strong>굵게</strong>');
    expect(h).not.toContain('title: x');
  });
  it('글씨색 span 은 HTML 내보내기에도 색이 남는다', () => {
    const h = renderNoteBody('<span style="color:#c0392b">빨강</span> 글\n', opts);
    expect(h).toContain('<span style="color:#c0392b">빨강</span>');
  });

  it('위키링크: 있으면 링크(제목·블록 조각 포함), 없으면 미해결 표시, 별칭', () => {
    const h = renderNoteBody('[[있는노트#세부 내용|보기]] [[없는노트]] [[있는노트#^abc]]', opts);
    expect(h).toContain('<a class="wikilink" href="있는노트.html#세부-내용">보기</a>');
    expect(h).toContain('<span class="unresolved">없는노트</span>');
    expect(h).toContain('href="있는노트.html#blk-abc"');
  });
  it('이미지 임베드와 크기, 없는 첨부', () => {
    const h = renderNoteBody('![[a.png|300]] ![[b.png]]', opts);
    expect(h).toContain('<img src="assets/a.png" alt="a.png" width="300">');
    expect(h).toContain('<span class="unresolved">b.png</span>');
  });
  it('노트 임베드는 콜백 결과를 쓰고 없으면 링크로', () => {
    expect(renderNoteBody('![[있는노트#^q]]', opts)).toContain('<div class="embed-note"><p>발췌:q</p></div>');
  });
  it('블록 ID 는 앵커가 되고 글자에서는 빠진다', () => {
    const h = renderNoteBody('문단 내용 ^abc12\n', opts);
    expect(h).toContain('<p id="blk-abc12">문단 내용</p>');
  });
  it('콜아웃(접이식 포함)과 열 펜스', () => {
    const c = renderNoteBody('> [!warning] 조심\n> 본문\n', opts);
    expect(c).toContain('class="callout callout-warning"');
    expect(c).toContain('조심');
    expect(c).toContain('본문');
    expect(renderNoteBody('> [!tip]+ 열림\n> 내용\n', opts)).toContain('<details class="callout callout-tip" open>');
    const cols = renderNoteBody(':::columns\n\n:::column\n\n왼쪽\n\n:::\n\n:::column\n\n오른쪽\n\n:::\n\n:::\n', opts);
    expect(cols).toContain('<div class="fence fence-columns">');
    expect(cols.match(/<\/div>/g)?.length).toBe(3);
  });
  it('토글 제목 표시·하이라이트·수식', () => {
    const h = renderNoteBody('## 접이식 {.toggle}\n\n==중요== $x^2$\n\n$$\ny=1\n$$\n', opts);
    expect(h).toContain('<h2 id="접이식">접이식</h2>');
    expect(h).toContain('<mark>중요</mark>');
    expect(h).toContain('<math');
  });
  it('각주 참조·정의·인라인 각주를 내보낸다', () => {
    const h = renderNoteBody('본문[^1]과 ^[인라인 내용]\n\n[^1]: 정의 내용\n', opts);
    expect(h).toContain('data-footnote-ref');
    expect(h).toContain('<section data-footnotes');
    expect(h).toContain('정의 내용');
    expect(h).toContain('인라인 내용');
  });

  it('인라인 각주 식별자가 실제 [^inline-1] 정의와 겹치지 않는다', () => {
    const h = renderNoteBody('본문 ^[인라인]\n\n[^inline-1]: 실제 정의\n', opts);
    expect(h).toContain('nops-inline-1');
    expect(h).toContain('inline-1');
  });

  it('Mermaid 펜스는 원문 코드 블록으로 내보낸다(앱에서만 SVG)', () => {
    const h = renderNoteBody('```mermaid\nflowchart TD\n  A --> B\n```\n', opts);
    expect(h).toContain('language-mermaid');
    expect(h).toContain('flowchart TD');
  });

  it('코드 안의 [[ ]] 는 그대로 둔다', () => {
    expect(renderNoteBody('`[[x]]`\n\n```\n[[y]]\n```\n', opts)).not.toContain('unresolved');
  });
  it('문서로 감싸면 스크립트를 막는 CSP 가 들어간다', () => {
    const d = wrapHtmlDocument({ title: 'a<b', body: '<p>x</p>' });
    expect(d).toContain("default-src 'none'");
    expect(d).toContain('<title>a&lt;b</title>');
  });
});
