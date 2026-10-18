import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { expandTemplate, resolveInVault } from '@nopsidian/core';
import {
  DB_FILE,
  FILTER_OPS,
  STORED_TYPES,
  TITLE_PROP,
  buildRowNote,
  normalizeValue,
  optionsOf,
  parseDbSchema,
  queryRows,
  setFrontmatter,
  toFrontmatterValue,
  type CellValue,
  type DbRow,
  type DbSchema,
  type FilterCondition,
  type Property,
  type SortRule,
} from '@nopsidian/core/db';
import type { ScannedNote, VaultScanner } from './vault-scan.js';
import { validateNotePath } from './policy.js';
import { WriteError } from './writer.js';

/** 에이전트에게 보여 줄 속성 설명 */
export interface PropertyInfo {
  name: string;
  type: string;
  /** select·status·multi_select 의 허용 값 */
  options?: string[];
  /** 에이전트가 값을 쓸 수 있는가(계산되는 속성은 false) */
  writable: boolean;
  note?: string;
}
export interface DatabaseInfo {
  /** 볼트 상대 폴더('' = 볼트 루트) */
  folder: string;
  title: string;
  rows: number;
  properties: PropertyInfo[];
  views: { id: string; name: string; type: string }[];
  /** 새 행에 기본으로 쓰는 템플릿 노트(없으면 생략)와 고를 수 있는 템플릿 */
  defaultTemplate?: string;
  templates: string[];
  /** `_db.yaml` 에서 읽다가 버린 항목 수 */
  issues: number;
}

const SKIP = new Set(['node_modules']);

/** `_db.yaml` 이 있는 폴더(볼트 상대, 정렬). 점 폴더·심볼릭 링크는 건너뛴다. */
export function findDatabaseFolders(root: string): string[] {
  const out: string[] = [];
  const visit = (abs: string, rel: string) => {
    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || SKIP.has(e.name)) continue;
      if (e.isFile() && e.name === DB_FILE) out.push(rel);
      else if (e.isDirectory()) visit(path.join(abs, e.name), rel ? `${rel}/${e.name.normalize('NFC')}` : e.name.normalize('NFC'));
    }
  };
  visit(root, '');
  return out.sort();
}

const propertyInfo = (name: string, def: Property): PropertyInfo => {
  const options = def.type === 'select' || def.type === 'multi_select' || def.type === 'status' ? optionsOf(def).map((o) => o.name) : undefined;
  const info: PropertyInfo = { name, type: def.type, writable: STORED_TYPES.has(def.type) && !(def.type === 'relation' && def.twoWay) };
  if (options) info.options = options;
  if (def.type === 'relation') info.note = def.twoWay ? 'two-way relation: edit it in the app (the reverse side must stay in sync)' : 'write note links like "[[Note title]]"';
  else if (def.type === 'unique_id') info.note = 'assigned automatically when a row is added';
  else if (!info.writable) info.note = 'computed — cannot be written';
  else if (def.type === 'date') info.note = 'YYYY-MM-DD, or {start, end} for a range';
  return info;
};

const nowIso = (d: Date) => {
  const off = -d.getTimezoneOffset();
  const p = (n: number) => String(Math.trunc(Math.abs(n))).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${off >= 0 ? '+' : '-'}${p(off / 60)}:${p(off % 60)}`;
};

const unsafeName = /[\\/:*?"<>|]/g;

/** 데이터베이스(폴더 + `_db.yaml`)를 MCP 에서 읽는다. 행은 스캐너가 읽어 둔 노트의 프런트매터에서 만든다. */
export class DatabaseAccess {
  constructor(
    private readonly root: string,
    private readonly scanner: VaultScanner,
  ) {}

  private schemaOf(folder: string): { schema: DbSchema; issues: number } | null {
    const file = path.join(this.root, folder, DB_FILE);
    if (!existsSync(file)) return null;
    try {
      const r = parseDbSchema(readFileSync(file, 'utf8'), path.posix.basename(folder) || 'database');
      return { schema: r.schema, issues: r.issues.length };
    } catch {
      return null;
    }
  }

  /** `folder` 안의 행 노트(중첩된 다른 데이터베이스 폴더 제외) */
  private rowNotes(folder: string, schema: DbSchema, dbFolders: string[]): ScannedNote[] {
    const recursive = schema.rowsFolder === '**';
    const nested = dbFolders.filter((f) => f !== folder && (folder === '' || f.startsWith(`${folder}/`)));
    return this.scanner.list().filter((n) => {
      const dir = path.posix.dirname(n.path) === '.' ? '' : path.posix.dirname(n.path);
      const inside = recursive ? folder === '' || dir === folder || dir.startsWith(`${folder}/`) : dir === folder;
      return inside && !nested.some((f) => dir === f || dir.startsWith(`${f}/`));
    });
  }

  private toRow(schema: DbSchema, n: ScannedNote): DbRow {
    const fm = n.properties;
    const created = typeof fm.created === 'string' ? fm.created : undefined;
    const updated = new Date(n.mtimeMs).toISOString();
    const values: DbRow['values'] = {};
    for (const [name, def] of Object.entries(schema.properties)) values[name] = normalizeValue(def, fm[name], { created, updated });
    return { path: n.path, title: n.title, values, created, updated };
  }

  list(): DatabaseInfo[] {
    const folders = findDatabaseFolders(this.root);
    const out: DatabaseInfo[] = [];
    for (const folder of folders) {
      const s = this.schemaOf(folder);
      if (!s) continue;
      out.push({
        folder,
        title: s.schema.title ?? (path.posix.basename(folder) || 'database'),
        rows: this.rowNotes(folder, s.schema, folders).length,
        properties: Object.entries(s.schema.properties).map(([n, d]) => propertyInfo(n, d)),
        views: s.schema.views.map((v) => ({ id: v.id, name: v.name, type: v.type })),
        ...(s.schema.defaultTemplate ? { defaultTemplate: s.schema.defaultTemplate } : {}),
        templates: s.schema.templates,
        issues: s.issues,
      });
    }
    return out;
  }

  /** 데이터베이스 폴더 이름(또는 제목)으로 찾는다 */
  resolveFolder(input: string): string {
    const p = input.normalize('NFC').replace(/\\/g, '/').replace(/^\.?\/+|\/+$/g, '');
    const folders = findDatabaseFolders(this.root);
    if (folders.includes(p)) return p;
    const byTitle = folders.filter((f) => (this.schemaOf(f)?.schema.title ?? '').normalize('NFC') === p);
    if (byTitle.length === 1) return byTitle[0]!;
    throw new WriteError('bad-input', `데이터베이스를 찾을 수 없어요: ${input}. 있는 것: ${folders.map((f) => f || '(볼트 루트)').join(', ') || '없음'} (list_databases 로 확인)`);
  }

  /** 가장 가까운 상위 데이터베이스 폴더(행 노트의 소속) */
  folderOfRow(notePath: string): string | null {
    const folders = findDatabaseFolders(this.root);
    const dir = path.posix.dirname(notePath) === '.' ? '' : path.posix.dirname(notePath);
    let best: string | null = null;
    for (const f of folders) {
      const s = this.schemaOf(f);
      const recursive = s?.schema.rowsFolder === '**';
      const ok = recursive ? f === '' || dir === f || dir.startsWith(`${f}/`) : dir === f;
      if (ok && (best === null || f.length > best.length)) best = f;
    }
    return best;
  }

  query(
    folder: string,
    opts: { view?: string; filter?: FilterCondition[]; sort?: SortRule[]; limit?: number; offset?: number },
  ): { folder: string; total: number; matched: number; rows: { path: string; title: string; values: Record<string, CellValue> }[] } {
    const dbFolders = findDatabaseFolders(this.root);
    const s = this.schemaOf(folder);
    if (!s) throw new WriteError('bad-input', `데이터베이스가 아니에요: ${folder}`);
    const { schema } = s;
    const base = opts.view ? schema.views.find((v) => v.id === opts.view || v.name === opts.view) : schema.views[0];
    if (opts.view && !base) throw new WriteError('bad-input', `없는 보기: ${opts.view}. 있는 보기: ${schema.views.map((v) => v.name).join(', ')}`);
    const filters = opts.filter ?? [];
    for (const f of filters) if (f.prop !== TITLE_PROP && !schema.properties[f.prop]) throw new WriteError('bad-input', `없는 속성: ${f.prop}. 있는 속성: ${Object.keys(schema.properties).join(', ')}`);
    const view = {
      id: '_mcp',
      name: 'mcp',
      type: 'table' as const,
      sort: opts.sort ?? base?.sort ?? [],
      ...(filters.length || base?.filter
        ? { filter: { and: [...(base?.filter ? [base.filter] : []), ...filters] } }
        : {}),
    };
    const rows = this.rowNotes(folder, schema, dbFolders).map((n) => this.toRow(schema, n));
    const res = queryRows(schema, view, rows);
    const offset = opts.offset ?? 0;
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    return {
      folder,
      total: res.total,
      matched: res.matched,
      rows: res.rows.slice(offset, offset + limit).map((r) => ({ path: r.path, title: r.title, values: Object.fromEntries(Object.entries(r.values).filter(([, v]) => v !== null)) })),
    };
  }

  /** 값들을 속성 형식에 맞춰 검증·변환해 프런트매터에 쓸 값으로 만든다. 맞지 않으면 무엇이 잘못됐는지 알려 준다. */
  frontmatterFor(schema: DbSchema, values: Record<string, unknown>): Record<string, unknown> {
    const fm: Record<string, unknown> = {};
    for (const [name, raw] of Object.entries(values)) {
      if (name === TITLE_PROP) throw new WriteError('bad-input', '제목(title)은 values 가 아니라 title 인자로 주세요');
      const def = schema.properties[name];
      if (!def) throw new WriteError('bad-input', `없는 속성: ${name}. 있는 속성: ${Object.keys(schema.properties).join(', ') || '없음'}`);
      if (!STORED_TYPES.has(def.type)) throw new WriteError('bad-input', `${name}(${def.type}) 은 계산되는 속성이라 쓸 수 없어요`);
      if (def.type === 'relation' && def.twoWay) throw new WriteError('bad-input', `${name} 은 양방향 관계라 앱에서 고쳐 주세요(반대쪽 노트도 함께 바뀌어야 해서요)`);
      const cell = raw === null ? null : normalizeValue(def, raw);
      if (raw !== null && (cell === null || (Array.isArray(cell) && cell.length === 0)) && !(def.type === 'checkbox')) {
        throw new WriteError('bad-input', `${name} 값을 ${def.type} 형식으로 읽을 수 없어요: ${JSON.stringify(raw)}`);
      }
      if (cell !== null && (def.type === 'select' || def.type === 'status' || def.type === 'multi_select')) {
        const allowed = optionsOf(def).map((o) => o.name);
        const picked = Array.isArray(cell) ? cell : [String(cell)];
        const bad = picked.filter((v) => allowed.length > 0 && !allowed.includes(v));
        if (bad.length) throw new WriteError('bad-input', `${name} 에 없는 옵션: ${bad.join(', ')}. 쓸 수 있는 옵션: ${allowed.join(', ')}`);
      }
      fm[name] = toFrontmatterValue(def, cell);
    }
    return fm;
  }

  /** 새 행 노트의 경로와 내용. 이름이 겹치면 ` 2`, ` 3`… */
  buildRow(
    folder: string,
    title: string,
    values: Record<string, unknown>,
    body = '',
    now = new Date(),
    /** 템플릿 노트 경로. 빈 문자열이면 템플릿 없이, 생략하면 데이터베이스의 기본 템플릿 */
    template?: string,
  ): { rel: string; text: string } {
    const s = this.schemaOf(folder);
    if (!s) throw new WriteError('bad-input', `데이터베이스가 아니에요: ${folder}`);
    const fm = this.frontmatterFor(s.schema, values);
    // 고유 ID 속성은 현재 최댓값 + 1
    for (const [name, def] of Object.entries(s.schema.properties)) {
      if (def.type !== 'unique_id' || fm[name] !== undefined) continue;
      let max = 0;
      for (const n of this.rowNotes(folder, s.schema, findDatabaseFolders(this.root))) {
        const v = normalizeValue(def, n.properties[name]);
        if (typeof v === 'number' && v > max) max = v;
      }
      fm[name] = max + 1;
    }
    fm.created = nowIso(now);
    const clean = [...title].filter((c) => c.charCodeAt(0) >= 32).join('').replace(unsafeName, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!clean) throw new WriteError('bad-input', '행 제목이 비어 있어요');
    let rel = '';
    for (let n = 1; ; n++) {
      rel = path.posix.join(folder, `${clean}${n > 1 ? ` ${n}` : ''}.md`);
      if (!existsSync(resolveInVault(this.root, rel))) break;
    }
    const tpl = template === '' ? undefined : (template ?? s.schema.defaultTemplate);
    if (!tpl) return { rel, text: buildRowNote(fm, body) };
    let tplPath: string;
    try {
      tplPath = validateNotePath(tpl);
    } catch (e) {
      throw new WriteError('bad-input', `템플릿 경로가 올바르지 않아요: ${e instanceof Error ? e.message : String(e)}`);
    }
    const tplFile = resolveInVault(this.root, tplPath);
    if (!existsSync(tplFile)) throw new WriteError('bad-input', `템플릿 노트가 없어요: ${tplPath}. 템플릿 없이 만들려면 template 를 빈 문자열로 주세요`);
    const filled = expandTemplate(readFileSync(tplFile, 'utf8'), { now, title: clean });
    const withValues = setFrontmatter(filled, fm);
    return { rel, text: body ? `${withValues.replace(/\s+$/, '')}\n\n${body}` : withValues };
  }

  /** 행 노트의 속성을 고친 새 내용(프런트매터의 그 키만 바뀌고 본문은 그대로) */
  applyValues(notePath: string, values: Record<string, unknown>): (disk: string) => string {
    const folder = this.folderOfRow(notePath);
    if (folder === null) throw new WriteError('bad-input', `이 노트는 데이터베이스의 행이 아니에요: ${notePath}`);
    const schema = this.schemaOf(folder)!.schema;
    const fm = this.frontmatterFor(schema, values);
    return (disk) => setFrontmatter(disk, fm);
  }
}

export { FILTER_OPS };
