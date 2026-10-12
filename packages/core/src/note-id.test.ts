import { describe, expect, it } from 'vitest';
import { ensureNoteId, newNoteId } from './note-id.js';
import { parseNote } from './markdown/parse.js';

describe('newNoteId', () => {
  it('26자 Crockford ULID이고 시간순으로 정렬된다', () => {
    const a = newNoteId(1_700_000_000_000);
    const b = newNoteId(1_700_000_001_000);
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(a < b).toBe(true);
  });
});

describe('ensureNoteId', () => {
  it('프런트매터가 있으면 id 한 줄만 끼워 넣고 나머지는 그대로 둔다', () => {
    const src = '---\ntitle: 가\ntags: [a]\n---\n\n본문\n';
    const r = ensureNoteId(src, 'ID1');
    expect(r.added).toBe(true);
    expect(r.source).toBe('---\nid: ID1\ntitle: 가\ntags: [a]\n---\n\n본문\n');
    expect(parseNote(r.source).meta.id).toBe('ID1');
  });

  it('프런트매터가 없으면 새로 만든다(CRLF 유지)', () => {
    expect(ensureNoteId('# 제목\n', 'ID2').source).toBe('---\nid: ID2\n---\n\n# 제목\n');
    expect(ensureNoteId('# 제목\r\n', 'ID2').source).toBe('---\r\nid: ID2\r\n---\r\n\r\n# 제목\r\n');
  });

  it('이미 id가 있으면 바꾸지 않는다', () => {
    const src = '---\nid: "KEEP"\n---\n본문\n';
    const r = ensureNoteId(src, 'NEW');
    expect(r).toEqual({ source: src, id: 'KEEP', added: false });
  });
});
