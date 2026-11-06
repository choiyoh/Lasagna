import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '@nopsidian/i18n';
import { commentAuthorName, commentLengthError } from './comments-author';

afterEach(() => setLocale('ko'));

describe('commentAuthorName', () => {
  it('shows the stored self author in the current language', () => {
    setLocale('ko');
    expect(commentAuthorName('나')).toBe('나');
    setLocale('en');
    expect(commentAuthorName('나')).toBe('Me');
  });

  it('leaves other people and agents untouched', () => {
    setLocale('en');
    expect(commentAuthorName('Claude')).toBe('Claude');
    expect(commentAuthorName('PM 봇')).toBe('PM 봇');
    expect(commentAuthorName('')).toBe('');
  });
});

describe('commentLengthError', () => {
  it('IPC 스키마가 막기 전에 같은 한도로 사용자 문구를 돌려준다(ko/en, {} 없음)', () => {
    setLocale('ko');
    expect(commentLengthError('x'.repeat(5000))).toBeNull();
    expect(commentLengthError('x'.repeat(5001))).toBe('댓글이 너무 길어요(최대 5000자)');
    setLocale('en');
    const en = commentLengthError('x'.repeat(5001));
    expect(en).toBe('The comment is too long (at most 5000 characters)');
    expect(en).not.toMatch(/[\u3131-\u318e\uac00-\ud7a3]/);
    expect(en).not.toMatch(/\{\}/);
    setLocale('ko');
  });
});
