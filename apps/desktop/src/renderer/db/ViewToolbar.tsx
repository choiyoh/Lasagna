import { useState } from 'react';
import type { FilterNode, FilterOp, Property, View } from '@nopsidian/core/db';
import { optionsOf } from '@nopsidian/core/db/values';
import { TITLE, type DbData } from './types';

type Cond = { prop: string; op: FilterOp; value?: unknown };

const OPS_BY_KIND: Record<string, FilterOp[]> = {
  text: ['contains', '!contains', '=', '!=', 'startsWith', 'endsWith', 'empty', '!empty'],
  number: ['=', '!=', '>', '>=', '<', '<=', 'empty', '!empty'],
  select: ['=', '!=', 'empty', '!empty'],
  list: ['contains', '!contains', 'empty', '!empty'],
  date: ['=', '<', '<=', '>', '>=', 'empty', '!empty'],
  checkbox: ['=', '!='],
};
const OP_LABEL: Record<FilterOp, string> = {
  '=': '같음', '!=': '다름', '>': '초과', '>=': '이상', '<': '미만', '<=': '이하', contains: '포함', '!contains': '포함 안 함',
  startsWith: '시작', endsWith: '끝', empty: '비어 있음', '!empty': '비어 있지 않음', in: '중 하나',
};

const kindOf = (p: Property | undefined): keyof typeof OPS_BY_KIND => {
  if (!p) return 'text';
  if (p.type === 'number' || p.type === 'unique_id') return 'number';
  if (p.type === 'select' || p.type === 'status') return 'select';
  if (p.type === 'multi_select' || p.type === 'files' || p.type === 'relation') return 'list';
  if (p.type === 'date' || p.type === 'created_time' || p.type === 'updated_time') return 'date';
  if (p.type === 'checkbox') return 'checkbox';
  return 'text';
};

/** 단순 필터: 조건들의 AND 목록. 중첩·OR 이 있으면 편집하지 않고 알려 준다. */
export function flatConditions(f: FilterNode | undefined): Cond[] | null {
  if (!f) return [];
  if ('prop' in f) return [f];
  if ('and' in f && f.and.every((c) => 'prop' in c)) return f.and as Cond[];
  if ('or' in f && f.or.every((c) => 'prop' in c)) return f.or as Cond[];
  return null;
}
/** 조건 목록의 결합 방식: `or` 로 저장돼 있으면 'or' */
const modeOf = (f: FilterNode | undefined): 'and' | 'or' => (f && 'or' in f ? 'or' : 'and');
const toFilter = (conds: Cond[], mode: 'and' | 'or' = 'and'): FilterNode | undefined => (conds.length ? (mode === 'or' ? { or: conds } : { and: conds }) : undefined);

interface Props {
  data: DbData;
  view: View;
  dirty: boolean;
  onChange: (v: View) => void;
  onSave: () => void;
  onReset: () => void;
}

const VIEW_TYPES: { type: View['type']; label: string }[] = [
  { type: 'table', label: '표' }, { type: 'board', label: '보드' }, { type: 'list', label: '목록' }, { type: 'gallery', label: '갤러리' }, { type: 'calendar', label: '캘린더' }, { type: 'timeline', label: '타임라인' },
];

/** 필터·정렬·그룹·표시 속성 조절 막대. 바꾸면 저장 전의 임시 뷰가 되고, "보기 저장"으로 `_db.yaml` 에 쓴다. */
export function ViewToolbar({ data, view, dirty, onChange, onSave, onReset }: Props) {
  const [open, setOpen] = useState<'filter' | 'sort' | 'group' | 'cols' | null>(null);
  const props = [TITLE, ...Object.keys(data.schema.properties)];
  const conds = flatConditions(view.filter);
  const toggle = (k: NonNullable<typeof open>) => setOpen(open === k ? null : k);
  const mode = modeOf(view.filter);
  const setConds = (next: Cond[], m: 'and' | 'or' = mode) => onChange({ ...view, filter: toFilter(next, m) });
  const dateProps = Object.entries(data.schema.properties).filter(([, p]) => p.type === 'date' || p.type === 'created_time' || p.type === 'updated_time').map(([n]) => n);
  const sorts = view.sort;
  const groupable = props.filter((p) => p !== TITLE);
  const cols = view.columns ?? props;

  return (
    <div className="dbtoolbar" role="toolbar" aria-label="보기 설정">
      <label className="dbtoolbar__type">
        <span className="muted small">보기 형태</span>
        <select value={view.type} onChange={(e) => onChange({ ...view, type: e.target.value as View['type'] })} aria-label="보기 형태">
          {VIEW_TYPES.map((t) => (
            <option key={t.type} value={t.type}>{t.label}</option>
          ))}
        </select>
      </label>

      {(view.type === 'calendar' || view.type === 'timeline') && (
        <label className="dbtoolbar__type">
          <span className="muted small">날짜 속성</span>
          <select value={view.dateProp ?? dateProps[0] ?? ''} onChange={(e) => onChange({ ...view, dateProp: e.target.value || undefined })} aria-label="날짜 속성">
            {dateProps.length === 0 && <option value="">(날짜 속성 없음)</option>}
            {dateProps.map((p) => <option key={p}>{p}</option>)}
          </select>
        </label>
      )}
      <button className={view.filter ? 'on' : ''} onClick={() => toggle('filter')} aria-expanded={open === 'filter'}>
        필터{conds && conds.length ? ` ${conds.length}` : ''}
      </button>
      <button className={sorts.length ? 'on' : ''} onClick={() => toggle('sort')} aria-expanded={open === 'sort'}>
        정렬{sorts.length ? ` ${sorts.length}` : ''}
      </button>
      <button className={view.groupBy ? 'on' : ''} onClick={() => toggle('group')} aria-expanded={open === 'group'}>
        그룹{view.groupBy ? `: ${view.groupBy}` : ''}
      </button>
      <button onClick={() => toggle('cols')} aria-expanded={open === 'cols'}>속성 표시</button>
      {dirty && (
        <span className="dbtoolbar__dirty">
          <button className="primary" onClick={onSave}>보기 저장</button>
          <button onClick={onReset}>되돌리기</button>
        </span>
      )}

      {open === 'filter' && (
        <div className="dbpop" role="dialog" aria-label="필터">
          {conds === null ? (
            <p className="muted small">OR·중첩 조건은 <code>_db.yaml</code> 에서 편집해 주세요. 아래 버튼으로 지울 수 있어요.</p>
          ) : (
            <>
              {conds.length > 1 && (
                <label className="small">
                  <select value={mode} onChange={(e) => setConds(conds, e.target.value as 'and' | 'or')} aria-label="조건 결합">
                    <option value="and">모든 조건을 만족</option>
                    <option value="or">하나라도 만족</option>
                  </select>
                </label>
              )}
            {conds.map((c, i) => {
              const def = c.prop === TITLE ? undefined : data.schema.properties[c.prop];
              const kind = kindOf(def);
              const ops = OPS_BY_KIND[kind]!;
              const needsValue = c.op !== 'empty' && c.op !== '!empty';
              const opts = optionsOf(def);
              return (
                <div key={i} className="dbpop__row">
                  <select value={c.prop} onChange={(e) => setConds(conds.map((x, j) => (j === i ? { prop: e.target.value, op: OPS_BY_KIND[kindOf(e.target.value === TITLE ? undefined : data.schema.properties[e.target.value])]![0]!, value: undefined } : x)))} aria-label="속성">
                    {props.map((p) => (
                      <option key={p} value={p}>{p === TITLE ? '제목' : p}</option>
                    ))}
                  </select>
                  <select value={c.op} onChange={(e) => setConds(conds.map((x, j) => (j === i ? { ...x, op: e.target.value as FilterOp } : x)))} aria-label="조건">
                    {ops.map((o) => (
                      <option key={o} value={o}>{OP_LABEL[o]}</option>
                    ))}
                  </select>
                  {needsValue &&
                    (kind === 'checkbox' ? (
                      <select value={String(c.value ?? true)} onChange={(e) => setConds(conds.map((x, j) => (j === i ? { ...x, value: e.target.value === 'true' } : x)))} aria-label="값">
                        <option value="true">체크됨</option>
                        <option value="false">체크 안 됨</option>
                      </select>
                    ) : (kind === 'select' || kind === 'list') && opts.length ? (
                      <select value={String(c.value ?? '')} onChange={(e) => setConds(conds.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} aria-label="값">
                        <option value="" />
                        {opts.map((o) => (
                          <option key={o.name}>{o.name}</option>
                        ))}
                      </select>
                    ) : (
                      <input value={String(c.value ?? '')} placeholder={kind === 'date' ? 'YYYY-MM-DD, today, +7d' : '값'} onChange={(e) => setConds(conds.map((x, j) => (j === i ? { ...x, value: kind === 'number' && e.target.value !== '' && !Number.isNaN(Number(e.target.value)) ? Number(e.target.value) : e.target.value } : x)))} aria-label="값" />
                    ))}
                  <button onClick={() => setConds(conds.filter((_, j) => j !== i))} aria-label="조건 삭제">×</button>
                </div>
              );
            })}
            </>
          )}
          <div className="dbpop__actions">
            {conds !== null && (
              <button onClick={() => setConds([...conds, { prop: props[0]!, op: 'contains', value: '' }])}>+ 조건 추가</button>
            )}
            {(conds === null || conds.length > 0) && <button onClick={() => onChange({ ...view, filter: undefined })}>모두 지우기</button>}
          </div>
        </div>
      )}

      {open === 'sort' && (
        <div className="dbpop" role="dialog" aria-label="정렬">
          {sorts.map((s, i) => (
            <div key={i} className="dbpop__row">
              <select value={s.prop} onChange={(e) => onChange({ ...view, sort: sorts.map((x, j) => (j === i ? { ...x, prop: e.target.value } : x)) })} aria-label="정렬 속성">
                {props.map((p) => (
                  <option key={p} value={p}>{p === TITLE ? '제목' : p}</option>
                ))}
              </select>
              <select value={s.dir} onChange={(e) => onChange({ ...view, sort: sorts.map((x, j) => (j === i ? { ...x, dir: e.target.value as 'asc' | 'desc' } : x)) })} aria-label="정렬 방향">
                <option value="asc">오름차순</option>
                <option value="desc">내림차순</option>
              </select>
              <button onClick={() => onChange({ ...view, sort: sorts.filter((_, j) => j !== i) })} aria-label="정렬 삭제">×</button>
            </div>
          ))}
          <div className="dbpop__actions">
            <button onClick={() => onChange({ ...view, sort: [...sorts, { prop: props[0]!, dir: 'asc' }] })}>+ 정렬 추가</button>
          </div>
        </div>
      )}

      {open === 'group' && (
        <div className="dbpop" role="dialog" aria-label="그룹">
          <select value={view.groupBy ?? ''} onChange={(e) => { onChange({ ...view, groupBy: e.target.value || undefined, subGroupBy: undefined }); setOpen(null); }} aria-label="그룹 속성">
            <option value="">그룹 없음</option>
            {groupable.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </div>
      )}

      {open === 'cols' && (
        <div className="dbpop" role="dialog" aria-label="속성 표시">
          {props.map((p) => (
            <label key={p} className="small">
              <input
                type="checkbox"
                checked={cols.includes(p)}
                onChange={(e) => onChange({ ...view, columns: props.filter((x) => (x === p ? e.target.checked : cols.includes(x))) })}
              />{' '}
              {p === TITLE ? '제목' : p}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
