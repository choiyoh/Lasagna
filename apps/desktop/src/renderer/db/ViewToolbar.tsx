import { useEffect, useState } from 'react';
import { t } from '@nopsidian/i18n';
import type { CALC_FNS, FilterNode, View } from '@nopsidian/core/db';
import { FilterBuilder } from './FilterBuilder';
import { calcLabel, viewTypeLabel } from './labels';
import { TITLE, type DbData } from './types';

const countConds = (f: FilterNode): number => ('prop' in f ? 1 : ('and' in f ? f.and : f.or).reduce((n, c) => n + countConds(c), 0));

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

const VIEW_TYPES: View['type'][] = ['table', 'board', 'list', 'gallery', 'calendar', 'timeline'];

/** 필터·정렬·그룹·표시 속성 조절 막대. 바꾸면 잠시 뒤 `_db.yaml` 에 자동 저장되고, "되돌리기"로 돌아갈 수 있다. */
export function ViewToolbar({ data, view, saveState, onChange, onUndo, openFilterRequest }: Props) {
  const [open, setOpen] = useState<'filter' | 'sort' | 'group' | 'cols' | 'calc' | null>(null);
  useEffect(() => {
    if (openFilterRequest) setOpen('filter');
  }, [openFilterRequest]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  const filesProps = Object.entries(data.schema.properties).filter(([, p]) => p.type === 'files').map(([n]) => n);
  const props = [TITLE, ...Object.keys(data.schema.properties)];
  const toggle = (k: NonNullable<typeof open>) => setOpen(open === k ? null : k);
  const dateProps = Object.entries(data.schema.properties).filter(([, p]) => p.type === 'date' || p.type === 'created_time' || p.type === 'updated_time').map(([n]) => n);
  const sorts = view.sort;
  const groupable = props.filter((p) => p !== TITLE);
  const cols = view.columns ?? props;

  return (
    <div className="dbtoolbar" role="toolbar" aria-label={t('db.viewSettings')}>
      <label className="dbtoolbar__type">
        <span className="muted small">{t('db.viewType')}</span>
        <select value={view.type} onChange={(e) => onChange({ ...view, type: e.target.value as View['type'] })} aria-label={t('db.viewType')}>
          {VIEW_TYPES.map((type) => (
            <option key={type} value={type}>{viewTypeLabel(type)}</option>
          ))}
        </select>
      </label>

      {(view.type === 'board' || view.type === 'gallery') && (
        <label className="dbtoolbar__type">
          <span className="muted small">{t('db.cover')}</span>
          <select value={view.cover ?? ''} onChange={(e) => onChange({ ...view, cover: e.target.value || undefined })} aria-label={t('db.coverProp')}>
            <option value="">{t('db.coverFirstImage')}</option>
            {filesProps.map((p) => <option key={p}>{p}</option>)}
          </select>
        </label>
      )}
      {(view.type === 'calendar' || view.type === 'timeline') && (
        <label className="dbtoolbar__type">
          <span className="muted small">{t('db.dateProp')}</span>
          <select value={view.dateProp ?? dateProps[0] ?? ''} onChange={(e) => onChange({ ...view, dateProp: e.target.value || undefined })} aria-label={t('db.dateProp')}>
            {dateProps.length === 0 && <option value="">{t('db.datePropNone')}</option>}
            {dateProps.map((p) => <option key={p}>{p}</option>)}
          </select>
        </label>
      )}
      <button className={view.filter ? 'on' : ''} onClick={() => toggle('filter')} aria-expanded={open === 'filter'}>
        {t('db.filter')}{view.filter ? ` ${countConds(view.filter)}` : ''}
      </button>
      <button className={sorts.length ? 'on' : ''} onClick={() => toggle('sort')} aria-expanded={open === 'sort'}>
        {t('db.sort')}{sorts.length ? ` ${sorts.length}` : ''}
      </button>
      <button className={view.groupBy ? 'on' : ''} onClick={() => toggle('group')} aria-expanded={open === 'group'}>
        {t('db.group')}{view.groupBy ? `: ${view.groupBy}` : ''}
      </button>
      <button onClick={() => toggle('cols')} aria-expanded={open === 'cols'}>{t('db.showProps')}</button>
      {view.type === 'table' && (
        <button className={view.calc && Object.keys(view.calc).length ? 'on' : ''} onClick={() => toggle('calc')} aria-expanded={open === 'calc'}>{t('db.calc')}</button>
      )}
      {saveState !== 'idle' && (
        <span className="dbtoolbar__dirty" data-testid="view-save-state">
          <span className="muted small">{saveState === 'pending' ? t('db.saving') : t('db.viewSaved')}</span>
          <button onClick={onUndo}>{t('db.undo')}</button>
        </span>
      )}

      {open === 'filter' && (
        <div className="dbpop" role="dialog" aria-label={t('db.filter')}>
          <FilterBuilder schema={data.schema} value={view.filter} onChange={(f) => onChange({ ...view, filter: f })} />
        </div>
      )}

      {open === 'sort' && (
        <div className="dbpop" role="dialog" aria-label={t('db.sort')}>
          {sorts.map((s, i) => (
            <div key={i} className="dbpop__row">
              <select value={s.prop} onChange={(e) => onChange({ ...view, sort: sorts.map((x, j) => (j === i ? { ...x, prop: e.target.value } : x)) })} aria-label={t('db.sortProp')}>
                {props.map((p) => (
                  <option key={p} value={p}>{p === TITLE ? t('db.title') : p}</option>
                ))}
              </select>
              <select value={s.dir} onChange={(e) => onChange({ ...view, sort: sorts.map((x, j) => (j === i ? { ...x, dir: e.target.value as 'asc' | 'desc' } : x)) })} aria-label={t('db.sortDir')}>
                <option value="asc">{t('db.sortAsc')}</option>
                <option value="desc">{t('db.sortDesc')}</option>
              </select>
              <button onClick={() => onChange({ ...view, sort: sorts.filter((_, j) => j !== i) })} aria-label={t('db.sortRemove')}>×</button>
            </div>
          ))}
          <div className="dbpop__actions">
            <button onClick={() => onChange({ ...view, sort: [...sorts, { prop: props[0]!, dir: 'asc' }] })}>{t('db.sortAdd')}</button>
          </div>
        </div>
      )}

      {open === 'group' && (
        <div className="dbpop" role="dialog" aria-label={t('db.group')}>
          <select value={view.groupBy ?? ''} onChange={(e) => { onChange({ ...view, groupBy: e.target.value || undefined, subGroupBy: undefined }); setOpen(null); }} aria-label={t('db.groupProp')}>
            <option value="">{t('db.groupNone')}</option>
            {groupable.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          {view.groupBy && (
            <select value={view.subGroupBy ?? ''} onChange={(e) => { onChange({ ...view, subGroupBy: e.target.value || undefined }); setOpen(null); }} aria-label={t('db.subGroupProp')}>
              <option value="">{t('db.subGroupNone')}</option>
              {groupable.filter((p) => p !== view.groupBy).map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          )}
        </div>
      )}

      {open === 'calc' && (
        <div className="dbpop" role="dialog" aria-label={t('db.calcRow')}>
          {cols.map((c) => {
            const def = c === TITLE ? undefined : data.schema.properties[c];
            const fns = CALC_BY_KIND[def ? (def.type === 'number' ? 'number' : def.type === 'checkbox' ? 'checkbox' : 'any') : 'any']!;
            return (
              <label key={c} className="dbpop__row small">
                <span style={{ minWidth: 100 }}>{c === TITLE ? t('db.title') : c}</span>
                <select
                  value={view.calc?.[c] ?? ''}
                  onChange={(e) => {
                    const next = { ...(view.calc ?? {}) };
                    if (e.target.value) next[c] = e.target.value as (typeof CALC_FNS)[number];
                    else delete next[c];
                    onChange({ ...view, calc: Object.keys(next).length ? next : undefined });
                  }}
                  aria-label={t('db.calcFor', { prop: c === TITLE ? t('db.title') : c })}
                >
                  <option value="">{t('db.none')}</option>
                  {fns.map((f) => (
                    <option key={f} value={f}>{calcLabel(f)}</option>
                  ))}
                </select>
              </label>
            );
          })}
        </div>
      )}

      {open === 'cols' && (
        <div className="dbpop" role="dialog" aria-label={t('db.showProps')}>
          {props.map((p) => (
            <label key={p} className="small">
              <input
                type="checkbox"
                checked={cols.includes(p)}
                onChange={(e) => onChange({ ...view, columns: props.filter((x) => (x === p ? e.target.checked : cols.includes(x))) })}
              />{' '}
              {p === TITLE ? t('db.title') : p}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
