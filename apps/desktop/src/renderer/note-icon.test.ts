import { describe, expect, it } from 'vitest';
import { withNoteIcon } from './note-icon';

describe('withNoteIcon', () => {
  it('프런트매터가 없으면 만들고, 본문은 그대로', () => {
    expect(withNoteIcon('# 제목\n\n본문\n', '📘')).toBe('---\nicon: 📘\n---\n# 제목\n\n본문\n');
  });
  it('있으면 그 키만 바꾸고 나머지는 보존', () => {
    expect(withNoteIcon('---\ntitle: 메모\nicon: 📘\n---\n본문\n', '🚀')).toBe('---\ntitle: 메모\nicon: 🚀\n---\n본문\n');
  });
  it('null 이면 icon 키만 지운다', () => {
    expect(withNoteIcon('---\ntitle: 메모\nicon: 📘\n---\n본문\n', null)).toBe('---\ntitle: 메모\n---\n본문\n');
  });
  it('같은 값이면 바이트 동일', () => {
    const s = '---\nicon: 📘\n---\n본문\n';
    expect(withNoteIcon(s, '📘')).toBe(s);
  });
});
