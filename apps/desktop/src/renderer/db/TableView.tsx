import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import { t } from '@nopsidian/i18n';
import { CellEditor, CellView, isEditable } from './CellEditor';
import { COL_MIN, columnWidths } from './column-widths';
import { calcLabel, groupLabel } from './labels';
import { movedColumns, movedRows } from './view-edit';
import { cellOf, TITLE, visibleColumns, type CellValue, type DbData, type DbGroupDto, type DbRowDto } from './types';

type Item =
  | { kind: 'row'; row: DbRowDto }
  | { kind: 'group'; key: string; label: string; labelKey?: DbGroupDto['labelKey']; count: number; hidden: number; depth: number };

/** 그룹이 있으면 머리 줄과 행을 한 줄로 펼친다(하위 그룹은 들여쓰기) */
function flatten(rows: DbRowDto[], groups: DbGroupDto[] | null): Item[] {
  if (!groups) return rows.map((row) => ({ kind: 'row', row }));
  const out: Item[] = [];
  const walk = (gs: DbGroupDto[], depth: number, prefix: string) => {
    for (const g of gs) {
      out.push({ kind: 'group', key: `${prefix}/${g.key ?? '\u0000'}`, label: g.label, labelKey: g.labelKey, count: g.count, hidden: g.hidden, depth });
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
  /** 행 우클릭 메뉴·여러 행 선택 막대의 동작. 없으면 선택 기능이 없다 */
  onRowAction?: (action: RowAction, paths: string[]) => void;
  /** 행이 없을 때 헤더 아래에 그릴 내용(0행 EmptyState). 있으면 행·계산 줄은 그리지 않는다 */
  empty?: ReactNode;
}

export type RowAction = 'open' | 'duplicate' | 'delete';

const fmtCalc = (v: unknown) => (typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : v === null || v === undefined ? '' : String(v));

const ROW_H = 32;

/** 표 뷰: 행을 가상화해(2만 행도 보이는 만큼만 그림) 셀을 눌러 바로 고친다. */
export function TableView({ data, rows, onOpen, onEdit, onWidth, notes, onRenameTitle, onSort, onHide, onColumns, onFilter, onReorderRows, startRenaming, onStartedRenaming, onRowAction, empty }: Props) {
  /** 선택한 행(경로). 체크 상자·⇧클릭으로 범위·우클릭 */
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const anchor = useRef<string | null>(null);
  const [rowMenu, setRowMenu] = useState<{ x: number; y: number } | null>(null);
  // 사라진 행(삭제·필터)은 선택에서 뺀다
  const live = useMemo(() => new Set(rows.map((r) => r.path)), [rows]);
  const selected = useMemo(() => [...picked].filter((p) => live.has(p)), [picked, live]);
  const toggleRow = (path: string, range: boolean) => {
    setPicked((cur) => {
      const next = new Set(cur);
      if (range && anchor.current && live.has(anchor.current)) {
        const order = rows.map((r) => r.path);
        const [a, b] = [order.indexOf(anchor.current), order.indexOf(path)].sort((x, y) => x - y);
        order.slice(a, b + 1).forEach((p) => next.add(p));
      } else if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
    anchor.current = path;
  };
  const act = (action: RowAction, paths: string[]) => {
    setRowMenu(null);
    if (action !== 'open') setPicked(new Set());
    onRowAction?.(action, paths);
  };
  const [dragCol, setDragCol] = useState<string | null>(null);
  const [dragRow, setDragRow] = useState<string | null>(null);
  const rowsMovable = !!onReorderRows && !data.groups;
  /** 열 머리 메뉴: 화면 좌표(뷰포트 기준)에 fixed 로 띄운다. 부모 overflow 에 잘리지 않게 포털을 쓴다 */
  const [menu, setMenu] = useState<{ col: string; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const toggleMenu = (col: string, el: HTMLButtonElement) => {
    if (menu?.col === col) {
      setMenu(null);
      return;
    }
    menuButtonRef.current = el;
    const anchor = el.closest('.dbtable__th') ?? el;
    const r = anchor.getBoundingClientRect();
    const width = 168;
    const height = 176;
    setMenu({
      col,
      x: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
      y: r.bottom + height > window.innerHeight ? Math.max(8, window.innerHeight - height - 8) : r.bottom,
    });
  };
  const sortOf = (c: string) => data.view.sort.find((r) => r.prop === c)?.dir ?? null;
  const cols = visibleColumns(data);
  const widths = data.view.widths ?? {};
  const scroller = useRef<HTMLDivElement>(null);
  /** 메뉴를 닫고(필요하면) 열 머리로 초점을 돌린다. 숨긴 열이면 남은 첫 머리로 */
  const focusHeader = useCallback(() => {
    const btn = menuButtonRef.current;
    const target = btn?.isConnected ? btn : scroller.current?.querySelector<HTMLButtonElement>('.dbtable__thbtn');
    target?.focus({ preventScroll: true });
  }, []);
  const closeMenu = useCallback(
    (focus = false) => {
      setMenu(null);
      if (focus) focusHeader();
    },
    [focusHeader],
  );
  // 열리면 첫 항목으로 초점을 옮긴다(role=menu 와 실제 키보드 동작을 맞춘다)
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeMenu(true);
        return;
      }
      if (e.key === 'Tab') {
        // 포털 메뉴는 DOM 끝에 있어 Tab 이 엉뚱한 곳으로 간다. 닫고 열 머리로 돌린다.
        e.preventDefault();
        e.stopPropagation();
        closeMenu(true);
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
      const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
      if (items.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      const at = items.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? items.length - 1
            : e.key === 'ArrowDown'
              ? at < 0
                ? 0
                : (at + 1) % items.length
              : at <= 0
                ? items.length - 1
                : at - 1;
      items[next]?.focus();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [menu, closeMenu]);
  // 바깥 pointerdown 으로 닫는다. 같은 열 머리를 누른 경우는 click 이 토글하게 둔다.
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (menuRef.current?.contains(t)) return;
      if (menuButtonRef.current && (menuButtonRef.current === t || menuButtonRef.current.contains(t))) return;
      closeMenu();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [menu, closeMenu]);
  // 표를 가로로 스크롤하거나 창 폭이 바뀌면 메뉴가 다른 열 위에 떠 있게 된다. 닫는다.
  useEffect(() => {
    if (!menu) return;
    const close = () => closeMenu(true);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [menu, closeMenu]);
  /** 표에 실제로 주어진 폭. 열 폭은 여기서 나눈다(고정 180px 이면 마지막 열이 화면 밖으로 밀린다) */
  const [avail, setAvail] = useState(0);
  // 첫 페인트 전에 재서 좁은 열이 한 프레임 보였다가 넓어지는 깜빡임을 막는다
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const sync = () => setAvail((cur) => (Math.abs(cur - el.clientWidth) < 1 ? cur : el.clientWidth));
    sync();
    // jsdom 에는 ResizeObserver 가 없다(테스트는 0 으로 두고 최소 폭을 쓴다)
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const layout = useMemo(() => columnWidths(avail, cols, TITLE, widths), [avail, cols, widths]);
  const w = (c: string) => layout.widths[c] ?? COL_MIN;
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
  const total = layout.total;

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
    <div className={selected.length ? 'dbtable has-picked' : 'dbtable'} ref={scroller} data-testid="db-table">
      {onRowAction && selected.length > 0 && (
        <div className="dbtable__selbar" role="toolbar" aria-label={t('db.selectedRows')} data-testid="db-selbar">
          <strong>{t('db.selectedCount', { count: selected.length })}</strong>
          <button onClick={() => act('duplicate', selected)}>{t('db.duplicate')}</button>
          <button className="danger" onClick={() => act('delete', selected)}>{t('db.delete')}</button>
          <button onClick={() => setPicked(new Set())}>{t('db.deselect')}</button>
        </div>
      )}
      {rowMenu && onRowAction && (
        <div className="ctxmask" onMouseDown={() => setRowMenu(null)} onContextMenu={(e) => (e.preventDefault(), setRowMenu(null))}>
          <div className="ctxmenu" role="menu" style={{ left: Math.min(rowMenu.x, window.innerWidth - 190), top: Math.min(rowMenu.y, window.innerHeight - 130) }} onMouseDown={(e) => e.stopPropagation()}>
            {selected.length === 1 && <button role="menuitem" onClick={() => act('open', selected)}>{t('db.open')}</button>}
            <button role="menuitem" onClick={() => act('duplicate', selected)}>{selected.length > 1 ? t('db.duplicateCount', { count: selected.length }) : t('db.duplicate')}</button>
            <button role="menuitem" className="danger" onClick={() => act('delete', selected)}>{selected.length > 1 ? t('db.deleteCount', { count: selected.length }) : t('db.delete')}</button>
          </div>
        </div>
      )}
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
                <button className="dbtable__thbtn" onClick={(e) => toggleMenu(c, e.currentTarget)} aria-haspopup="menu" aria-expanded={menu?.col === c} data-testid={`th-${c}`}>
                  {c === TITLE ? t('db.title') : c}
                  {sortOf(c) && <span className="dbtable__sort" aria-hidden>{sortOf(c) === 'asc' ? ' ↑' : ' ↓'}</span>}
                </button>
              ) : (
                <span>{c === TITLE ? t('db.title') : c}</span>
              )}
              {menu?.col === c &&
                createPortal(
                  <div ref={menuRef} className="dbtable__menu" role="menu" style={{ left: menu.x, top: menu.y }}>
                    {onSort && (
                      <>
                        <button role="menuitem" onClick={() => { onSort(c, 'asc'); closeMenu(true); }}>{t('db.sortAscMenu')}</button>
                        <button role="menuitem" onClick={() => { onSort(c, 'desc'); closeMenu(true); }}>{t('db.sortDescMenu')}</button>
                        {sortOf(c) && <button role="menuitem" onClick={() => { onSort(c, null); closeMenu(true); }}>{t('db.sortClear')}</button>}
                      </>
                    )}
                    {onFilter && <button role="menuitem" onClick={() => { onFilter(c); closeMenu(); }}>{t('db.filterByColumn')}</button>}
                    {onHide && c !== TITLE && (
                      <button
                        role="menuitem"
                        onClick={() => {
                          onHide(c);
                          setMenu(null);
                          // 숨긴 열의 머리는 사라지므로, 다시 그린 뒤 남은 첫 머리로 초점을 옮긴다
                          setTimeout(() => scroller.current?.querySelector<HTMLButtonElement>('.dbtable__thbtn')?.focus({ preventScroll: true }), 0);
                        }}
                      >
                        {t('db.hideColumn')}
                      </button>
                    )}
                  </div>,
                  document.body,
                )}
              <i className="dbtable__grip" onPointerDown={(e) => drag(c, e)} />
            </div>
          ))}
        </div>
        {!empty && (<div style={{ height: v.getTotalSize(), position: 'relative' }}>
          {v.getVirtualItems().map((vi) => {
            const item = items[vi.index]!;
            if (item.kind === 'group') {
              return (
                <div key={item.key} className="dbtable__group" role="row" style={{ transform: `translateY(${vi.start}px)`, height: ROW_H, paddingLeft: 10 + item.depth * 18 }}>
                  <strong>{groupLabel(item)}</strong> <span className="count">{item.count}</span>
                  {item.hidden > 0 && <span className="muted small"> · {t('db.groupMore', { count: item.hidden })}</span>}
                </div>
              );
            }
            const row = item.row;
            return (
              <div
                key={`${vi.index}:${row.path}`}
                className={`dbtable__row${dragRow && dragRow !== row.path ? ' dropable' : ''}${picked.has(row.path) ? ' picked' : ''}`}
                role="row"
                aria-selected={onRowAction ? picked.has(row.path) : undefined}
                style={{ transform: `translateY(${vi.start}px)`, height: ROW_H }}
                onContextMenu={
                  onRowAction
                    ? (e) => {
                        if ((e.target as HTMLElement).closest('input, textarea, select')) return;
                        e.preventDefault();
                        if (!picked.has(row.path)) setPicked(new Set([row.path]));
                        anchor.current = row.path;
                        setRowMenu({ x: e.clientX, y: e.clientY });
                      }
                    : undefined
                }
                onDragOver={(e) => rowsMovable && dragRow && e.preventDefault()}
                onDrop={(e) => {
                  if (!rowsMovable || !dragRow) return;
                  e.preventDefault();
                  onReorderRows!(movedRows(rows.map((r) => r.path), dragRow, row.path));
                  setDragRow(null);
                }}
              >
                {rowsMovable && (
                  <span className="dbtable__rowgrip" draggable title={t('db.rowGrip')} aria-label={t('db.rowGrip')} onDragStart={() => setDragRow(row.path)} onDragEnd={() => setDragRow(null)}>
                    ⋮⋮
                  </span>
                )}
                {onRowAction && (
                  <input
                    type="checkbox"
                    className="dbtable__check"
                    checked={picked.has(row.path)}
                    aria-label={t('db.rowSelect', { title: row.title })}
                    onChange={() => undefined}
                    onClick={(e) => toggleRow(row.path, e.shiftKey)}
                  />
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
                            aria-label={t('db.renameTitle')}
                            onClick={(e) => e.stopPropagation()}
                            onBlur={(e) => {
                              const title = e.target.value.trim();
                              setRenaming(null);
                              if (title && title !== row.title) onRenameTitle?.(row, title);
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
                            title={t('db.renameHint', { path: row.path })}
                          >
                            {row.title}
                          </button>
                        )
                      ) : prop && isEditable(prop) && (isEd || prop.type === 'checkbox' || prop.type === 'select' || prop.type === 'status' || prop.type === 'multi_select' || prop.type === 'relation' || (prop.type === 'number' && prop.format === 'stars')) ? (
                        <div
                          onBlurCapture={(e) => {
                            // 날짜 고르기 창(화면 위에 띄움)으로 초점이 옮겨 가는 것은 편집을 끝낸 것이 아니다
                            const to = e.relatedTarget instanceof Element ? e.relatedTarget : null;
                            if (isEd && prop.type !== 'date' && !to?.closest('.datepicker')) setEditing(null);
                          }}
                        >
                          <CellEditor prop={prop} value={value} notes={notes} autoFocus={isEd} onDone={() => setEditing(null)} onCommit={(nv) => { onEdit(row, c, nv); if (isEd && prop.type !== 'date') setEditing(null); }} />
                        </div>
                      ) : data.errors[row.path]?.[c] ? (
                        <span className="cell__error" title={data.errors[row.path]![c]} role="img" aria-label={t('db.cellError', { message: data.errors[row.path]![c] })}>
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
        </div>)}
        {!empty && data.view.calc && (
          <div className="dbtable__calc" role="row">
            {cols.map((c) => (
              <div key={c} className="dbtable__td" style={{ width: w(c) }}>
                {data.view.calc?.[c] ? `${calcLabel(data.view.calc[c]!)} ${fmtCalc(data.calc[c])}` : ''}
              </div>
            ))}
          </div>
        )}
      </div>
      {empty && <div className="dbtable__empty">{empty}</div>}
    </div>
  );
}
