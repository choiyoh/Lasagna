import { describe, expect, it } from 'vitest';
import { isRollupFn, ROLLUP_FNS, rollupValues } from './rollup.js';
import type { CellValue } from './values.js';

/** [함수, 입력, 기대] 표를 한 번에 검사한다 */
function expectTable(cases: Array<[Parameters<typeof rollupValues>[0], CellValue[], CellValue]>): void {
  for (const [fn, values, expected] of cases) {
    expect([fn, rollupValues(fn, values)]).toEqual([fn, expected]);
  }
}

describe('isRollupFn', () => {
  it('목록에 있는 이름만 통과한다', () => {
    expect(isRollupFn('sum')).toBe(true);
    expect(isRollupFn('date_range')).toBe(true);
    expect(isRollupFn('nope')).toBe(false);
    expect(isRollupFn('')).toBe(false);
  });

  it('모든 집계 함수가 목록에 있다', () => {
    expect(ROLLUP_FNS.length).toBe(20);
    for (const fn of ROLLUP_FNS) expect(isRollupFn(fn)).toBe(true);
  });
});

describe('show_original', () => {
  it('배열은 펼치고 null 은 빼며 나머지는 문자열로 만든다', () => {
    expect(
      rollupValues('show_original', [['빨강', '파랑'], '텍스트', null, 3, true, { start: '2026-01-01', end: '2026-01-02' }]),
    ).toEqual(['빨강', '파랑', '텍스트', '3', 'true', '2026-01-01 → 2026-01-02']);
  });

  it('한 날짜는 시작일만', () => {
    expect(rollupValues('show_original', [{ start: '2026-01-01' }, '2026-02-03'])).toEqual(['2026-01-01', '2026-02-03']);
  });

  it('모두 비면 null', () => {
    expectTable([
      ['show_original', [], null],
      ['show_original', [null, null], null],
      ['show_original', [[]], null],
    ]);
  });
});

describe('count 계열', () => {
  const values: CellValue[] = ['a', null, ['x', 'y'], false, '', { start: '2026-01-01' }];

  it('count 는 대상 수(빈 값 포함)', () => {
    expectTable([
      ['count', values, 6],
      ['count', [], 0],
      ['count', [null, null], 2],
    ]);
  });

  it('count_values / count_empty 는 빈 셀만 가른다', () => {
    // '' 와 false 는 셀 값으로는 비어 있지 않다(정규화가 '' 를 null 로 바꾼다).
    expectTable([
      ['count_values', values, 5],
      ['count_empty', values, 1],
      ['count_values', [], 0],
      ['count_empty', [null, null], 2],
      ['count_empty', ['a'], 0],
    ]);
  });

  it('count_unique 는 배열을 펼치고 대소문자를 구분한다', () => {
    expectTable([
      ['count_unique', [['a', 'b'], 'a', 'A', null], 3],
      ['count_unique', [1, '1'], 1],
      ['count_unique', [{ start: '2026-01-01' }, { start: '2026-01-01', end: '2026-01-02' }], 2],
      ['count_unique', [null, [], null], 0],
    ]);
  });
});

describe('percent_empty / percent_not_empty', () => {
  it('대상 중 비율을 둘째 자리까지 반올림한다', () => {
    expectTable([
      ['percent_empty', [null, null, 'a'], 66.67],
      ['percent_not_empty', [null, null, 'a'], 33.33],
      ['percent_empty', [null, 'a', 'b', 'c', 'd', 'e'], 16.67],
      ['percent_empty', ['a', 'b'], 0],
      ['percent_not_empty', ['a', 'b'], 100],
    ]);
  });

  it('대상이 없으면 null', () => {
    expectTable([
      ['percent_empty', [], null],
      ['percent_not_empty', [], null],
    ]);
  });
});

describe('숫자 집계', () => {
  it('문자열 숫자는 변환하고 나머지는 제외한다', () => {
    expectTable([
      ['sum', [1, '2', '3.5'], 6.5],
      ['sum', [null, 'abc', true, []], 0],
      ['sum', [], 0],
      ['sum', ['1 000', '2'], 1002],
    ]);
  });

  it('avg 는 반올림하지 않는다', () => {
    expectTable([
      ['avg', [1, 2], 1.5],
      ['avg', [1, 2, '4'], 7 / 3],
      ['avg', [null, 'x'], null],
    ]);
  });

  it('median 은 짝수 개에서 가운데 둘의 평균', () => {
    expectTable([
      ['median', [3, 1, 2], 2],
      ['median', [1, 2, 3, 4], 2.5],
      ['median', ['10', 0], 5],
      ['median', [null], null],
    ]);
  });

  it('min / max / range', () => {
    expectTable([
      ['min', [5, 1, 9], 1],
      ['max', [5, 1, 9], 9],
      ['range', [5, 1, 9], 8],
      ['range', [4], 0],
      ['min', ['abc', true], null],
      ['max', [], null],
    ]);
  });

  it('날짜·배열·불리언은 숫자로 보지 않는다', () => {
    expectTable([
      ['sum', [{ start: '2026-01-01' }, ['1', '2'], true], 0],
      ['max', [{ start: '2026-01-01' }, ['1'], false], null],
    ]);
  });
});

describe('날짜 집계', () => {
  const values: CellValue[] = [
    { start: '2026-03-01' },
    '2025-12-31',
    null,
    { start: '2026-01-01', end: '2026-02-01' },
    '그냥 문자열',
  ];

  it('earliest / latest 는 시작일 기준', () => {
    expectTable([
      ['earliest', values, { start: '2025-12-31' }],
      ['latest', values, { start: '2026-03-01' }],
    ]);
  });

  it('date_range 는 가장 이른 시작 ~ 가장 늦은 끝', () => {
    expectTable([
      ['date_range', values, { start: '2025-12-31', end: '2026-03-01' }],
      ['date_range', [{ start: '2026-01-01', end: '2026-01-10' }], { start: '2026-01-01', end: '2026-01-10' }],
      // 시작과 끝이 같으면 end 를 붙이지 않는다
      ['date_range', ['2026-05-05', { start: '2026-05-05' }], { start: '2026-05-05' }],
    ]);
  });

  it('날짜가 없으면 null', () => {
    expectTable([
      ['earliest', [null, 'abc', ['2026-01-01']], null],
      ['latest', [], null],
      ['date_range', [true, 3], null],
    ]);
  });
});

describe('checked / unchecked', () => {
  const values: CellValue[] = [true, false, true, null, 'true'];

  it('true / false 개수만 센다', () => {
    expectTable([
      ['checked', values, 2],
      ['unchecked', values, 1],
      ['checked', [], 0],
      ['unchecked', [null, 'false'], 0],
    ]);
  });

  it('percent 는 대상 중 비율(둘째 자리 반올림)', () => {
    expectTable([
      ['percent_checked', values, 40],
      ['percent_unchecked', values, 20],
      ['percent_checked', [true, null, null], 33.33],
      ['percent_checked', [], null],
      ['percent_unchecked', [], null],
    ]);
  });
});
