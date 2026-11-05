import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '@nopsidian/i18n';
import { showTextPrompt } from '../src/nops/prompt';

afterEach(() => {
  document.body.innerHTML = '';
  setLocale('ko');
});

describe('showTextPrompt', () => {
  it('한국어에서는 취소/확인, 영어에서는 Cancel/OK', () => {
    setLocale('ko');
    void showTextPrompt('이름');
    let buttons = [...document.querySelectorAll('.nops-prompt button')].map((b) => b.textContent);
    expect(buttons).toEqual(['취소', '확인']);

    document.body.innerHTML = '';
    setLocale('en');
    void showTextPrompt('Name');
    buttons = [...document.querySelectorAll('.nops-prompt button')].map((b) => b.textContent);
    expect(buttons).toEqual(['Cancel', 'OK']);
  });
});
