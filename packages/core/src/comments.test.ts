import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { COMMENTS_DIR, addComment, listComments, relocateComments, removeComment, setCommentResolved } from './comments.js';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const vault = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'nops-cm-'));
  dirs.push(d);
  return d;
};
const NOW = new Date('2026-10-18T09:00:00Z');

describe('comments', () => {
  it('댓글을 달고 읽는다(노트마다 따로, 오래된 것부터)', () => {
    const root = vault();
    const a = addComment(root, 'a/노트.md', { author: '나', text: '  첫 댓글 ' }, NOW);
    addComment(root, 'a/노트.md', { author: 'claude', text: '리뷰', quote: '인용한   글\n두 줄' }, NOW);
    addComment(root, 'b.md', { author: '나', text: '다른 노트' }, NOW);
    expect(a).toMatchObject({ author: '나', text: '첫 댓글', createdAt: NOW.toISOString() });
    const list = listComments(root, 'a/노트.md');
    expect(list.map((c) => c.text)).toEqual(['첫 댓글', '리뷰']);
    expect(list[1]!.quote).toBe('인용한 글 두 줄');
    expect(listComments(root, 'b.md')).toHaveLength(1);
    expect(listComments(root, '없는.md')).toEqual([]);
  });
  it('빈 댓글·너무 긴 댓글은 거부한다', () => {
    const root = vault();
    expect(() => addComment(root, 'a.md', { author: '나', text: '   ' })).toThrow();
    expect(() => addComment(root, 'a.md', { author: '나', text: 'x'.repeat(5001) })).toThrow(/너무 길어요/);
  });
  it('해결·다시 열기·삭제, 마지막 댓글을 지우면 파일도 없어진다', () => {
    const root = vault();
    const c = addComment(root, 'a.md', { author: '나', text: '하나' }, NOW);
    expect(setCommentResolved(root, 'a.md', c.id, true)).toBe(true);
    expect(listComments(root, 'a.md')[0]!.resolved).toBe(true);
    expect(setCommentResolved(root, 'a.md', c.id, false)).toBe(true);
    expect(listComments(root, 'a.md')[0]!.resolved).toBeUndefined();
    expect(setCommentResolved(root, 'a.md', 'nope', true)).toBe(false);
    expect(removeComment(root, 'a.md', 'nope')).toBe(false);
    expect(removeComment(root, 'a.md', c.id)).toBe(true);
    expect(readdirSync(path.join(root, COMMENTS_DIR))).toEqual([]);
  });
  it('노트·폴더 이름이 바뀌면 댓글이 따라간다', () => {
    const root = vault();
    addComment(root, '폴더/노트.md', { author: '나', text: '폴더 안' }, NOW);
    addComment(root, '폴더/하위/깊은.md', { author: '나', text: '깊음' }, NOW);
    addComment(root, '폴더2/노트.md', { author: '나', text: '다른 폴더' }, NOW);
    expect(relocateComments(root, '폴더', '새폴더')).toBe(2);
    expect(listComments(root, '새폴더/노트.md').map((c) => c.text)).toEqual(['폴더 안']);
    expect(listComments(root, '새폴더/하위/깊은.md')).toHaveLength(1);
    expect(listComments(root, '폴더/노트.md')).toEqual([]);
    expect(listComments(root, '폴더2/노트.md')).toHaveLength(1); // 이름이 비슷한 다른 폴더는 건드리지 않는다
    expect(readdirSync(path.join(root, COMMENTS_DIR))).toHaveLength(3);
    expect(relocateComments(root, '새폴더/노트.md', '새폴더/이름바뀜.md')).toBe(1);
    expect(listComments(root, '새폴더/이름바뀜.md')).toHaveLength(1);
    expect(existsSync(path.join(root, COMMENTS_DIR))).toBe(true);
  });
});
