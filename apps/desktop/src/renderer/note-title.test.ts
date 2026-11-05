import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '@nopsidian/i18n';
import { safeName, titleInSync, titleRenameTarget, untitledPath } from './note-title';

afterEach(() => setLocale('ko'));

describe('note-title', () => {
  it('제목과 파일 이름이 같거나 제목이 비었을 때만 동기화한다', () => {
    expect(titleInSync('a/회의.md', '회의')).toBe(true);
    expect(titleInSync('a/제목 없음.md', '')).toBe(true);
    expect(titleInSync('a/회의.md', '다른 제목')).toBe(false);
    expect(titleInSync('a/회의.md', null)).toBe(false);
    expect(titleInSync('일기/2026-10-15.md', '2026-10-15')).toBe(false);
    expect(titleInSync('A: B.md', 'A: B')).toBe(false);
    expect(titleInSync('A  B.md', 'A: B')).toBe(false);
    expect(titleInSync('A B.md', 'A: B')).toBe(true);
  });
  it('새 경로는 같은 폴더에 다듬은 제목으로', () => {
    expect(titleRenameTarget('a/제목 없음.md', '주간 회의')).toBe('a/주간 회의.md');
    expect(titleRenameTarget('제목 없음.md', '  ')).toBeNull();
    expect(titleRenameTarget('회의.md', '회의')).toBeNull();
    expect(titleRenameTarget('x.md', 'a/b: [c]#d')).toBe('a b c d.md');
    expect(safeName('x'.repeat(200))).toHaveLength(120);
  });
  it('겹치지 않는 제목 없음 경로', () => {
    expect(untitledPath('', [])).toBe('제목 없음.md');
    expect(untitledPath('f', ['f/제목 없음.md', 'f/제목 없음 2.md'])).toBe('f/제목 없음 3.md');
  });
  it('영어에서는 Untitled 로 만들고, 겹치면 번호를 붙인다', () => {
    setLocale('en');
    expect(untitledPath('', [])).toBe('Untitled.md');
    expect(untitledPath('f', ['f/Untitled.md'])).toBe('f/Untitled 2.md');
  });
});
