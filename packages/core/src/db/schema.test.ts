import { describe, expect, it } from 'vitest';
import { parseDbSchema } from './schema.js';
import { cellText, normalizeValue, toFrontmatterValue } from './values.js';

describe('parseDbSchema', () => {
  it('설계 문서의 예제를 해석한다', () => {
    const { schema, issues } = parseDbSchema(`
version: 1
title: 독서 목록
properties:
  저자: { type: text }
  상태: { type: status, options: [{name: 읽을 예정, group: todo}, {name: 읽는 중, group: doing}, {name: 완료, group: done}] }
  평점: { type: number, format: stars }
  관련 노트: { type: relation, target: "*", twoWay: false }
  읽은 권수: { type: rollup, relation: 관련 노트, property: 상태, fn: count }
  점수: { type: formula, expr: 'prop("평점") * 20' }
views:
  - { id: v1, name: 전체, type: table, columns: [title, 저자, 상태, 평점], sort: [{prop: 평점, dir: desc}] }
  - { id: v2, name: 보드, type: board, groupBy: 상태, filter: { and: [{prop: 평점, op: ">=", value: 3}] } }
`);
    expect(issues).toEqual([]);
    expect(Object.keys(schema.properties)).toEqual(['저자', '상태', '평점', '관련 노트', '읽은 권수', '점수']);
    expect(schema.properties['평점']).toMatchObject({ type: 'number', format: 'stars' });
    expect(schema.views.map((v) => v.type)).toEqual(['table', 'board']);
    expect(schema.views[1]!.filter).toEqual({ and: [{ prop: '평점', op: '>=', value: 3 }] });
  });
  it('나쁜 속성·뷰만 버리고 이유를 알려 준다', () => {
    const { schema, issues } = parseDbSchema(`
properties:
  좋음: { type: text }
  나쁨: { type: nope }
  title: { type: text }
views:
  - { id: a, type: table }
  - { id: a, type: board }
  - { id: b, type: board, groupBy: 없는속성 }
`);
    expect(Object.keys(schema.properties)).toEqual(['좋음']);
    expect(schema.views.map((v) => v.id)).toEqual(['a', 'b']);
    expect(issues.map((i) => i.path)).toEqual(expect.arrayContaining(['properties.나쁨', 'properties.title', 'views[1].id', 'views.b.groupBy']));
  });
  it('YAML 이 깨졌거나 비었으면 기본 스키마', () => {
    expect(parseDbSchema('a: [', 'X').issues[0]!.message).toMatch(/YAML/);
    const empty = parseDbSchema('', 'X');
    expect(empty.issues).toEqual([]);
    expect(empty.schema.views).toHaveLength(1);
    expect(empty.schema.title).toBe('X');
  });
});

describe('값 정규화', () => {
  const num = { type: 'number', format: 'number' } as const;
  it('숫자·불리언·목록·날짜를 느슨하게 읽는다', () => {
    expect(normalizeValue(num, '1,234')).toBe(1234);
    expect(normalizeValue(num, '50%')).toBe(50);
    expect(normalizeValue(num, 'abc')).toBeNull();
    expect(normalizeValue({ type: 'checkbox' }, 'yes')).toBe(true);
    expect(normalizeValue({ type: 'checkbox' }, undefined)).toBe(false);
    expect(normalizeValue({ type: 'multi_select', options: [] }, 'a, b')).toEqual(['a', 'b']);
    expect(normalizeValue({ type: 'relation', target: '*', twoWay: false }, ['[[A]]', '[[B]]'])).toEqual(['[[A]]', '[[B]]']);
    expect(normalizeValue({ type: 'text' }, '  ')).toBeNull();
    expect(normalizeValue({ type: 'date' }, '2026-10-12')).toEqual({ start: '2026-10-12' });
    expect(normalizeValue({ type: 'date' }, '2026-10-12 → 2026-10-14')).toEqual({ start: '2026-10-12', end: '2026-10-14' });
    expect(normalizeValue({ type: 'date' }, { start: '2026-10-12', end: '2026-10-13' })).toEqual({ start: '2026-10-12', end: '2026-10-13' });
    expect(normalizeValue({ type: 'date' }, '내일')).toBeNull();
    expect(normalizeValue({ type: 'created_time' }, 'x', { created: '2026-01-01' })).toBe('2026-01-01');
  });
  it('프런트매터 값으로 되돌린다(빈 값은 키 삭제)', () => {
    expect(toFrontmatterValue(num, 3)).toBe(3);
    expect(toFrontmatterValue(num, null)).toBeUndefined();
    expect(toFrontmatterValue({ type: 'text' }, '안녕')).toBe('안녕');
    expect(toFrontmatterValue({ type: 'date' }, { start: '2026-10-12' })).toBe('2026-10-12');
    expect(toFrontmatterValue({ type: 'date' }, { start: '2026-10-12', end: '2026-10-13' })).toEqual({ start: '2026-10-12', end: '2026-10-13' });
    expect(toFrontmatterValue({ type: 'multi_select', options: [] }, [])).toBeUndefined();
    expect(toFrontmatterValue({ type: 'formula', expr: '1' }, 1)).toBeUndefined();
    expect(toFrontmatterValue({ type: 'checkbox' }, null)).toBe(false);
  });
  it('표시 문자열', () => {
    expect(cellText({ type: 'number', format: 'stars' }, 3)).toBe('★★★☆☆');
    expect(cellText({ type: 'number', format: 'percent' }, 50)).toBe('50%');
    expect(cellText({ type: 'date' }, { start: '2026-10-12', end: '2026-10-13' })).toBe('2026-10-12 → 2026-10-13');
    expect(cellText(undefined, ['a', 'b'])).toBe('a, b');
    expect(cellText(undefined, null)).toBe('');
  });
});
