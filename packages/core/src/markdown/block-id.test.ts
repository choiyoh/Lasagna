import { describe, expect, it } from 'vitest';
import { ensureBlockIdAt } from './block-id.js';

const fixed = () => 'abc123';

describe('ensureBlockIdAt', () => {
  it('문단 끝에 붙인다(줄 끝 공백은 정리)', () => {
    const r = ensureBlockIdAt('# 제목\n\n본문 문장   \n\n다음\n', 3, fixed)!;
    expect(r).toEqual({ content: '# 제목\n\n본문 문장 ^abc123\n\n다음\n', id: 'abc123', changed: true });
  });

  it('이미 있으면 그대로 돌려준다', () => {
    const src = '본문 ^keep1\n';
    expect(ensureBlockIdAt(src, 1, fixed)).toEqual({ content: src, id: 'keep1', changed: false });
  });

  it('제목 줄과 프런트매터가 있는 문서의 줄 번호', () => {
    const r = ensureBlockIdAt('---\nid: X\n---\n\n## 소제목\n', 5, fixed)!;
    expect(r.content).toBe('---\nid: X\n---\n\n## 소제목 ^abc123\n');
  });

  it('목록은 가리킨 항목의 줄에 붙인다', () => {
    const r = ensureBlockIdAt('- a\n- b\n- c\n', 2, fixed)!;
    expect(r.content).toBe('- a\n- b ^abc123\n- c\n');
  });

  it('인용·콜아웃은 블록의 마지막 줄에 붙인다', () => {
    expect(ensureBlockIdAt('> [!note] 제목\n> 본문\n', 1, fixed)!.content).toBe('> [!note] 제목\n> 본문 ^abc123\n');
  });

  it('표·코드 블록은 아래에 단독 줄로 둔다, 이미 있으면 재사용', () => {
    const table = '| a | b |\n| - | - |\n| 1 | 2 |\n\n끝\n';
    const r = ensureBlockIdAt(table, 3, fixed)!;
    expect(r.content).toBe('| a | b |\n| - | - |\n| 1 | 2 |\n\n^abc123\n\n끝\n');
    expect(ensureBlockIdAt(r.content, 1, () => 'zzzzzz')).toMatchObject({ id: 'abc123', changed: false });
    const code = '```ts\nx\n```\n';
    expect(ensureBlockIdAt(code, 2, fixed)!.content).toBe('```ts\nx\n```\n\n^abc123\n');
  });

  it('CRLF 문서는 줄바꿈을 유지한다', () => {
    const r = ensureBlockIdAt('# 제목\r\n\r\n본문\r\n', 3, fixed)!;
    expect(r.content).toBe('# 제목\r\n\r\n본문 ^abc123\r\n');
    expect(ensureBlockIdAt('```\r\nx\r\n```\r\n', 1, fixed)!.content).toBe('```\r\nx\r\n```\r\n\r\n^abc123\r\n');
  });

  it('이미 쓰인 ID와 겹치지 않는 ID를 만든다', () => {
    const seen: string[][] = [];
    ensureBlockIdAt('a ^x1\n\nb\n', 3, (existing) => (seen.push([...existing]), 'q1w2e3'));
    expect(seen[0]).toEqual(['x1']);
  });

  it('블록 밖(빈 줄)이면 null, 기본 생성기는 6자 영숫자', () => {
    expect(ensureBlockIdAt('a\n\nb\n', 2)).toBeNull();
    expect(ensureBlockIdAt('본문\n', 1)!.id).toMatch(/^[a-z0-9]{6}$/);
  });

  it('바뀌는 것은 ID 하나뿐이다(나머지 바이트 동일)', () => {
    const src = '앞\t \n\n**굵게** [[링크]] `코드`\n\n- 항목\n';
    const r = ensureBlockIdAt(src, 3, fixed)!;
    expect(r.content.replace(' ^abc123', '')).toBe(src);
  });
});
