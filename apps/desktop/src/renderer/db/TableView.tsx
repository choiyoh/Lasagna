import { useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { CellEditor, CellView, isEditable } from './CellEditor';
import { cellOf, TITLE, visibleColumns, type CellValue, type DbData, type DbRowDto } from './types';

interface Props {
  data: DbData;
  rows: DbRowDto[];
  onOpen: (path: string) => void;
  onEdit: (row: DbRowDto, prop: string, value: CellValue) => void;
  onWidth: (prop: string, width: number) => void;
}

const ROW_H = 32;
const DEFAULT_W = 180;

/** 표 뷰: 행을 가상화해(2만 행도 보이는 만큼만 그림) 셀을 눌러 바로 고친다. */
export function TableView({ data, rows, onOpen, onEdit, onWidth }: Props) {
  const cols = visibleColumns(data);
  const widths = data.view.widths ?? {};
  const w = (c: string) => widths[c] ?? (c === TITLE ? 260 : DEFAULT_W);
  const scroller = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<{ path: string; prop: string } | null>(null);
  const v = useVirtualizer({ count: rows.length, getScrollElement: () => scroller.current, estimateSize: () => ROW_H, overscan: 12 });
  const total = cols.reduce((n, c) => n + w(c), 0) + 40;

  const drag = (c: string, e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const start = w(c);
    const move = (ev: PointerEvent) => onWidth(c, Math.max(60, Math.round(start + ev.clientX - startX)));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="dbtable" ref={scroller} data-testid="db-table">
      <div className="dbtable__inner" style={{ width: total }}>
        <div className="dbtable__head" role="row">
          {cols.map((c) => (
            <div key={c} className="dbtable__th" style={{ width: w(c) }} role="columnheader">
              <span>{c === TITLE ? '제목' : c}</span>
              <i className="dbtable__grip" onPointerDown={(e) => drag(c, e)} />
            </div>
          ))}
        </div>
        <div style={{ height: v.getTotalSize(), position: 'relative' }}>
          {v.getVirtualItems().map((vi) => {
            const row = rows[vi.index]!;
            return (
              <div key={row.path} className="dbtable__row" role="row" style={{ transform: `translateY(${vi.start}px)`, height: ROW_H }}>
                {cols.map((c) => {
                  const prop = c === TITLE ? undefined : data.schema.properties[c];
                  const value = cellOf(row, c);
                  const isEd = editing?.path === row.path && editing.prop === c;
                  return (
                    <div
                      key={c}
                      className={isEd ? 'dbtable__td editing' : 'dbtable__td'}
                      style={{ width: w(c) }}
                      role="cell"
                      onClick={() => {
                        if (c === TITLE) return onOpen(row.path);
                        if (prop && isEditable(prop) && prop.type !== 'checkbox' && prop.type !== 'select' && prop.type !== 'status') setEditing({ path: row.path, prop: c });
                      }}
                    >
                      {c === TITLE ? (
                        <button className="dbtable__title" onClick={() => onOpen(row.path)} title={row.path}>
                          {row.title}
                        </button>
                      ) : prop && isEditable(prop) && (isEd || prop.type === 'checkbox' || prop.type === 'select' || prop.type === 'status' || prop.type === 'multi_select' || (prop.type === 'number' && prop.format === 'stars')) ? (
                        <div onBlurCapture={() => !isEd || setEditing(null)} onKeyDownCapture={() => undefined}>
                          <CellEditor prop={prop} value={value} autoFocus={isEd} onCommit={(nv) => { onEdit(row, c, nv); if (isEd && prop.type !== 'date') setEditing(null); }} />
                        </div>
                      ) : (
                        <CellView prop={prop} value={value} />
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
        {data.view.calc && (
          <div className="dbtable__calc" role="row">
            {cols.map((c) => (
              <div key={c} className="dbtable__td" style={{ width: w(c) }}>
                {data.view.calc?.[c] ? `${data.view.calc[c]}: ${String(data.calc[c] ?? '')}` : ''}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
