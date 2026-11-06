import { dialog, BrowserWindow } from 'electron';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { t } from '@nopsidian/i18n';
import path from 'node:path';
import { atomicWrite, expandTemplate, resolveInVault, saveNote, splitFrontmatter } from '@nopsidian/core';
import { createLinkResolver, linkNameFor } from '@nopsidian/core/links';
import {
  DB_FILE,
  STORED_TYPES,
  TITLE_PROP,
  normalizeValue,
  parseDbSchema,
  property as propertySchema,
  toFrontmatterValue,
  view as viewSchema,
  type CellValue,
  type DbSchema,
  type DbRow,
  type Property,
} from '@nopsidian/core/db';
import {
  csvToRows,
  guessColumns,
  parseCsv,
  rowsToCsvTable,
  toCsv,
  buildRowNote,
  newDbYaml,
  moveDbView,
  removeDbProperty,
  removeDbView,
  renameDbProperty,
  renameFrontmatterKey,
  setDbMeta,
  setDbProperty,
  setFrontmatter,
  upsertDbView,
} from '@nopsidian/core/db';
import type { z } from 'zod';
import type { dbSchemaOp } from '@nopsidian/ipc-contract';
import type { OpenVault } from './vault';

type SchemaOp = z.infer<typeof dbSchemaOp>;

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** 노트가 속한 데이터베이스 폴더(가장 가까운 상위 `_db.yaml` 폴더). 없으면 null. */
export async function dbFolderOf(v: OpenVault, notePath: string): Promise<string | null> {
  await v.index.ready;
  const folders = await v.index.query<string[]>('databaseFolders');
  const dir = path.posix.dirname(notePath) === '.' ? '' : path.posix.dirname(notePath);
  let best: string | null = null;
  for (const f of folders) {
    if ((f === '' || dir === f || dir.startsWith(`${f}/`)) && (best === null || f.length > best.length)) best = f;
  }
  return best;
}

export function readDbSchema(v: OpenVault, folder: string): DbSchema {
  const text = readFileSync(resolveInVault(v.info.path, path.posix.join(folder, DB_FILE)), 'utf8');
  return parseDbSchema(text, path.posix.basename(folder)).schema;
}

/** 행 노트의 속성 하나를 고친다. 프런트매터의 그 키만 바뀌고 나머지 바이트는 그대로다. */
export async function updateCell(v: OpenVault, notePath: string, prop: string, value: unknown): Promise<void> {
  if (prop === TITLE_PROP) throw new Error(t('main.err.titleRename'));
  const folder = await dbFolderOf(v, notePath);
  if (folder === null) throw new Error(t('main.err.notDbRow'));
  const def = readDbSchema(v, folder).properties[prop];
  if (!def) throw new Error(t('main.err.missingProp', { prop }));
  if (!STORED_TYPES.has(def.type)) throw new Error(t('main.err.computedProp'));
  const fmValue = toFrontmatterValue(def, normalizeValue(def, value));
  const disk = readFileSync(resolveInVault(v.info.path, notePath), 'utf8');
  const next = setFrontmatter(disk, { [prop]: fmValue });
  if (next === disk) return;
  saveNote({ root: v.info.path, rel: notePath, content: next, baseHash: sha(disk), baseContent: disk });
  if (def.type === 'relation' && def.twoWay && def.reverse) {
    const before = asNames(splitFrontmatter(disk)?.data[prop]);
    const after = asNames(fmValue);
    await syncReverse(v, notePath, def.reverse, before, after);
  }
}

const asNames = (raw: unknown): string[] =>
  (Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : []).filter((x): x is string => typeof x === 'string').map(relationNameOf);

const relationNameOf = (raw: string): string => (/^\[\[(.+)\]\]$/.exec(raw.trim())?.[1] ?? raw).split('|')[0]!.split('#')[0]!.trim();

/**
 * 양방향 관계: 이 노트가 새로 가리키게 된 노트에는 되돌아오는 링크를 추가하고, 더 이상 가리키지 않는 노트에서는 뺀다.
 * 반대쪽 속성(`reverse`)에 쓴다. 다른 노트의 파일을 바꾸므로 값이 실제로 달라질 때만 쓴다.
 */
async function syncReverse(v: OpenVault, notePath: string, reverse: string, before: string[], after: string[]): Promise<void> {
  const list = await v.index.list();
  const resolver = createLinkResolver(
    list.map((n, i) => ({ id: i, path: n.path, title: n.title })),
    list.flatMap((n, i) => n.aliases.map((alias) => ({ pageId: i, alias }))),
  );
  const pathOf = (name: string) => {
    const id = resolver(name, notePath);
    return id === undefined ? undefined : list[id]?.path;
  };
  const me = `[[${linkNameFor(notePath, list.map((n) => n.path))}]]`;
  const meName = relationNameOf(me);
  const changes: [string, 'add' | 'remove'][] = [
    ...after.filter((n) => !before.includes(n)).map((n): [string, 'add'] => [n, 'add']),
    ...before.filter((n) => !after.includes(n)).map((n): [string, 'remove'] => [n, 'remove']),
  ];
  for (const [name, op] of changes) {
    const target = pathOf(name);
    if (!target || target === notePath) continue;
    const disk = readFileSync(resolveInVault(v.info.path, target), 'utf8');
    const cur = splitFrontmatter(disk)?.data[reverse];
    const items = (Array.isArray(cur) ? cur : typeof cur === 'string' ? [cur] : []).filter((x): x is string => typeof x === 'string');
    const has = items.some((x) => relationNameOf(x).toLowerCase() === meName.toLowerCase());
    if (op === 'add' && has) continue;
    if (op === 'remove' && !has) continue;
    const nextItems = op === 'add' ? [...items, me] : items.filter((x) => relationNameOf(x).toLowerCase() !== meName.toLowerCase());
    const content = setFrontmatter(disk, { [reverse]: nextItems.length ? nextItems : undefined });
    if (content !== disk) saveNote({ root: v.info.path, rel: target, content, baseHash: sha(disk), baseContent: disk });
  }
}

const unsafeName = /[\\/:*?"<>|]/g;

/** `폴더/이름.md` — 이미 있으면 ` 2`, ` 3` … */
function freeNotePath(root: string, folder: string, title: string): string {
  const base = [...title].filter((c) => c.charCodeAt(0) >= 32).join('').replace(unsafeName, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || t('default.untitled');
  for (let n = 1; ; n++) {
    const rel = path.posix.join(folder, `${base}${n > 1 ? ` ${n}` : ''}.md`);
    if (!existsSync(resolveInVault(root, rel))) return rel;
  }
}

const localIso = (d: Date) => {
  const off = -d.getTimezoneOffset();
  const p = (n: number) => String(Math.trunc(Math.abs(n))).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${off >= 0 ? '+' : '-'}${p(off / 60)}:${p(off % 60)}`;
};

export async function addRow(
  v: OpenVault,
  folder: string,
  title: string,
  values: Record<string, unknown> = {},
  template?: string,
): Promise<string> {
  const schema = readDbSchema(v, folder);
  const fm: Record<string, unknown> = {};
  for (const [name, raw] of Object.entries(values)) {
    const def = schema.properties[name];
    if (!def || !STORED_TYPES.has(def.type)) continue;
    const out = toFrontmatterValue(def, normalizeValue(def, raw));
    if (out !== undefined) fm[name] = out;
  }
  // 고유 ID 속성은 현재 최댓값 + 1 을 자동으로 붙인다
  for (const [name, def] of Object.entries(schema.properties)) {
    if (def.type !== 'unique_id' || fm[name] !== undefined) continue;
    const top = await v.index.query<{ rows: { values: Record<string, unknown> }[] }>('queryDatabase', {
      folder,
      view: { id: '_uid', type: 'table', sort: [{ prop: name, dir: 'desc' }] },
      limit: 1,
    });
    const max = top.rows[0]?.values[name];
    fm[name] = (typeof max === 'number' ? max : 0) + 1;
  }
  const now = new Date();
  fm.created = localIso(now);
  const tpl = template === '' ? undefined : (template ?? schema.defaultTemplate);
  let content: string;
  if (tpl) {
    const body = readFileSync(resolveInVault(v.info.path, tpl), 'utf8');
    content = setFrontmatter(expandTemplate(body, { now, title }), fm);
  } else {
    content = buildRowNote(fm, '');
  }
  const rel = freeNotePath(v.info.path, folder, title);
  atomicWrite(resolveInVault(v.info.path, rel), content);
  return rel;
}

export async function createDatabase(v: OpenVault, folder: string, title: string): Promise<string> {
  const abs = resolveInVault(v.info.path, folder === '' ? '.' : folder);
  mkdirSync(abs, { recursive: true });
  const file = resolveInVault(v.info.path, path.posix.join(folder, DB_FILE));
  if (existsSync(file)) throw new Error(t('main.err.alreadyDb'));
  atomicWrite(file, newDbYaml(title));
  return folder;
}

/** `_db.yaml` 편집. 속성 이름 변경은 모든 행의 프런트매터 키도 함께 바꾼다(실패한 행은 건너뛰고 센다). */
export async function editSchema(v: OpenVault, folder: string, op: SchemaOp): Promise<number> {
  const file = resolveInVault(v.info.path, path.posix.join(folder, DB_FILE));
  const text = readFileSync(file, 'utf8');
  let next: string;
  let touched = 0;
  switch (op.kind) {
    case 'setProperty': {
      const r = propertySchema.safeParse(op.def);
      if (!r.success || op.name === TITLE_PROP) throw new Error(t('main.err.badPropDef'));
      next = setDbProperty(text, op.name, r.data);
      break;
    }
    case 'removeProperty':
      next = removeDbProperty(text, op.name);
      break;
    case 'renameProperty': {
      if (op.to === TITLE_PROP) throw new Error(t('main.err.reservedTitle'));
      next = renameDbProperty(text, op.from, op.to);
      if (next !== text) {
        await v.index.ready;
        for (const rel of await v.index.query<string[]>('databaseRowPaths', folder)) {
          try {
            const disk = readFileSync(resolveInVault(v.info.path, rel), 'utf8');
            const renamed = renameFrontmatterKey(disk, op.from, op.to);
            if (renamed !== disk) {
              saveNote({ root: v.info.path, rel, content: renamed, baseHash: sha(disk), baseContent: disk });
              touched++;
            }
          } catch {
            // 프런트매터가 깨졌거나 새 이름이 이미 있는 행은 그대로 둔다
          }
        }
      }
      break;
    }
    case 'upsertView': {
      const r = viewSchema.safeParse(op.view);
      if (!r.success) throw new Error(t('main.err.badView'));
      next = upsertDbView(text, r.data);
      break;
    }
    case 'removeView':
      next = removeDbView(text, op.id);
      break;
    case 'moveView':
      next = moveDbView(text, op.id, op.toIndex);
      break;
    case 'meta':
      next = setDbMeta(text, {
        ...(op.title !== undefined ? { title: op.title } : {}),
        ...(op.rowsFolder !== undefined ? { rowsFolder: op.rowsFolder } : {}),
        ...(op.defaultTemplate !== undefined ? { defaultTemplate: op.defaultTemplate ?? undefined } : {}),
        ...(op.templates !== undefined ? { templates: op.templates } : {}),
      });
      break;
  }
  if (next !== text) atomicWrite(file, next);
  return touched;
}

const dlgParent = () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? undefined;

/** 현재 뷰(필터·정렬 적용)를 CSV 로 저장한다. 저장한 경로, 취소하면 null. */
export async function exportCsv(v: OpenVault, folder: string, viewId?: string): Promise<{ path: string; rows: number } | null> {
  await v.index.ready;
  const rows: DbRow[] = [];
  let first: Awaited<ReturnType<typeof queryAll>> | null = null;
  for (let offset = 0; ; offset += 5000) {
    const r = await queryAll(v, folder, viewId, offset);
    first ??= r;
    rows.push(...(r.rows as DbRow[]));
    if (r.rows.length < 5000) break;
  }
  const schema = first!.schema;
  const cols = first!.view.columns?.length ? first!.view.columns : [TITLE_PROP, ...Object.keys(schema.properties)];
  const table = rowsToCsvTable(schema, cols, rows.map((r) => ({ title: r.title, values: r.values as Record<string, CellValue> })));
  const opts = { title: t('main.dialog.exportCsv'), defaultPath: `${schema.title ?? 'database'}.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }] };
  const win = dlgParent();
  const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
  if (r.canceled || !r.filePath) return null;
  writeFileSync(r.filePath, toCsv(table, { bom: true }));
  return { path: r.filePath, rows: rows.length };
}

async function queryAll(v: OpenVault, folder: string, viewId: string | undefined, offset: number) {
  return v.index.query<{ schema: DbSchema; view: { columns?: string[] }; rows: { path: string; title: string; values: Record<string, unknown> }[] }>(
    'queryDatabase',
    { folder, viewId, offset, limit: 5000 },
  );
}

interface CsvSession {
  table: string[][];
  fileName: string;
}
const csvSessions = new Map<string, CsvSession>();

export interface CsvPreview {
  token: string;
  fileName: string;
  rowCount: number;
  columns: { index: number; header: string; name: string; type: string; options: string[]; sample: string[] }[];
}

/** CSV 파일을 고르게 하고 열 이름·추정 형식·미리보기를 돌려준다. 취소하면 null. */
export async function importCsvPreview(): Promise<CsvPreview | null> {
  const opts = { title: t('main.dialog.importCsv'), properties: ['openFile' as const], filters: [{ name: 'CSV', extensions: ['csv', 'tsv', 'txt'] }] };
  const win = dlgParent();
  const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  const file = r.filePaths[0];
  if (r.canceled || !file) return null;
  const table = parseCsv(readFileSync(file, 'utf8'), { delimiter: 'auto' });
  if (table.length < 2) throw new Error(t('main.err.noRows'));
  const token = createHash('sha256').update(`${file}:${Date.now()}:${Math.random()}`).digest('hex').slice(0, 16);
  while (csvSessions.size >= 3) csvSessions.delete(csvSessions.keys().next().value!);
  const fileName = path.basename(file);
  csvSessions.set(token, { table, fileName });
  const guesses = guessColumns(table);
  return {
    token,
    fileName,
    rowCount: table.length - 1,
    columns: guesses.map((g, index) => ({
      index,
      header: g.header,
      name: g.name,
      type: g.isTitle ? 'title' : (g.prop?.type ?? 'skip'),
      options: g.prop && 'options' in g.prop ? g.prop.options.map((o) => o.name) : [],
      sample: table.slice(1, 4).map((row) => row[index] ?? ''),
    })),
  };
}

export interface CsvColumnChoice {
  index: number;
  name: string;
  type: string;
}

const IMPORT_TYPES = new Set(['text', 'number', 'select', 'multi_select', 'date', 'checkbox', 'url', 'email', 'phone']);

/** 사용자가 고른 열 대응으로 가져온다: 새 데이터베이스를 만들거나 기존 데이터베이스에 행을 더한다. */
export async function importCsvApply(
  v: OpenVault,
  token: string,
  target: { mode: 'new'; name: string } | { mode: 'existing'; folder: string },
  choices: CsvColumnChoice[],
): Promise<{ folder: string; rows: number; issues: string[] }> {
  const session = csvSessions.get(token);
  if (!session) throw new Error(t('main.err.importExpired'));
  const { table } = session;
  const titleCols = choices.filter((c) => c.type === 'title');
  if (titleCols.length !== 1) throw new Error(t('main.err.oneTitleColumn'));

  let folder: string;
  let schema: DbSchema | null = null;
  if (target.mode === 'new') {
    const base = target.name.replace(unsafeName, ' ').trim() || session.fileName.replace(/\.[^.]+$/, '');
    folder = base;
    for (let n = 2; existsSync(resolveInVault(v.info.path, folder)); n++) folder = `${base} ${n}`;
    await createDatabase(v, folder, base);
  } else {
    folder = target.folder;
    schema = readDbSchema(v, folder);
  }
  const yamlFile = resolveInVault(v.info.path, path.posix.join(folder, DB_FILE));
  let yamlText = readFileSync(yamlFile, 'utf8');

  // 열 정의: 기존 속성이 있으면 그 형식을 따르고, 없으면 고른 형식으로 새로 만든다
  const guesses = guessColumns(table);
  const columns = guesses.map((g, index) => {
    const c = choices.find((x) => x.index === index);
    if (!c || c.type === 'skip') return { ...g, prop: null, isTitle: false };
    if (c.type === 'title') return { ...g, name: c.name, prop: null, isTitle: true };
    const existing = schema?.properties[c.name];
    let prop: Property | undefined = existing;
    if (!prop) {
      if (!IMPORT_TYPES.has(c.type)) throw new Error(t('main.err.unsupportedType', { type: c.type }));
      const distinct = [...new Set(table.slice(1).flatMap((row) => (c.type === 'multi_select' ? (row[index] ?? '').split(',') : [row[index] ?? ''])).map((x) => x.trim()).filter(Boolean))].slice(0, 100);
      const def = propertySchema.parse(
        c.type === 'select' || c.type === 'multi_select'
          ? { type: c.type, options: distinct.map((name) => ({ name })) }
          : c.type === 'number'
            ? { type: 'number', format: 'number' }
            : { type: c.type },
      );
      prop = def;
      yamlText = setDbProperty(yamlText, c.name, def);
    }
    return { ...g, name: c.name, prop, isTitle: false };
  });
  atomicWrite(yamlFile, yamlText);

  const imported = csvToRows(table, columns);
  const issues: string[] = [];
  for (const row of imported) {
    issues.push(...row.issues);
    const rel = freeNotePath(v.info.path, folder, row.title);
    atomicWrite(resolveInVault(v.info.path, rel), buildRowNote(row.values, ''));
  }
  csvSessions.delete(token);
  return { folder, rows: imported.length, issues: issues.slice(0, 30) };
}
