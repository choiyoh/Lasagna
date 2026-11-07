import { CodedError } from '@nopsidian/core';
import { setLocale } from '@nopsidian/i18n';
import { afterEach, describe, expect, it } from 'vitest';
import { renameFailureText } from './rename-error';

const HANGUL = /[\u3131-\u318e\uac00-\ud7a3]/;
afterEach(() => setLocale('ko'));

describe('renameFailureText', () => {
  it('이미 있는 이름이면 ko/en 모두 분명한 문구로 알린다', () => {
    const err = Object.assign(new Error('main.err.pathExists'), { key: 'main.err.pathExists', params: {} });
    setLocale('ko');
    const ko = renameFailureText(err, false, '폴더/보고서.md');
    expect(ko).toBe('이미 있는 이름이에요: 보고서');
    setLocale('en');
    const en = renameFailureText(err, false, 'folder/report.md');
    expect(en).toBe('That name is already taken: report');
    expect(en).not.toMatch(HANGUL);
    expect(en).not.toMatch(/\{\w+\}/);
    setLocale('ko');
  });

  it('그 밖의 실패·자동 이름 동기화 실패는 기존 문구를 쓴다', () => {
    setLocale('en');
    expect(renameFailureText(new CodedError('core.err.keyExists', { key: 'x' }), false)).toMatch(/^Couldn't rename: That key already exists: x$/);
    expect(renameFailureText(new Error('boom'), true)).toMatch(/left as is/);
  });
});
