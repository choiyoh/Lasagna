/**
 * DB 뷰의 필터·정렬·그룹·계산 행을 메모리에서 계산한다 — 순수 함수만(DOM·Node·Electron API 없음).
 *
 * 행 = 노트이고 값은 `values.ts` 가 `CellValue` 로 이미 정규화했다고 가정한다.
 * 2만 행에서 필터+정렬+그룹이 100ms 안쪽이 목표라서, 비교·키 계산에서 할당과 반복 스캔을 아낀다.
 */

import type { CALC_FNS, DbSchema, FilterNode, FilterOp, Property, PropertyType, SortRule, View } from './schema.js';
import { TITLE_PROP } from './schema.js';
import type { CellValue } from './values.js';
import { isEmptyCell, optionsOf } from './values.js';

export interface DbRow {
  /** 노트 상대 경로 */
  path: string;
  /** 노트 제목 */
  title: string;
  /** 속성 이름 → 정규화된 값. `title` 키는 쓰지 않는다(제목은 `title` 필드) */
  values: Record<string, CellValue>;
  /** ISO 문자열(없을 수 있음). `created_time` 속성 값이 이미 `values` 에 담긴다. 정렬 보조용 */
  created?: string;
  updated?: string;
}

export interface RowGroup {
  /** 그룹 키. `null` = '비어 있음' 그룹 */
  key: string | null;
  label: string;
  rows: DbRow[];
  /** 한 단계 아래 그룹(있을 때만). sub 에는 다시 sub 가 없다 */
  sub?: RowGroup[];
}

export interface QueryResult {
  /** 필터 전 행 수 */
  total: number;
  /** 필터 후 행 수 */
  matched: number;
  /** 필터+정렬 결과(그룹 무시, 정렬만) */
  rows: DbRow[];
  /** `view.groupBy` 가 있을 때만 */
  groups: RowGroup[] | null;
  /** `view.calc` 의 열별 결과(필터 후 전체 행 기준) */
  calc: Record<string, CellValue>;
}

type CalcFn = (typeof CALC_FNS)[number];
/** 속성 종류. `title` 은 스키마에 없지만 제목 문자열로 다룬다 */
type Kind = PropertyType | 'title';

const EMPTY_LABEL = '(없음)';
/** status 옵션의 group 순서(정의 순서보다 우선한다) */
const GROUP_RANK: Record<string, number> = { todo: 0, doing: 1, done: 2 };
/** 한글·숫자 자연 정렬. `localeCompare(..., 'ko')` 와 같은 결과를 비교기 생성 비용 없이 쓴다 */
const KO = new Intl.Collator('ko', { numeric: true });

const ARRAY_KINDS: ReadonlySet<string> = new Set(['multi_select', 'files', 'relation']);
const STRING_KINDS: ReadonlySet<string> = new Set(['text', 'url', 'email', 'phone', 'select', 'status', 'unique_id', 'title']);

/** 스키마에서 속성 종류를 찾는다. `title` 은 문자열, 모르는 속성은 `undefined` */
function kindOf(schema: DbSchema, prop: string): Kind | undefined {
  if (prop === TITLE_PROP) return 'title';
  return schema.properties[prop]?.type;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** `now` 의 로컬 날짜(상대 날짜 필터의 기준) */
function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 날짜 비교는 날짜 부분(앞 10자)만 쓴다 */
function dayPart(s: string): string {
  return s.slice(0, 10);
}

function compareText(value: CellValue): string {
  if (Array.isArray(value)) return value.join(', ');
  if (value !== null && typeof value === 'object') return value.start;
  return String(value);
}

function numOf(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const s = v.trim();
    if (s === '') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function boolOf(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'true') return true;
    if (s === 'false') return false;
  }
  return undefined;
}

function toStr(v: unknown): string {
  if (v === null || v === undefined) return '';
  return typeof v === 'string' ? v : String(v);
}

function lower(v: unknown): string {
  return toStr(v).toLowerCase();
}

/** `[[노트]]` · `[[노트|별칭]]` · `[[노트#제목]]` 에서 노트 이름만 뽑는다 */
function noteName(raw: string): string {
  let s = raw.trim();
  const wrapped = /^\[\[(.+)\]\]$/.exec(s);
  if (wrapped) s = wrapped[1]!;
  const bar = s.indexOf('|');
  if (bar >= 0) s = s.slice(0, bar);
  const hash = s.indexOf('#');
  if (hash >= 0) s = s.slice(0, hash);
  return s.trim();
}

/** 행 날짜를 `[start, end]`(날짜 부분)로. 날짜가 아니면 null */
function rowSpan(value: CellValue): { start: string; end: string } | null {
  if (value === null) return null;
  if (typeof value === 'string') {
    const start = dayPart(value);
    return { start, end: start };
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    const start = dayPart(value.start);
    return { start, end: value.end ? dayPart(value.end) : start };
  }
  return null;
}

function dateStart(value: CellValue): string | null {
  const span = rowSpan(value);
  return span ? span.start : null;
}

/** 필터 값의 상대 표기를 `now` 로 해석한다: `today` `yesterday` `tomorrow` `+3d` `-2d` `now` */
function resolveDate(raw: unknown, now: Date): string | null {
  if (raw instanceof Date) return localDate(raw);
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (s === '') return null;
  const rel = /^([+-])(\d+)d$/i.exec(s);
  if (rel) {
    const delta = (rel[1] === '-' ? -1 : 1) * Number(rel[2]!);
    return localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + delta));
  }
  const word = s.toLowerCase();
  if (word === 'today' || word === 'now') return localDate(now);
  if (word === 'yesterday') return localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  if (word === 'tomorrow') return localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const abs = /^\d{4}-\d{2}-\d{2}/.exec(s);
  return abs ? abs[0] : null;
}

/** 옵션 정의 순서(정의에 없으면 `Infinity` = 뒤). status 는 group(todo<doing<done) 이 먼저다 */
function optionRank(prop: Property | undefined, name: string): number {
  const opts = optionsOf(prop);
  const idx = opts.findIndex((o) => o.name === name);
  if (idx < 0) return Number.POSITIVE_INFINITY;
  if (prop?.type !== 'status') return idx;
  return (GROUP_RANK[opts[idx]!.group ?? 'todo'] ?? 0) * 1000 + idx;
}

/** 빈 값이면 방향과 무관하게 뒤로 보내는 비교. 둘 다 값이면 `undefined` */
function emptyOrder(a: CellValue, b: CellValue): number | undefined {
  const ea = isEmptyCell(a);
  const eb = isEmptyCell(b);
  if (ea && eb) return 0;
  if (ea) return 1;
  if (eb) return -1;
  return undefined;
}

/** 값이 있는 셀끼리의 오름차순 비교(속성 타입별 규칙) */
function compareNonNull(prop: Property | undefined, a: CellValue, b: CellValue): number {
  const type = prop?.type;
  if (type === 'number' || (type === 'unique_id' && (typeof a === 'number' || typeof b === 'number'))) {
    return (numOf(a) ?? 0) - (numOf(b) ?? 0);
  }
  if (type === 'date' || type === 'created_time' || type === 'updated_time') {
    const sa = dateStart(a);
    const sb = dateStart(b);
    if (sa === sb) return 0;
    if (sa === null) return 1;
    if (sb === null) return -1;
    return sa < sb ? -1 : 1;
  }
  if (type === 'checkbox') return (a === true ? 1 : 0) - (b === true ? 1 : 0);
  if (type === 'select' || type === 'status') {
    const ra = optionRank(prop, compareText(a));
    const rb = optionRank(prop, compareText(b));
    if (ra === rb) return KO.compare(compareText(a), compareText(b));
    return ra < rb ? -1 : 1;
  }
  return KO.compare(compareText(a), compareText(b));
}

// ── 셀 읽기 ──────────────────────────────────────────────────────

export function getCell(schema: DbSchema, row: DbRow, prop: string): CellValue {
  if (prop === TITLE_PROP) return row.title;
  return row.values[prop] ?? null;
}

// ── 필터 ─────────────────────────────────────────────────────────

function matchString(op: FilterOp, cell: CellValue, raw: unknown): boolean {
  const a = lower(cell);
  const b = lower(raw);
  switch (op) {
    case '=':
      return a === b;
    case '!=':
      return a !== b;
    case 'contains':
      return a.includes(b);
    case '!contains':
      return !a.includes(b);
    case 'startsWith':
      return a.startsWith(b);
    case 'endsWith':
      return a.endsWith(b);
    case 'in':
      return Array.isArray(raw) ? raw.some((v) => lower(v) === a) : false;
    default:
      return false;
  }
}

function matchList(kind: Kind, op: FilterOp, cell: CellValue, raw: unknown): boolean {
  const items = Array.isArray(cell) ? cell : [];
  const norm = (v: unknown): string => lower(kind === 'relation' ? noteName(toStr(v)) : v);
  const list = items.map((item) => norm(item));
  const has = (v: unknown): boolean => list.includes(norm(v));
  switch (op) {
    // 배열에서 `=` 는 contains 와 같게 본다
    case '=':
    case 'contains':
      return has(raw);
    case '!contains':
      return !has(raw);
    case 'in':
      return Array.isArray(raw) ? raw.some((v) => has(v)) : false;
    default:
      return false;
  }
}

function matchNumber(op: FilterOp, cell: CellValue, raw: unknown): boolean {
  const a = numOf(cell);
  if (a === null) return op === '!='; // 빈 값: `!=` 만 true
  const b = numOf(raw);
  if (b === null) return false;
  switch (op) {
    case '=':
      return a === b;
    case '!=':
      return a !== b;
    case '>':
      return a > b;
    case '>=':
      return a >= b;
    case '<':
      return a < b;
    case '<=':
      return a <= b;
    default:
      return false;
  }
}

function matchCheckbox(op: FilterOp, cell: CellValue, raw: unknown): boolean {
  if (cell === null) return op === '!='; // 빈 값: `!=` 만 true
  const b = boolOf(raw);
  if (b === undefined) return false;
  const a = cell === true;
  if (op === '=') return a === b;
  if (op === '!=') return a !== b;
  return false;
}

function matchDate(op: FilterOp, cell: CellValue, raw: unknown, now: Date): boolean {
  const span = rowSpan(cell);
  if (!span) return false; // 빈 날짜는 empty 만 true
  const target = resolveDate(raw, now);
  if (target === null) return false;
  const hit = span.start <= target && target <= span.end;
  switch (op) {
    case '=':
      return hit;
    case '!=':
      return !hit;
    case '<':
    case '<=':
      return op === '<' ? span.start < target : span.start <= target;
    case '>':
    case '>=':
      return op === '>' ? span.end > target : span.end >= target;
    default:
      return false;
  }
}

/** `empty`/`!empty` 는 값을 쓰지 않는다. checkbox 는 false 도 빈 것으로 본다 */
function isEffectivelyEmpty(kind: Kind, cell: CellValue): boolean {
  return isEmptyCell(cell) || (kind === 'checkbox' && cell === false);
}

function matchCondition(prop: Property | undefined, kind: Kind, op: FilterOp, raw: unknown, cell: CellValue, now: Date): boolean {
  if (op === 'empty') return isEffectivelyEmpty(kind, cell);
  if (op === '!empty') return !isEffectivelyEmpty(kind, cell);
  if (kind === 'number') return matchNumber(op, cell, raw);
  if (kind === 'checkbox') return matchCheckbox(op, cell, raw);
  if (kind === 'date' || kind === 'created_time' || kind === 'updated_time') return matchDate(op, cell, raw, now);
  if (ARRAY_KINDS.has(kind)) return matchList(kind, op, cell, raw);
  if (STRING_KINDS.has(kind)) return matchString(op, cell, raw);
  return false; // 규칙에 없는 조합
}

export function evalFilter(schema: DbSchema, node: FilterNode | undefined, row: DbRow, now: Date = new Date()): boolean {
  if (!node) return true;
  if ('and' in node) return node.and.every((n) => evalFilter(schema, n, row, now));
  // 조건이 없으면 거르지 않는다
  if ('or' in node) return node.or.length === 0 ? true : node.or.some((n) => evalFilter(schema, n, row, now));
  const kind = kindOf(schema, node.prop);
  if (kind === undefined) return true; // 모르는 속성은 거르지 않는다
  return matchCondition(schema.properties[node.prop], kind, node.op, node.value, getCell(schema, row, node.prop), now);
}

// ── 정렬 ─────────────────────────────────────────────────────────

export function compareCells(prop: Property | undefined, a: CellValue, b: CellValue): number {
  const empty = emptyOrder(a, b);
  if (empty !== undefined) return empty;
  return compareNonNull(prop, a, b);
}

export function sortRows(schema: DbSchema, rows: DbRow[], rules: SortRule[]): DbRow[] {
  if (rules.length === 0) return [...rows]; // 규칙이 없으면 입력 순서 그대로
  const out = [...rows];
  out.sort((ra, rb) => {
    for (const rule of rules) {
      const prop = rule.prop === TITLE_PROP ? undefined : schema.properties[rule.prop];
      const a = getCell(schema, ra, rule.prop);
      const b = getCell(schema, rb, rule.prop);
      const empty = emptyOrder(a, b);
      if (empty !== undefined) {
        if (empty !== 0) return empty; // 빈 값은 desc 에서도 항상 뒤
        continue;
      }
      const c = compareNonNull(prop, a, b);
      if (c !== 0) return rule.dir === 'desc' ? -c : c;
    }
    return 0; // 모두 같으면 원래 순서(안정 정렬)
  });
  return out;
}

// ── 그룹 ─────────────────────────────────────────────────────────

/** checkbox 그룹: 항상 두 그룹(false<true)을 만든다 */
function checkboxGroups(schema: DbSchema, propName: string, rows: DbRow[]): RowGroup[] {
  const off: DbRow[] = [];
  const on: DbRow[] = [];
  for (const row of rows) (getCell(schema, row, propName) === true ? on : off).push(row);
  return [
    { key: 'false', label: '체크 안 됨', rows: off },
    { key: 'true', label: '체크됨', rows: on },
  ];
}

/** 그룹 키: date 는 시작일 `YYYY-MM-DD`, 배열은 join, 그 외는 문자열 */
function groupKey(kind: Kind, value: CellValue): string {
  if (kind === 'date' || kind === 'created_time' || kind === 'updated_time') return dateStart(value) ?? '';
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

interface SelectBucket {
  key: string;
  label: string;
  rows: DbRow[];
  /** 옵션 정의 순서(모르는 값은 Infinity) */
  rank: number;
}

function compareBuckets(a: SelectBucket, b: SelectBucket): number {
  if (a.rank !== b.rank) {
    if (a.rank === Number.POSITIVE_INFINITY) return 1;
    if (b.rank === Number.POSITIVE_INFINITY) return -1;
    return a.rank - b.rank;
  }
  return KO.compare(a.key, b.key);
}

/** select/status/multi_select 그룹: 정의된 옵션은 빈 그룹으로도 포함하고, 모르는 값은 그 뒤 가나다 */
function selectGroups(prop: Property | undefined, rows: DbRow[], propName: string, schema: DbSchema): RowGroup[] {
  const known = new Map<string, SelectBucket>();
  for (const opt of optionsOf(prop)) {
    known.set(opt.name, { key: opt.name, label: opt.name, rows: [], rank: optionRank(prop, opt.name) });
  }
  const unknown = new Map<string, SelectBucket>();
  const bucketFor = (name: string): SelectBucket => {
    const hit = known.get(name) ?? unknown.get(name);
    if (hit) return hit;
    const made: SelectBucket = { key: name, label: name, rows: [], rank: Number.POSITIVE_INFINITY };
    unknown.set(name, made);
    return made;
  };
  const emptyRows: DbRow[] = [];
  for (const row of rows) {
    const value = getCell(schema, row, propName);
    if (isEmptyCell(value)) {
      emptyRows.push(row);
      continue;
    }
    if (Array.isArray(value)) {
      // multi_select: 항목마다 그룹에 (행이 여러 그룹에 중복 포함)
      const seen = new Set<string>();
      for (const item of value) {
        if (typeof item !== 'string' || item === '' || seen.has(item)) continue;
        seen.add(item);
        bucketFor(item).rows.push(row);
      }
    } else if (typeof value === 'string') {
      bucketFor(value).rows.push(row);
    }
  }
  const out: RowGroup[] = [...known.values(), ...unknown.values()]
    .sort(compareBuckets)
    .map((b) => ({ key: b.key, label: b.label, rows: b.rows }));
  if (emptyRows.length) out.push({ key: null, label: EMPTY_LABEL, rows: emptyRows });
  return out;
}

/** 그 외 타입: 값별 그룹을 compareCells 순서로. 빈 값은 맨 뒤 */
function valueGroups(prop: Property | undefined, rows: DbRow[], propName: string, schema: DbSchema, kind: Kind): RowGroup[] {
  const buckets = new Map<string, { key: string; value: CellValue; rows: DbRow[] }>();
  const emptyRows: DbRow[] = [];
  for (const row of rows) {
    const value = getCell(schema, row, propName);
    if (isEmptyCell(value)) {
      emptyRows.push(row);
      continue;
    }
    const key = groupKey(kind, value);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { key, value, rows: [] };
      buckets.set(key, bucket);
    }
    bucket.rows.push(row);
  }
  const out: RowGroup[] = [...buckets.values()]
    .sort((a, b) => compareNonNull(prop, a.value, b.value))
    .map((b) => ({ key: b.key, label: b.key, rows: b.rows }));
  if (emptyRows.length) out.push({ key: null, label: EMPTY_LABEL, rows: emptyRows });
  return out;
}

function buildGroups(schema: DbSchema, rows: DbRow[], propName: string): RowGroup[] {
  const kind = kindOf(schema, propName);
  if (kind === undefined) return [{ key: null, label: EMPTY_LABEL, rows: [...rows] }]; // 모르는 속성은 한 그룹
  const prop = propName === TITLE_PROP ? undefined : schema.properties[propName];
  if (kind === 'select' || kind === 'status' || kind === 'multi_select') return selectGroups(prop, rows, propName, schema);
  if (kind === 'checkbox') return checkboxGroups(schema, propName, rows);
  return valueGroups(prop, rows, propName, schema, kind);
}

export function groupRows(schema: DbSchema, rows: DbRow[], groupBy: string, subGroupBy?: string): RowGroup[] {
  const groups = buildGroups(schema, rows, groupBy);
  if (subGroupBy) for (const group of groups) group.sub = buildGroups(schema, group.rows, subGroupBy);
  return groups;
}

// ── 계산 행 ──────────────────────────────────────────────────────

/** 고유 값 판정용 키(배열은 항목 단위) */
function uniqueKeys(value: CellValue): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (value !== null && typeof value === 'object') return [value.end ? `${value.start}→${value.end}` : value.start];
  return [String(value)];
}

export function calcColumn(schema: DbSchema, rows: DbRow[], prop: string, fn: CalcFn): CellValue {
  switch (fn) {
    case 'count':
      return rows.length;
    case 'count_values': {
      let n = 0;
      for (const row of rows) if (!isEmptyCell(getCell(schema, row, prop))) n += 1;
      return n;
    }
    case 'count_empty': {
      let n = 0;
      for (const row of rows) if (isEmptyCell(getCell(schema, row, prop))) n += 1;
      return n;
    }
    case 'count_unique': {
      const seen = new Set<string>();
      for (const row of rows) {
        const value = getCell(schema, row, prop);
        if (isEmptyCell(value)) continue;
        for (const key of uniqueKeys(value)) seen.add(key);
      }
      return seen.size;
    }
    case 'sum':
    case 'avg':
    case 'min':
    case 'max': {
      if (schema.properties[prop]?.type !== 'number') return null; // 타입에 안 맞는 fn
      // Math.min(...nums) 은 행이 많으면 인자 한도에 걸리므로 직접 훑는다
      let sum = 0;
      let n = 0;
      let min = 0;
      let max = 0;
      for (const row of rows) {
        const value = getCell(schema, row, prop);
        if (typeof value !== 'number') continue;
        if (n === 0) {
          min = value;
          max = value;
        } else {
          if (value < min) min = value;
          if (value > max) max = value;
        }
        sum += value;
        n += 1;
      }
      if (n === 0) return null; // 숫자가 하나도 없으면 null
      if (fn === 'sum') return sum;
      if (fn === 'avg') return sum / n;
      return fn === 'min' ? min : max;
    }
    case 'checked':
    case 'unchecked': {
      if (schema.properties[prop]?.type !== 'checkbox') return null; // 타입에 안 맞는 fn
      let n = 0;
      for (const row of rows) {
        const value = getCell(schema, row, prop);
        if (fn === 'checked' ? value === true : value === false) n += 1;
      }
      return n;
    }
    default:
      return null;
  }
}

// ── 질의 ─────────────────────────────────────────────────────────

export function queryRows(schema: DbSchema, view: View, rows: DbRow[], opts: { now?: Date } = {}): QueryResult {
  const now = opts.now ?? new Date();
  const matched = rows.filter((row) => evalFilter(schema, view.filter, row, now));
  const sorted = sortRows(schema, matched, view.sort);
  const groups = view.groupBy ? groupRows(schema, sorted, view.groupBy, view.subGroupBy) : null;
  const calc: Record<string, CellValue> = {};
  const spec = view.calc ?? {};
  for (const prop of Object.keys(spec)) calc[prop] = calcColumn(schema, sorted, prop, spec[prop]!);
  return { total: rows.length, matched: matched.length, rows: sorted, groups, calc };
}
