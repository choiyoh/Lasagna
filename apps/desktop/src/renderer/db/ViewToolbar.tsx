import { useEffect, useState } from 'react';
import type { CALC_FNS, FilterNode, View } from '@nopsidian/core/db';
import { FilterBuilder } from './FilterBuilder';
import { TITLE, type DbData } from './types';

const countConds = (f: FilterNode): number => ('prop' in f ? 1 : ('and' in f ? f.and : f.or).reduce((n, c) => n + countConds(c), 0));

const CALC_LABEL: Record<string, string> = {
  count: '개수', count_values: '값이 있는 수', count_empty: '빈 값 수', count_unique: '고유 값 수', sum: '합계', avg: '평균', min: '최소', max: '최대', checked: '체크됨', unchecked: '체크 안 됨',
};
const CALC_BY_KIND: Record<string, (typeof CALC_FNS)[number][]> = {
  any: ['count', 'count_values', 'count_empty', 'count_unique'],
  number: ['count', 'count_values', 'count_empty', 'sum', 'avg', 'min', 'max'],
  checkbox: ['count', 'checked', 'unchecked'],
};

interface Props {
  data: DbData;
  view: View;
  /** 보기 설정 자동 저장 상태: 저장 대기 / 방금 저장(되돌릴 수 있음) / 없음 */
  saveState: 'pending' | 'saved' | 'idle';
  onChange: (v: View) => void;
  /** 방금 바꾼 보기 설정을 되돌린다 */
  onUndo: () => void;
  /** 값이 바뀔 때마다 필터 창을 연다(표 열 머리 메뉴의 "필터 추가") */
  openFilterRequest?: number;
}

const VIEW_TYPES: { type: View['type']; label: string }[] = [
  { type: 'table', label: '표' }, { type: 'board', label: '보드' }, { type: 'list', label: '목록' }, { type: 'gallery', label: '갤러리' }, { type: 'calendar', label: '캘린더' }, { type: 'timeline', label: '타임라인' },
];

/** 필터·정렬·그룹·표시 속성 조절 막대. 바꾸면 잠시 뒤 `_db.yaml` 에 자동 저장되고, "되돌리기"로 돌아갈 수 있다. */
export function ViewToolbar({ data, view, saveState, onChange, onUndo, openFilterRequest }: Props) {
  const [open, setOpen] = useState<'filter' | 'sort' | 'group' | 'cols' | 'calc' | null>(null);
  useEffect(() => {
    if (openFilterRequest) setOpen('filter');
  }, [openFilterRequest]);
  const filesProps = Object.entries(data.schema.properties).filter(([, p]) => p.type === 'files').map(([n]) => n);
  const props = [TITLE, ...Object.keys(data.schema.properties)];
  const toggle = (k: NonNullable<typeof open>) => setOpen(open === k ? null : k);
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

      {(view.type === 'board' || view.type === 'gallery') && (
        <label className="dbtoolbar__type">
          <span className="muted small">커버</span>
          <select value={view.cover ?? ''} onChange={(e) => onChange({ ...view, cover: e.target.value || undefined })} aria-label="커버 속성">
            <option value="">본문 첫 이미지</option>
            {filesProps.map((p) => <option key={p}>{p}</option>)}
          </select>
        </label>
      )}
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
        필터{view.filter ? ` ${countConds(view.filter)}` : ''}
      </button>
      <button className={sorts.length ? 'on' : ''} onClick={() => toggle('sort')} aria-expanded={open === 'sort'}>
        정렬{sorts.length ? ` ${sorts.length}` : ''}
      </button>
      <button className={view.groupBy ? 'on' : ''} onClick={() => toggle('group')} aria-expanded={open === 'group'}>
        그룹{view.groupBy ? `: ${view.groupBy}` : ''}
      </button>
      <button onClick={() => toggle('cols')} aria-expanded={open === 'cols'}>속성 표시</button>
      {view.type === 'table' && (
        <button className={view.calc && Object.keys(view.calc).length ? 'on' : ''} onClick={() => toggle('calc')} aria-expanded={open === 'calc'}>계산</button>
      )}
      {saveState !== 'idle' && (
        <span className="dbtoolbar__dirty" data-testid="view-save-state">
          <span className="muted small">{saveState === 'pending' ? '저장 중…' : '보기 저장됨'}</span>
          <button onClick={onUndo}>되돌리기</button>
        </span>
      )}

      {open === 'filter' && (
        <div className="dbpop" role="dialog" aria-label="필터">
          <FilterBuilder schema={data.schema} value={view.filter} onChange={(f) => onChange({ ...view, filter: f })} />
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
          {view.groupBy && (
            <select value={view.subGroupBy ?? ''} onChange={(e) => { onChange({ ...view, subGroupBy: e.target.value || undefined }); setOpen(null); }} aria-label="하위 그룹 속성">
              <option value="">하위 그룹 없음</option>
              {groupable.filter((p) => p !== view.groupBy).map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          )}
        </div>
      )}

      {open === 'calc' && (
        <div className="dbpop" role="dialog" aria-label="계산 행">
          {cols.map((c) => {
            const def = c === TITLE ? undefined : data.schema.properties[c];
            const fns = CALC_BY_KIND[def ? (def.type === 'number' ? 'number' : def.type === 'checkbox' ? 'checkbox' : 'any') : 'any']!;
            return (
              <label key={c} className="dbpop__row small">
                <span style={{ minWidth: 100 }}>{c === TITLE ? '제목' : c}</span>
                <select
                  value={view.calc?.[c] ?? ''}
                  onChange={(e) => {
                    const next = { ...(view.calc ?? {}) };
                    if (e.target.value) next[c] = e.target.value as (typeof CALC_FNS)[number];
                    else delete next[c];
                    onChange({ ...view, calc: Object.keys(next).length ? next : undefined });
                  }}
                  aria-label={`${c} 계산`}
                >
                  <option value="">없음</option>
                  {fns.map((f) => (
                    <option key={f} value={f}>{CALC_LABEL[f]}</option>
                  ))}
                </select>
              </label>
            );
          })}
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
