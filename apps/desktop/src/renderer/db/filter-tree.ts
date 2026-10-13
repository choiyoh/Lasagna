import type { FilterNode, FilterOp } from '@nopsidian/core/db';

/**
 * 중첩 AND/OR 필터 트리의 불변 갱신 도우미(순수 함수, React 없음).
 * 노드 위치는 **경로**(`number[]`)로 가리킨다 — 루트 그룹의 자식 인덱스부터 차례로 내려간다.
 * 예: `[]` = 루트 그룹, `[1]` = 루트의 두 번째 자식, `[1, 0]` = 그 자식의 첫 자식.
 * 모든 함수는 입력을 바꾸지 않고 새 객체를 돌려주며, 잘못된 경로는 root 를 그대로 돌려준다(예외 없음).
 */

/** AND/OR 그룹. 루트도 그룹이다(깊이 1). */
export type Group = { and: FilterNode[] } | { or: FilterNode[] };
export type Condition = { prop: string; op: FilterOp; value?: unknown };

/** 루트 그룹이 깊이 1. 조건은 깊이 0. */
export const MAX_DEPTH = 3;

export const isGroup = (n: FilterNode): n is Group => 'and' in n || 'or' in n;
export const isCondition = (n: FilterNode): n is Condition => !isGroup(n);

export function groupKind(g: Group): 'and' | 'or' {
  return 'and' in g ? 'and' : 'or';
}

export function childrenOf(g: Group): FilterNode[] {
  return 'and' in g ? g.and : g.or;
}

/** 같은 종류의 그룹을 만들면서 자식만 바꾼다. */
function withChildren(g: Group, kids: FilterNode[]): Group {
  return 'and' in g ? { and: kids } : { or: kids };
}

/** 조건·없음 = 0, 그룹 = 1 + 자식 최대 깊이 */
export function depthOf(n: FilterNode | undefined): number {
  if (!n || !isGroup(n)) return 0;
  let deepest = 0;
  for (const c of childrenOf(n)) deepest = Math.max(deepest, depthOf(c));
  return deepest + 1;
}

/** undefined → 빈 AND 그룹, 조건 하나 → 그 그룹에 담기, 그룹은 그대로 */
export function normalizeRoot(f: FilterNode | undefined): Group {
  if (!f) return { and: [] };
  return isGroup(f) ? f : { and: [f] };
}

/**
 * 저장용 정리: 비어 있는 그룹을 재귀로 제거하고, 남는 게 없으면 undefined.
 * 자식이 조건 하나뿐인 **안쪽** 그룹은 펼치지 않는다(사용자가 만든 구조를 유지).
 * 루트는 자식이 하나뿐이어도 그룹 그대로 둔다.
 */
export function simplify(g: Group): FilterNode | undefined {
  const kids: FilterNode[] = [];
  for (const child of childrenOf(g)) {
    const next = isGroup(child) ? simplify(child) : child;
    if (next !== undefined) kids.push(next);
  }
  return kids.length ? withChildren(g, kids) : undefined;
}

/** 경로를 따라 내려간 노드. 잘못된 경로면 undefined. */
export function getAt(root: Group, path: number[]): FilterNode | undefined {
  let cur: FilterNode = root;
  for (const i of path) {
    if (!isGroup(cur)) return undefined;
    const kids = childrenOf(cur);
    if (!Number.isInteger(i) || i < 0 || i >= kids.length) return undefined;
    cur = kids[i]!;
  }
  return cur;
}

/** 경로 위치가 그룹이면 그 그룹, 아니면(없거나 조건) undefined */
function groupAt(root: Group, path: number[]): Group | undefined {
  const n = getAt(root, path);
  return n && isGroup(n) ? n : undefined;
}

/** 경로가 가리키는 노드를 `next` 로 바꾼 새 그룹(경로는 이미 검증됐다고 가정) */
function rebuild(node: Group, path: number[], at: number, next: FilterNode): Group {
  const i = path[at]!;
  const kids = childrenOf(node);
  // 마지막이 아니면 경로 중간은 반드시 그룹이다(호출 전에 검증한다).
  const replaced = at + 1 === path.length ? next : rebuild(kids[i] as Group, path, at + 1, next);
  return withChildren(node, kids.map((c, j) => (j === i ? replaced : c)));
}

/** 경로가 가리키는 노드를 부모의 자식 목록에서 지운 새 그룹(경로는 이미 검증됐다고 가정) */
function dropAt(node: Group, path: number[], at: number): Group {
  const i = path[at]!;
  const kids = childrenOf(node);
  if (at + 1 === path.length) return withChildren(node, kids.filter((_, j) => j !== i));
  const child = kids[i] as Group;
  return withChildren(node, kids.map((c, j) => (j === i ? dropAt(child, path, at + 1) : c)));
}

/** 경로 위치의 노드를 바꾼다. 빈 경로는 그룹을 넘길 때만 루트 교체로 본다. */
export function updateAt(root: Group, path: number[], next: FilterNode): Group {
  if (path.length === 0) return isGroup(next) ? next : root;
  if (getAt(root, path) === undefined) return root;
  return rebuild(root, path, 0, next);
}

/** 경로 위치의 노드를 지운다. 루트는 지울 수 없다(빈 경로는 그대로 돌려준다). */
export function removeAt(root: Group, path: number[]): Group {
  if (path.length === 0 || getAt(root, path) === undefined) return root;
  return dropAt(root, path, 0);
}

/** 그룹의 자식 끝에 조건을 붙인다. */
export function addConditionTo(root: Group, groupPath: number[], cond: Condition): Group {
  const g = groupAt(root, groupPath);
  if (!g) return root;
  return updateAt(root, groupPath, withChildren(g, [...childrenOf(g), cond]));
}

/** 그룹을 하나 더 만들 수 있는가(경로가 그룹이고 깊이 제한을 넘지 않을 때) */
export function canAddGroup(root: Group, groupPath: number[]): boolean {
  return groupAt(root, groupPath) !== undefined && groupPath.length + 2 <= MAX_DEPTH;
}

/** 그룹의 자식 끝에 빈 그룹을 붙인다. 깊이 제한을 넘으면 root 를 그대로 돌려준다. */
export function addGroupTo(root: Group, groupPath: number[], kind: 'and' | 'or'): Group {
  const g = groupAt(root, groupPath);
  if (!g || groupPath.length + 2 > MAX_DEPTH) return root;
  const fresh: Group = kind === 'and' ? { and: [] } : { or: [] };
  return updateAt(root, groupPath, withChildren(g, [...childrenOf(g), fresh]));
}

/** 그룹의 결합 방식만 바꾼다(자식 유지). */
export function setGroupKind(root: Group, groupPath: number[], kind: 'and' | 'or'): Group {
  const g = groupAt(root, groupPath);
  if (!g) return root;
  const kids = childrenOf(g);
  return updateAt(root, groupPath, kind === 'and' ? { and: kids } : { or: kids });
}
