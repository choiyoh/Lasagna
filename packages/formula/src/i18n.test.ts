import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '@nopsidian/i18n';
import { compileFormula, formulaErrorText, suggestAt } from './index.js';

afterEach(() => setLocale('ko'));

describe('수식 오류·제안 문구의 로캘', () => {
  it('오류 문구는 지금 언어로 나온다(ko/en)', () => {
    setLocale('ko');
    const ko = compileFormula('');
    expect(ko.ok).toBe(false);
    if (!ko.ok) expect(formulaErrorText(ko.error)).toBe('수식이 비어 있어요');

    setLocale('en');
    const en = compileFormula('');
    expect(en.ok).toBe(false);
    if (!en.ok) expect(formulaErrorText(en.error)).toBe('The formula is empty');
  });

  it('ko 로 컴파일한 오류도 표시할 때 언어로 다시 만든다(캐시에 문구가 박히지 않음)', () => {
    setLocale('ko');
    const parsed = compileFormula('1 +');
    expect(parsed.ok).toBe(false);
    const issue = parsed.ok ? null : parsed.error;
    if (!issue) throw new Error('expected error');
    expect(issue.message).toBe('수식이 갑자기 끝났어요');
    setLocale('en');
    expect(formulaErrorText(issue)).toBe('The formula ended unexpectedly');
  });

  it('함수 제안의 인자 수·속성 표기도 지금 언어', () => {
    setLocale('ko');
    expect(suggestAt('ro', 2, [])!.items.map((i) => i.detail)).toContain('1~2개');
    expect(suggestAt('prop("점', 7, ['점수'])!.items[0]!.detail).toBe('속성');
    setLocale('en');
    expect(suggestAt('ro', 2, [])!.items.map((i) => i.detail)).toContain('1–2 args');
    expect(suggestAt('prop("점', 7, ['점수'])!.items[0]!.detail).toBe('Property');
  });
});
