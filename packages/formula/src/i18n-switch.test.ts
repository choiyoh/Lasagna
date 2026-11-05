import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '@nopsidian/i18n';
import { compileFormula, evalFormula, formulaErrorText, type Env } from './index.js';

afterEach(() => setLocale('ko'));

const env: Env = { prop: () => null };

describe('ko↔en 전환에서도 오류 문구가 따라간다', () => {
  it('인자 개수 오류: ko 는 base 문구 그대로, en 은 영어', () => {
    setLocale('ko');
    const ko = compileFormula('round()');
    expect(ko.ok).toBe(false);
    if (!ko.ok) {
      expect(ko.error.message).toBe('round() 는 인자가 1~2개 필요해요(지금 0개)');
      setLocale('en');
      expect(formulaErrorText(ko.error)).toBe('round() takes 1–2 arguments (got 0)');
    }
  });

  it('값 종류 이름도 중첩 번역된다(한글이 영어 문장에 섞이지 않음)', () => {
    setLocale('ko');
    const ko = compileFormula('sort("x")');
    expect(ko.ok).toBe(true);
    const err = (() => {
      try {
        evalFormula((ko as { ok: true; compiled: never }).compiled, { prop: () => 'x' });
        return null;
      } catch (e) {
        return e;
      }
    })();
    if (!err) throw new Error('expected error');
    expect(formulaErrorText(err)).toContain('목록이 필요한데 문자열 이에요');
    setLocale('en');
    const text = formulaErrorText(err);
    expect(text).toBe('sort: expected a list but got Text');
    expect(text).not.toMatch(/[가-힣]/);
  });

  it('fn-text 의 fail 도 키를 들고 있어 전환 후 다시 번역된다', () => {
    setLocale('ko');
    const compiled = compileFormula('repeat([1], 2)');
    expect(compiled.ok).toBe(true);
    let err: unknown = null;
    try {
      evalFormula((compiled as { ok: true; compiled: never }).compiled, env);
    } catch (e) {
      err = e;
    }
    expect(formulaErrorText(err)).toBe('repeat: 문자열이 필요한데 목록 이에요');
    setLocale('en');
    expect(formulaErrorText(err)).toBe('repeat: expected text but got List');
  });


  it('날짜 함수의 목록 인자 오류도 표시 시점에 번역된다(formatDate/parseDate)', () => {
    const listEnv: Env = { prop: () => [1] };
    const cases: [string, string, string][] = [
      ['formatDate(prop("목록"), "yyyy")', 'formatDate: 날짜 인자가 필요한데 목록 이에요', 'formatDate: expected a date but got List'],
      ['parseDate(prop("목록"))', 'parseDate: 문자열이나 날짜가 필요한데 목록 이에요', 'parseDate: expected text or a date but got List'],
    ];
    for (const [src, koText, enText] of cases) {
      setLocale('ko');
      const compiled = compileFormula(src);
      expect(compiled.ok).toBe(true);
      let err: unknown = null;
      try {
        evalFormula((compiled as { ok: true; compiled: never }).compiled, listEnv);
      } catch (e) {
        err = e;
      }
      expect(formulaErrorText(err)).toBe(koText);
      setLocale('en');
      const text = formulaErrorText(err);
      expect(text).toBe(enText);
      expect(text).not.toMatch(/[가-힣]/);
    }
  });

  it('영어 인자 수 문구는 1 일 때 단수다', () => {
    setLocale('en');
    const exact = compileFormula('round(1, 2, 3)');
    expect(exact.ok).toBe(false);
    if (!exact.ok) expect(formulaErrorText(exact.error)).toBe('round() takes 1–2 arguments (got 3)');
    const atLeast = compileFormula('max()');
    expect(atLeast.ok).toBe(false);
    if (!atLeast.ok) expect(formulaErrorText(atLeast.error)).toBe('max() takes at least 1 argument (got 0)');
  });

  it('평가기가 오류를 다시 던져도 키가 보존된다(위치만 채워서)', () => {
    setLocale('ko');
    const compiled = compileFormula('map(1, current + 1)');
    expect(compiled.ok).toBe(true);
    let err: unknown = null;
    try {
      evalFormula((compiled as { ok: true; compiled: never }).compiled, { prop: () => null });
    } catch (e) {
      err = e;
    }
    setLocale('en');
    expect(formulaErrorText(err)).toBe('map: expected a list but got Number');
  });
});
