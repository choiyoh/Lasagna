import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { CellEditor, CellView, isEditable } from './CellEditor';
import { movedColumns, movedRows } from './view-edit';
import { cellOf, TITLE, visibleColumns, type CellValue, type DbData, type DbGroupDto, type DbRowDto } from './types';

type Item = { kind: 'row'; row: DbRowDto } | { kind: 'group'; key: string; label: string; count: number; hidden: number; depth: number };

/** 그룹이 있으면 머리 줄과 행을 한 줄로 펼친다(하위 그룹은 들여쓰기) */
function flatten(rows: DbRowDto[], groups: DbGroupDto[] | null): Item[] {
  if (!groups) return rows.map((row) => ({ kind: 'row', row }));
  const out: Item[] = [];
  const walk = (gs: DbGroupDto[], depth: number, prefix: string) => {
    for (const g of gs) {
      out.push({ kind: 'group', key: `${prefix}/${g.key ?? '\u0000'}`, label: g.label, count: g.count, hidden: g.hidden, depth });
      if (g.sub) walk(g.sub, depth + 1, `${prefix}/${g.key ?? '\u0000'}`);
      else for (const row of g.rows) out.push({ kind: 'row', row });
    }
  };
  walk(groups, 0, '');
  return out;
}

interface Props {
  data: DbData;
  rows: DbRowDto[];
  onOpen: (path: string) => void;
  onEdit: (row: DbRowDto, prop: string, value: CellValue) => void;
  onWidth: (prop: string, width: number) => void;
  notes: { path: string; title: string }[];
  /** 제목 칸을 두 번 눌러 이름(=파일 이름)을 바꾼다 */
  onRenameTitle?: (row: DbRowDto, title: string) => void;
  /** 열 머리 메뉴: 정렬(null = 정렬 해제)·숨기기. 없으면 메뉴가 없다 */
  onSort?: (prop: string, dir: 'asc' | 'desc' | null) => void;
  onHide?: (prop: string) => void;
  /** 열 머리를 끌어 순서를 바꾼다 */
  onColumns?: (cols: string[]) => void;
  /** 열 머리 메뉴 "필터 추가" */
  onFilter?: (prop: string) => void;
  /** 행 앞 손잡이를 끌어 순서를 바꾼다(그룹이 없을 때만). 새 경로 순서 */
  onReorderRows?: (order: string[]) => void;
  /** 이 경로의 행이 보이면 제목을 바로 고치는 입력으로 시작한다(방금 만든 행) */
  startRenaming?: string | null;
  /** `startRenaming` 을 받아 입력 상태로 들어간 뒤 부른다(다시 들어가지 않게 부모가 값을 비운다) */
  onStartedRenaming?: () => void;
}

const CALC_LABEL: Record<string, string> = {
  count: '개수', count_values: '값이 있는 수', count_empty: '빈 값 수', count_unique: '고유 값 수', sum: '합계', avg: '평균', min: '최소', max: '최대', checked: '체크됨', unchecked: '체크 안 됨',
};
const fmtCalc = (v: unknown) => (typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : v === null || v === undefined ? '' : String(v));

const ROW_H = 32;
const DEFAULT_W = 180;

/** 표 뷰: 행을 가상화해(2만 행도 보이는 만큼만 그림) 셀을 눌러 바로 고친다. */
export function TableView({ data, rows, onOpen, onEdit, onWidth, notes, onRenameTitle, onSort, onHide, onColumns, onFilter, onReorderRows, startRenaming, onStartedRenaming }: Props) {
  const [dragCol, setDragCol] = useState<string | null>(null);
  const [dragRow, setDragRow] = useState<string | null>(null);
  const rowsMovable = !!onReorderRows && !data.groups;
  const [menu, setMenu] = useState<string | null>(null);
  const sortOf = (c: string) => data.view.sort.find((r) => r.prop === c)?.dir ?? null;
  const cols = visibleColumns(data);
  const widths = data.view.widths ?? {};
  const w = (c: string) => widths[c] ?? (c === TITLE ? 260 : DEFAULT_W);
  const scroller = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<{ path: string; prop: string } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  useEffect(() => {
    if (startRenaming && rows.some((r) => r.path === startRenaming)) {
      setRenaming(startRenaming);
      onStartedRenaming?.();
    }
  }, [startRenaming, rows, onStartedRenaming]);
  const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const items = useMemo(() => flatten(rows, data.groups), [rows, data.groups]);
  const v = useVirtualizer({ count: items.length, getScrollElement: () => scroller.current, estimateSize: () => ROW_H, overscan: 12 });
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
            <div
              key={c}
              className={dragCol && dragCol !== c ? 'dbtable__th dropable' : 'dbtable__th'}
              style={{ width: w(c) }}
              draggable={!!onColumns && c !== TITLE}
              onDragStart={() => setDragCol(c)}
              onDragEnd={() => setDragCol(null)}
              onDragOver={(e) => dragCol && e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (dragCol && onColumns) onColumns(movedColumns(cols, dragCol, c));
                setDragCol(null);
              }}
              role="columnheader"
              aria-sort={sortOf(c) === 'asc' ? 'ascending' : sortOf(c) === 'desc' ? 'descending' : 'none'}>
              {onSort || onHide ? (
                <button className="dbtable__thbtn" onClick={() => setMenu(menu === c ? null : c)} aria-haspopup="menu" aria-expanded={menu === c} data-testid={`th-${c}`}>
                  {c === TITLE ? '제목' : c}
                  {sortOf(c) && <span className="dbtable__sort" aria-hidden>{sortOf(c) === 'asc' ? ' ↑' : ' ↓'}</span>}
                </button>
              ) : (
                <span>{c === TITLE ? '제목' : c}</span>
              )}
              {menu === c && (
                <div className="dbtable__menu" role="menu" onMouseLeave={() => setMenu(null)}>
                  {onSort && (
                    <>
                      <button role="menuitem" onClick={() => { onSort(c, 'asc'); setMenu(null); }}>↑ 오름차순 정렬</button>
                      <button role="menuitem" onClick={() => { onSort(c, 'desc'); setMenu(null); }}>↓ 내림차순 정렬</button>
                      {sortOf(c) && <button role="menuitem" onClick={() => { onSort(c, null); setMenu(null); }}>정렬 해제</button>}
                    </>
                  )}
                  {onFilter && <button role="menuitem" onClick={() => { onFilter(c); setMenu(null); }}>이 열로 필터 추가</button>}
                  {onHide && c !== TITLE && <button role="menuitem" onClick={() => { onHide(c); setMenu(null); }}>이 열 숨기기</button>}
                </div>
              )}
              <i className="dbtable__grip" onPointerDown={(e) => drag(c, e)} />
            </div>
          ))}
        </div>
        <div style={{ height: v.getTotalSize(), position: 'relative' }}>
          {v.getVirtualItems().map((vi) => {
            const item = items[vi.index]!;
            if (item.kind === 'group') {
              return (
                <div key={item.key} className="dbtable__group" role="row" style={{ transform: `translateY(${vi.start}px)`, height: ROW_H, paddingLeft: 10 + item.depth * 18 }}>
                  <strong>{item.label}</strong> <span className="count">{item.count}</span>
                  {item.hidden > 0 && <span className="muted small"> · {item.hidden}개 더 있음(필터로 좁혀 보세요)</span>}
                </div>
              );
            }
            const row = item.row;
            return (
              <div
                key={`${vi.index}:${row.path}`}
                className={dragRow && dragRow !== row.path ? 'dbtable__row dropable' : 'dbtable__row'}
                role="row"
                style={{ transform: `translateY(${vi.start}px)`, height: ROW_H }}
                onDragOver={(e) => rowsMovable && dragRow && e.preventDefault()}
                onDrop={(e) => {
                  if (!rowsMovable || !dragRow) return;
                  e.preventDefault();
                  onReorderRows!(movedRows(rows.map((r) => r.path), dragRow, row.path));
                  setDragRow(null);
                }}
              >
                {rowsMovable && (
                  <span className="dbtable__rowgrip" draggable title="끌어서 행 순서 바꾸기" aria-label="행 순서 바꾸기" onDragStart={() => setDragRow(row.path)} onDragEnd={() => setDragRow(null)}>
                    ⋮⋮
                  </span>
                )}
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
                        if (c === TITLE) return;
                        if (prop && isEditable(prop) && prop.type !== 'checkbox' && prop.type !== 'select' && prop.type !== 'status') setEditing({ path: row.path, prop: c });
                      }}
                    >
                      {c === TITLE ? (
                        renaming === row.path ? (
                          <input
                            autoFocus
                            defaultValue={row.title}
                            aria-label="제목 바꾸기"
                            onClick={(e) => e.stopPropagation()}
                            onBlur={(e) => {
                              const t = e.target.value.trim();
                              setRenaming(null);
                              if (t && t !== row.title) onRenameTitle?.(row, t);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') (e.target as HTMLElement).blur();
                              if (e.key === 'Escape') {
                                e.stopPropagation();
                                setRenaming(null);
                              }
                            }}
                          />
                        ) : (
                          <button
                            className="dbtable__title"
                            onClick={() => {
                              // 두 번 누르면 이름 바꾸기이므로, 한 번 누른 열기는 잠깐 기다렸다가 한다
                              if (!onRenameTitle) return onOpen(row.path);
                              clearTimeout(openTimer.current);
                              openTimer.current = setTimeout(() => onOpen(row.path), 240);
                            }}
                            onDoubleClick={(e) => {
                              if (!onRenameTitle) return;
                              e.stopPropagation();
                              clearTimeout(openTimer.current);
                              setRenaming(row.path);
                            }}
                            title={`${row.path} — 두 번 눌러 이름 바꾸기`}
                          >
                            {row.title}
                          </button>
                        )
                      ) : prop && isEditable(prop) && (isEd || prop.type === 'checkbox' || prop.type === 'select' || prop.type === 'status' || prop.type === 'multi_select' || prop.type === 'relation' || (prop.type === 'number' && prop.format === 'stars')) ? (
                        <div onBlurCapture={() => !isEd || setEditing(null)} onKeyDownCapture={() => undefined}>
                          <CellEditor prop={prop} value={value} notes={notes} autoFocus={isEd} onCommit={(nv) => { onEdit(row, c, nv); if (isEd && prop.type !== 'date') setEditing(null); }} />
                        </div>
                      ) : data.errors[row.path]?.[c] ? (
                        <span className="cell__error" title={data.errors[row.path]![c]} role="img" aria-label={`오류: ${data.errors[row.path]![c]}`}>
                          ⚠ {data.errors[row.path]![c]}
                        </span>
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
                {data.view.calc?.[c] ? `${CALC_LABEL[data.view.calc[c]!] ?? data.view.calc[c]} ${fmtCalc(data.calc[c])}` : ''}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
