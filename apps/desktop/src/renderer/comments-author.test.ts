import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '@nopsidian/i18n';
import { commentAuthorName } from './comments-author';

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
