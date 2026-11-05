import { t, type MessageKey } from '@nopsidian/i18n';
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

export const OP_KEYS: Record<FilterOp, MessageKey> = {
  '=': 'db.op.equals', '!=': 'db.op.notEquals', '>': 'db.op.gt', '>=': 'db.op.gte', '<': 'db.op.lt', '<=': 'db.op.lte',
  contains: 'db.op.contains', '!contains': 'db.op.notContains', startsWith: 'db.op.startsWith', endsWith: 'db.op.endsWith',
  empty: 'db.op.empty', '!empty': 'db.op.notEmpty', in: 'db.op.in',
};

/** 연산자 표시 이름. 연산자 값 자체는 저장·비교에 쓰이므로 바꾸지 않는다. */
export const opLabel = (op: FilterOp): string => t(OP_KEYS[op]);

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
