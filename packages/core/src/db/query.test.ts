import { describe, expect, it } from 'vitest';
import type { DbSchema, FilterNode, FilterOp, View } from './schema.js';
import { calcColumn, compareCells, evalFilter, getCell, groupRows, queryRows, sortRows, type DbRow } from './query.js';
import type { CellValue } from './values.js';

/** 고정 `now`: 2026-10-12(로컬) */
const NOW = new Date(2026, 9, 12, 12, 0, 0);

const schema: DbSchema = {
  version: 1,
  rowsFolder: '.',
  properties: {
    텍스트: { type: 'text' },
    수치: { type: 'number', format: 'number' },
    체크: { type: 'checkbox' },
    날짜: { type: 'date' },
    상태: {
      type: 'status',
      options: [
        { name: '할 일', group: 'todo' },
        { name: '하는 중', group: 'doing' },
        { name: '완료', group: 'done' },
      ],
    },
    분류: { type: 'select', options: [{ name: '가' }, { name: '나' }, { name: '다' }] },
    태그: { type: 'multi_select', options: [{ name: '빨강' }, { name: '파랑' }] },
    관계: { type: 'relation', target: '*', twoWay: false },
    생성: { type: 'created_time' },
  },
  views: [],
  templates: [],
};

function row(path: string, title = path, values: Record<string, CellValue> = {}): DbRow {
  return { path, title, values };
}

const cond = (prop: string, op: FilterOp, value?: unknown): FilterNode => ({ prop, op, value });

/** [연산자, 필터 값, 기대 결과] 표를 한 번에 검사한다 */
function expectTable(prop: string, cases: Array<[FilterOp, unknown, boolean]>, r: DbRow): void {
  for (const [op, value, expected] of cases) {
    expect([op, value, evalFilter(schema, cond(prop, op, value), r, NOW)]).toEqual([op, value, expected]);
  }
}

const paths = (rows: DbRow[]): string[] => rows.map((r) => r.path);
const keys = (groups: { key: string | null }[]): Array<string | null> => groups.map((g) => g.key);

describe('getCell', () => {
  it('title 은 필드를, 나머지는 values 에서 읽는다', () => {
    const r = row('a.md', '제목', { 텍스트: 'hi' });
    expect(getCell(schema, r, 'title')).toBe('제목');
    expect(getCell(schema, r, '텍스트')).toBe('hi');
    expect(getCell(schema, r, '없는속성')).toBeNull();
  });
});

describe('evalFilter — 문자열 계열', () => {
  const r = row('a.md', '노트 A', { 텍스트: 'Hello World' });

  it('대소문자를 구분하지 않는다', () => {
    expectTable('텍스트', [
      ['=', 'hello world', true],
      ['=', 'hello', false],
      ['!=', 'hello', true],
      ['contains', 'WORLD', true],
      ['!contains', 'world', false],
      ['startsWith', 'hello', true],
      ['endsWith', 'WORLD', true],
      ['in', ['nope', 'HELLO WORLD'], true],
      ['in', ['nope'], false],
      ['>', 1, false], // 규칙에 없는 조합
    ], r);
  });

  it('title 도 같은 문자열 규칙을 쓴다', () => {
    expectTable('title', [
      ['contains', '노트', true],
      ['=', '노트 a', true],
      ['startsWith', '노', true],
    ], r);
  });

  it('빈 셀은 빈 문자열로 본다', () => {
    const empty = row('b.md', 'B', { 텍스트: null });
    expectTable('텍스트', [
      ['=', 'x', false],
      ['!=', 'x', true],
      ['contains', 'x', false],
      ['empty', undefined, true],
      ['!empty', undefined, false],
    ], empty);
  });
});

describe('evalFilter — 배열 계열', () => {
  it('multi_select: contains·!contains·=·in', () => {
    expectTable('태그', [
      ['contains', '빨강', true],
      ['contains', '초록', false],
      ['!contains', '초록', true],
      ['=', '파랑', true],
      ['in', ['검정', '빨강'], true],
      ['in', ['검정'], false],
      ['!=', '빨강', false], // 배열에서 `!=` 는 규칙에 없다
      ['empty', undefined, false],
    ], row('a.md', 'A', { 태그: ['빨강', '파랑'] }));

    expectTable('태그', [
      ['contains', '빨강', false],
      ['!contains', '빨강', true],
      ['empty', undefined, true],
    ], row('b.md', 'B', { 태그: [] }));
  });

  it('relation: `[[노트|별칭]]`·`#` 에서 노트 이름만 비교한다', () => {
    const r = row('a.md', 'A', { 관계: ['[[노트 B]]', '[[노트 C|별칭]]', '[[노트 D#제목]]'] });
    expectTable('관계', [
      ['contains', '노트 B', true],
      ['contains', '노트 C', true],
      ['contains', '노트 D', true],
      ['contains', '별칭', false],
      ['contains', '제목', false],
      ['in', ['노트 D', '노트 Z'], true],
    ], r);
  });
});

describe('evalFilter — number', () => {
  it('숫자 비교(문자열 값도 숫자로 읽는다)', () => {
    expectTable('수치', [
      ['=', 5, true],
      ['=', 4, false],
      ['=', '5', true],
      ['!=', 4, true],
      ['>', 4, true],
      ['>', 5, false],
      ['>=', 5, true],
      ['<', 5, false],
      ['<=', 5, true],
      ['>', '4', true],
    ], row('a.md', 'A', { 수치: 5 }));
  });

  it('빈 값은 `!=` 만 true', () => {
    expectTable('수치', [
      ['=', 5, false],
      ['!=', 5, true],
      ['>', 0, false],
      ['>=', 0, false],
      ['<', 0, false],
      ['empty', undefined, true],
      ['!empty', undefined, false],
    ], row('b.md', 'B', { 수치: null }));
  });
});

describe('evalFilter — checkbox', () => {
  it('true/false 와 문자열 표기', () => {
    expectTable('체크', [
      ['=', true, true],
      ['=', 'true', true],
      ['=', false, false],
      ['!=', false, true],
      ['>', 0, false],
      ['empty', undefined, false],
      ['!empty', undefined, true],
    ], row('t.md', 'T', { 체크: true }));

    expectTable('체크', [
      ['=', false, true],
      ['=', 'false', true],
      ['!=', false, false],
      ['empty', undefined, true], // checkbox 는 false 도 빈 것으로 본다
      ['!empty', undefined, false],
    ], row('f.md', 'F', { 체크: false }));
  });
});

describe('evalFilter — date', () => {
  it('상대 표기와 절대 날짜', () => {
    expectTable('날짜', [
      ['=', 'today', true],
      ['=', 'now', true],
      ['=', '2026-10-12', true],
      ['=', '+0d', true],
      ['=', 'yesterday', false],
      ['!=', 'yesterday', true],
      ['<', 'tomorrow', true],
      ['>', 'yesterday', true],
      ['>=', 'today', true],
      ['<=', 'today', true],
    ], row('t.md', 'T', { 날짜: { start: '2026-10-12' } }));

    expectTable('날짜', [
      ['=', '+3d', true],
      ['=', '-3d', false],
    ], row('x.md', 'X', { 날짜: { start: '2026-10-15' } }));
  });

  it('기간은 `=` 이 구간 포함, `<`/`<=` 는 start, `>`/`>=` 는 end 기준', () => {
    const r = row('r.md', 'R', { 날짜: { start: '2026-10-10', end: '2026-10-14' } });
    expectTable('날짜', [
      ['=', 'today', true],
      ['=', '2026-10-14', true],
      ['=', '2026-10-09', false],
      ['!=', '2026-10-09', true],
      ['<', '2026-10-10', false],
      ['<=', '2026-10-10', true],
      ['>', '2026-10-14', false],
      ['>=', '2026-10-14', true],
      ['>', '2026-10-13', true],
      ['>=', '2026-10-15', false],
    ], r);
  });

  it('빈 날짜는 empty 만 true', () => {
    expectTable('날짜', [
      ['empty', undefined, true],
      ['!empty', undefined, false],
      ['=', 'today', false],
      ['!=', 'today', false],
      ['>', '2020-01-01', false],
    ], row('n.md', 'N', { 날짜: null }));
  });

  it('created_time 은 ISO 문자열 앞 10자로 비교한다', () => {
    expectTable('생성', [
      ['=', 'today', true],
      ['>=', 'today', true],
      ['<', 'tomorrow', true],
      ['<', 'today', false],
    ], row('c.md', 'C', { 생성: '2026-10-12T09:30:00.000Z' }));
  });
});

describe('evalFilter — and/or·모르는 속성', () => {
  const r = row('a.md', 'A', { 수치: 5, 텍스트: 'abc' });

  it('필터가 없거나 비어 있으면 거르지 않는다', () => {
    expect(evalFilter(schema, undefined, r)).toBe(true);
    expect(evalFilter(schema, { and: [] }, r)).toBe(true);
    expect(evalFilter(schema, { or: [] }, r)).toBe(true);
  });

  it('and·or 를 중첩해서 판단한다', () => {
    const node: FilterNode = {
      and: [
        { or: [cond('수치', '>', 10), cond('텍스트', '=', 'ABC')] },
        { and: [cond('수치', '>=', 5), cond('텍스트', '!contains', 'z')] },
      ],
    };
    expect(evalFilter(schema, node, r, NOW)).toBe(true);
    expect(evalFilter(schema, { and: [node, cond('수치', '>', 100)] }, r, NOW)).toBe(false);
    expect(evalFilter(schema, { or: [cond('수치', '>', 100), cond('텍스트', '=', 'zzz')] }, r, NOW)).toBe(false);
  });

  it('모르는 속성은 거르지 않는다', () => {
    expect(evalFilter(schema, cond('없는속성', '=', 1), r, NOW)).toBe(true);
    expect(evalFilter(schema, { or: [cond('없는속성', '=', 1), cond('수치', '>', 100)] }, r, NOW)).toBe(true);
  });
});

describe('sortRows · compareCells', () => {
  const nums = [row('1.md', '1', { 수치: 3 }), row('2.md', '2', { 수치: 1 }), row('3.md', '3', { 수치: null }), row('4.md', '4', { 수치: 2 })];

  it('숫자 asc/desc, 빈 값은 방향과 무관하게 맨 뒤', () => {
    expect(paths(sortRows(schema, nums, [{ prop: '수치', dir: 'asc' }]))).toEqual(['2.md', '4.md', '1.md', '3.md']);
    expect(paths(sortRows(schema, nums, [{ prop: '수치', dir: 'desc' }]))).toEqual(['1.md', '4.md', '2.md', '3.md']);
  });

  it('규칙이 없으면 입력 순서 그대로', () => {
    expect(paths(sortRows(schema, nums, []))).toEqual(['1.md', '2.md', '3.md', '4.md']);
  });

  it('입력 배열을 바꾸지 않는다', () => {
    const before = paths(nums);
    sortRows(schema, nums, [{ prop: '수치', dir: 'asc' }]);
    expect(paths(nums)).toEqual(before);
  });

  it('select 는 옵션 정의 순서, 모르는 값·빈 값은 뒤', () => {
    const rs = [row('a', 'a', { 분류: '다' }), row('b', 'b', { 분류: '가' }), row('c', 'c', { 분류: '몰라' }), row('d', 'd', { 분류: null })];
    expect(paths(sortRows(schema, rs, [{ prop: '분류', dir: 'asc' }]))).toEqual(['b', 'a', 'c', 'd']);
  });

  it('status 는 group(todo<doing<done) 순서가 정의 순서보다 우선한다', () => {
    const s: DbSchema = {
      ...schema,
      properties: {
        ...schema.properties,
        상태: {
          type: 'status',
          options: [
            { name: '완료', group: 'done' },
            { name: '할 일', group: 'todo' },
            { name: '하는 중', group: 'doing' },
          ],
        },
      },
    };
    const rs = [row('a', 'a', { 상태: '완료' }), row('b', 'b', { 상태: '할 일' }), row('c', 'c', { 상태: '하는 중' })];
    expect(paths(sortRows(s, rs, [{ prop: '상태', dir: 'asc' }]))).toEqual(['b', 'c', 'a']);
  });

  it('한글은 가나다, 숫자는 자연 정렬', () => {
    const hangul = [row('a', 'a', { 텍스트: '나' }), row('b', 'b', { 텍스트: '가' }), row('c', 'c', { 텍스트: '하' })];
    expect(paths(sortRows(schema, hangul, [{ prop: '텍스트', dir: 'asc' }]))).toEqual(['b', 'a', 'c']);

    const numeric = [row('a', 'a', { 텍스트: '10장' }), row('b', 'b', { 텍스트: '9장' }), row('c', 'c', { 텍스트: '2장' })];
    expect(paths(sortRows(schema, numeric, [{ prop: '텍스트', dir: 'asc' }]))).toEqual(['c', 'b', 'a']);
  });

  it('앞 규칙이 같으면 다음 규칙을, 모두 같으면 입력 순서(안정)', () => {
    const rs = [row('a', 'a', { 분류: '가', 수치: 2 }), row('b', 'b', { 분류: '가', 수치: 1 }), row('c', 'c', { 분류: '나', 수치: 5 })];
    expect(paths(sortRows(schema, rs, [{ prop: '분류', dir: 'asc' }, { prop: '수치', dir: 'desc' }]))).toEqual(['a', 'b', 'c']);

    const same = [row('a', 'a', { 수치: 1 }), row('b', 'b', { 수치: 1 }), row('c', 'c', { 수치: 1 })];
    expect(paths(sortRows(schema, same, [{ prop: '수치', dir: 'asc' }]))).toEqual(['a', 'b', 'c']);
  });

  it('checkbox 는 false<true, date 는 시작일 순', () => {
    const cb = [row('a', 'a', { 체크: true }), row('b', 'b', { 체크: false })];
    expect(paths(sortRows(schema, cb, [{ prop: '체크', dir: 'asc' }]))).toEqual(['b', 'a']);
    expect(paths(sortRows(schema, cb, [{ prop: '체크', dir: 'desc' }]))).toEqual(['a', 'b']);

    const dates = [row('a', 'a', { 날짜: { start: '2026-10-12' } }), row('b', 'b', { 날짜: { start: '2026-10-01' } }), row('c', 'c', { 날짜: null })];
    expect(paths(sortRows(schema, dates, [{ prop: '날짜', dir: 'asc' }]))).toEqual(['b', 'a', 'c']);
  });

  it('compareCells 는 빈 값을 항상 뒤로 보낸다', () => {
    expect(compareCells(undefined, null, 'a')).toBeGreaterThan(0);
    expect(compareCells(undefined, 'a', null)).toBeLessThan(0);
    expect(compareCells(undefined, null, null)).toBe(0);
    expect(compareCells(schema.properties['분류'], '다', '가')).toBeGreaterThan(0);
    expect(compareCells(schema.properties['수치'], 1, 2)).toBeLessThan(0);
  });
});

describe('groupRows', () => {
  it('select: 정의된 옵션은 빈 그룹으로도 포함, 모르는 값 뒤, 빈 값 맨 뒤', () => {
    const rs = [row('a', 'a', { 분류: '다' }), row('b', 'b', { 분류: '가' }), row('c', 'c', { 분류: '몰라' }), row('d', 'd', { 분류: null })];
    const groups = groupRows(schema, rs, '분류');
    expect(keys(groups)).toEqual(['가', '나', '다', '몰라', null]);
    expect(groups.find((g) => g.key === '나')!.rows).toEqual([]);
    expect(groups.at(-1)!.label).toBe('(없음)');
    expect(paths(groups.at(-1)!.rows)).toEqual(['d']);
    expect(paths(groups[0]!.rows)).toEqual(['b']);
  });

  it('status: 행이 하나도 없어도 정의된 옵션 그룹을 만든다(보드 뷰)', () => {
    const groups = groupRows(schema, [], '상태');
    expect(keys(groups)).toEqual(['할 일', '하는 중', '완료']);
    expect(groups.every((g) => g.rows.length === 0)).toBe(true);
  });

  it('multi_select: 항목마다 그룹, 행은 여러 그룹에 중복 포함', () => {
    const rs = [row('a', 'a', { 태그: ['빨강', '파랑'] }), row('b', 'b', { 태그: ['빨강'] })];
    const groups = groupRows(schema, rs, '태그');
    expect(keys(groups)).toEqual(['빨강', '파랑']);
    expect(paths(groups[0]!.rows)).toEqual(['a', 'b']);
    expect(paths(groups[1]!.rows)).toEqual(['a']);
  });

  it('checkbox 는 두 그룹을 만든다', () => {
    const rs = [row('a', 'a', { 체크: true }), row('b', 'b', { 체크: false })];
    const groups = groupRows(schema, rs, '체크');
    expect(groups).toEqual([
      { key: 'false', label: '체크 안 됨', rows: [rs[1]] },
      { key: 'true', label: '체크됨', rows: [rs[0]] },
    ]);
  });

  it('date 그룹 키는 시작일 YYYY-MM-DD, text 그룹은 값 순서에 행 순서 유지', () => {
    const dates = [row('a', 'a', { 날짜: { start: '2026-10-12T09:00' } }), row('b', 'b', { 날짜: { start: '2026-10-11', end: '2026-10-13' } })];
    expect(keys(groupRows(schema, dates, '날짜'))).toEqual(['2026-10-11', '2026-10-12']);

    const texts = [row('a', 'a', { 텍스트: '나' }), row('b', 'b', { 텍스트: '가' }), row('c', 'c', { 텍스트: '가' })];
    const groups = groupRows(schema, texts, '텍스트');
    expect(keys(groups)).toEqual(['가', '나']);
    expect(paths(groups[0]!.rows)).toEqual(['b', 'c']);
  });

  it('subGroupBy 는 한 단계 더 그룹을 만든다', () => {
    const rs = [row('a', 'a', { 분류: '가', 체크: true }), row('b', 'b', { 분류: '가', 체크: false }), row('c', 'c', { 분류: '나', 체크: true })];
    const groups = groupRows(schema, rs, '분류', '체크');
    expect(keys(groups)).toEqual(['가', '나', '다']);
    const 가 = groups[0]!;
    expect(keys(가.sub!)).toEqual(['false', 'true']);
    expect(paths(가.sub![0]!.rows)).toEqual(['b']);
    expect(paths(가.sub![1]!.rows)).toEqual(['a']);
    expect(paths(groups[1]!.sub![1]!.rows)).toEqual(['c']);
    expect(groups[2]!.sub!.every((s) => s.rows.length === 0)).toBe(true);
    expect(가.sub![0]!.sub).toBeUndefined();
  });

  it('모르는 속성이면 모든 행을 한 그룹으로', () => {
    const rs = [row('a', 'a'), row('b', 'b')];
    expect(groupRows(schema, rs, '없는속성')).toEqual([{ key: null, label: '(없음)', rows: rs }]);
  });
});

describe('calcColumn', () => {
  const rows = [
    row('a', 'a', { 수치: 10, 체크: true, 태그: ['빨강', '파랑'], 텍스트: 'x', 날짜: { start: '2026-10-12' } }),
    row('b', 'b', { 수치: 20, 체크: false, 태그: ['빨강'], 텍스트: null, 날짜: null }),
    row('c', 'c', { 수치: null, 체크: true, 태그: null, 텍스트: 'x' }),
  ];

  it('count 계열', () => {
    expect(calcColumn(schema, rows, '수치', 'count')).toBe(3);
    expect(calcColumn(schema, rows, '수치', 'count_values')).toBe(2);
    expect(calcColumn(schema, rows, '수치', 'count_empty')).toBe(1);
    expect(calcColumn(schema, rows, '텍스트', 'count_values')).toBe(2);
    expect(calcColumn(schema, rows, '태그', 'count_unique')).toBe(2); // 배열은 항목 단위
    expect(calcColumn(schema, rows, '텍스트', 'count_unique')).toBe(1); // 서로 다른 'x' 하나 + 빈 값 제외
    expect(calcColumn(schema, rows, '날짜', 'count_values')).toBe(1);
    expect(calcColumn(schema, rows, '없는속성', 'count')).toBe(3);
    expect(calcColumn(schema, rows, '없는속성', 'count_values')).toBe(0);
  });

  it('sum·avg·min·max 는 number 만', () => {
    expect(calcColumn(schema, rows, '수치', 'sum')).toBe(30);
    expect(calcColumn(schema, rows, '수치', 'avg')).toBe(15);
    expect(calcColumn(schema, rows, '수치', 'min')).toBe(10);
    expect(calcColumn(schema, rows, '수치', 'max')).toBe(20);
    expect(calcColumn(schema, rows, '텍스트', 'sum')).toBeNull(); // 타입에 안 맞는 fn
    expect(calcColumn(schema, [rows[2]!], '수치', 'sum')).toBeNull(); // 숫자가 하나도 없으면 null
  });

  it('checked·unchecked 는 checkbox 만', () => {
    expect(calcColumn(schema, rows, '체크', 'checked')).toBe(2);
    expect(calcColumn(schema, rows, '체크', 'unchecked')).toBe(1);
    expect(calcColumn(schema, rows, '수치', 'checked')).toBeNull();
  });
});

describe('queryRows', () => {
  const rows = [
    row('a', '노트 A', { 수치: 5, 분류: '가', 태그: ['빨강'] }),
    row('b', '노트 B', { 수치: 1, 분류: '나', 태그: null }),
    row('c', '노트 C', { 수치: 9, 분류: '가', 태그: ['파랑'] }),
  ];

  it('필터 → 정렬 → 그룹 → calc', () => {
    const view: View = {
      id: 'v1',
      name: '전체',
      type: 'table',
      sort: [{ prop: '수치', dir: 'desc' }],
      filter: { and: [cond('수치', '>=', 2)] },
      groupBy: '분류',
      calc: { 수치: 'sum' },
    };
    const result = queryRows(schema, view, rows, { now: NOW });
    expect(result.total).toBe(3);
    expect(result.matched).toBe(2);
    expect(paths(result.rows)).toEqual(['c', 'a']);
    expect(keys(result.groups!)).toEqual(['가', '나', '다']);
    expect(paths(result.groups![0]!.rows)).toEqual(['c', 'a']);
    expect(result.calc).toEqual({ 수치: 14 }); // 필터된 행 기준(5+9)
  });

  it('groupBy·calc 가 없으면 null·빈 객체, 정렬 규칙이 없으면 입력 순서', () => {
    const view: View = { id: 'v1', name: '표', type: 'table', sort: [] };
    const result = queryRows(schema, view, rows);
    expect(result.groups).toBeNull();
    expect(result.calc).toEqual({});
    expect(paths(result.rows)).toEqual(['a', 'b', 'c']);
    expect(result.matched).toBe(3);
  });

  it('상대 날짜 필터는 now 기준', () => {
    const rs = [row('a', 'a', { 날짜: { start: '2026-10-12' } }), row('b', 'b', { 날짜: { start: '2026-10-11' } })];
    const view: View = { id: 'v1', name: '오늘', type: 'table', sort: [], filter: cond('날짜', '=', 'today') };
    expect(paths(queryRows(schema, view, rs, { now: NOW }).rows)).toEqual(['a']);
  });
});

describe('성능', () => {
  it('2만 행 필터+정렬+그룹이 300ms 안에 끝난다', () => {
    const rows: DbRow[] = Array.from({ length: 20000 }, (_, i) =>
      row(`노트/${i}.md`, `노트 ${i}`, {
        수치: i % 5000,
        분류: ['가', '나', '다'][i % 3] ?? null,
        텍스트: `제목 ${i}`,
        체크: i % 2 === 0,
        태그: i % 2 === 0 ? ['빨강', '파랑'] : ['빨강'],
      }),
    );
    const view: View = {
      id: 'v1',
      name: '전체',
      type: 'table',
      sort: [{ prop: '수치', dir: 'desc' }],
      filter: { and: [cond('수치', '>=', 1000), cond('태그', 'contains', '빨강')] },
      groupBy: '분류',
      calc: { 수치: 'sum' },
    };
    const started = performance.now();
    const result = queryRows(schema, view, rows, { now: NOW });
    const elapsed = performance.now() - started;
    expect(result.matched).toBe(16000);
    expect(keys(result.groups!)).toEqual(['가', '나', '다']);
    expect(elapsed).toBeLessThan(300);
  });
});

describe('롤업·수식 값의 필터·정렬(값의 모양으로 종류를 정한다)', () => {
  const schema: DbSchema = {
    version: 1,
    rowsFolder: '.',
    properties: { 합: { type: 'rollup', relation: 'r', property: 'p', fn: 'sum' }, 라벨: { type: 'formula', expr: '1' } },
    views: [],
    templates: [],
  };
  const row = (title: string, 합: number | null, 라벨: string | null): DbRow => ({ path: `${title}.md`, title, values: { 합, 라벨 } });
  const rows = [row('a', 10, 'x'), row('b', 2, 'y'), row('c', null, null)];
  it('숫자 롤업은 숫자로 비교하고 정렬한다(문자열 순서가 아니다)', () => {
    expect(rows.filter((r) => evalFilter(schema, { prop: '합', op: '>=', value: 5 }, r)).map((r) => r.title)).toEqual(['a']);
    expect(sortRows(schema, rows, [{ prop: '합', dir: 'asc' }]).map((r) => r.title)).toEqual(['b', 'a', 'c']);
  });
  it('문자열 수식은 문자열 연산을 쓴다', () => {
    expect(rows.filter((r) => evalFilter(schema, { prop: '라벨', op: 'contains', value: 'x' }, r)).map((r) => r.title)).toEqual(['a']);
    expect(rows.filter((r) => evalFilter(schema, { prop: '라벨', op: 'empty' }, r)).map((r) => r.title)).toEqual(['c']);
  });
});

describe('manualOrder', () => {
  it('정렬 규칙이 없으면 직접 정한 순서를 따르고, 없는 행은 뒤에 둔다', () => {
    const rows = ['a', 'b', 'c', 'd'].map((n) => ({ path: `${n}.md`, title: n, values: {} }));
    const schema = { version: 1, rowsFolder: '.', properties: {}, views: [], templates: [] } as never;
    const v = { id: 'v', name: 'v', type: 'board', sort: [], manualOrder: ['c.md', 'a.md'] } as never;
    expect(queryRows(schema, v, rows).rows.map((r) => r.title)).toEqual(['c', 'a', 'b', 'd']);
  });
});
