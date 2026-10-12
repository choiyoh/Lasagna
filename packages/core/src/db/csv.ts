import { TITLE_PROP } from './schema.js';
import type { DbSchema, Property } from './schema.js';
import { normalizeValue, toFrontmatterValue } from './values.js';
import type { CellValue } from './values.js';

/**
 * CSV 가져오기/내보내기 — 파일을 읽고 쓰는 일은 호출자(앱)가 맡고 여기서는 순수 함수만 다룬다.
 * 값 변환은 `values.ts` 의 normalizeValue/toFrontmatterValue 를 그대로 쓰므로 편집기와 규칙이 어긋나지 않는다.
 */

const BOM = '\uFEFF';

// ── 파서 ─────────────────────────────────────────────────────────

const DELIMITER_CANDIDATES = [',', ';', '\t'] as const;
type Delimiter = (typeof DELIMITER_CANDIDATES)[number];

/** 구분자 자동 감지 — 첫 줄에서 가장 많이 나온 후보. 동률이거나 없으면 쉼표. 따옴표 안의 구분자는 세지 않는다. */
function detectDelimiter(text: string): Delimiter {
  const counts: Record<Delimiter, number> = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (const ch of text) {
    if (ch === '\n' || ch === '\r') break;
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && ch in counts) counts[ch as Delimiter] += 1;
  }
  let best: Delimiter = ',';
  for (const d of DELIMITER_CANDIDATES) if (counts[d] > counts[best]) best = d;
  return best;
}

/**
 * RFC 4180 CSV 파서. UTF-8 BOM 제거, 구분자는 쉼표 기본(`opts.delimiter` 로 `;` `\t` 지정, `'auto'` 면 첫 줄에서
 * 가장 많은 것), CRLF/LF/CR 줄바꿈, 따옴표 안의 줄바꿈·쉼표·`""` 이스케이프, 끝의 빈 줄 무시.
 * 닫히지 않은 따옴표는 끝까지를 한 칸으로 본다.
 */
export function parseCsv(
  text: string,
  opts: { delimiter?: ',' | ';' | '\t' | 'auto' } = {},
): string[][] {
  const src = text.startsWith(BOM) ? text.slice(1) : text;
  const delimiter: Delimiter =
    opts.delimiter === undefined
      ? ','
      : opts.delimiter === 'auto'
        ? detectDelimiter(src)
        : opts.delimiter;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const endRow = (): void => {
    row.push(field);
    rows.push(row);
    row = [];
    field = '';
  };

  for (let i = 0; i < src.length;) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'; // "" 이스케이프
          i += 2;
          continue;
        }
        quoted = false; // 닫는 따옴표
        i += 1;
        continue;
      }
      field += ch; // 따옴표 안의 줄바꿈·쉼표는 그대로 값의 일부
      i += 1;
      continue;
    }
    if (ch === '"' && field === '') {
      quoted = true; // 칸 맨 앞의 따옴표만 묶음의 시작으로 본다
      i += 1;
      continue;
    }
    if (ch === delimiter) {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      endRow();
      i += ch === '\r' && src[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field !== '' || row.length > 0) endRow(); // 마지막 줄에 줄바꿈이 없어도 마지막 칸을 남긴다

  // 끝의 빈 줄은 무시한다(엑셀이 붙이는 마지막 줄바꿈 등). 줄 중간의 빈 줄은 한 칸짜리 행으로 남긴다.
  while (rows.length > 0) {
    const last = rows[rows.length - 1]!;
    if (last.length === 1 && last[0] === '') rows.pop();
    else break;
  }
  return rows;
}

const CSV_QUOTE_RE = /[",\r\n]/;

/** 쉼표·따옴표·줄바꿈이 있는 칸만 따옴표로 감싸고 안의 `"` 는 `""` 로 바꾼다. */
function escapeField(value: string): string {
  return CSV_QUOTE_RE.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * CSV 직렬화. 줄바꿈은 `\n`, 끝에 줄바꿈 하나. `opts.bom` 이면 맨 앞에 BOM 을 붙인다(엑셀용).
 * 행이 없으면 빈 문자열(빈 줄을 만들지 않는다).
 */
export function toCsv(rows: string[][], opts: { bom?: boolean } = {}): string {
  const head = opts.bom ? BOM : '';
  if (rows.length === 0) return head;
  return head + rows.map((row) => row.map(escapeField).join(',')).join('\n') + '\n';
}

// ── 열 타입 추론 ─────────────────────────────────────────────────

export interface ColumnGuess {
  header: string;
  name: string;
  prop: Property | null /* null 이면 가져오지 않음 */;
  isTitle: boolean;
}

const TITLE_HEADERS = new Set(['title', '제목', '이름', 'name']);

const CHECKBOX_TRUE = new Set([
  'true',
  'yes',
  'y',
  '1',
  'on',
  'v',
  'o',
  '✓',
  '✔',
  '체크',
  'checked',
]);
const CHECKBOX_FALSE = new Set(['false', 'no', 'n', '0', 'off', 'x', '✗', '미체크', 'unchecked']);

/** 천단위 쉼표와 % 를 허용하는 숫자. */
const NUMBER_RE = /^[-+]?(\d{1,3}(,\d{3})+|\d+)(?:\.\d+)?%?$/;

/** `YYYY-MM-DD` `YYYY/MM/DD` `YYYY.MM.DD` + 시각(선택). values.ts 의 DATE_LIKE 는 대시 형태만 읽으니 주의. */
const DATE_RE =
  /^\d{4}[-/.]\d{2}[-/.]\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const DATE_TIME_RE = /^\d{4}[-/.]\d{2}[-/.]\d{2}[T ]\d{2}:\d{2}/;
const DATE_RANGE_RE = /\s*(?:→|->|~)\s*/;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\//i;

/** 값이 날짜(기간이면 양끝 모두)면 조각들을, 아니면 null. */
function dateParts(value: string): string[] | null {
  if (DATE_RE.test(value)) return [value];
  const parts = value.split(DATE_RANGE_RE).map((p) => p.trim());
  const filled = parts.filter((p) => p !== '');
  return filled.length === 2 && filled.every((p) => DATE_RE.test(p)) ? filled : null;
}

/** `,` 로 나눈 항목들(`a, b` 형태). 비어 있는 항목은 버린다. */
function splitItems(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/** 등장 순서를 지키며 중복을 없앤다. */
function uniqueInOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/**
 * checkbox 로 추론한 값 중에는 `values.ts` 의 toBool 이 모르는 표기(체크·v·o·✗ 등)도 있다.
 * 추론 규칙과 가져오기가 어긋나 값이 조용히 false 로 바뀌지 않도록 toBool 이 아는 표기로 먼저 맞춘다.
 */
function canonicalCheckbox(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (CHECKBOX_TRUE.has(s)) return 'true';
  if (CHECKBOX_FALSE.has(s)) return 'false';
  return raw;
}

/** `2026/10/12` `2026.10.13` 은 date 로 추론되지만 values.ts(DATE_LIKE)는 대시 형태만 읽는다. 대시로 맞춰 준다. */
function canonicalDate(raw: string): string {
  if (!DATE_RE.test(raw) && dateParts(raw) === null) return raw;
  return raw.replace(/(\d{4})[-/.](\d{2})[-/.](\d{2})/g, '$1-$2-$3');
}

/** normalizeValue 가 읽을 수 있는 표기로 먼저 맞춘다(추론 규칙과 가져오기 규칙을 일치시킨다). */
function canonicalCell(prop: Property, raw: string): string {
  if (prop.type === 'checkbox') return canonicalCheckbox(raw);
  if (prop.type === 'date') return canonicalDate(raw);
  return raw;
}

const selectOptions = (names: string[]): { name: string }[] => names.map((name) => ({ name }));

/** 비어 있지 않은 값들로 열의 속성 타입을 추론한다(규칙 순서는 guessColumns 주석 참고). */
function guessProperty(values: string[]): Property {
  if (values.length === 0) return { type: 'text' };

  const lower = values.map((v) => v.toLowerCase());
  if (lower.every((v) => CHECKBOX_TRUE.has(v) || CHECKBOX_FALSE.has(v)))
    return { type: 'checkbox' };
  if (values.every((v) => NUMBER_RE.test(v))) {
    return { type: 'number', format: values.every((v) => v.endsWith('%')) ? 'percent' : 'number' };
  }
  const dates = values.map(dateParts);
  if (dates.every((d) => d !== null)) {
    const includeTime = dates.some((d) => d!.some((p) => DATE_TIME_RE.test(p)));
    return includeTime ? { type: 'date', includeTime: true } : { type: 'date' };
  }
  if (values.every((v) => URL_RE.test(v))) return { type: 'url' };
  if (values.every((v) => EMAIL_RE.test(v))) return { type: 'email' };

  // 목록 열(multi_select)을 먼저 본다. 전체 값의 종류가 적어도 `a, b` 처럼 항목이 나뉘어 있으면 select 보다 목록이 맞다.
  const lists = values.map(splitItems);
  const listRows = lists.filter((items) => items.length > 1).length;
  if (listRows > 0 && listRows * 2 >= values.length) {
    const items = uniqueInOrder(lists.flat());
    if (items.length <= 20) return { type: 'multi_select', options: selectOptions(items) };
  }

  const unique = uniqueInOrder(values);
  if (values.length >= 5 && unique.length <= 20 && unique.length * 2 <= values.length) {
    return { type: 'select', options: selectOptions(unique) };
  }
  return { type: 'text' };
}

/**
 * 헤더와 데이터 행으로 열별 속성 타입을 추론한다. 규칙(위에서부터):
 * - 헤더가 title/제목/이름/name(대소문자 무시)이면 그 열이 제목(prop null). 없으면 첫 열이 제목.
 * - 값이 모두 비어 있으면 text.
 * - 모두 true/false/yes/no/y/n/✓/1/0/체크 계열이면 checkbox(0/1 뿐이어도 number 가 아니다).
 * - 모두 숫자(쉼표 천단위·% 허용)면 number(모두 % 로 끝나면 percent).
 * - 모두 날짜(YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD, 기간은 `→`)면 date(시각이 하나라도 있으면 includeTime).
 * - 모두 `http(s)://` 로 시작하면 url, 모두 이메일 형태면 email.
 * - 고유 값이 적으면 select, `, ` 로 항목이 나뉜 행이 절반 이상이면 multi_select.
 * - 그 외 text.
 * name 은 헤더를 정리한 속성 이름(앞뒤 공백 제거, 비면 `열N`, 겹치면 ` 2` 식으로, 예약어 `title` 은 `title 2`).
 */
export function guessColumns(rows: string[][]): ColumnGuess[] {
  const header = rows[0] ?? [];
  const dataRows = rows.slice(1);
  const named = header.findIndex((h) => TITLE_HEADERS.has(h.trim().toLowerCase()));
  const titleIndex = named === -1 ? 0 : named;
  const used = new Set<string>([TITLE_PROP]); // `title` 은 노트 제목 예약어라 속성 이름으로 쓸 수 없다

  return header.map((raw, index) => {
    const isTitle = index === titleIndex;
    const trimmed = raw.trim();
    const base = trimmed === '' ? `열${index + 1}` : trimmed;
    let name = base;
    for (let n = 2; used.has(name); n += 1) name = `${base} ${n}`;
    used.add(name);

    const values = isTitle
      ? []
      : dataRows.map((row) => (row[index] ?? '').trim()).filter((v) => v !== '');
    return { header: raw, name, prop: isTitle ? null : guessProperty(values), isTitle };
  });
}

// ── 가져오기 ─────────────────────────────────────────────────────

export interface ImportedRow {
  title: string;
  values: Record<string, unknown>; // toFrontmatterValue 가 쓴 프런트매터 값
  issues: string[];
}

/**
 * 추론(또는 사용자가 고친) 열 정의로 행을 만든다. 값은 normalizeValue → toFrontmatterValue 를 거친 프런트매터 값.
 * 제목이 비면 `제목 없음 N`(N 은 빈 제목 순번, 1부터). 같은 제목이 겹치면 그대로 둔다(파일 이름은 호출자가 정한다).
 * 해석 못 한 값은 비우고 `N행 <이름>: 읽을 수 없는 값 '<값>'` 을 issues 에 남긴다(N 은 데이터 행 번호, 1부터).
 * 칸이 비어 있으면 값을 만들지 않으므로 프런트매터 키도 쓰이지 않는다.
 */
export function csvToRows(rows: string[][], columns: ColumnGuess[]): ImportedRow[] {
  const dataRows = rows.slice(1); // 첫 줄은 헤더
  let unnamed = 0;

  return dataRows.map((row, rowIndex) => {
    const issues: string[] = [];
    const values: Record<string, unknown> = {};
    let title = '';

    for (const [index, column] of columns.entries()) {
      const raw = (row[index] ?? '').trim();
      if (column.isTitle) {
        title = raw;
        continue;
      }
      if (!column.prop) continue; // prop 이 null 이면 가져오지 않는다
      if (raw === '') continue;
      const text = canonicalCell(column.prop, raw);
      const frontmatter = toFrontmatterValue(column.prop, normalizeValue(column.prop, text));
      if (frontmatter === undefined) {
        issues.push(`${rowIndex + 1}행 ${column.name}: 읽을 수 없는 값 '${raw}'`);
        continue;
      }
      values[column.name] = frontmatter;
    }

    if (title === '') {
      unnamed += 1;
      title = `제목 없음 ${unnamed}`;
    }
    return { title, values, issues };
  });
}

// ── 내보내기 ─────────────────────────────────────────────────────

/** CSV 로 내보낼 문자열 — cellText 와 달리 서식 없이 다시 가져올 수 있는 형태. */
function importableText(value: CellValue | string | undefined): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object') return value.end ? `${value.start} → ${value.end}` : value.start;
  return String(value);
}

/**
 * 현재 뷰의 열(`title` 포함)과 행으로 CSV 용 문자열 배열을 만든다(첫 행은 헤더).
 * 값은 cellText 와 달리 **재가져오기 가능한 형태**: checkbox 는 true/false, 날짜 기간은 `시작 → 끝`,
 * 배열은 `, ` 로 join, number 는 숫자 그대로(stars·percent·currency 서식 없이). 빈 값은 빈 칸.
 */
export function rowsToCsvTable(
  schema: DbSchema,
  columns: string[],
  rows: { title: string; values: Record<string, CellValue> }[],
): string[][] {
  // schema 는 쓰지 않는다 — 서식 없이 값만 바꾸므로 속성 정의가 필요 없다(호출자 API 를 그대로 맞춘다).
  return [
    [...columns],
    ...rows.map((row) =>
      columns.map((col) => importableText(col === TITLE_PROP ? row.title : row.values[col])),
    ),
  ];
}
