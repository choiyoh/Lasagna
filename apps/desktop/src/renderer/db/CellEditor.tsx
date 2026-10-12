import { useEffect, useRef, useState } from 'react';
import { cellText, optionsOf } from '@nopsidian/core/db/values';
import type { CellValue, Property } from './types';

interface Props {
  prop: Property;
  value: CellValue;
  onCommit: (v: CellValue) => void;
  /** 편집 상태로 시작(표에서 셀을 눌렀을 때) */
  autoFocus?: boolean;
}

const EDITABLE = new Set(['text', 'number', 'select', 'multi_select', 'status', 'date', 'checkbox', 'url', 'email', 'phone', 'files', 'relation']);
export const isEditable = (p: Property) => EDITABLE.has(p.type);

const optionColor = (prop: Property, name: string) => optionsOf(prop).find((o) => o.name === name)?.color;

/** 읽기 전용 표시 */
export function CellView({ prop, value }: { prop: Property | undefined; value: CellValue }) {
  if (value === null || (Array.isArray(value) && !value.length)) return <span className="cell__empty" />;
  if (prop && (prop.type === 'select' || prop.type === 'status')) {
    return <span className="chip" style={{ background: optionColor(prop, String(value)) }}>{String(value)}</span>;
  }
  if (prop?.type === 'multi_select' && Array.isArray(value)) {
    return (
      <>
        {value.map((v) => (
          <span key={v} className="chip" style={{ background: optionColor(prop, v) }}>{v}</span>
        ))}
      </>
    );
  }
  if (prop?.type === 'checkbox') return <span>{value ? '☑' : '☐'}</span>;
  if (prop?.type === 'url' && typeof value === 'string') return <span className="cell__link">{value}</span>;
  return <span>{cellText(prop, value)}</span>;
}

/** 형식별 편집기. 값을 바꾸면(엔터·포커스 이동·선택) `onCommit` 으로 한 번 알린다. */
export function CellEditor({ prop, value, onCommit, autoFocus }: Props) {
  const ref = useRef<HTMLInputElement | HTMLSelectElement>(null);
  const [draft, setDraft] = useState(() => (Array.isArray(value) ? value.join(', ') : typeof value === 'object' && value && !Array.isArray(value) ? value.start : (value ?? '').toString()));
  const [end, setEnd] = useState(() => (value && typeof value === 'object' && !Array.isArray(value) ? (value.end ?? '') : ''));
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  const commitText = () => {
    const t = draft.trim();
    switch (prop.type) {
      case 'number':
        return onCommit(t === '' ? null : Number(t.replace(/,/g, '')));
      case 'multi_select':
      case 'files':
      case 'relation':
        return onCommit(t === '' ? null : t.split(',').map((s) => s.trim()).filter(Boolean));
      default:
        return onCommit(t === '' ? null : t);
    }
  };
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') (e.target as HTMLElement).blur();
    if (e.key === 'Escape') {
      setDraft(Array.isArray(value) ? value.join(', ') : ((value as string | number | null) ?? '').toString());
      (e.target as HTMLElement).blur();
    }
  };

  switch (prop.type) {
    case 'checkbox':
      return <input type="checkbox" checked={value === true} onChange={(e) => onCommit(e.target.checked)} aria-label="체크" />;
    case 'select':
    case 'status':
      return (
        <select ref={ref as React.RefObject<HTMLSelectElement>} value={typeof value === 'string' ? value : ''} onChange={(e) => onCommit(e.target.value || null)}>
          <option value="" />
          {optionsOf(prop).map((o) => (
            <option key={o.name}>{o.name}</option>
          ))}
          {typeof value === 'string' && !optionsOf(prop).some((o) => o.name === value) && <option>{value}</option>}
        </select>
      );
    case 'multi_select': {
      const cur = Array.isArray(value) ? value : [];
      const opts = [...new Set([...optionsOf(prop).map((o) => o.name), ...cur])];
      return (
        <span className="cell__multi">
          {opts.map((o) => (
            <label key={o} className={cur.includes(o) ? 'chip on' : 'chip'}>
              <input type="checkbox" checked={cur.includes(o)} onChange={(e) => onCommit((e.target.checked ? [...cur, o] : cur.filter((x) => x !== o)).length ? (e.target.checked ? [...cur, o] : cur.filter((x) => x !== o)) : null)} />
              {o}
            </label>
          ))}
        </span>
      );
    }
    case 'date':
      return (
        <span className="cell__date">
          <input
            ref={ref as React.RefObject<HTMLInputElement>}
            type={prop.includeTime ? 'datetime-local' : 'date'}
            value={draft.slice(0, prop.includeTime ? 16 : 10)}
            onChange={(e) => {
              setDraft(e.target.value);
              onCommit(e.target.value ? (end ? { start: e.target.value, end } : { start: e.target.value }) : null);
            }}
            aria-label="날짜"
          />
          <input
            type={prop.includeTime ? 'datetime-local' : 'date'}
            value={end.slice(0, prop.includeTime ? 16 : 10)}
            onChange={(e) => {
              setEnd(e.target.value);
              if (draft) onCommit(e.target.value ? { start: draft, end: e.target.value } : { start: draft });
            }}
            aria-label="끝 날짜"
          />
        </span>
      );
    case 'number':
      if (prop.format === 'stars') {
        const max = prop.max ?? 5;
        const n = typeof value === 'number' ? value : 0;
        return (
          <span className="cell__stars" role="radiogroup" aria-label="별점">
            {Array.from({ length: max }, (_, i) => (
              <button key={i} role="radio" aria-checked={n === i + 1} className={i < n ? 'on' : ''} onClick={() => onCommit(n === i + 1 ? null : i + 1)}>
                ★
              </button>
            ))}
          </span>
        );
      }
      return <input ref={ref as React.RefObject<HTMLInputElement>} type="text" inputMode="decimal" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commitText} onKeyDown={keys} />;
    default:
      return <input ref={ref as React.RefObject<HTMLInputElement>} type="text" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commitText} onKeyDown={keys} />;
  }
}
