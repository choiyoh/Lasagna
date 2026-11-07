import { setLocale } from '@nopsidian/i18n';
import { afterEach, describe, expect, it } from 'vitest';
import { compileFormula, evalFormula } from './compile.js';


const HANGUL = /[\u3131-\u318e\uac00-\ud7a3]/;
afterEach(() => setLocale('ko'));

/** 노트 속성 없이 상수만 쓰는 수식을 실행한다. */
const run = (source: string, props: Record<string, unknown> = {}): unknown => {
  const r = compileFormula(source);
  if (!r.ok) throw new Error(r.error.message);
  return evalFormula(r.compiled, { now: new Date(2026, 9, 18, 15, 30), prop: (name: string) => (name in props ? props[name] : null) } as never);
};
const ts = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();

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

  it("'en' 경계: 1·12월, 00·12시, 윤년 2/29, AM/PM", () => {
    expect(run(`formatDate(fromTimestamp(${ts(2026, 1, 5)}), "MMMM MMM", "en")`)).toBe('January Jan');
    expect(run(`formatDate(fromTimestamp(${ts(2026, 12, 31)}), "MMMM MMM", "en")`)).toBe('December Dec');
    expect(run(`formatDate(fromTimestamp(${ts(2026, 2, 1, 0, 5)}), "hh:mm A", "en")`)).toBe('12:05 AM');
    expect(run(`formatDate(fromTimestamp(${ts(2026, 2, 1, 12, 0)}), "hh:mm A", "en")`)).toBe('12:00 PM');
    expect(run(`formatDate(fromTimestamp(${ts(2026, 2, 1, 23, 59)}), "HH:mm A", "en")`)).toBe('23:59 PM');
    // 윤년 2/29 (2024-02-29 는 목요일)
    expect(run(`formatDate(fromTimestamp(${ts(2024, 2, 29)}), "YYYY-MM-DD dddd ddd", "en")`)).toBe('2024-02-29 Thursday Thu');
    expect(run(`formatDate(fromTimestamp(${ts(2024, 2, 29)}), "YYYY-MM-DD dddd", "ko")`)).toBe('2024-02-29 목요일');
  });

  it('인자를 생략한 기존 수식 결과가 base 와 같다(코퍼스 고정)', () => {
    // 이 표는 언어 인자를 넣기 전(base) 동작을 그대로 옮겨 적은 것이다 — 값이 달라지면 회귀다.
    const corpus: [string, string][] = [
      [`formatDate(fromTimestamp(${ts(2026, 10, 18, 15, 30)}), "YYYY-MM-DD")`, '2026-10-18'],
      [`formatDate(fromTimestamp(${ts(2026, 10, 18, 15, 30)}), "YYYY-MM-DD dddd A")`, '2026-10-18 일요일 오후'],
      [`formatDate(fromTimestamp(${ts(2026, 1, 1, 0, 5)}), "YYYY MMMM MMM ddd hh:mm A")`, '2026 1월 1월 목 12:05 오전'],
      [`formatDate(fromTimestamp(${ts(2024, 2, 29)}), "YYYY-MM-DD dddd")`, '2024-02-29 목요일'],
      [`formatDate(fromTimestamp(${ts(2026, 12, 31, 12, 0)}), "YY/M/D H:m:s A a")`, '26/12/31 12:0:0 오후 pm'],
      [`formatDate(fromTimestamp(${ts(2026, 3, 8)}), "[작성] YYYY")`, '작성 2026'],
    ];
    setLocale('ko');
    for (const [source, expected] of corpus) expect([source, run(source)]).toEqual([source, expected]);
    // 앱 언어가 en 이어도 인자를 생략하면 같은 값이다
    setLocale('en');
    for (const [source, expected] of corpus) expect([source, run(source)]).toEqual([source, expected]);
    setLocale('ko');
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

  it("따옴표가 든 값은 실제 오류 경로에서 ’ 로 바뀌어 문구의 따옴표와 섞이지 않는다", () => {
    setLocale('ko');
    let message = '';
    try {
      // 실제 값이 문자열인 입력(prop)으로 fromTimestamp 오류를 낸다
      run('fromTimestamp(prop("x"))', { x: "it's" });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toBe("fromTimestamp: 숫자가 필요한데 'it’s' 값이에요");
    expect(message).not.toContain("it's");
    setLocale('en');
    let en = '';
    try {
      run('fromTimestamp(prop("x"))', { x: "it's" });
    } catch (e) {
      en = (e as Error).message;
    }
    expect(en).toBe("fromTimestamp: expected a number but got it’s");
    setLocale('ko');
  });
});
