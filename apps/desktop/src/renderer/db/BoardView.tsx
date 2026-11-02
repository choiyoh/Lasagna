import { useState, type ReactNode } from 'react';
import { optionsOf } from '@nopsidian/core/db/values';
import { coverOf } from './ListGalleryViews';import { CellView } from './CellEditor';
import { chipBorderColor } from './chip-color';
import { cellOf, TITLE, visibleColumns, type CellValue, type DbData, type DbRowDto } from './types';

interface Props {
  data: DbData;
  onOpen: (path: string) => void;
  /** 카드를 다른 열로 옮기면 그룹 속성 값을 바꾼다(key null = 비우기) */
  onMove: (row: DbRowDto, prop: string, value: CellValue) => void;
  onAdd: (groupKey: string | null) => void;
  /** 있으면 본문의 첫 이미지를 카드 위에 커버로 보인다 */
  vaultId?: string;
  /** 카드를 다른 카드 앞에 놓았을 때 보드 전체의 새 순서(노트 경로) */
  onReorder?: (order: string[]) => void;
  /** 필터 결과가 0행일 때 열 머리 아래에 그릴 내용 */
  empty?: ReactNode;
}

/** 보드(칸반) 뷰: 그룹 속성의 값마다 열, 카드를 끌어다 놓으면 값이 바뀐다. */
export function BoardView({ data, onOpen, onMove, onAdd, onReorder, vaultId, empty }: Props) {
  const prop = data.view.groupBy;
  const def = prop ? data.schema.properties[prop] : undefined;
  const [over, setOver] = useState<string | null | undefined>(undefined);
  const [dragging, setDragging] = useState<DbRowDto | null>(null);
  const isEmpty = !!empty;
  if (!prop || !data.groups) {
    return empty ? (
      <div className="dbboard dbboard--empty dbboard--nogroup" data-testid="db-board">
        <div className="dbboard__empty">{empty}</div>
      </div>
    ) : (
      <p className="muted pad">보드 보기에는 그룹 속성이 필요해요. 위쪽 ‘그룹’에서 선택·상태 같은 속성을 골라 주세요.</p>
    );
  }
  const cols = visibleColumns(data).filter((c) => c !== TITLE && c !== prop).slice(0, 3);
  const colorOf = (key: string | null) => (key && def ? optionsOf(def).find((o) => o.name === key)?.color : undefined);
  const keyOf = (k: string | null) => k ?? '\u0000';

  return (
    <div className={isEmpty ? `dbboard dbboard--empty${data.groups.length === 0 ? ' dbboard--nogroup' : ''}` : 'dbboard'} data-testid="db-board">
      {data.groups.map((g) => (
        <section
          key={keyOf(g.key)}
          className={over === g.key && dragging ? 'dbboard__col over' : 'dbboard__col'}
          data-testid={`board-col-${g.key ?? 'none'}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(g.key);
          }}
          onDragLeave={() => setOver(undefined)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(undefined);
            if (dragging && cellOf(dragging, prop) !== g.key) onMove(dragging, prop, g.key);
            setDragging(null);
          }}
        >
          <h4 style={{ borderTopColor: chipBorderColor(colorOf(g.key)) }}>
            {g.label} <span className="count">{g.count}</span>
          </h4>
          {!isEmpty && (
            <div className="dbboard__cards">
              {g.rows.map((r) => (
                <article
                  key={r.path}
                  className="dbcard"
                  data-testid="board-card"
                  draggable
                  onDragStart={() => setDragging(r)}
                  onDragEnd={() => setDragging(null)}
                  onDragOver={(e) => {
                    if (!dragging || !onReorder) return;
                    e.preventDefault();
                    e.stopPropagation();
                    setOver(g.key);
                  }}
                  onDrop={(e) => {
                    if (!dragging || !onReorder) return;
                    e.preventDefault();
                    e.stopPropagation();
                    setOver(undefined);
                    if (dragging.path !== r.path) {
                      const order = data.groups!.flatMap((x) => x.rows.map((y) => y.path)).filter((p) => p !== dragging.path);
                      order.splice(order.indexOf(r.path), 0, dragging.path);
                      onReorder(order);
                      if (cellOf(dragging, prop) !== g.key) onMove(dragging, prop, g.key);
                    }
                    setDragging(null);
                  }}
                >
                  {vaultId && coverOf(data, r, vaultId) && <img className="dbcard__cover" src={coverOf(data, r, vaultId)!} alt="" loading="lazy" draggable={false} />}
                  <button className="dbcard__title" onClick={() => onOpen(r.path)}>
                    {r.title}
                  </button>
                  {cols.map((c) => (
                    <div key={c} className="dbcard__prop">
                      <CellView prop={data.schema.properties[c]} value={cellOf(r, c)} />
                    </div>
                  ))}
                </article>
              ))}
              {g.hidden > 0 && <p className="muted small">… 외 {g.hidden}개</p>}
            </div>
          )}
          <button className="dbboard__add" onClick={() => onAdd(g.key)}>
            + 새 행
          </button>
        </section>
      ))}
      {empty && <div className="dbboard__empty">{empty}</div>}
    </div>
  );
}
