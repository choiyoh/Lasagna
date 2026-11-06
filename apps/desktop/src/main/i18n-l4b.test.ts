import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '@nopsidian/i18n';
import { syncFailureFor } from './sync';
import { duplicateNote } from './trash';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

afterEach(() => setLocale('ko'));

describe('메인 프로세스 문구의 로캘', () => {
  it('동기화 실패 안내: ko 는 base 글자 그대로, en 은 영어', () => {
    setLocale('ko');
    const ko = syncFailureFor({ kind: 'auth' });
    expect(ko.title).toBe('Google 로그인이 만료됐어요');
    expect(ko.action).toBe('Google 계정을 다시 연결해 주세요');
    setLocale('en');
    const en = syncFailureFor({ kind: 'auth' });
    expect(en.title).toBe('Google sign-in expired');
    expect(en.action).toBe('Reconnect your Google account');
    expect(`${en.title} ${en.action}`).not.toMatch(/[가-힣]/);
    // 문서 anchor 는 문서 제목 값이라 언어와 무관하게 그대로
    expect(en.docs).toBe(ko.docs);
  });

  it('사본 파일 이름: ko 는 base, en 은 copy', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'nops-main-i18n-'));
    try {
      writeFileSync(path.join(root, '메모.md'), '# 메모\n');
      setLocale('ko');
      expect(duplicateNote(root, '메모.md')).toBe('메모 (사본).md');
      setLocale('en');
      expect(duplicateNote(root, '메모.md')).toBe('메모 (copy).md');
      // 사본이 이미 있으면 번호를 붙인다
      writeFileSync(path.join(root, '메모 (copy).md'), '# 메모\n');
      expect(duplicateNote(root, '메모.md')).toBe('메모 (copy 2).md');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
