import { describe, expect, it } from 'vitest';
import { buildMergeDocxParts, escapeXml, mergePlainText, mergeTxtBytes } from './merge.js';

const parts = [
  { title: '1화 시작', body: '첫 문단\n\n둘째 문단' },
  { title: '2화 다음', body: '이어짐' },
];

const doc = (opts: Partial<Parameters<typeof buildMergeDocxParts>[0]> = {}) =>
  new TextDecoder().decode(buildMergeDocxParts({ title: '달빛', summary: null, parts, includeTitles: true, separator: 'page', ...opts })['word/document.xml']);

describe('mergePlainText', () => {
  it('제목·본문·구분선·요약을 순서대로 넣는다', () => {
    expect(mergePlainText(parts, { includeTitles: true, separator: 'rule', summary: '달빛 · 2개 회차 · 20자' })).toBe(
      '달빛 · 2개 회차 · 20자\n\n1화 시작\n\n첫 문단\n\n둘째 문단\n\n---\n\n2화 다음\n\n이어짐\n',
    );
  });

  it('빈 줄 구분은 본문 사이 한 줄, 제목 끄기는 제목 없이', () => {
    const text = mergePlainText(parts, { includeTitles: false, separator: 'blank', summary: null });
    expect(text).toBe('첫 문단\n\n둘째 문단\n\n이어짐\n');
  });

  it('쪽 나눔은 폼피드, 끝에는 줄바꿈 하나', () => {
    expect(mergePlainText(parts, { includeTitles: false, separator: 'page', summary: null })).toBe('첫 문단\n\n둘째 문단\n\n\f\n\n이어짐\n');
  });
});

describe('mergeTxtBytes', () => {
  it('UTF-8 BOM + CRLF 로 저장한다', () => {
    const bytes = mergeTxtBytes('가\n나\n');
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes.slice(3));
    expect(text).toBe('가\r\n나\r\n');
    expect(text).not.toMatch(/[^\r]\n/);
  });
});

describe('docx 파트', () => {
  it('필수 파트가 모두 있고 최소 OOXML 선언을 갖는다', () => {
    const files = buildMergeDocxParts({ title: '달빛', summary: null, parts, includeTitles: true, separator: 'page' });
    expect(Object.keys(files).sort()).toEqual(['[Content_Types].xml', '_rels/.rels', 'word/_rels/document.xml.rels', 'word/document.xml', 'word/styles.xml']);
    const xml = doc();
    expect(xml.startsWith('<?xml')).toBe(true);
    expect(xml).toContain('w:document');
    const styles = new TextDecoder().decode(files['word/styles.xml']);
    expect(styles).toContain('Malgun Gothic');
    expect(styles).toContain('w:eastAsia="Malgun Gothic"');
  });

  it('작품 제목·회차 제목·본문·쪽 나눔을 넣는다', () => {
    const xml = doc();
    expect(xml).toContain('<w:pStyle w:val="Title"/>');
    expect(xml.indexOf('1화 시작')).toBeLessThan(xml.indexOf('2화 다음'));
    expect(xml).toContain('이어짐');
    expect((xml.match(/w:type="page"/g) ?? []).length).toBe(1);
  });

  it('구분선·빈 줄·요약 옵션을 반영한다', () => {
    expect(doc({ separator: 'rule' })).toContain('w:pBdr');
    expect(doc({ summary: '달빛 · 2개 회차' })).toContain('달빛 · 2개 회차');
    const noTitle = doc({ includeTitles: false });
    expect(noTitle).not.toContain('1화 시작');
  });

  it('XML 특수문자·제어문자를 안전하게 쓴다', () => {
    expect(escapeXml('a<b>&"c"\u0007')).toBe('a&lt;b&gt;&amp;&quot;c&quot;');
    const xml = doc({ title: 'A&B <제목>', parts: [{ title: '1화 <시작>', body: '문단 & 기호' }] });
    expect(xml).toContain('A&amp;B &lt;제목&gt;');
    expect(xml).not.toContain('A&B <제목>');
  });

  it('빈 본문 회차도 제목만 남고 깨지지 않는다', () => {
    const xml = doc({ parts: [{ title: '빈 회차', body: '' }] });
    expect(xml).toContain('빈 회차');
    expect(xml).toContain('<w:p/>');
  });
});
