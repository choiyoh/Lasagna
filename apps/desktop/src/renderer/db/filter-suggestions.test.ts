import { describe, expect, it } from 'vitest';
import type { DbRow, DbSchema } from '@nopsidian/core/db';
import { conditionLabel, suggestFilterRemovals } from './filter-suggestions';

const schema: DbSchema = {
  version: 1,
  title: '프로젝트',
  rowsFolder: '.',
  properties: {
    상태: { type: 'select', options: [{ name: '진행' }, { name: '완료' }] },
    점수: { type: 'number', format: 'number' },
  },
  views: [{ id: 'v', name: '표', type: 'table', sort: [] }],
  templates: [],
};

const rows: DbRow[] = [
  { path: 'a.md', title: 'A', values: { 상태: '완료', 점수: 5 } },
  { path: 'b.md', title: 'B', values: { 상태: '완료', 점수: 20 } },
  { path: 'c.md', title: 'C', values: { 상태: '진행', 점수: 30 } },
  { path: 'd.md', title: 'D', values: { 상태: '완료', 점수: 40 } },
];

describe('suggestFilterRemovals', () => {
  it('루트 AND 의 직속 조건별로 빼면 남는 행 수를 센다', () => {
    const out = suggestFilterRemovals(
      schema,
      {
        and: [
          { prop: '상태', op: '=', value: '진행' },
          { prop: '점수', op: '>=', value: 10 },
        ],
      },
      rows,
    );
    expect(out).toHaveLength(2);
    expect(out.map((s) => [s.label, s.count])).toEqual([
      ['상태 = 진행', 3],
      ['점수 ≥ 10', 1],
    ]);
  });

  it('OR 루트에서는 제안을 만들지 않는다', () => {
    expect(
      suggestFilterRemovals(
        schema,
        {
          or: [
            { prop: '상태', op: '=', value: '완료' },
            { prop: '점수', op: '>=', value: 10 },
          ],
        },
        rows,
      ),
    ).toEqual([]);
  });

  it('중첩 그룹 안의 조건은 제안하지 않고, count 0 은 빼며, 최대 3개만 남긴다', () => {
    const out = suggestFilterRemovals(
      schema,
      {
        and: [
          { prop: '상태', op: '=', value: '완료' },
          { prop: '점수', op: '>=', value: 100 },
          { and: [{ prop: '점수', op: '=', value: 5 }] },
          { prop: '점수', op: '<', value: 100 },
          { prop: '점수', op: '>', value: 0 },
        ],
      },
      rows,
    );
    expect(out.length).toBeLessThanOrEqual(3);
    expect(out.map((s) => s.label)).not.toContain('점수 = 5');
    expect(out.every((s) => s.count > 0)).toBe(true);
  });
});

describe('conditionLabel', () => {
  it('제목·연산자·값을 사람이 읽는 한 줄로 만든다', () => {
    expect(conditionLabel({ prop: 'title', op: 'contains', value: '디자인' })).toBe('제목 포함 디자인');
    expect(conditionLabel({ prop: '상태', op: 'empty' })).toBe('상태 비어 있음');
    expect(conditionLabel({ prop: '점수', op: '>=', value: 10 })).toBe('점수 ≥ 10');
  });
});
