import { useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import { formatMonthTitle, formatWeekdayShort, t } from '@nopsidian/i18n';
import { addDays, parseYmd, ymd } from './date-util';
import { addMonths, fromDateValue, monthGrid, pickRange, sameDay, toDateValue } from './date-picker-math';

interface Props {
  /** 셀 값(문자열 또는 {start,end?} 또는 null) */
  value: unknown;
  /** true 면 시각 입력(HH:mm)도 보인다 */
  includeTime?: boolean;
  /** 바뀔 때마다 부른다(null = 지우기) */
  onCommit: (v: { start: string; end?: string } | null) => void;
  /** Esc·바깥 클릭·"닫기" */
  onClose: () => void;
  autoFocus?: boolean;
}

/** 주는 월요일에서 시작한다(2024-01-01 이 월요일). */
const WEEKDAY_DATES = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i));
const weekdays = () => WEEKDAY_DATES.map((d) => formatWeekdayShort(d));
/** 방향키 이동량(일) */
const ARROW_STEPS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };

/** 그 달 1일(달 표시용) */
const monthOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);

/** 날짜 셀 고르기 팝오버: 작은 달력에서 하루 또는 기간을 고른다. `value` 는 처음 값으로만 읽는다. */
export function DatePicker({ value, includeTime = false, onCommit, onClose, autoFocus }: Props): JSX.Element {
  const [cur, setCur] = useState(() => {
    const s = fromDateValue(value);
    return { start: s.start, end: s.end };
  });
  const [range, setRange] = useState(() => fromDateValue(value).end !== null);
  const [view, setView] = useState(() => monthOf(fromDateValue(value).start ?? new Date()));
  const [focus, setFocus] = useState(() => fromDateValue(value).start ?? new Date());
  const [time, setTime] = useState(() => fromDateValue(value).time ?? '');
  const [startText, setStartText] = useState(() => {
    const s = fromDateValue(value).start;
    return s ? ymd(s) : '';
  });
  const [endText, setEndText] = useState(() => {
    const s = fromDateValue(value).end;
    return s ? ymd(s) : '';
  });

  const rootRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const startInputRef = useRef<HTMLInputElement>(null);
  /** 방향키로 옮긴 뒤에만 DOM 포커스를 옮긴다(처음 열 때 입력칸 포커스를 뺏지 않으려고) */
  const moveFocus = useRef(false);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // autoFocus 면 시작 날짜 입력칸으로
  useEffect(() => {
    if (autoFocus) startInputRef.current?.focus();
  }, [autoFocus]);

  // 바깥 클릭이면 닫는다
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!(e.target instanceof Node) || !rootRef.current?.contains(e.target)) onCloseRef.current();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  // 방향키로 옮긴 날짜 칸에 실제 포커스를 준다
  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${ymd(focus)}"]`)?.focus();
  }, [focus, view]);

  useEffect(() => {
    setStartText(cur.start ? ymd(cur.start) : '');
  }, [cur.start]);
  useEffect(() => {
    setEndText(cur.end ? ymd(cur.end) : '');
  }, [cur.end]);

  const days = useMemo(() => monthGrid(view), [view]);
  const today = new Date();
  const startK = cur.start ? ymd(cur.start) : null;
  const endK = cur.end ? ymd(cur.end) : null;
  const inRange = (k: string) => startK !== null && endK !== null && k > startK && k < endK;

  /** 새 값으로 바꾸고 부모에 알린다 */
  const apply = (start: Date | null, end: Date | null, t: string | null = includeTime ? time || null : null) => {
    setCur({ start, end });
    onCommit(start ? toDateValue(start, end, t) : null);
  };

  const selectDay = (d: Date) => {
    setFocus(d);
    if (range) {
      const next = pickRange(cur, d);
      apply(next.start, next.end);
    } else {
      apply(d, null);
    }
  };

  const goMonth = (n: number) => {
    const next = addMonths(view, n);
    setView(next);
    if (focus.getFullYear() !== next.getFullYear() || focus.getMonth() !== next.getMonth()) setFocus(next);
  };

  const onGridKeyDown = (e: React.KeyboardEvent) => {
    const step = ARROW_STEPS[e.key];
    if (!step) return;
    e.preventDefault();
    const next = addDays(focus, step);
    moveFocus.current = true;
    setFocus(next);
    if (next.getFullYear() !== view.getFullYear() || next.getMonth() !== view.getMonth()) setView(monthOf(next));
  };

  const commitStartText = () => {
    const d = parseYmd(startText);
    if (!d) {
      setStartText(cur.start ? ymd(cur.start) : '');
      return;
    }
    apply(d, cur.end && cur.end.getTime() >= d.getTime() ? cur.end : null);
  };

  const commitEndText = () => {
    const d = parseYmd(endText);
    if (!d || !cur.start || d.getTime() < cur.start.getTime()) {
      setEndText(cur.end ? ymd(cur.end) : '');
      return;
    }
    apply(cur.start, d);
  };

  const commitTime = (v: string) => {
    setTime(v);
    if (cur.start) apply(cur.start, cur.end, v || null);
  };

  return (
    <div
      ref={rootRef}
      className="datepicker"
      role="dialog"
      aria-label={t('datepicker.pick')}
      data-testid="date-picker"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="datepicker__inputs">
        <input
          ref={startInputRef}
          type="text"
          value={startText}
          placeholder="YYYY-MM-DD"
          aria-label={t('datepicker.startDate')}
          onChange={(e) => setStartText(e.target.value)}
          onBlur={commitStartText}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitStartText();
          }}
        />
        {includeTime && <input type="time" value={time} aria-label={t('datepicker.startTime')} onChange={(e) => commitTime(e.target.value)} />}
        {range && (
          <input
            type="text"
            value={endText}
            placeholder="YYYY-MM-DD"
            aria-label={t('datepicker.endDate')}
            onChange={(e) => setEndText(e.target.value)}
            onBlur={commitEndText}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitEndText();
            }}
          />
        )}
      </div>

      <div className="datepicker__head">
        <button type="button" onClick={() => goMonth(-1)} aria-label={t('datepicker.prevMonth')}>
          ‹
        </button>
        <span className="datepicker__title">{formatMonthTitle(view)}</span>
        <button type="button" onClick={() => goMonth(1)} aria-label={t('datepicker.nextMonth')}>
          ›
        </button>
        <button
          type="button"
          onClick={() => {
            const now = new Date();
            setView(monthOf(now));
            selectDay(now);
          }}
        >
          {t('datepicker.today')}
        </button>
      </div>

      <div className="datepicker__dow">
        {weekdays().map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>

      <div ref={gridRef} className="datepicker__grid" onKeyDown={onGridKeyDown}>
        {days.map((d) => {
          const k = ymd(d);
          const selected = (startK !== null && k === startK) || (endK !== null && k === endK);
          const mid = inRange(k);
          const cls = `datepicker__day${d.getMonth() !== view.getMonth() ? ' out' : ''}${sameDay(d, today) ? ' today' : ''}${selected ? ' selected' : ''}${mid ? ' inrange' : ''}`;
          return (
            <button
              key={k}
              type="button"
              role="gridcell"
              className={cls}
              aria-label={k}
              aria-selected={selected || mid}
              data-date={k}
              tabIndex={sameDay(d, focus) ? 0 : -1}
              onClick={() => selectDay(d)}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>

      <div className="datepicker__foot">
        <label>
          <input
            type="checkbox"
            checked={range}
            aria-label={t('datepicker.range')}
            onChange={(e) => {
              setRange(e.target.checked);
              if (!e.target.checked && cur.start) apply(cur.start, null);
            }}
          />
          {t('datepicker.endDate')}
        </label>
        <button
          type="button"
          onClick={() => {
            setTime('');
            apply(null, null);
          }}
        >
          {t('datepicker.clear')}
        </button>
        <button type="button" onClick={onClose}>
          {t('db.close')}
        </button>
      </div>
    </div>
  );
}
