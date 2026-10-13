import { describe, expect, it } from 'vitest';
import type { FilterNode, FilterOp } from '@nopsidian/core/db';
import {
  MAX_DEPTH,
  addConditionTo,
  addGroupTo,
  canAddGroup,
  childrenOf,
  depthOf,
  getAt,
  groupKind,
  isCondition,
  isGroup,
  normalizeRoot,
  removeAt,
  setGroupKind,
  simplify,
  updateAt,
  type Condition,
  type Group,
} from './filter-tree';

const c = (prop: string, op: FilterOp = '=', value?: unknown): Condition => ({ prop, op, value });
const and = (...kids: FilterNode[]): Group => ({ and: kids });
const or = (...kids: FilterNode[]): Group => ({ or: kids });

/** 깊은 동결: 함수가 입력을 건드리면 strict mode 에서 바로 예외가 난다. */
function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object') {
    for (const x of Object.values(v as Record<string, unknown>)) deepFreeze(x);
    Object.freeze(v);
  }
  return v;
}

describe('판정·조회', () => {
  it('isGroup / isCondition', () => {
    expect(isGroup(and())).toBe(true);
    expect(isGroup(or(c('a')))).toBe(true);
    expect(isGroup(c('a'))).toBe(false);
    expect(isCondition(c('a'))).toBe(true);
    expect(isCondition(and())).toBe(false);
  });

  it('groupKind / childrenOf', () => {
    const a = and(c('a'), c('b'));
    expect(groupKind(a)).toBe('and');
    expect(childrenOf(a)).toEqual([c('a'), c('b')]);
    const o = or(c('z'));
    expect(groupKind(o)).toBe('or');
    expect(childrenOf(o)).toEqual([c('z')]);
  });

  it('depthOf: 조건·없음 = 0, 그룹은 1 + 자식 최대 깊이', () => {
    expect(depthOf(undefined)).toBe(0);
    expect(depthOf(c('a'))).toBe(0);
    expect(depthOf(and())).toBe(1);
    expect(depthOf(and(c('a'), or()))).toBe(2);
    expect(depthOf(and(c('a'), or(c('b'), and(c('d')))))).toBe(3);
    // 얕은 형제가 아니라 가장 깊은 가지만 센다
    expect(depthOf(and(or(and(c('deep'))), c('shallow')))).toBe(3);
  });
});

describe('normalizeRoot / simplify', () => {
  it('normalizeRoot: 없음 → 빈 AND, 조건 하나 → 담기, 그룹은 그대로', () => {
    expect(normalizeRoot(undefined)).toEqual({ and: [] });
    expect(normalizeRoot(c('a'))).toEqual({ and: [c('a')] });
    const g = or(c('a'));
    expect(normalizeRoot(g)).toBe(g);
  });

  it('simplify: 빈 그룹은 undefined, 조건 하나짜리 루트는 그룹 그대로', () => {
    expect(simplify(and())).toBeUndefined();
    expect(simplify(or())).toBeUndefined();
    expect(simplify(and(c('a')))).toEqual({ and: [c('a')] });
  });

  it('simplify: 재귀로 빈 안쪽 그룹을 지운다', () => {
    expect(simplify(and(c('a'), or(), and()))).toEqual({ and: [c('a')] });
    expect(simplify(or(c('a'), and(c('b'), or())))).toEqual({ or: [c('a'), { and: [c('b')] }] });
  });

  it('simplify: 안쪽 그룹은 자식이 하나여도 펼치지 않는다', () => {
    expect(simplify(and(or(c('a'))))).toEqual({ and: [{ or: [c('a')] }] });
    expect(simplify(or(and(c('a'), c('b'))))).toEqual({ or: [{ and: [c('a'), c('b')] }] });
  });

  it('simplify: 자식이 모두 사라진 안쪽 그룹도 함께 사라진다', () => {
    expect(simplify(and(and(or())))).toBeUndefined();
    expect(simplify(and(c('a'), and(or(), and())))).toEqual({ and: [c('a')] });
  });

  it('simplify 는 입력을 바꾸지 않는다', () => {
    const tree = deepFreeze(and(c('a'), or()));
    expect(simplify(tree)).toEqual({ and: [c('a')] });
    expect(tree).toEqual({ and: [c('a'), { or: [] }] });
  });

  it('normalizeRoot ∘ simplify 왕복', () => {
    expect(normalizeRoot(simplify(normalizeRoot(undefined)))).toEqual({ and: [] });
    expect(normalizeRoot(simplify(normalizeRoot(c('a'))))).toEqual({ and: [c('a')] });
    const g = or(and(c('a'), c('b')));
    expect(simplify(normalizeRoot(g))).toEqual(g);
  });
});

describe('getAt / updateAt / removeAt', () => {
  const tree = and(c('a0'), or(c('b0'), c('b1')), c('a2'));

  it('getAt: 빈 경로는 루트, 경로를 따라 내려간다', () => {
    expect(getAt(tree, [])).toEqual(tree);
    expect(getAt(tree, [1])).toEqual(or(c('b0'), c('b1')));
    expect(getAt(tree, [1, 1])).toEqual(c('b1'));
  });

  it('getAt: 잘못된 경로는 undefined', () => {
    expect(getAt(tree, [3])).toBeUndefined();
    expect(getAt(tree, [-1])).toBeUndefined();
    expect(getAt(tree, [1, 5])).toBeUndefined();
    expect(getAt(tree, [0, 0])).toBeUndefined(); // 조건 안으로는 못 내려간다
    expect(getAt(tree, [1.5])).toBeUndefined();
  });

  it('updateAt: 경로의 노드만 바꾸고 나머지 참조는 유지한다', () => {
    const next = updateAt(tree, [1, 1], c('z'));
    expect(getAt(next, [1, 1])).toEqual(c('z'));
    expect(getAt(next, [0])).toBe(getAt(tree, [0]));
    expect(next).not.toBe(tree);
    expect(tree).toEqual(and(c('a0'), or(c('b0'), c('b1')), c('a2')));
  });

  it('updateAt: 빈 경로는 그룹일 때만 루트를 바꾼다', () => {
    const g = or(c('x'));
    expect(updateAt(tree, [], g)).toBe(g);
    expect(updateAt(tree, [], c('x'))).toBe(tree);
  });

  it('updateAt: 잘못된 경로는 root 그대로', () => {
    expect(updateAt(tree, [9], c('z'))).toBe(tree);
    expect(updateAt(tree, [0, 0], c('z'))).toBe(tree);
  });

  it('removeAt: 루트의 자식·안쪽 자식을 지운다', () => {
    expect(removeAt(tree, [0])).toEqual(and(or(c('b0'), c('b1')), c('a2')));
    expect(removeAt(tree, [1, 0])).toEqual(and(c('a0'), or(c('b1')), c('a2')));
    expect(removeAt(tree, [1])).toEqual(and(c('a0'), c('a2')));
    expect(removeAt(tree, [1, 1, 0])).toBe(tree);
  });

  it('removeAt: 빈 경로·잘못된 경로는 root 그대로', () => {
    expect(removeAt(tree, [])).toBe(tree);
    expect(removeAt(tree, [7])).toBe(tree);
  });

  it('updateAt/removeAt 는 동결된 입력에서도 안전하다', () => {
    const frozen = deepFreeze(and(c('a'), or(c('b'), c('d'))));
    expect(updateAt(frozen, [1, 0], c('z'))).toEqual(and(c('a'), or(c('z'), c('d'))));
    expect(removeAt(frozen, [1, 1])).toEqual(and(c('a'), or(c('b'))));
  });
});

describe('addConditionTo / addGroupTo / setGroupKind', () => {
  const tree = and(c('a'), or(c('b')));

  it('addConditionTo: 루트·안쪽 그룹 끝에 붙인다(불변)', () => {
    expect(addConditionTo(tree, [], c('z'))).toEqual(and(c('a'), or(c('b')), c('z')));
    expect(addConditionTo(tree, [1], c('z'))).toEqual(and(c('a'), or(c('b'), c('z'))));
    expect(tree).toEqual(and(c('a'), or(c('b'))));
  });

  it('addConditionTo: 그룹이 아닌 경로·없는 경로는 root 그대로', () => {
    expect(addConditionTo(tree, [0], c('z'))).toBe(tree);
    expect(addConditionTo(tree, [9], c('z'))).toBe(tree);
  });

  it('addGroupTo: 빈 그룹을 붙인다', () => {
    expect(addGroupTo(tree, [], 'or')).toEqual(and(c('a'), or(c('b')), { or: [] }));
    const g = and(or(c('b')));
    expect(addGroupTo(g, [0], 'and')).toEqual(and(or(c('b'), { and: [] })));
  });

  it('addGroupTo: MAX_DEPTH 를 넘으면 root 그대로', () => {
    expect(MAX_DEPTH).toBe(3);
    expect(canAddGroup(tree, [])).toBe(true); // 루트 깊이 1 → 새 그룹 깊이 2
    expect(canAddGroup(tree, [1])).toBe(true); // 깊이 2 안쪽 → 새 그룹 깊이 3
    expect(canAddGroup(tree, [0])).toBe(false); // 조건은 그룹이 아니다
    expect(canAddGroup(tree, [9])).toBe(false);

    const deep = and(or(and(c('x')))); // 루트(1) → or(2) → and(3)
    expect(canAddGroup(deep, [0, 0])).toBe(false);
    expect(addGroupTo(deep, [0, 0], 'or')).toBe(deep);
    expect(addGroupTo(deep, [0], 'or')).toEqual(and(or(and(c('x')), { or: [] })));
  });

  it('setGroupKind: 자식을 유지한 채 결합 방식만 바꾼다', () => {
    expect(setGroupKind(tree, [], 'or')).toEqual(or(c('a'), or(c('b'))));
    expect(setGroupKind(tree, [1], 'and')).toEqual(and(c('a'), and(c('b'))));
    expect(setGroupKind(tree, [0], 'or')).toBe(tree); // 조건은 그룹이 아니다
    expect(setGroupKind(tree, [9], 'or')).toBe(tree);
    expect(tree).toEqual(and(c('a'), or(c('b'))));
  });

  it('추가·변경도 동결된 입력에서 안전하다', () => {
    const frozen = deepFreeze(and(or(c('b'))));
    expect(addConditionTo(frozen, [0], c('z'))).toEqual(and(or(c('b'), c('z'))));
    expect(addGroupTo(frozen, [0], 'and')).toEqual(and(or(c('b'), { and: [] })));
    expect(setGroupKind(frozen, [0], 'and')).toEqual(and(and(c('b'))));
  });
});
