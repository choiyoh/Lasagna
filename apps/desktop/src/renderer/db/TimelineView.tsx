import { useEffect, useMemo, useState } from 'react';
import { addDays, daysBetween, parseYmd, rowSpan, ymd } from './date-util';
import { applyDrag, dxToDays, spanToValue, type DragMode } from './timeline-math';
import type { CellValue, DbData, DbRowDto } from './types';

interface Props {
  data: DbData;
  rows: DbRowDto[];
  onOpen: (path: string) => void;
  /** 끌기·늘이기 결과를 저장할 때 부른다. 없으면 끌기가 비활성이고 클릭(노트 열기)만 동작한다. */
  onChange?: (row: DbRowDto, prop: string, value: CellValue) => void;
}

const SCALES = { day: 36, week: 14, month: 4 } as const;
const ROW_H = 30;
const LABEL_W = 220;

/** 타임라인 뷰: 날짜 속성의 기간을 가로 막대로 보여 준다(축 단위 일/주/월). 막대를 끌어 옮기고 양 끝을 끌어 기간을 바꾼다. */
export function TimelineView({ data, rows, onOpen, onChange }: Props) {
  const prop = data.view.dateProp ?? Object.entries(data.schema.properties).find(([, p]) => p.type === 'date')?.[0];
  const [scale, setScale] = useState<keyof typeof SCALES>('week');
  const px = SCALES[scale];

  const { items, undated, first, span } = useMemo(() => {
    const items: { row: DbRowDto; start: Date; end: Date }[] = [];
    const undated: DbRowDto[] = [];
    if (prop) {
      for (const r of rows) {
        const s = rowSpan(r, prop);
        if (s) items.push({ row: r, start: s.start, end: s.end });
        else undated.push(r);
      }
    }
    items.sort((a, b) => a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime());
    const today = new Date();
    const min = items.length ? items[0]!.start : today;
    const max = items.reduce((m, i) => (i.end > m ? i.end : m), items[0]?.end ?? today);
    const first = addDays(min < today ? min : today, -3);
    const last = addDays(max > today ? max : today, 7);
    return { items, undated, first, span: daysBetween(first, last) + 1 };
  }, [rows, prop]);

  const ticks = useTicks(first, span, scale);
  if (!prop) return <p className="muted pad">타임라인 보기에는 날짜 속성이 필요해요. 속성 관리에서 “날짜” 속성을 추가해 주세요.</p>;
  const todayX = daysBetween(first, new Date()) * px;

  return (
    <div className="dbtl" data-testid="db-timeline">
      <div className="dbtl__bar">
        <select value={scale} onChange={(e) => setScale(e.target.value as keyof typeof SCALES)} aria-label="축 단위">
          <option value="day">일</option>
          <option value="week">주</option>
          <option value="month">월</option>
        </select>
        <span className="muted small">날짜 속성: {prop}</span>
      </div>
      <div className="dbtl__scroll">
        <div className="dbtl__inner" style={{ width: LABEL_W + span * px }}>
          <div className="dbtl__axis" style={{ marginLeft: LABEL_W }}>
            {ticks.map((t) => (
              <span key={t.label + t.x} style={{ left: t.x * px }}>{t.label}</span>
            ))}
          </div>
          <div className="dbtl__today" style={{ left: LABEL_W + todayX }} />
          {items.map(({ row, start, end }) => (
            <div key={row.path} className="dbtl__row" style={{ height: ROW_H }}>
              <button className="dbtl__label" style={{ width: LABEL_W }} onClick={() => onOpen(row.path)} title={row.path}>{row.title}</button>
              <TimelineBar row={row} start={start} end={end} first={first} px={px} propName={prop} onOpen={onOpen} onChange={onChange} />
            </div>
          ))}
          {undated.length > 0 && <p className="muted small pad">날짜가 없는 행 {undated.length}개: {undated.slice(0, 8).map((r) => r.title).join(', ')}{undated.length > 8 ? ' …' : ''}</p>}
        </div>
      </div>
    </div>
  );
}

interface BarProps {
  row: DbRowDto;
  start: Date;
  end: Date;
  first: Date;
  px: number;
  propName: string;
  onOpen: (path: string) => void;
  onChange?: (row: DbRowDto, prop: string, value: CellValue) => void;
}

interface DragState {
  mode: DragMode;
  /** pointerdown 시점의 clientX — 이동량(dx)은 여기서 잰다 */
  startX: number;
  dx: number;
}

/**
 * 행 하나의 기간 막대.
 * 본체를 끌면 기간 전체를 옮기고, 좌·우 8px 손잡이(`.dbtl__handle.start/end`)를 끌면 그쪽 끝만 늘어난다.
 * 끌기 중에는 left/width 를 임시로 바꿔 결과를 미리 보여 주고, 손을 떼면 값으로 저장한다.
 * 거의 움직이지 않았으면(pxPerDay/3 미만) 끌기가 아니라 클릭으로 보고 노트를 연다. Esc 는 끌기 취소.
 */
function TimelineBar({ row, start, end, first, px, propName, onOpen, onChange }: BarProps) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragging = drag !== null;
  // 원래 값에 시각(T HH:mm)이 있었으면 옮겨도 유지한다
  const time = rowSpan(row, propName)?.time ?? null;

  useEffect(() => {
    if (!dragging) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrag(null); // 미리 보기만 지우고 값은 건드리지 않는다
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dragging]);

  const shown = drag ? applyDrag({ start, end }, drag.mode, dxToDays(drag.dx, px)) : { start, end };
  const left = daysBetween(first, shown.start) * px;
  const width = Math.max(px * 0.8, (daysBetween(shown.start, shown.end) + 1) * px);

  const begin = (e: React.PointerEvent, mode: DragMode) => {
    if (!onChange) return;
    e.preventDefault();
    e.stopPropagation(); // 손잡이 끌기가 막대 본체(이동) 끌기로 번지지 않게
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ mode, startX: e.clientX, dx: 0 });
  };

  const finish = (e: React.PointerEvent) => {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    setDrag(null);
    if (Math.abs(dx) < px / 3) {
      onOpen(row.path); // 끌지 않고 눌렀다 — 클릭
      return;
    }
    const days = dxToDays(dx, px);
    if (!onChange || days === 0) return; // 한 칸도 못 움직였으면 값이 바뀌지 않는다
    onChange(row, propName, spanToValue(applyDrag({ start, end }, drag.mode, days), time));
  };

  return (
    <div
      className="dbtl__bar-wrap"
      onPointerMove={onChange ? (e) => { if (drag) setDrag({ ...drag, dx: e.clientX - drag.startX }); } : undefined}
      onPointerUp={onChange ? finish : undefined}
      onPointerCancel={onChange ? () => setDrag(null) : undefined}
    >
      <div
        className={`dbtl__barx${dragging ? ' dragging' : ''}`}
        data-testid="timeline-bar"
        data-path={row.path}
        style={{ left, width }}
        title={`${ymd(start)} → ${ymd(end)}`}
        onPointerDown={onChange ? (e) => begin(e, 'move') : undefined}
        onClick={onChange ? undefined : () => onOpen(row.path)}
      >
        {onChange && (
          <>
            <span className="dbtl__handle start" onPointerDown={(e) => begin(e, 'resize-start')} />
            <span className="dbtl__handle end" onPointerDown={(e) => begin(e, 'resize-end')} />
          </>
        )}
      </div>
    </div>
  );
}

function useTicks(first: Date, span: number, scale: keyof typeof SCALES) {
  return useMemo(() => {
    const out: { x: number; label: string }[] = [];
    for (let i = 0; i < span; i++) {
      const d = addDays(first, i);
      if (scale === 'day') out.push({ x: i, label: `${d.getMonth() + 1}/${d.getDate()}` });
      else if (scale === 'week' && d.getDay() === 1) out.push({ x: i, label: `${d.getMonth() + 1}/${d.getDate()}` });
      else if (scale === 'month' && d.getDate() === 1) out.push({ x: i, label: `${d.getFullYear()}.${d.getMonth() + 1}` });
    }
    return out;
  }, [first, span, scale]);
}

export { parseYmd };
