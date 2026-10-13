import { useMemo, useState } from 'react';
import { addDays, daysBetween, parseYmd, rowSpan, shiftValue, startOfWeek, ymd } from './date-util';
import type { CellValue, DbData, DbRowDto } from './types';

interface Props {
  data: DbData;
  rows: DbRowDto[];
  onOpen: (path: string) => void;
  onMove: (row: DbRowDto, prop: string, value: CellValue) => void;
  onAdd: (date: string) => void;
  onOpenDaily: (date: string) => void;
}

const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];

/** 캘린더 뷰(월/주): 날짜 속성 기준으로 행을 날짜 칸에 놓는다. 칩을 다른 날로 끌면 날짜(기간이면 둘 다)가 옮겨진다. */
export function CalendarView({ data, rows, onOpen, onMove, onAdd, onOpenDaily }: Props) {
  const prop = data.view.dateProp ?? Object.entries(data.schema.properties).find(([, p]) => p.type === 'date')?.[0];
  const [anchor, setAnchor] = useState(() => new Date());
  const [mode, setMode] = useState<'month' | 'week'>('month');
  const [drag, setDrag] = useState<DbRowDto | null>(null);
  const today = ymd(new Date());

  const days = useMemo(() => {
    const first = mode === 'month' ? startOfWeek(new Date(anchor.getFullYear(), anchor.getMonth(), 1)) : startOfWeek(anchor);
    const n = mode === 'month' ? 42 : 7;
    return Array.from({ length: n }, (_, i) => addDays(first, i));
  }, [anchor, mode]);

  const byDay = useMemo(() => {
    const m = new Map<string, DbRowDto[]>();
    if (!prop) return m;
    const first = days[0]!;
    const last = days[days.length - 1]!;
    for (const r of rows) {
      const s = rowSpan(r, prop);
      if (!s || s.end < first || s.start > last) continue;
      for (let d = s.start < first ? first : s.start; d <= (s.end > last ? last : s.end); d = addDays(d, 1)) {
        const k = ymd(d);
        (m.get(k) ?? m.set(k, []).get(k)!).push(r);
      }
    }
    return m;
  }, [rows, prop, days]);

  if (!prop) return <p className="muted pad">캘린더 뷰에는 날짜 속성이 필요해요. 속성 관리에서 “날짜” 속성을 추가해 주세요.</p>;
  const move = (dir: number) => setAnchor((a) => (mode === 'month' ? new Date(a.getFullYear(), a.getMonth() + dir, 1) : addDays(a, dir * 7)));
  const title = mode === 'month' ? `${anchor.getFullYear()}년 ${anchor.getMonth() + 1}월` : `${ymd(days[0]!)} ~ ${ymd(days[6]!)}`;

  return (
    <div className="dbcal" data-testid="db-calendar">
      <div className="dbcal__bar">
        <button onClick={() => move(-1)} aria-label="이전">‹</button>
        <strong>{title}</strong>
        <button onClick={() => move(1)} aria-label="다음">›</button>
        <button onClick={() => setAnchor(new Date())}>오늘</button>
        <select value={mode} onChange={(e) => setMode(e.target.value as 'month' | 'week')} aria-label="달력 단위">
          <option value="month">월</option>
          <option value="week">주</option>
        </select>
        <span className="muted small">날짜 속성: {prop}</span>
      </div>
      <div className={mode === 'month' ? 'dbcal__grid' : 'dbcal__grid week'}>
        {WEEKDAYS.map((w) => (
          <div key={w} className="dbcal__dow">{w}</div>
        ))}
        {days.map((d) => {
          const k = ymd(d);
          const items = byDay.get(k) ?? [];
          const dim = mode === 'month' && d.getMonth() !== anchor.getMonth();
          return (
            <div
              key={k}
              className={`dbcal__day${dim ? ' dim' : ''}${k === today ? ' today' : ''}`}
              data-date={k}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (!drag) return;
                const s = rowSpan(drag, prop);
                if (s) {
                  const shift = daysBetween(s.start, d);
                  if (shift !== 0) onMove(drag, prop, shiftValue((drag.values[prop] ?? null) as CellValue, shift));
                }
                setDrag(null);
              }}
            >
              <div className="dbcal__head">
                <button className="dbcal__num" onClick={() => onOpenDaily(k)} title="데일리 노트 열기">{d.getDate()}</button>
                <button className="dbcal__add" onClick={() => onAdd(k)} aria-label={`${k} 새 행`}>+</button>
              </div>
              {items.slice(0, mode === 'month' ? 4 : 30).map((r) => (
                <button key={r.path} className="dbcal__chip" draggable onDragStart={() => setDrag(r)} onDragEnd={() => setDrag(null)} onClick={() => onOpen(r.path)} title={r.title}>
                  {r.title}
                </button>
              ))}
              {mode === 'month' && items.length > 4 && <span className="muted small">+{items.length - 4}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { parseYmd };
