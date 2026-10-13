import { describe, expect, it } from 'vitest';
import { extractExcerpt } from './excerpt.js';

const doc = `---\ntitle: x\n---\n# 제목\n\n첫 문단 ^p1\n\n## 둘째\n\n둘째 문단\n\n- 항목\n\n# 다음\n\n끝\n`;

describe('extractExcerpt', () => {
  it('블록 ID로 그 블록만 돌려준다(^id 는 뺀다)', () => {
    expect(extractExcerpt(doc, { block: 'p1' })).toMatchObject({ found: true, text: '첫 문단' });
  });
  it('제목은 같거나 높은 단계의 다음 제목 전까지', () => {
    const r = extractExcerpt(doc, { heading: '둘째' });
    expect(r.found).toBe(true);
    expect(r.text).toContain('둘째 문단');
    expect(r.text).not.toContain('끝');
  });
  it('못 찾으면 found=false 와 앞부분', () => {
    const r = extractExcerpt(doc, { block: 'nope' });
    expect(r.found).toBe(false);
    expect(r.text).toContain('첫 문단');
  });
  it('길면 자른다', () => {
    const r = extractExcerpt('가'.repeat(50), { maxChars: 10 });
    expect(r.truncated).toBe(true);
  });
});

describe('접이식 제목 표시', () => {
  it('제목 목록·블록 텍스트에서 {.toggle} 은 빠진다', async () => {
    const { parseNote } = await import('./parse.js');
    const n = parseNote('## 둘째 {.toggle} ^h\n\n본문\n');
    expect(n.meta.headings[0]!.text).toBe('둘째');
    expect(n.blocks[0]!.text).not.toContain('{.toggle}');
    expect(extractExcerpt('## 둘째 {.toggle}\n\n본문\n', { heading: '둘째' }).text).toContain('본문');
  });
});
