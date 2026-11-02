import { evalFilter, type DbRow, type DbSchema, type FilterNode, type FilterOp } from '@nopsidian/core/db';
import { OP_LABEL, needsValue } from './filter-ops';
import { type Condition, childrenOf, groupKind, isCondition, normalizeRoot, removeAt, simplify } from './filter-tree';
import { TITLE } from './types';

const OP_SYMBOL: Record<FilterOp, string> = {
  '=': '=',
  '!=': '≠',
  '>': '>',
  '>=': '≥',
  '<': '<',
  '<=': '≤',
  contains: '포함',
  '!contains': '포함 안 함',
  startsWith: '시작',
  endsWith: '끝',
  empty: '비어 있음',
  '!empty': '비어 있지 않음',
  in: '중 하나',
};

const valueText = (value: unknown): string => {
  if (Array.isArray(value)) return value.map(String).join(', ');
  if (typeof value === 'boolean') return value ? '체크됨' : '체크 안 됨';
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'object') {
    const start = (value as { start?: unknown }).start;
    return typeof start === 'string' ? start : '';
  }
  return String(value);
};

/** UI 에 보여 줄 조건 한 줄. 예: `상태 = 완료`, `제목 포함 디자인` */
export function conditionLabel(cond: Condition): string {
  const name = cond.prop === TITLE ? '제목' : cond.prop;
  const value = needsValue(cond.op) ? valueText(cond.value) : '';
  return `${name} ${OP_SYMBOL[cond.op] ?? OP_LABEL[cond.op]}${value ? ` ${value}` : ''}`;
}

export interface FilterRemovalSuggestion {
  label: string;
  count: number;
  /** 이 조건을 뺀 필터. 모두 지우면 undefined */
  filter: FilterNode | undefined;
}

/**
 * 루트가 AND 일 때만 "이 조건을 빼면 몇 행이 남는지"를 계산한다.
 * OR 루트에서는 조건을 빼면 결과가 줄어들 수 있어 제안하지 않는다.
 * 조건은 루트 직속만, count 0 은 제외, count 내림차순 최대 3개.
 */
export function suggestFilterRemovals(schema: DbSchema, filter: FilterNode | undefined, rows: DbRow[], now = new Date()): FilterRemovalSuggestion[] {
  if (!filter) return [];
  const root = normalizeRoot(filter);
  if (groupKind(root) !== 'and') return [];
  const direct = childrenOf(root)
    .map((node, index) => ({ node, index }))
    .filter(({ node }) => isCondition(node));
  if (direct.length === 0) return [];

  const out: FilterRemovalSuggestion[] = [];
  for (const { node, index } of direct) {
    const next = simplify(removeAt(root, [index]));
    const count = rows.reduce((n, row) => n + (evalFilter(schema, next, row, now) ? 1 : 0), 0);
    if (count > 0) out.push({ label: conditionLabel(node as Condition), count, filter: next });
  }
  return out.sort((a, b) => b.count - a.count).slice(0, 3);
}
