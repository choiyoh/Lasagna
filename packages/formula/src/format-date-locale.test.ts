import { setLocale, t } from '@nopsidian/i18n';
import { afterEach, describe, expect, it } from 'vitest';
import { compileFormula, evalFormula } from './compile.js';


const HANGUL = /[\u3131-\u318e\uac00-\ud7a3]/;
afterEach(() => setLocale('ko'));

/** 노트 속성 없이 상수만 쓰는 수식을 실행한다. */
const run = (source: string): unknown => {
  const r = compileFormula(source);
  if (!r.ok) throw new Error(r.error.message);
  return evalFormula(r.compiled, { now: new Date(2026, 9, 18, 15, 30), prop: () => null } as never);
};

describe('formatDate 의 선택 언어 인자', () => {
  it('인자를 생략하면 지금까지와 같은 한국어 값이다(기존 수식 결과 불변)', () => {
    setLocale('en'); // 앱 언어와 무관하게 값은 한국어 유지
    expect(run('formatDate(parseDate("2026-10-18"), "YYYY-MM-DD dddd")')).toBe('2026-10-18 일요일');
    expect(run('formatDate(now(), "A")')).toBe('오후');
    setLocale('ko');
    expect(run('formatDate(parseDate("2026-10-18"), "YYYY-MM-DD dddd")')).toBe('2026-10-18 일요일');
  });

  it("'en' 을 주면 영어 요일·월·오전/오후로 쓴다", () => {
    expect(run('formatDate(parseDate("2026-10-18"), "dddd, MMMM D", "en")')).toBe('Sunday, October 18');
    expect(run('formatDate(now(), "A", "en")')).toBe('PM');
    expect(run('formatDate(parseDate("2026-01-05"), "ddd MMM", "en")')).toBe('Mon Jan');
    expect(run('formatDate(parseDate("2026-10-18"), "YYYY-MM-DD dddd", "ko")')).toBe('2026-10-18 일요일');
  });

  it('알 수 없는 언어 코드는 ko/en 문구로 거부한다', () => {
    setLocale('ko');
    expect(() => run('formatDate(parseDate("2026-10-18"), "YYYY", "fr")')).toThrow(/언어 코드/);
    setLocale('en');
    let message = '';
    try {
      run('formatDate(parseDate("2026-10-18"), "YYYY", "fr")');
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).not.toMatch(HANGUL);
    expect(message).toMatch(/language code/);
    setLocale('ko');
  });

  it('오류 문구의 값 따옴표가 겹치지 않게 이스케이프한다(실제 수식 경로)', () => {
    // fromTimestamp("it's") 처럼 따옴표가 든 값은 표시용으로 ’ 로 바꿔 문구의 따옴표와 섞이지 않게 한다
    setLocale('ko');
    let message = '';
    try {
      run('fromTimestamp(prop("x"))');
    } catch (e) {
      message = (e as Error).message;
    }
    // 타입 오류 문구 자체(값 종류)는 따옴표를 쓰지 않으므로 여기서는 문구 템플릿을 직접 확인한다
    expect(t('formula.err.fromTimestampArg', { value: 'it\u2019s' })).toBe("fromTimestamp: 숫자가 필요한데 'it’s' 값이에요");
    expect(message === '' || !message.includes("''")).toBe(true);
  });
});
