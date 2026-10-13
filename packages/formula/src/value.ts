/**
 * 수식이 다루는 값. 노트의 속성 값(`CellValue`)과 따로 둔다 — 경계(`prop()` 를 채우는 쪽)가 변환한다.
 *
 * 날짜는 에포크 밀리초(UTC)와 "시각을 가졌는지"를 함께 든다. 달력 연산(년·월·일·요일)은 **로컬 시간대**로 한다.
 */
export interface FDate {
  kind: 'date';
  ms: number;
  /** false 면 날짜만(하루 단위) */
  hasTime: boolean;
  /** 기간의 끝(없으면 한 시점) */
  endMs?: number;
}

export type FValue = null | number | string | boolean | FDate | FValue[];

export type FType = 'null' | 'number' | 'string' | 'boolean' | 'date' | 'list';

/** 수식 오류. `pos`/`end` 는 원문 안의 위치(문자 오프셋, end 는 배타). 평가 중 오류는 위치가 없을 수 있다. */
export class FormulaError extends Error {
  constructor(
    message: string,
    public readonly pos?: number,
    public readonly end?: number,
  ) {
    super(message);
    this.name = 'FormulaError';
  }
}

export const isDate = (v: FValue): v is FDate => v !== null && typeof v === 'object' && !Array.isArray(v) && v.kind === 'date';

export function typeOf(v: FValue): FType {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'list';
  if (typeof v === 'object') return 'date';
  return typeof v as 'number' | 'string' | 'boolean';
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** 날짜 → `YYYY-MM-DD` 또는 `YYYY-MM-DDTHH:mm`(로컬 시간대) */
export function formatDateIso(d: FDate, which: 'start' | 'end' = 'start'): string {
  const t = new Date(which === 'end' && d.endMs !== undefined ? d.endMs : d.ms);
  const day = `${pad(t.getFullYear(), 4)}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
  return d.hasTime ? `${day}T${pad(t.getHours())}:${pad(t.getMinutes())}` : day;
}

/** 문자열로 이어 붙일 때의 표기 */
export function toDisplayString(v: FValue): string {
  if (v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(15)));
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.map(toDisplayString).join(', ');
  return d2s(v);
}
function d2s(d: FDate): string {
  return d.endMs !== undefined ? `${formatDateIso(d)} → ${formatDateIso(d, 'end')}` : formatDateIso(d);
}

/** 값 동등(리스트는 원소별, 날짜는 시작 시각 기준) */
export function valuesEqual(a: FValue, b: FValue): boolean {
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => valuesEqual(x, b[i]!));
  }
  if (isDate(a) || isDate(b)) return isDate(a) && isDate(b) && a.ms === b.ms && a.endMs === b.endMs;
  return a === b;
}

/** 정렬용 비교. 같은 타입끼리만 의미가 있고, null 은 항상 뒤. 다른 타입이면 타입 이름 순. */
export function compareValues(a: FValue, b: FValue): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  const ta = typeOf(a);
  const tb = typeOf(b);
  if (ta !== tb) return ta < tb ? -1 : 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b, 'ko', { numeric: true });
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  if (isDate(a) && isDate(b)) return a.ms - b.ms;
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const c = compareValues(a[i]!, b[i]!);
      if (c !== 0) return c;
    }
    return a.length - b.length;
  }
  return 0;
}

export const num = (v: number): FValue => v;
