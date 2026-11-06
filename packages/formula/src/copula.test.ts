import { setLocale, t, type MessageKey } from '@nopsidian/i18n';
import { afterEach, describe, expect, it } from 'vitest';
import { formulaErrorText } from './value.js';

const HANGUL = /[\u3131-\u318e\uac00-\ud7a3]/;
afterEach(() => setLocale('ko'));

/** 값 종류 이름 뒤의 '이에요/예요'는 받침에 맞춰 붙여 쓴다(예: 문자열이에요, 숫자예요). */
const CASES: [string, string][] = [
  ['string', '문자열이에요'],
  ['list', '목록이에요'],
  ['number', '숫자예요'],
  ['date', '날짜예요'],
  ['boolean', '불리언이에요'],
  ['null', '빈 값이에요'],
];

describe('값 종류 뒤의 이에요/예요', () => {
  it('모든 값 종류에서 받침에 맞게 붙여 쓴다', () => {
    setLocale('ko');
    for (const [type, expected] of CASES) {
      const label = t(`formula.type.${type}` as MessageKey);
      const text = t('formula.err.needsNumber', { what: 'x', type: label });
      expect(text).toBe(`x: 숫자가 필요한데 ${expected}`);
      expect(text).not.toMatch(/\{be\}/);
      // 띄어 쓴 ' 이에요' 가 남지 않는다
      expect(text).not.toMatch(/\s이에요|\s예요/);
    }
  });

  it('실제 오류(문자열 인자에 목록)에서도 같은 규칙을 쓴다', () => {
    setLocale('ko');
    const err = { key: 'formula.err.needsList' as MessageKey, params: { fn: 'repeat', type: { key: 'formula.type.string' as MessageKey } } };
    expect(formulaErrorText(err)).toBe('repeat: 목록이 필요한데 문자열이에요');
    setLocale('en');
    const en = formulaErrorText(err);
    expect(en).toBe('repeat: expected a list but got Text');
    expect(en).not.toMatch(HANGUL);
    expect(en).not.toMatch(/\{be\}/);
  });
});
