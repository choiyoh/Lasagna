import { useMemo, useState } from 'react';
import { addDays, daysBetween, parseYmd, rowSpan, ymd } from './date-util';
import type { DbData, DbRowDto } from './types';

interface Props {
  data: DbData;
  rows: DbRowDto[];
  onOpen: (path: string) => void;
}

const SCALES = { day: 36, week: 14, month: 4 } as const;
const ROW_H = 30;
const LABEL_W = 220;

/** 타임라인 뷰: 날짜 속성의 기간을 가로 막대로 보여 준다(축 단위 일/주/월). */
export function TimelineView({ data, rows, onOpen }: Props) {
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
  if (!prop) return <p className="muted pad">타임라인 뷰에는 날짜 속성이 필요해요. 속성 관리에서 “날짜” 속성을 추가해 주세요.</p>;
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
              <div className="dbtl__bar-wrap">
                <div className="dbtl__barx" style={{ left: daysBetween(first, start) * px, width: Math.max(px * 0.8, (daysBetween(start, end) + 1) * px) }} onClick={() => onOpen(row.path)} title={`${ymd(start)} → ${ymd(end)}`} />
              </div>
            </div>
          ))}
          {undated.length > 0 && <p className="muted small pad">날짜가 없는 행 {undated.length}개: {undated.slice(0, 8).map((r) => r.title).join(', ')}{undated.length > 8 ? ' …' : ''}</p>}
        </div>
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
