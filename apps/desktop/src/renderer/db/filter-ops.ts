import type { FilterOp, Property } from '@nopsidian/core/db';

/**
 * 필터 편집 UI 가 쓰는 연산자 목록·라벨·속성 종류 판정.
 * ViewToolbar 의 평면 필터에서 그대로 옮겨 왔다(중첩 편집기도 같은 규칙을 쓴다).
 */
export const OPS_BY_KIND: Record<string, FilterOp[]> = {
  text: ['contains', '!contains', '=', '!=', 'startsWith', 'endsWith', 'empty', '!empty'],
  number: ['=', '!=', '>', '>=', '<', '<=', 'empty', '!empty'],
  select: ['=', '!=', 'empty', '!empty'],
  list: ['contains', '!contains', 'empty', '!empty'],
  date: ['=', '<', '<=', '>', '>=', 'empty', '!empty'],
  checkbox: ['=', '!='],
};

export const OP_LABEL: Record<FilterOp, string> = {
  '=': '같음', '!=': '다름', '>': '초과', '>=': '이상', '<': '미만', '<=': '이하', contains: '포함', '!contains': '포함 안 함',
  startsWith: '시작', endsWith: '끝', empty: '비어 있음', '!empty': '비어 있지 않음', in: '중 하나',
};

/** 속성 종류 → 연산자 목록 키. 속성이 없으면(제목) 텍스트로 본다. */
export const kindOf = (p: Property | undefined): keyof typeof OPS_BY_KIND => {
  if (!p) return 'text';
  if (p.type === 'number' || p.type === 'unique_id') return 'number';
  if (p.type === 'select' || p.type === 'status') return 'select';
  if (p.type === 'multi_select' || p.type === 'files' || p.type === 'relation') return 'list';
  if (p.type === 'date' || p.type === 'created_time' || p.type === 'updated_time') return 'date';
  if (p.type === 'checkbox') return 'checkbox';
  return 'text';
};

/** 그 종류의 첫 연산자(속성을 바꿨을 때 기본값) */
export function defaultOp(p: Property | undefined): FilterOp {
  return OPS_BY_KIND[kindOf(p)]![0]!;
}

/** 값 입력이 필요한 연산자인가(비어 있음/비어 있지 않음은 값이 없다) */
export function needsValue(op: FilterOp): boolean {
  return op !== 'empty' && op !== '!empty';
}
