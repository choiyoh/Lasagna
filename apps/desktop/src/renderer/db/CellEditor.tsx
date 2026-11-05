import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { t } from '@nopsidian/i18n';
import { DatePicker } from './DatePicker';
import { linkNameFor } from '@nopsidian/core/links';
import { cellText, optionsOf } from '@nopsidian/core/db/values';
import type { CellValue, Property } from './types';
import { chipStyle } from './chip-color';

interface Props {
  prop: Property;
  value: CellValue;
  onCommit: (v: CellValue) => void;
  /** 편집 상태로 시작(표에서 셀을 눌렀을 때) */
  autoFocus?: boolean;
  /** 관계 속성의 노트 고르기에 쓰는 볼트의 노트 경로·제목 */
  notes?: { path: string; title: string }[];
  /** 편집을 마쳤을 때(날짜 고르기 창을 닫았을 때 등) */
  onDone?: () => void;
}

/** 날짜 셀: 값을 누르면 달력(DatePicker)이 뜬다. 표 셀이 잘리지 않도록 화면 위에 띄운다. */
function DateCell({ prop, value, onCommit, autoFocus, onDone }: { prop: Property; value: CellValue; onCommit: (v: CellValue) => void; autoFocus?: boolean; onDone?: () => void }) {
  const btn = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const openPicker = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    // 아래 공간이 모자라면 위로
    const top = r.bottom + 360 > window.innerHeight ? Math.max(8, r.top - 364) : r.bottom + 4;
    setAt({ left: Math.max(8, Math.min(r.left, window.innerWidth - 276)), top });
  };
  useEffect(() => {
    if (autoFocus) openPicker();
  }, [autoFocus]);
  const text = value === null ? '' : cellText(prop, value);
  return (
    <span className="cell__date">
      <button ref={btn} type="button" className="cell__datebtn" onClick={openPicker} aria-label={t('cell.openDatePicker')}>
        {text || <span className="muted">{t('cell.pickDate')}</span>}
      </button>
      {at &&
        createPortal(
          <div className="datepicker-layer" style={{ left: at.left, top: at.top }}>
            <DatePicker
              value={value}
              includeTime={prop.type === 'date' && !!prop.includeTime}
              autoFocus
              onCommit={(v) => onCommit(v)}
              onClose={() => {
                setAt(null);
                onDone?.();
              }}
            />
          </div>,
          document.body,
        )}
    </span>
  );
}

const relName = (raw: string) => (/^\[\[(.+)\]\]$/.exec(raw.trim())?.[1] ?? raw).split('|')[0]!.split('#')[0]!.trim();

/** 관계 셀: 연결된 노트를 칩으로 보여 주고, 검색해서 추가·제거한다. */
function RelationEditor({ value, onCommit, notes = [] }: { value: CellValue; onCommit: (v: CellValue) => void; notes: { path: string; title: string }[] }) {
  const cur = Array.isArray(value) ? value : [];
  const [q, setQ] = useState('');
  const hits = q.trim()
    ? notes.filter((n) => n.title.toLowerCase().includes(q.trim().toLowerCase()) && !cur.some((c) => relName(c).toLowerCase() === n.title.toLowerCase() || relName(c) === linkNameFor(n.path, notes.map((x) => x.path)))).slice(0, 8)
    : [];
  const set = (next: string[]) => onCommit(next.length ? next : null);
  return (
    <span className="cell__relation">
      {cur.map((c) => (
        <span key={c} className="chip on">
          {relName(c)}
          <button onClick={() => set(cur.filter((x) => x !== c))} aria-label={t('cell.unlink', { name: relName(c) })}>×</button>
        </span>
      ))}
      <input value={q} placeholder={t('cell.linkPlaceholder')} onChange={(e) => setQ(e.target.value)} aria-label={t('cell.searchNotes')} />
      {hits.length > 0 && (
        <ul className="cell__relhits" role="listbox">
          {hits.map((n) => (
            <li key={n.path}>
              <button
                role="option"
                aria-selected={false}
                onClick={() => {
                  set([...cur, `[[${linkNameFor(n.path, notes.map((x) => x.path))}]]`]);
                  setQ('');
                }}
              >
                {n.title} <span className="muted small">{n.path}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}

const EDITABLE = new Set(['text', 'number', 'select', 'multi_select', 'status', 'date', 'checkbox', 'url', 'email', 'phone', 'files', 'relation']);
export const isEditable = (p: Property) => EDITABLE.has(p.type);

const optionColor = (prop: Property, name: string) => optionsOf(prop).find((o) => o.name === name)?.color;

/** 읽기 전용 표시 */
export function CellView({ prop, value }: { prop: Property | undefined; value: CellValue }) {
  if (value === null || (Array.isArray(value) && !value.length)) return <span className="cell__empty" />;
  if (prop && (prop.type === 'select' || prop.type === 'status')) {
    return <span className="chip" style={chipStyle(optionColor(prop, String(value)))}>{String(value)}</span>;
  }
  if (prop?.type === 'relation' && Array.isArray(value)) {
    return (
      <>
        {value.map((v) => (
          <span key={v} className="chip on">{relName(v)}</span>
        ))}
      </>
    );
  }
  if (prop?.type === 'multi_select' && Array.isArray(value)) {
    return (
      <>
        {value.map((v) => (
          <span key={v} className="chip" style={chipStyle(optionColor(prop, v))}>{v}</span>
        ))}
      </>
    );
  }
  if (prop?.type === 'checkbox') return <span>{value ? '☑' : '☐'}</span>;
  if (prop?.type === 'url' && typeof value === 'string') return <span className="cell__link">{value}</span>;
  return <span>{cellText(prop, value)}</span>;
}

/** 형식별 편집기. 값을 바꾸면(엔터·포커스 이동·선택) `onCommit` 으로 한 번 알린다. */
export function CellEditor({ prop, value, onCommit, autoFocus, notes, onDone }: Props) {
  const ref = useRef<HTMLInputElement | HTMLSelectElement>(null);
  const [draft, setDraft] = useState(() => (Array.isArray(value) ? value.join(', ') : typeof value === 'object' && value && !Array.isArray(value) ? value.start : (value ?? '').toString()));
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
    case 'relation':
      return <RelationEditor value={value} onCommit={onCommit} notes={notes ?? []} />;
    case 'checkbox':
      return <input type="checkbox" checked={value === true} onChange={(e) => onCommit(e.target.checked)} aria-label={t('cell.check')} />;
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
            <label key={o} className={cur.includes(o) ? 'chip on' : 'chip'} style={cur.includes(o) ? undefined : chipStyle(optionColor(prop, o))}>
              <input type="checkbox" checked={cur.includes(o)} onChange={(e) => onCommit((e.target.checked ? [...cur, o] : cur.filter((x) => x !== o)).length ? (e.target.checked ? [...cur, o] : cur.filter((x) => x !== o)) : null)} />
              {o}
            </label>
          ))}
        </span>
      );
    }
    case 'date':
      return <DateCell prop={prop} value={value} onCommit={onCommit} autoFocus={autoFocus} onDone={onDone} />;
    case 'number':
      if (prop.format === 'stars') {
        const max = prop.max ?? 5;
        const n = typeof value === 'number' ? value : 0;
        return (
          <span className="cell__stars" role="radiogroup" aria-label={t('cell.stars')}>
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
