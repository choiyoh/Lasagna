import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

/**
 * 데이터베이스 = 폴더 + `_db.yaml`. 행 = 그 폴더(`rowsFolder`) 안의 노트이고 속성 값은 프런트매터에 있다.
 * 이 파일은 `_db.yaml` 의 형식(zod)과 해석만 다룬다. 값 변환은 `values.ts`, 질의는 `query.ts`.
 */

export const DB_FILE = '_db.yaml';

export const selectOption = z.object({
  name: z.string().min(1),
  color: z.string().optional(),
  /** status 속성의 그룹 */
  group: z.enum(['todo', 'doing', 'done']).optional(),
});
export type SelectOption = z.infer<typeof selectOption>;

const options = z.array(selectOption).default([]);

export const property = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text') }),
  z.object({
    type: z.literal('number'),
    format: z.enum(['number', 'percent', 'currency', 'stars']).default('number'),
    currency: z.string().optional(),
    /** stars 의 최대 별 수 */
    max: z.number().int().positive().optional(),
  }),
  z.object({ type: z.literal('select'), options }),
  z.object({ type: z.literal('multi_select'), options }),
  z.object({ type: z.literal('status'), options }),
  z.object({ type: z.literal('date'), includeTime: z.boolean().optional() }),
  z.object({ type: z.literal('checkbox') }),
  z.object({ type: z.literal('url') }),
  z.object({ type: z.literal('email') }),
  z.object({ type: z.literal('phone') }),
  z.object({ type: z.literal('files') }),
  z.object({ type: z.literal('created_time') }),
  z.object({ type: z.literal('updated_time') }),
  z.object({ type: z.literal('unique_id'), prefix: z.string().optional() }),
  // 6단계에서 계산한다. 5단계는 정의를 보존하고 값은 비워 둔다.
  z.object({ type: z.literal('relation'), target: z.string().default('*'), twoWay: z.boolean().default(false), reverse: z.string().optional() }),
  z.object({ type: z.literal('rollup'), relation: z.string(), property: z.string(), fn: z.string() }),
  z.object({ type: z.literal('formula'), expr: z.string() }),
]);
export type Property = z.infer<typeof property>;
export type PropertyType = Property['type'];

/** 파일에 값이 저장되는(= 편집할 수 있는) 속성 */
export const STORED_TYPES: ReadonlySet<PropertyType> = new Set([
  'text', 'number', 'select', 'multi_select', 'status', 'date', 'checkbox', 'url', 'email', 'phone', 'files', 'unique_id', 'relation',
]);

/** 이름이 `title` 인 속성은 만들 수 없다 — 노트 제목(파일 이름)을 가리키는 예약어다. */
export const TITLE_PROP = 'title';

// ── 필터 ─────────────────────────────────────────────────────────
export const FILTER_OPS = [
  '=', '!=', '>', '>=', '<', '<=', 'contains', '!contains', 'startsWith', 'endsWith', 'empty', '!empty', 'in',
] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

export interface FilterCondition {
  prop: string;
  op: FilterOp;
  /** 문자열·숫자·불리언·배열(in). 날짜는 `YYYY-MM-DD` 또는 `today` `tomorrow` `yesterday` `+7d` `-7d` 같은 상대 표기 */
  value?: unknown;
}
export type FilterNode = FilterCondition | { and: FilterNode[] } | { or: FilterNode[] };

const filterCondition = z.object({ prop: z.string().min(1), op: z.enum(FILTER_OPS), value: z.unknown().optional() });
export const filterNode: z.ZodType<FilterNode> = z.lazy(() =>
  z.union([z.object({ and: z.array(filterNode) }), z.object({ or: z.array(filterNode) }), filterCondition]),
) as z.ZodType<FilterNode>;

// ── 뷰 ───────────────────────────────────────────────────────────
export const sortRule = z.object({ prop: z.string().min(1), dir: z.enum(['asc', 'desc']).default('asc') });
export type SortRule = z.infer<typeof sortRule>;

export const CALC_FNS = ['count', 'count_values', 'count_empty', 'count_unique', 'sum', 'avg', 'min', 'max', 'checked', 'unchecked'] as const;

export const view = z.object({
  id: z.string().min(1),
  name: z.string().default('보기'),
  type: z.enum(['table', 'board', 'list', 'gallery', 'calendar', 'timeline']).default('table'),
  /** 보일 속성 순서(`title` 포함). 없으면 모든 속성 */
  columns: z.array(z.string()).optional(),
  sort: z.array(sortRule).default([]),
  filter: filterNode.optional(),
  groupBy: z.string().optional(),
  subGroupBy: z.string().optional(),
  /** 갤러리 커버로 쓸 files 속성(없으면 본문 첫 이미지) */
  cover: z.string().optional(),
  /** 캘린더·타임라인이 쓸 날짜 속성 */
  dateProp: z.string().optional(),
  /** 직접 끌어 정한 행 순서(노트 경로). 정렬 규칙이 없을 때만 쓴다 */
  manualOrder: z.array(z.string()).optional(),
  widths: z.record(z.string(), z.number()).optional(),
  /** 왼쪽에서 고정할 열 수 */
  frozen: z.number().int().min(0).optional(),
  /** 열별 계산 행 */
  calc: z.record(z.string(), z.enum(CALC_FNS)).optional(),
});
export type View = z.infer<typeof view>;

export const dbSchema = z.object({
  version: z.number().default(1),
  title: z.string().optional(),
  /** `.`(기본) = 이 폴더의 노트만, `**` = 하위 폴더 포함 */
  rowsFolder: z.string().default('.'),
  properties: z.record(z.string(), property).default({}),
  views: z.array(view).default([]),
  templates: z.array(z.string()).default([]),
  /** 새 행에 기본으로 쓰는 템플릿 */
  defaultTemplate: z.string().optional(),
});
export type DbSchema = z.infer<typeof dbSchema>;

export interface DbParseIssue {
  path: string;
  message: string;
}
export interface DbParseResult {
  schema: DbSchema;
  issues: DbParseIssue[];
}

/** 스키마가 없거나 깨졌을 때도 열 수 있는 기본값: 속성 없음, 표 뷰 하나 */
export function defaultSchema(title?: string): DbSchema {
  return { version: 1, title, rowsFolder: '.', properties: {}, views: [{ id: 'v1', name: '표', type: 'table', sort: [] }], templates: [] };
}

/**
 * `_db.yaml` 텍스트를 해석한다. 문제가 있어도 던지지 않고 가능한 만큼 살려 `issues` 로 알린다
 * (문제 패널에 위치와 함께 표시). 속성·뷰는 하나씩 검증해서 나쁜 항목만 버린다.
 */
export function parseDbSchema(yamlText: string, fallbackTitle?: string): DbParseResult {
  const issues: DbParseIssue[] = [];
  let raw: unknown;
  try {
    raw = parseYaml(yamlText);
  } catch (e) {
    return { schema: defaultSchema(fallbackTitle), issues: [{ path: '', message: `YAML 오류: ${e instanceof Error ? e.message : String(e)}` }] };
  }
  const doc = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out = defaultSchema(fallbackTitle);
  out.views = [];
  if (typeof doc.version === 'number') out.version = doc.version;
  if (typeof doc.title === 'string') out.title = doc.title;
  if (typeof doc.rowsFolder === 'string') out.rowsFolder = doc.rowsFolder;
  if (typeof doc.defaultTemplate === 'string') out.defaultTemplate = doc.defaultTemplate;
  if (Array.isArray(doc.templates)) out.templates = doc.templates.filter((t): t is string => typeof t === 'string');

  const props = doc.properties;
  if (props && typeof props === 'object' && !Array.isArray(props)) {
    for (const [name, def] of Object.entries(props as Record<string, unknown>)) {
      if (name === TITLE_PROP) {
        issues.push({ path: `properties.${name}`, message: '`title` 은 노트 제목에 쓰는 예약어라 속성 이름으로 쓸 수 없어요' });
        continue;
      }
      const r = property.safeParse(def);
      if (r.success) out.properties[name] = r.data;
      else issues.push({ path: `properties.${name}`, message: describe(r.error) });
    }
  } else if (props !== undefined) {
    issues.push({ path: 'properties', message: '속성은 이름: 정의 형태의 맵이어야 해요' });
  }

  const views = doc.views;
  if (Array.isArray(views)) {
    const seen = new Set<string>();
    views.forEach((v, i) => {
      const r = view.safeParse(v);
      if (!r.success) return void issues.push({ path: `views[${i}]`, message: describe(r.error) });
      if (seen.has(r.data.id)) return void issues.push({ path: `views[${i}].id`, message: `뷰 id 가 겹쳐요: ${r.data.id}` });
      seen.add(r.data.id);
      out.views.push(r.data);
    });
  } else if (views !== undefined) {
    issues.push({ path: 'views', message: '뷰는 목록이어야 해요' });
  }
  if (out.views.length === 0) out.views = defaultSchema().views;

  // 뷰가 모르는 속성을 가리키면 알려 준다(버리지는 않는다 — 속성을 나중에 추가할 수도 있다).
  const known = new Set([TITLE_PROP, ...Object.keys(out.properties)]);
  for (const v of out.views) {
    for (const [field, name] of [['groupBy', v.groupBy], ['subGroupBy', v.subGroupBy], ['dateProp', v.dateProp], ['cover', v.cover]] as const) {
      if (name && !known.has(name)) issues.push({ path: `views.${v.id}.${field}`, message: `없는 속성: ${name}` });
    }
    for (const c of v.columns ?? []) if (!known.has(c)) issues.push({ path: `views.${v.id}.columns`, message: `없는 속성: ${c}` });
  }
  return { schema: out, issues };
}

function describe(e: z.ZodError): string {
  return e.issues.map((i) => `${i.path.join('.') || '(값)'}: ${i.message}`).join('; ');
}
