import type { Property, SelectOption } from './schema.js';

/** 기간(또는 한 날짜). 날짜는 `YYYY-MM-DD`, 시각이 있으면 `YYYY-MM-DDTHH:mm`(필요하면 초·시간대까지) */
export interface DateValue {
  start: string;
  end?: string;
}

/** 속성 타입에 맞게 정규화한 셀 값. 비어 있으면 null(빈 문자열·빈 배열도 null). */
export type CellValue = null | string | number | boolean | string[] | DateValue;

/** 노트(파일)에서 오는 값 — 생성·수정 시각 속성에 쓴다 */
export interface RowMeta {
  created?: string;
  updated?: string;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);

const toText = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.trim() === '' ? null : v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  return null;
};

function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const s = v.trim().replace(/[,\s]/g, '').replace(/%$/, '');
    if (s === '') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toList(v: unknown, splitCommas: boolean): string[] | null {
  let items: unknown[];
  if (Array.isArray(v)) items = v;
  else if (typeof v === 'string') items = splitCommas ? v.split(',') : [v];
  else return null;
  const out = items.map(toText).filter((s): s is string => s !== null);
  return out.length ? out : null;
}

const DATE_LIKE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function toDateString(v: unknown): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = toText(v);
  return s && DATE_LIKE.test(s) ? s.replace(' ', 'T') : null;
}

function toDate(v: unknown): DateValue | null {
  if (isPlainObject(v)) {
    const start = toDateString(v.start);
    if (!start) return null;
    const end = toDateString(v.end);
    return end ? { start, end } : { start };
  }
  const s = toText(v);
  if (s) {
    const range = /^(.+?)\s*(?:→|->|\/|~)\s*(.+)$/.exec(s);
    if (range) {
      const a = toDateString(range[1]);
      const b = toDateString(range[2]);
      if (a && b) return { start: a, end: b };
    }
  }
  const one = toDateString(v);
  return one ? { start: one } : null;
}

function toBool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (['true', 'yes', 'y', '1', 'on', '✓', 'x'].includes(s)) return true;
    if (['false', 'no', 'n', '0', 'off', ''].includes(s)) return false;
  }
  return null;
}

/** 프런트매터의 원시 값을 속성 타입에 맞는 셀 값으로 바꾼다. 읽을 수 없으면 null(원본은 건드리지 않는다). */
export function normalizeValue(prop: Property, raw: unknown, meta: RowMeta = {}): CellValue {
  switch (prop.type) {
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
    case 'select':
    case 'status':
      return toText(raw);
    case 'number':
      return toNumber(raw);
    case 'unique_id':
      return toNumber(raw) ?? toText(raw);
    case 'multi_select':
      return toList(raw, true);
    case 'files':
    case 'relation':
      return toList(raw, false);
    case 'date':
      return toDate(raw);
    case 'checkbox':
      return toBool(raw) ?? false;
    case 'created_time':
      return meta.created ?? null;
    case 'updated_time':
      return meta.updated ?? null;
    case 'rollup':
    case 'formula':
      return null; // 6단계
  }
}

/** 셀 값을 프런트매터에 쓸 값으로. `undefined` 는 "키를 지운다"는 뜻(빈 값). */
export function toFrontmatterValue(prop: Property, value: CellValue): unknown {
  if (value === null) return prop.type === 'checkbox' ? false : undefined;
  switch (prop.type) {
    case 'checkbox':
      return value === true;
    case 'number':
    case 'unique_id':
      return typeof value === 'number' ? value : (toNumber(value) ?? undefined);
    case 'multi_select':
    case 'files':
    case 'relation':
      return Array.isArray(value) && value.length ? value : undefined;
    case 'date': {
      const d = toDate(value);
      if (!d) return undefined;
      return d.end ? { start: d.start, end: d.end } : d.start;
    }
    case 'created_time':
    case 'updated_time':
    case 'rollup':
    case 'formula':
      return undefined; // 파일에 쓰지 않는다
    default: {
      const t = toText(value);
      return t ?? undefined;
    }
  }
}

export function isEmptyCell(value: CellValue): boolean {
  return value === null || (Array.isArray(value) && value.length === 0);
}

/** 화면·CSV·텍스트 검색용 문자열 */
export function cellText(prop: Property | undefined, value: CellValue): string {
  if (value === null) return '';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? '✓' : '';
  if (typeof value === 'object') return value.end ? `${value.start} → ${value.end}` : value.start;
  if (typeof value === 'number' && prop?.type === 'number') {
    const f = prop.format;
    if (f === 'percent') return `${value}%`;
    if (f === 'stars') return '★'.repeat(Math.max(0, Math.round(value))) + '☆'.repeat(Math.max(0, (prop.max ?? 5) - Math.round(value)));
    if (f === 'currency') {
      try {
        return new Intl.NumberFormat('ko-KR', { style: 'currency', currency: prop.currency ?? 'KRW' }).format(value);
      } catch {
        return String(value);
      }
    }
  }
  return String(value);
}

/** select·status·multi_select 의 옵션 목록(없으면 빈 배열) */
export function optionsOf(prop: Property | undefined): SelectOption[] {
  return prop && (prop.type === 'select' || prop.type === 'multi_select' || prop.type === 'status') ? prop.options : [];
}
