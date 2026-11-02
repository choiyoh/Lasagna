import { describe, expect, it } from 'vitest';
import type { DbSchema } from '@nopsidian/core/db';
import { isHiddenByFilter } from './row-visibility';
import type { DbRowDto } from './types';

const schema: DbSchema = {
  version: 1,
  rowsFolder: '.',
  properties: { 점수: { type: 'number', format: 'number' } },
  views: [],
  templates: [],
};
const row = (score: number | null): DbRowDto => ({ path: `db/${score}.md`, title: '행', values: { 점수: score } });
const filter = { and: [{ prop: '점수', op: '>=' as const, value: 999 }] };

describe('isHiddenByFilter', () => {
  it('필터가 없으면 숨기지 않는다', () => {
    expect(isHiddenByFilter(schema, undefined, row(1))).toBe(false);
  });

  it('새 행이 현재 필터에 걸리면 숨김으로 판정한다', () => {
    expect(isHiddenByFilter(schema, filter, row(1))).toBe(true);
    expect(isHiddenByFilter(schema, filter, row(null))).toBe(true);
  });

  it('필터를 통과하면 숨기지 않는다', () => {
    expect(isHiddenByFilter(schema, filter, row(999))).toBe(false);
  });
});
