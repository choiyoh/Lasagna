import type { CellValue } from './types';

/**
 * 회차 DB 수정일 열: 원문 ISO 대신 사람이 읽는 `YYYY-MM-DD HH:mm`(기기 로컬)로 보여 준다.
 * 날짜로 읽을 수 없으면 원문을 그대로 둔다(값을 잃지 않는다).
 */
export function formatUpdatedAt(value: string): string {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** goal_met 자동 열인가(다른 수식 열은 건드리지 않는다). */
export function isGoalMetFormula(expr: string | undefined): boolean {
  return !!expr && /\bgoal_met\s*\(\s*\)/.test(expr);
}

export type GoalMetState = 'none' | 'miss' | 'met';

/** goal_met 3상태: 값이 없으면 목표 없음(null)이다. */
export function goalMetState(value: CellValue): GoalMetState {
  if (value === true) return 'met';
  if (value === false) return 'miss';
  return 'none';
}
