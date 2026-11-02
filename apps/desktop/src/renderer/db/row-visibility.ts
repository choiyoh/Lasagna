import { evalFilter, type DbRow, type DbSchema, type FilterNode } from '@nopsidian/core/db';
import type { DbRowDto } from './types';

/** 새로 만든 행이 현재 뷰 필터에 걸려 보이지 않는가. 판정은 query 와 같은 evalFilter 를 쓴다. */
export function isHiddenByFilter(schema: DbSchema, filter: FilterNode | undefined, row: DbRowDto): boolean {
  return !!filter && !evalFilter(schema, filter, row as unknown as DbRow);
}
