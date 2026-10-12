import { describe, expect, it } from 'vitest';
import { csvToRows, guessColumns, parseCsv, rowsToCsvTable, toCsv } from './csv.js';
import type { ColumnGuess } from './csv.js';
import { property as propertySchema } from './schema.js';
import type { DbSchema, Property } from './schema.js';
import type { CellValue } from './values.js';

const dbSchema = (properties: Record<string, Property>): DbSchema => ({
  version: 1,
  rowsFolder: '.',
  properties,
  views: [],
  templates: [],
});

/** 첫 열이 제목이 되도록 2열 표를 만든다 — 둘째 열(시험 대상)의 추론 결과를 돌려준다. */
const guessSecond = (values: string[]): Property | null =>
  guessColumns([['제목', '값'], ...values.map((v) => ['행', v])])[1]!.prop;

describe('parseCsv', () => {
  it('쉼표 구분·줄바꿈(LF/CRLF/CR)·BOM·한글', () => {
    expect(parseCsv('a,b\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(parseCsv('a,b\r\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(parseCsv('a,b\rc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(parseCsv('\uFEFF이름,나이\r\n홍길동,30')).toEqual([
      ['이름', '나이'],
      ['홍길동', '30'],
    ]);
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('\n')).toEqual([]);
  });

  it('따옴표 안의 쉼표·줄바꿈·"" 이스케이프', () => {
    expect(parseCsv('"a,b",c')).toEqual([['a,b', 'c']]);
    expect(parseCsv('"a\nb",c')).toEqual([['a\nb', 'c']]);
    expect(parseCsv('"그는 ""안녕"" 이라 말했다",x')).toEqual([['그는 "안녕" 이라 말했다', 'x']]);
    expect(parseCsv('"",x')).toEqual([['', 'x']]);
    expect(parseCsv('"a"b')).toEqual([['ab']]); // 칸 맨 앞 따옴표만 묶음의 시작
    expect(parseCsv('그는 "안녕" 이라')).toEqual([['그는 "안녕" 이라']]);
  });

  it('닫히지 않은 따옴표는 끝까지를 한 칸으로', () => {
    expect(parseCsv('a,"b\nc')).toEqual([['a', 'b\nc']]);
  });

  it('끝의 빈 줄은 무시하고 줄 중간의 빈 줄은 남긴다', () => {
    expect(parseCsv('a,b\n\n\n')).toEqual([['a', 'b']]);
    expect(parseCsv('a\n\nb')).toEqual([['a'], [''], ['b']]);
    expect(parseCsv('a,,')).toEqual([['a', '', '']]);
  });

  it('구분자 지정과 자동 감지', () => {
    expect(parseCsv('a;b;c', { delimiter: ';' })).toEqual([['a', 'b', 'c']]);
    expect(parseCsv('a\tb\tc', { delimiter: '\t' })).toEqual([['a', 'b', 'c']]);
    expect(parseCsv('a,b;c;d')).toEqual([['a', 'b;c;d']]); // 기본은 쉼표
    expect(parseCsv('a;b;c', { delimiter: 'auto' })).toEqual([['a', 'b', 'c']]);
    expect(parseCsv('a\tb\tc', { delimiter: 'auto' })).toEqual([['a', 'b', 'c']]);
    expect(parseCsv('a,b', { delimiter: 'auto' })).toEqual([['a', 'b']]);
    expect(parseCsv('"a;b;c",d', { delimiter: 'auto' })).toEqual([['a;b;c', 'd']]); // 따옴표 안은 세지 않는다
  });
});

describe('toCsv', () => {
  it('필요한 칸만 따옴표로 감싸고 안의 `"` 는 두 번 쓴다', () => {
    expect(toCsv([['a', 'b']])).toBe('a,b\n');
    expect(toCsv([['a,b', 'c']])).toBe('"a,b",c\n');
    expect(toCsv([['a"b']])).toBe('"a""b"\n');
    expect(toCsv([['a\nb', 'c']])).toBe('"a\nb",c\n');
    expect(toCsv([['  공백  ', '']])).toBe('  공백  ,\n'); // 공백만으로는 감싸지 않는다
    expect(toCsv([])).toBe('');
    expect(toCsv([['a'], ['b']])).toBe('a\nb\n'); // 끝에 줄바꿈 하나
  });

  it('BOM 옵션', () => {
    expect(toCsv([['a']], { bom: true })).toBe('\uFEFFa\n');
  });

  it('왕복: parseCsv(toCsv(rows)) 가 같은 표를 준다', () => {
    const rows = [
      ['제목', '수량', '메모'],
      ['사과, 바나나', '1,234', '그는 "안녕" 이라 말했다'],
      ['줄\n바꿈', '', '  앞뒤 공백  '],
      ['', '0', '✓'],
    ];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});

describe('guessColumns — 타입 추론', () => {
  it('값이 모두 비면 text', () => {
    expect(guessSecond(['', ''])).toEqual({ type: 'text' });
  });

  it('0/1 뿐이면 number 가 아니라 checkbox', () => {
    expect(guessSecond(['1', '0', '1'])).toEqual({ type: 'checkbox' });
  });

  it('true/false/yes/no/y/n/✓/체크 계열은 checkbox', () => {
    for (const v of ['true', 'FALSE', 'yes', 'No', 'y', 'n', '✓', '체크', '미체크', 'on', 'off']) {
      expect(guessSecond([v, v])).toEqual({ type: 'checkbox' });
    }
    expect(guessSecond(['1', '2'])).toEqual({ type: 'number', format: 'number' }); // 1/0 만은 아니다
  });

  it('숫자(쉼표 천단위·% 허용)', () => {
    expect(guessSecond(['1', '2.5', '-3'])).toEqual({ type: 'number', format: 'number' });
    expect(guessSecond(['1,234', '12,345'])).toEqual({ type: 'number', format: 'number' });
    expect(guessSecond(['50%', '12.5%'])).toEqual({ type: 'number', format: 'percent' });
    expect(guessSecond(['50%', '3'])).toEqual({ type: 'number', format: 'number' }); // 모두 % 는 아니다
    expect(guessSecond(['1', 'abc'])).toEqual({ type: 'text' }); // 섞이면 text
  });

  it('날짜와 시각', () => {
    expect(guessSecond(['2026-10-12', '2026/10/13', '2026.10.14'])).toEqual({ type: 'date' });
    expect(guessSecond(['2026-10-12 09:30', '2026-10-13T10:00'])).toEqual({
      type: 'date',
      includeTime: true,
    });
    expect(guessSecond(['2026-10-12 → 2026-10-14', '2026-10-15 ~ 2026-10-16'])).toEqual({
      type: 'date',
    });
    expect(guessSecond(['2026-10-12', '내일'])).toEqual({ type: 'text' });
  });

  it('url·email', () => {
    expect(guessSecond(['https://example.com', 'http://a.b/c?d=1'])).toEqual({ type: 'url' });
    expect(guessSecond(['a@b.com', 'c.d@e.co.kr'])).toEqual({ type: 'email' });
    expect(guessSecond(['https://example.com', 'a@b.com'])).toEqual({ type: 'text' });
  });

  it('select: 5행부터, 고유 값이 절반 이하이고 20개 이하일 때', () => {
    expect(guessSecond(['읽음', '읽음', '안 읽음', '안 읽음', '읽음'])).toEqual({
      type: 'select',
      options: [{ name: '읽음' }, { name: '안 읽음' }],
    });
    expect(guessSecond(['읽음', '읽음', '안 읽음', '안 읽음'])).toEqual({ type: 'text' }); // 4행이라 select 아님
    expect(guessSecond(['a', 'b', 'c', 'd', 'e'])).toEqual({ type: 'text' }); // 고유 값이 절반 초과
    expect(guessSecond(Array.from({ length: 42 }, (_, i) => `값${i % 21}`))).toEqual({
      type: 'text',
    }); // 고유 21종
  });

  it('multi_select: 항목이 나뉜 행이 절반 이상이고 고유 항목이 20개 이하일 때', () => {
    expect(guessSecond(['a, b', 'a, c', 'b, c', 'a, b', 'c, d'])).toEqual({
      type: 'multi_select',
      options: [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }],
    });
    // 값 전체가 겹쳐도 항목이 나뉘어 있으면 목록 — select 보다 먼저 본다
    expect(guessSecond(['a, b', 'a, b', 'a, b', 'a, b', 'a, b'])).toEqual({
      type: 'multi_select',
      options: [{ name: 'a' }, { name: 'b' }],
    });
  });

  it('여러 규칙에 걸치면 text', () => {
    expect(guessSecond(['1', '2026-10-12', 'true'])).toEqual({ type: 'text' });
  });
});

describe('guessColumns — 제목 열과 속성 이름', () => {
  it('제목 열을 찾고, 없으면 첫 열이 제목', () => {
    expect(
      guessColumns([
        ['제목', '수량'],
        ['사과', '1'],
        ['바나나', '2'],
      ]),
    ).toEqual([
      { header: '제목', name: '제목', prop: null, isTitle: true },
      { header: '수량', name: '수량', prop: { type: 'number', format: 'number' }, isTitle: false },
    ]);
    expect(
      guessColumns([
        ['저자', '연도'],
        ['가', '2020'],
      ])[0],
    ).toMatchObject({
      header: '저자',
      isTitle: true,
      prop: null,
    });
    expect(
      guessColumns([
        ['Name', 'x'],
        ['a', 'b'],
      ])[0]!.isTitle,
    ).toBe(true); // 대소문자 무시
  });

  it('이름 정리: 앞뒤 공백·빈 이름·중복·title 예약어', () => {
    const cols = guessColumns([
      [' title ', ' 수량 ', '수량', '', '연도'],
      ['a', '1', '2', '3', '2020'],
    ]);
    expect(cols.map((c) => c.name)).toEqual(['title 2', '수량', '수량 2', '열4', '연도']);
    expect(cols[0]).toMatchObject({ header: ' title ', isTitle: true, prop: null });
  });

  it('빈 표', () => {
    expect(guessColumns([])).toEqual([]);
    expect(guessColumns([['']])).toEqual([{ header: '', name: '열1', prop: null, isTitle: true }]);
  });
});

describe('csvToRows', () => {
  it('추론한 열로 행을 만든다 — 값은 프런트매터 값', () => {
    const table = [
      ['제목', '수량', '태그', '완료', '날짜'],
      ['사과', '3', '빨강, 맛있다', 'yes', '2026-10-12'],
      ['바나나', '7', '노랑, 길다', 'no', ''],
    ];
    expect(csvToRows(table, guessColumns(table))).toEqual([
      {
        title: '사과',
        values: { 수량: 3, 태그: ['빨강', '맛있다'], 완료: true, 날짜: '2026-10-12' },
        issues: [],
      },
      { title: '바나나', values: { 수량: 7, 태그: ['노랑', '길다'], 완료: false }, issues: [] },
    ]);
  });

  it('슬래시·점 날짜와 기간도 프런트매터 날짜로 읽는다', () => {
    const table = [
      ['제목', '날짜', '기간'],
      ['a', '2026/10/12', '2026.10.13 09:30'],
      ['b', '2026.10.14', '2026/10/15 ~ 2026/10/16'],
    ];
    expect(csvToRows(table, guessColumns(table))).toEqual([
      { title: 'a', values: { 날짜: '2026-10-12', 기간: '2026-10-13T09:30' }, issues: [] },
      {
        title: 'b',
        values: { 날짜: '2026-10-14', 기간: { start: '2026-10-15', end: '2026-10-16' } },
        issues: [],
      },
    ]);
  });

  it('제목이 비면 `제목 없음 N`, 읽을 수 없는 값은 비우고 issues 에 남긴다', () => {
    const table = [
      ['제목', '수량'],
      ['', '1'],
      ['', 'abc'],
      ['사과', '3'],
    ];
    const columns: ColumnGuess[] = [
      { header: '제목', name: '제목', prop: null, isTitle: true },
      { header: '수량', name: '수량', prop: { type: 'number', format: 'number' }, isTitle: false },
    ];
    const imported = csvToRows(table, columns);
    expect(imported.map((r) => r.title)).toEqual(['제목 없음 1', '제목 없음 2', '사과']);
    expect(imported[0]!.values).toEqual({ 수량: 1 });
    expect(imported[1]!.values).toEqual({});
    expect(imported[1]!.issues).toEqual([`2행 수량: 읽을 수 없는 값 'abc'`]);
    expect(imported[2]!.values).toEqual({ 수량: 3 });
  });

  it('빈 칸은 값을 만들지 않는다(checkbox 도)', () => {
    const table = [
      ['제목', '완료'],
      ['a', ''],
      ['b', '체크'],
    ];
    const imported = csvToRows(table, guessColumns(table));
    expect(imported[0]!.values).toEqual({});
    expect(imported[1]!.values).toEqual({ 완료: true });
  });

  it('같은 제목은 그대로 둔다(파일 이름은 호출자가 정한다)', () => {
    const table = [
      ['제목', '수량'],
      ['사과', '1'],
      ['사과', '2'],
    ];
    expect(csvToRows(table, guessColumns(table)).map((r) => r.title)).toEqual(['사과', '사과']);
  });
});

const exportSchema = dbSchema({
  수량: { type: 'number', format: 'stars' },
  비율: { type: 'number', format: 'percent' },
  완료: { type: 'checkbox' },
  태그: { type: 'multi_select', options: [{ name: '빨강' }] },
  기간: { type: 'date' },
  링크: { type: 'url' },
});

const exportRows: { title: string; values: Record<string, CellValue> }[] = [
  {
    title: '사과',
    values: {
      수량: 3,
      비율: 50,
      완료: true,
      태그: ['빨강', '맛있다'],
      기간: { start: '2026-10-12', end: '2026-10-14' },
      링크: 'https://example.com/사과, 맛',
    },
  },
  {
    title: '바나나',
    values: {
      수량: null,
      비율: null,
      완료: false,
      태그: [],
      기간: { start: '2026-10-15' },
      링크: 'https://example.com/b',
    },
  },
];

describe('rowsToCsvTable', () => {
  it('재가져오기 가능한 형태로 내보낸다(서식 없이)', () => {
    expect(
      rowsToCsvTable(
        exportSchema,
        ['title', '수량', '비율', '완료', '태그', '기간', '링크'],
        exportRows,
      ),
    ).toEqual([
      ['title', '수량', '비율', '완료', '태그', '기간', '링크'],
      [
        '사과',
        '3',
        '50',
        'true',
        '빨강, 맛있다',
        '2026-10-12 → 2026-10-14',
        'https://example.com/사과, 맛',
      ],
      ['바나나', '', '', 'false', '', '2026-10-15', 'https://example.com/b'],
    ]);
  });

  it('CSV 왕복 — 같은 타입으로 돌아온다', () => {
    const columns = ['title', '수량', '완료', '태그', '기간', '링크'];
    const back = guessColumns(parseCsv(toCsv(rowsToCsvTable(exportSchema, columns, exportRows))));
    expect(back.map((c) => [c.header, c.isTitle, c.prop?.type ?? null])).toEqual([
      ['title', true, null],
      ['수량', false, 'number'],
      ['완료', false, 'checkbox'],
      ['태그', false, 'multi_select'],
      ['기간', false, 'date'],
      ['링크', false, 'url'],
    ]);
    for (const col of back) {
      expect(propertySchema.safeParse(col.prop ?? { type: 'text' }).success).toBe(true);
    }
  });
});
