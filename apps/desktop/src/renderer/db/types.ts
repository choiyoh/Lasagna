import type { DbParseIssue, DbSchema, Property, View, CellValue } from '@nopsidian/core/db';
import type { DbGroupDto, DbRowDto } from '@nopsidian/ipc-contract';

/** `db.query` 결과 — IPC 는 schema·view 를 unknown 으로 건네므로 여기서 core 타입으로 좁힌다 */
export interface DbData {
  folder: string;
  schema: DbSchema;
  issues: DbParseIssue[];
  view: View;
  total: number;
  matched: number;
  rows: DbRowDto[];
  groups: DbGroupDto[] | null;
  calc: Record<string, CellValue>;
  /** 롤업·수식 오류: 행 경로 → 속성 → 메시지 */
  errors: Record<string, Record<string, string>>;
}

export type { DbGroupDto, DbRowDto, Property, View, DbSchema, CellValue };

export const TITLE = 'title';

/** 보일 열(뷰에 columns 가 있으면 그 순서, 없으면 title + 모든 속성) */
export function visibleColumns(data: DbData): string[] {
  const all = [TITLE, ...Object.keys(data.schema.properties)];
  const cols = data.view.columns?.filter((c) => all.includes(c));
  return cols && cols.length ? cols : all;
}

export function cellOf(row: DbRowDto, prop: string): CellValue {
  return prop === TITLE ? row.title : ((row.values[prop] ?? null) as CellValue);
}
