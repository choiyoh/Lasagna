import { readFileSync } from 'node:fs';
import path from 'node:path';
import { setLocale } from '@nopsidian/i18n';
import { afterEach, describe, expect, it } from 'vitest';
import { syncFailureFor } from './sync';

const DOCS = path.resolve(__dirname, '../../../../docs');

/** GitHub 이 만드는 제목 앵커(소문자·구두점 제거·공백은 -). */
function slugs(markdown: string): string[] {
  return markdown
    .split('\n')
    .filter((line) => /^#{1,4} /.test(line))
    .map((line) =>
      line
        .replace(/^#{1,4} /, '')
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s-]/gu, '')
        .replace(/\s+/g, '-'),
    );
}

afterEach(() => setLocale('ko'));

describe('동기화 문서 링크의 언어', () => {
  it('앱 언어에 맞는 문서와 앵커를 고른다(ko → sync-setup.md, en → sync-setup.en.md)', () => {
    setLocale('ko');
    const ko = syncFailureFor({ key: 'auth', code: 'HTTP 401' });
    expect(ko.docs).toBe('https://github.com/choiyoh/Lasagna/blob/main/docs/sync-setup.md#2-앱에서-연결');

    setLocale('en');
    const en = syncFailureFor({ key: 'auth', code: 'HTTP 401' });
    expect(en.docs).toBe('https://github.com/choiyoh/Lasagna/blob/main/docs/sync-setup.en.md#2-connect-in-the-app');
    setLocale('ko');
  });

  it('모든 오류의 앵커가 해당 언어 문서의 실제 헤딩과 맞는다', () => {
    const koSlugs = new Set(slugs(readFileSync(path.join(DOCS, 'sync-setup.md'), 'utf8')));
    const enSlugs = new Set(slugs(readFileSync(path.join(DOCS, 'sync-setup.en.md'), 'utf8')));
    const keys = ['auth', 'authCheck', 'authRevoked', 'notConnected', 'apiDisabled', 'quota', 'rateLimit', 'network', 'server', 'notFound', 'forbidden', 'folderMissing', 'partial', 'blocked', 'busy', 'unknown'];
    const missing: string[] = [];
    for (const key of keys) {
      setLocale('ko');
      const ko = syncFailureFor({ key, code: 'HTTP 400' });
      const koAnchor = decodeURIComponent(new URL(ko.docs).hash.slice(1));
      if (!koAnchor || !koSlugs.has(koAnchor)) missing.push(`ko ${key}: ${koAnchor}`);

      setLocale('en');
      const en = syncFailureFor({ key, code: 'HTTP 400' });
      const enAnchor = decodeURIComponent(new URL(en.docs).hash.slice(1));
      if (!enAnchor || !enSlugs.has(enAnchor)) missing.push(`en ${key}: ${enAnchor}`);
    }
    setLocale('ko');
    expect(missing).toEqual([]);
  });
});
