import { optionsOf } from '@nopsidian/core/db/values';
import type { CellValue, Property } from './types';

/** 회차 DB 상태 그룹의 표시 색(시안: 초고=회색·퇴고=주황·완료=초록). 파일에는 쓰지 않는다. */
const STATUS_GROUP_COLOR: Record<'todo' | 'doing' | 'done', string> = { todo: 'gray', doing: 'orange', done: 'green' };

/**
 * 회차 DB 상태 칩 색 — 옵션에 색이 없으면 그룹으로 고른다.
 * `_db.yaml` 에 색을 새로 쓰지 않고 화면에서만 입힌다(기존·일반 DB 불변).
 */
export function episodeStatusColor(prop: Property | undefined, value: string): string | undefined {
  if (prop?.type !== 'status') return undefined;
  const option = optionsOf(prop).find((o) => o.name === value);
  if (option?.color) return option.color;
  return option?.group ? STATUS_GROUP_COLOR[option.group] : undefined;
}

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
