import type { JSX } from 'react';
import type { FilterNode, FilterOp, Property } from '@nopsidian/core/db';
import { optionsOf } from '@nopsidian/core/db/values';
import { TITLE, type DbSchema } from './types';
import { OP_LABEL, OPS_BY_KIND, defaultOp, kindOf, needsValue } from './filter-ops';
import {
  type Condition,
  type Group,
  addConditionTo,
  addGroupTo,
  canAddGroup,
  childrenOf,
  getAt,
  groupKind,
  isGroup,
  normalizeRoot,
  removeAt,
  setGroupKind,
  simplify,
  updateAt,
} from './filter-tree';

export interface FilterBuilderProps {
  schema: DbSchema;
  value: FilterNode | undefined;
  /** simplify 한 결과를 올려보낸다. 빈 트리는 undefined. */
  onChange: (next: FilterNode | undefined) => void;
}

const GROUP_LIMIT_TITLE = '조건 그룹은 3단계까지만 만들 수 있어요';

/** 새 조건의 기본값: 제목 contains '' (ViewToolbar 의 "+ 조건 추가" 와 같다) */
const newCondition = (): Condition => ({ prop: TITLE, op: defaultOp(undefined), value: '' });

interface GroupProps {
  root: Group;
  /** 이 그룹의 위치(루트는 `[]`) */
  path: number[];
  names: string[];
  def: (name: string) => Property | undefined;
  emit: (next: Group) => void;
  onClear: () => void;
}

interface RowProps {
  root: Group;
  path: number[];
  names: string[];
  def: (name: string) => Property | undefined;
  emit: (next: Group) => void;
}

/** 속성 파일(제목은 스키마에 없는 예약 속성) 조회 */
const defOf = (schema: DbSchema) => (name: string): Property | undefined => (name === TITLE ? undefined : schema.properties[name]);

/** 조건 한 줄: 속성 · 연산자 · 값 · 삭제 */
function ConditionRow({ root, path, cond, names, def, emit }: RowProps & { cond: Condition }) {
  const kind = kindOf(def(cond.prop));
  const ops = OPS_BY_KIND[kind]!;
  const opts = optionsOf(def(cond.prop));
  const set = (patch: Partial<Condition>) => emit(updateAt(root, path, { ...cond, ...patch }));
  return (
    <div className="dbpop__row">
      <select
        value={cond.prop}
        onChange={(e) => emit(updateAt(root, path, { prop: e.target.value, op: defaultOp(def(e.target.value)), value: undefined }))}
        aria-label="속성"
      >
        {names.map((n) => (
          <option key={n} value={n}>{n === TITLE ? '제목' : n}</option>
        ))}
      </select>
      <select value={cond.op} onChange={(e) => set({ op: e.target.value as FilterOp })} aria-label="조건">
        {ops.map((o) => (
          <option key={o} value={o}>{OP_LABEL[o]}</option>
        ))}
      </select>
      {needsValue(cond.op) &&
        (kind === 'checkbox' ? (
          <select value={String(cond.value ?? true)} onChange={(e) => set({ value: e.target.value === 'true' })} aria-label="값">
            <option value="true">체크됨</option>
            <option value="false">체크 안 됨</option>
          </select>
        ) : (kind === 'select' || kind === 'list') && opts.length ? (
          <select value={String(cond.value ?? '')} onChange={(e) => set({ value: e.target.value })} aria-label="값">
            <option value="" />
            {opts.map((o) => (
              <option key={o.name}>{o.name}</option>
            ))}
          </select>
        ) : (
          <input
            value={String(cond.value ?? '')}
            placeholder={kind === 'date' ? 'YYYY-MM-DD, today, +7d' : '값'}
            onChange={(e) => set({
              value: kind === 'number' && e.target.value !== '' && !Number.isNaN(Number(e.target.value)) ? Number(e.target.value) : e.target.value,
            })}
            aria-label="값"
          />
        ))}
      <button onClick={() => emit(removeAt(root, path))} aria-label="조건 삭제">×</button>
    </div>
  );
}

/** 그룹 하나: 머리(결합 방식·삭제) + 자식(조건·하위 그룹) + 추가 버튼 */
function GroupEditor({ root, path, names, def, emit, onClear }: GroupProps) {
  const g = getAt(root, path) as Group; // 렌더 트리에서 경로는 항상 그룹을 가리킨다
  const canAdd = canAddGroup(root, path);
  /**
   * 새 그룹은 기본 조건 하나와 함께 만든다 — 빈 그룹은 `simplify` 가 즉시 지워서
   * 화면에 나타나지 않기 때문이다(그 뒤 조건을 지우면 그룹도 함께 사라진다).
   */
  const addGroup = () => {
    const withGroup = addGroupTo(root, path, 'and');
    if (withGroup === root) return; // 깊이 제한
    const outer = getAt(withGroup, path) as Group;
    emit(addConditionTo(withGroup, [...path, childrenOf(outer).length - 1], newCondition()));
  };
  return (
    <div className={path.length === 0 ? 'filterb__group filterb__group--root' : 'filterb__group'}>
      <div className="filterb__head">
        <select value={groupKind(g)} onChange={(e) => emit(setGroupKind(root, path, e.target.value as 'and' | 'or'))} aria-label="조건 결합">
          <option value="and">모든 조건에 맞음</option>
          <option value="or">하나라도 맞음</option>
        </select>
        {path.length === 0 ? (
          <button onClick={onClear}>모두 지우기</button>
        ) : (
          <button onClick={() => emit(removeAt(root, path))} aria-label="그룹 삭제">×</button>
        )}
      </div>
      <div className="filterb__children">
        {childrenOf(g).map((child, i) =>
          isGroup(child) ? (
            <GroupEditor key={`${path.join('.')}#${i}`} root={root} path={[...path, i]} names={names} def={def} emit={emit} onClear={onClear} />
          ) : (
            <ConditionRow key={`${path.join('.')}#${i}`} root={root} path={[...path, i]} cond={child} names={names} def={def} emit={emit} />
          ),
        )}
      </div>
      <div className="dbpop__actions">
        <button onClick={() => emit(addConditionTo(root, path, newCondition()))}>+ 조건 추가</button>
        <button disabled={!canAdd} title={canAdd ? undefined : GROUP_LIMIT_TITLE} onClick={addGroup}>+ 그룹 추가</button>
      </div>
    </div>
  );
}

/**
 * 중첩 AND/OR 필터 편집기(제어 컴포넌트).
 * 루트 그룹부터 재귀로 그리며, 바뀔 때마다 `onChange(simplify(새 트리))` 를 올려보낸다.
 * 값이 비어 있는 조건도 그대로 저장한다(평가 쪽이 처리하므로 막지 않는다).
 */
export function FilterBuilder({ schema, value, onChange }: FilterBuilderProps): JSX.Element {
  const root = normalizeRoot(value);
  const names = [TITLE, ...Object.keys(schema.properties)];
  const def = defOf(schema);
  const emit = (next: Group) => onChange(simplify(next));
  return (
    <div className="filterb">
      <GroupEditor root={root} path={[]} names={names} def={def} emit={emit} onClear={() => onChange(undefined)} />
    </div>
  );
}
