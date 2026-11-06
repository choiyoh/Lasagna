import { CodedError } from '@nopsidian/core';
import { setLocale } from '@nopsidian/i18n';
import { afterEach, describe, expect, it } from 'vitest';
import { userMessage } from './user-message';

const HANGUL = /[\u3131-\u318e\uac00-\ud7a3]/;
afterEach(() => setLocale('ko'));

/** Electron 이 붙이는 접두사가 붙은 IPC 오류. */
const ipc = (e: Error) => new Error(`Error invoking remote method 'x:y': Error: ${e.message}`);

describe('userMessage', () => {
  it('코드+params 오류는 지금 언어로 번역한다(키 노출 0, 영→한→영)', () => {
    const err = new CodedError('core.err.commentTooLong', { max: 5000 });
    setLocale('ko');
    const ko = userMessage(err);
    setLocale('en');
    const en = userMessage(err);
    setLocale('ko');
    expect(ko).toBe('댓글이 너무 길어요(최대 5000자)');
    expect(en).toBe('The comment is too long (at most 5000 characters)');
    expect(en).not.toMatch(HANGUL);
    expect(en).not.toMatch(/core\.err/);
    expect(userMessage(err)).toBe(ko);
  });

  it('IPC 접두사를 떼고, key 가 붙은 오류도 번역한다', () => {
    setLocale('en');
    // Electron 은 message 만 넘기므로 접두사만 떼면 이미 번역된 문구가 온다
    expect(userMessage(ipc(new Error('Path outside the vault: ../x')))).toBe('Path outside the vault: ../x');
    expect(userMessage(ipc(new Error('boom')))).toBe('boom');
    // 같은 컨텍스트에서 key 가 살아 있으면(워커 결과 등) 번역한다
    const withKey = Object.assign(new Error('core.err.pathEscape'), { key: 'core.err.pathEscape', params: { path: '../x' } });
    expect(userMessage(withKey)).toBe('Path outside the vault: ../x');
  });

  it('코드가 없는 오류는 메시지를 그대로 쓴다', () => {
    expect(userMessage(new Error('그냥 오류'))).toBe('그냥 오류');
    expect(userMessage('문자열')).toBe('문자열');
  });
});
