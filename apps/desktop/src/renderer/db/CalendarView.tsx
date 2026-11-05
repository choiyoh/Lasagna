import { useMemo, useState, type ReactNode } from 'react';
import { formatMonthTitle, formatWeekdayShort, t } from '@nopsidian/i18n';
import { addDays, daysBetween, parseYmd, rowSpan, shiftValue, startOfWeek, ymd } from './date-util';
import { spanToValue } from './timeline-math';
import type { CellValue, DbData, DbRowDto } from './types';

interface Props {
  data: DbData;
  rows: DbRowDto[];
  onOpen: (path: string) => void;
  onMove: (row: DbRowDto, prop: string, value: CellValue) => void;
  onAdd: (date: string) => void;
  onOpenDaily: (date: string) => void;
  /** 필터 결과가 0행일 때 월 이동 바 아래에 그릴 내용 */
  empty?: ReactNode;
}

/** 주는 월요일에서 시작한다. 2024-01-01 이 월요일이라 그 주를 요일 머리글 순서로 쓴다. */
const WEEKDAY_DATES = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i));
const weekdays = () => WEEKDAY_DATES.map((d) => formatWeekdayShort(d));

/** 캘린더 뷰(월/주): 날짜 속성 기준으로 행을 날짜 칸에 놓는다. 칩을 다른 날로 끌면 날짜(기간이면 둘 다)가 옮겨진다. */
export function CalendarView({ data, rows, onOpen, onMove, onAdd, onOpenDaily, empty }: Props) {
  const prop = data.view.dateProp ?? Object.entries(data.schema.properties).find(([, p]) => p.type === 'date')?.[0];
  const [anchor, setAnchor] = useState(() => new Date());
  const [mode, setMode] = useState<'month' | 'week'>('month');
  const [drag, setDrag] = useState<DbRowDto | null>(null);
  /** 칩 끝의 손잡이를 끌고 있는 행 — 놓은 날이 새 종료일 */
  const [resize, setResize] = useState<DbRowDto | null>(null);
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

  if (!prop) {
    return empty ? (
      <div className="dbcal dbcal--empty" data-testid="db-calendar">
        <div className="dbcal__empty">{empty}</div>
      </div>
    ) : (
      <p className="muted pad">{t('calendar.needDateProp')}</p>
    );
  }
  const move = (dir: number) => setAnchor((a) => (mode === 'month' ? new Date(a.getFullYear(), a.getMonth() + dir, 1) : addDays(a, dir * 7)));
  const title = mode === 'month' ? formatMonthTitle(anchor) : `${ymd(days[0]!)} ~ ${ymd(days[6]!)}`;

  return (
    <div className="dbcal" data-testid="db-calendar">
      <div className="dbcal__bar">
        <button onClick={() => move(-1)} aria-label={t('calendar.prev')}>‹</button>
        <strong>{title}</strong>
        <button onClick={() => move(1)} aria-label={t('calendar.next')}>›</button>
        <button onClick={() => setAnchor(new Date())}>{t('calendar.today')}</button>
        <select value={mode} onChange={(e) => setMode(e.target.value as 'month' | 'week')} aria-label={t('calendar.unit')}>
          <option value="month">{t('calendar.month')}</option>
          <option value="week">{t('calendar.week')}</option>
        </select>
        <span className="muted small">{t('calendar.dateProp', { prop })}</span>
      </div>
      {empty && <div className="dbcal__empty">{empty}</div>}
      <div className={mode === 'month' ? 'dbcal__grid' : 'dbcal__grid week'}>
        {weekdays().map((w) => (
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
                if (resize) {
                  const rs = rowSpan(resize, prop);
                  if (rs && d >= rs.start && ymd(d) !== ymd(rs.end)) onMove(resize, prop, spanToValue({ start: rs.start, end: d }, rs.time));
                  setResize(null);
                  return;
                }
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
                <button className="dbcal__num" onClick={() => onOpenDaily(k)} title={t('calendar.openDaily')}>{d.getDate()}</button>
                <button className="dbcal__add" onClick={() => onAdd(k)} aria-label={t('calendar.addRowAria', { date: k })}>+</button>
              </div>
              {items.slice(0, mode === 'month' ? 4 : 30).map((r) => {
                const sp = rowSpan(r, prop);
                const isEnd = !!sp && ymd(sp.end) === k;
                return (
                  <div key={r.path} className="dbcal__item">
                    <button className="dbcal__chip" draggable onDragStart={() => setDrag(r)} onDragEnd={() => setDrag(null)} onClick={() => onOpen(r.path)} title={r.title}>
                      {r.title}
                    </button>
                    {isEnd && (
                      <span
                        className="dbcal__handle"
                        draggable
                        title={t('calendar.resizeHint')}
                        data-testid="cal-resize"
                        onDragStart={(e) => {
                          e.stopPropagation();
                          setResize(r);
                        }}
                        onDragEnd={() => setResize(null)}
                      />
                    )}
                  </div>
                );
              })}
              {mode === 'month' && items.length > 4 && <span className="muted small">+{items.length - 4}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { parseYmd };
