import { readFileSync } from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import {
  DB_FILE,
  normalizeValue,
  parseDbSchema,
  queryRows,
  view as viewSchema,
  type DbParseIssue,
  type DbRow,
  type DbSchema,
  type QueryResult,
  type RowGroup,
  type View,
} from '@nopsidian/core/db';

/** `_db.yaml` 이 있는 폴더들(루트면 ''). `assets` 테이블에 파일로 들어 있다. */
export function dbFolders(db: Database.Database): string[] {
  const rows = db.prepare(`SELECT path FROM assets WHERE path = ? OR path LIKE ? ESCAPE '\\'`).all(DB_FILE, `%/${DB_FILE}`) as { path: string }[];
  return rows.map((r) => (r.path === DB_FILE ? '' : r.path.slice(0, -(DB_FILE.length + 1)))).sort();
}

const yamlPath = (root: string, folder: string) => path.join(root, folder, DB_FILE);

function readSchema(root: string, folder: string): { schema: DbSchema; issues: DbParseIssue[] } | null {
  try {
    return parseDbSchema(readFileSync(yamlPath(root, folder), 'utf8'), path.posix.basename(folder) || '데이터베이스');
  } catch {
    return null;
  }
}

interface RawRow {
  path: string;
  title: string;
  folder: string;
  mtime: number;
  frontmatter: string | null;
}

/** 폴더의 노트(행). `recursive` 면 하위 폴더 포함. 다른 데이터베이스 폴더 안의 노트는 제외한다. */
function rawRows(db: Database.Database, folder: string, recursive: boolean, otherDbs: string[]): RawRow[] {
  const like = `${folder.replace(/[\\%_]/g, (c) => `\\${c}`)}/%`;
  const rows = (
    recursive
      ? folder === ''
        ? db.prepare(`SELECT path,title,folder,mtime,frontmatter FROM pages`).all()
        : db.prepare(`SELECT path,title,folder,mtime,frontmatter FROM pages WHERE folder = ? OR folder LIKE ? ESCAPE '\\'`).all(folder, like)
      : db.prepare(`SELECT path,title,folder,mtime,frontmatter FROM pages WHERE folder = ?`).all(folder)
  ) as RawRow[];
  const nested = otherDbs.filter((f) => f !== folder && (folder === '' || f.startsWith(`${folder}/`)));
  return nested.length ? rows.filter((r) => !nested.some((n) => r.folder === n || r.folder.startsWith(`${n}/`))) : rows;
}

function toDbRow(schema: DbSchema, r: RawRow): DbRow {
  let fm: Record<string, unknown> = {};
  try {
    fm = JSON.parse(r.frontmatter ?? '{}') as Record<string, unknown>;
  } catch {
    fm = {};
  }
  const created = typeof fm.created === 'string' ? fm.created : undefined;
  const updated = new Date(r.mtime).toISOString();
  const values: DbRow['values'] = {};
  for (const [name, prop] of Object.entries(schema.properties)) values[name] = normalizeValue(prop, fm[name], { created, updated });
  return { path: r.path, title: r.title, values, created, updated };
}

export interface DatabaseInfo {
  folder: string;
  title: string;
  rowCount: number;
  issues: number;
}

export function listDatabases(db: Database.Database, root: string): DatabaseInfo[] {
  const folders = dbFolders(db);
  const out: DatabaseInfo[] = [];
  for (const folder of folders) {
    const parsed = readSchema(root, folder);
    if (!parsed) continue;
    const recursive = parsed.schema.rowsFolder === '**';
    out.push({
      folder,
      title: parsed.schema.title ?? (path.posix.basename(folder) || '데이터베이스'),
      rowCount: rawRows(db, folder, recursive, folders).length,
      issues: parsed.issues.length,
    });
  }
  return out;
}

export interface DbQueryParams {
  folder: string;
  /** 저장된 뷰 id(없으면 첫 뷰) */
  viewId?: string;
  /** 저장하지 않은 임시 뷰 설정(필터·정렬 UI 조작 중) — 있으면 viewId 대신 쓴다 */
  view?: unknown;
  offset?: number;
  limit?: number;
  /** 그룹마다 최대 몇 행을 돌려줄지(보드·갤러리). 나머지는 `hidden` 으로 센다 */
  groupLimit?: number;
}

export interface DbQueryOutput {
  folder: string;
  schema: DbSchema;
  issues: DbParseIssue[];
  view: View;
  total: number;
  matched: number;
  rows: DbRow[];
  groups: (Omit<RowGroup, 'rows' | 'sub'> & { rows: DbRow[]; hidden: number; count: number; sub?: DbQueryOutput['groups'] })[] | null;
  calc: QueryResult['calc'];
}

function trimGroups(groups: RowGroup[], limit: number): NonNullable<DbQueryOutput['groups']> {
  return groups.map((g) => ({
    key: g.key,
    label: g.label,
    count: g.rows.length,
    rows: g.rows.slice(0, limit),
    hidden: Math.max(0, g.rows.length - limit),
    sub: g.sub ? trimGroups(g.sub, limit) : undefined,
  }));
}

export function queryDatabase(db: Database.Database, root: string, p: DbQueryParams): DbQueryOutput {
  const parsed = readSchema(root, p.folder);
  if (!parsed) throw new Error(`데이터베이스를 찾을 수 없어요: ${p.folder || '(루트)'}`);
  const { schema, issues } = parsed;
  let view: View | undefined;
  if (p.view !== undefined) {
    const r = viewSchema.safeParse(p.view);
    if (!r.success) throw new Error('뷰 설정이 올바르지 않아요');
    view = r.data;
  } else {
    view = schema.views.find((v) => v.id === p.viewId) ?? schema.views[0];
  }
  if (!view) throw new Error('뷰가 없어요');
  const folders = dbFolders(db);
  const rows = rawRows(db, p.folder, schema.rowsFolder === '**', folders).map((r) => toDbRow(schema, r));
  const result = queryRows(schema, view, rows);
  const offset = Math.max(0, p.offset ?? 0);
  const limit = Math.min(5000, Math.max(1, p.limit ?? 500));
  return {
    folder: p.folder,
    schema,
    issues,
    view,
    total: result.total,
    matched: result.matched,
    rows: result.groups ? [] : result.rows.slice(offset, offset + limit),
    groups: result.groups ? trimGroups(result.groups, Math.max(1, p.groupLimit ?? 100)) : null,
    calc: result.calc,
  };
}

/** 데이터베이스 행(노트) 경로 전체 — 속성 이름 변경처럼 모든 행을 고칠 때 쓴다 */
export function databaseRowPaths(db: Database.Database, root: string, folder: string): string[] {
  const parsed = readSchema(root, folder);
  if (!parsed) return [];
  return rawRows(db, folder, parsed.schema.rowsFolder === '**', dbFolders(db)).map((r) => r.path).sort();
}
