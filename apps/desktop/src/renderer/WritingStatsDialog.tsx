import { useEffect, useMemo, useRef, useState } from 'react';
import { formatNumber, t } from '@nopsidian/i18n';
import {
  STATS_SCALE_MAX,
  StatsSeries,
  addDays,
  barPercent,
  calendarCells,
  dateKey,
  daysInMonth,
  heatLevel,
  monthTotals,
  startOfMonth,
  summarize,
  type StatsDayValue,
  type StatsHistory,
} from '@nopsidian/core';
import { canRestoreFocus, trapFocus } from './focus-guard';

interface Props {
  vaultId: string;
  /** 범위 선택지(작품 폴더) */
  works: readonly string[];
  /** 열 때의 범위(작품 카드에서 열면 그 작품, ⌘P 면 열린 작품) */
  initialWork: string | null;
  locale: 'ko' | 'en';
  /** 하루 목표(볼트 공통). 없으면 목표선·점·범례를 모두 뺀다. */
  dailyGoal: number | null;
  onClose: () => void;
}

/** 월요일부터 7일의 요일 이름 — 사전 대신 Intl 로 만든다(한/영 모두). */
function weekdayLabels(locale: 'ko' | 'en'): string[] {
  const format = new Intl.DateTimeFormat(locale, { weekday: 'short' });
  return Array.from({ length: 7 }, (_, i) => format.format(new Date(2024, 0, 1 + i, 12)));
}

/**
 * 쓰기 통계 — 날짜별 기록(PR 1)을 요약·최근 30일 막대·달력으로 보여 준다.
 * 읽기만 한다(통계 파일은 볼트가 아니라 userData 에 있고, 여기서는 조회만 한다).
 */
export function WritingStatsDialog({ vaultId, works, initialWork, locale, dailyGoal, onClose }: Props) {
  const today = useMemo(() => dateKey(new Date()), []);
  const [history, setHistory] = useState<StatsHistory>({});
  const [failed, setFailed] = useState(false);
  const [work, setWork] = useState<string | null>(initialWork);
  const [month, setMonth] = useState(() => startOfMonth(today));
  const [numbers, setNumbers] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const firstRef = useRef<HTMLButtonElement | null>(null);
  /** 이 대화상자를 연 요소 — 닫으면 여기로 초점을 돌려준다. */
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => {
      if (boxRef.current?.contains(document.activeElement)) return;
      (firstRef.current ?? boxRef.current)?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      const opener = openerRef.current;
      requestAnimationFrame(() => {
        if (opener?.isConnected && canRestoreFocus()) opener.focus();
      });
    };
  }, []);

  // 어디에 초점이 있어도(대화상자 빈 곳을 눌러 포커스가 빠져도) Esc 로 닫는다.
  // 위에 다른 overlay 가 열려 있으면 그쪽이 처리하도록 양보한다.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const ours = boxRef.current?.closest('.dialog-backdrop') ?? null;
      const others = [...document.querySelectorAll('.dialog-backdrop, .switcher, .nops-prompt, .ctxmask')].filter((el) => el !== ours);
      if (others.length > 0) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  // 통계 파일은 하루 1항목이라 10년치도 작다 — 한 번에 읽어 연속·달력 이동을 다시 조회 없이 한다.
  useEffect(() => {
    let alive = true;
    void window.nops.settings
      .writerHistory({ vaultId, from: addDays(today, -3649), to: today })
      .then((data) => {
        if (alive) setHistory(data);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [vaultId, today]);

  const series = useMemo(() => new StatsSeries(history, work, today, dailyGoal), [history, work, today, dailyGoal]);
  const summary = useMemo(() => summarize(series, today, month), [series, today, month]);
  const shown = useMemo(() => monthTotals(series, month), [series, month]);
  const last30 = useMemo(() => series.last30(), [series]);

  const fmt = (kind: 'day' | 'dayWeek' | 'month' | 'asOf', date: string) => {
    const at = new Date(`${date}T12:00:00`);
    const options: Intl.DateTimeFormatOptions =
      kind === 'day'
        ? { month: 'long', day: 'numeric' }
        : kind === 'dayWeek'
          ? { month: 'long', day: 'numeric', weekday: 'short' }
          : kind === 'month'
            ? { year: 'numeric', month: 'long' }
            : { month: 'long', day: 'numeric', weekday: 'short' };
    return new Intl.DateTimeFormat(locale, options).format(at);
  };
  /** 막대 툴팁·축의 짧은 날짜(10/21) — 로케일과 무관하게 같은 모양. */
  const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
  const charsValue = (chars: number) => t('stats.charsValue', { chars: formatNumber(chars, locale) });
  const daysValue = (days: number) =>
    t(days === 1 ? 'stats.daysValue.one' : 'stats.daysValue.other', { days: formatNumber(days, locale) });

  const dayLabel = (day: StatsDayValue) => {
    const date = fmt('dayWeek', day.date);
    if (!day.recorded) return t('stats.dayNone', { date });
    return t(day.goalMet ? 'stats.dayMet' : 'stats.dayChars', { date, value: charsValue(day.chars) });
  };

  const goalGoal = dailyGoal !== null && dailyGoal > 0 ? dailyGoal : null;

  const cells = calendarCells(month);
  const weekdays = weekdayLabels(locale);
  const canPrev = true; // 과거는 10년 보존 상한까지 열 수 있다.
  const nextMonth = addDays(startOfMonth(addDays(month, daysInMonth(month))), 0);
  const canNext = nextMonth <= startOfMonth(today);

  const step = (delta: number) => {
    const at = new Date(`${month}T12:00:00`);
    at.setMonth(at.getMonth() + delta);
    setMonth(dateKey(new Date(at.getFullYear(), at.getMonth(), 1, 12)));
  };

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="dialog statsdlg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="stats-title"
        data-testid="stats-dialog"
        ref={boxRef}
        onKeyDown={(e) => trapFocus(e, boxRef.current)}
      >
        <div className="statsdlg__head">
          <h3 className="statsdlg__title" id="stats-title">
            {t('stats.title')}
          </h3>
          <button className="statsdlg__close" aria-label={t('stats.close')} title={t('stats.closeHint')} onClick={onClose} data-testid="stats-close">
            ×
          </button>
        </div>

        <div className="scope">
          <div className="scope__seg" role="group" aria-label={t('stats.scope')}>
            <button
              ref={firstRef}
              className={work === null ? 'on' : undefined}
              aria-pressed={work === null}
              data-testid="stats-scope-vault"
              onClick={() => setWork(null)}
            >
              {t('stats.scopeVault')}
            </button>
            <select
              className="scope__work"
              aria-label={t('stats.scopeWork')}
              data-testid="stats-scope-work"
              value={work ?? ''}
              onChange={(e) => setWork(e.target.value || null)}
            >
              <option value="">{t('stats.scopeWork')} ▾</option>
              {works.map((name) => (
                <option key={name} value={name}>
                  {name === ':outside' ? t('stats.scopeOutside') : name}
                </option>
              ))}
            </select>
          </div>
          <span className="scope__date" data-testid="stats-asof">
            {t('stats.asOf', { date: fmt('asOf', today) })}
          </span>
        </div>

        <div className="statsdlg__nums" data-testid="stats-summary">
          <div className="num">
            <div className="num__lbl">{t('stats.week')}</div>
            <div className="num__val" data-testid="stats-week">
              {charsValue(summary.weekTotal)}
            </div>
            <div className="num__sub">{t('stats.weekSub')}</div>
          </div>
          <div className="num">
            <div className="num__lbl">{t('stats.month')}</div>
            <div className="num__val" data-testid="stats-month">
              {charsValue(summary.monthTotal)}
            </div>
            <div className="num__sub" data-testid="stats-month-sub">
              {t('stats.monthSub', {
                days: formatNumber(summary.monthElapsedDays, locale),
                written: formatNumber(summary.monthWrittenDays, locale),
              })}
            </div>
          </div>
          <div className="num">
            <div className="num__lbl">{t('stats.average')}</div>
            <div className="num__val" data-testid="stats-average">
              {charsValue(summary.writtenDayAverage)}
            </div>
            <div className="num__sub" data-testid="stats-average-sub">
              {summary.monthAverage > 0
                ? t('stats.averageSub', { value: charsValue(summary.monthAverage) })
                : t('stats.averageSubNone')}
            </div>
          </div>
          <div className="num">
            <div className="num__lbl">{t('stats.streak')}</div>
            <div className="num__val" data-testid="stats-streak">
              {daysValue(summary.streak)}
            </div>
            <div className="num__sub" data-testid="stats-streak-sub">
              {t('stats.streakSub', { days: daysValue(summary.longestStreak) })}
            </div>
          </div>
        </div>

        <div className="chart">
          <div className="sect-lbl">
            <span>{t('stats.last30')}</span>
            <span className="hint" data-testid="stats-scale">
              {goalGoal
                ? t('stats.scaleGoal', { goal: formatNumber(goalGoal, locale) })
                : t('stats.scaleNoGoal')}
            </span>
          </div>
          {numbers ? (
            <div className="stats__numbers" data-testid="stats-numbers">
              <table className="stats-table">
                <caption className="sr-only">{t('stats.tableCaption')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('stats.tableDate')}</th>
                    <th scope="col">{t('stats.tableChars')}</th>
                    <th scope="col">{t('stats.tableGoal')}</th>
                  </tr>
                </thead>
                <tbody>
                  {last30.map((day) => (
                    <tr key={day.date}>
                      <td>{fmt('dayWeek', day.date)}</td>
                      <td className="num">{day.recorded ? formatNumber(day.chars, locale) : t('stats.legendNone')}</td>
                      <td>{day.goalMet ? t('stats.tableMet') : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <>
              <div
                className="plot"
                role="img"
                aria-label={t('stats.chartAria', { value: charsValue(last30.reduce((sum, day) => sum + day.chars, 0)) })}
              >
                <div className="plot__baseline" />
                <div className="bars" aria-hidden>
                  {/* 목표선은 막대 영역(바닥 16px 위 72px) 기준이라 눈금과 정확히 맞는다. 4,000자를 넘는 목표는 위에 붙는다. */}
                  {goalGoal && <div className="plot__goalline" style={{ bottom: `${barPercent(goalGoal)}%` }} data-testid="stats-goalline" />}
                  {last30.map((day) => (
                    <div className={day.date === today ? 'bar is-today' : 'bar'} key={day.date}>
                      <span
                        className={
                          !day.recorded
                            ? 'bar__fill is-before'
                            : day.chars === 0
                              ? 'bar__fill is-zero'
                              : day.goalMet
                                ? 'bar__fill is-goal'
                                : 'bar__fill'
                        }
                        style={!day.recorded || day.chars === 0 ? undefined : { height: `${barPercent(day.chars)}%` }}
                      />
                      <span className="tip">
                        {day.recorded
                          ? `${md(day.date)} · ${charsValue(day.chars)}`
                          : t('stats.dayNone', { date: md(day.date) })}
                        {day.chars > STATS_SCALE_MAX && <span className="over"> ▲</span>}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="axis">
                <span>{md(last30[0]?.date ?? today)}</span>
                <span>{md(last30[10]?.date ?? today)}</span>
                <span>{md(last30[20]?.date ?? today)}</span>
                <span>{`${t('work.today')} ${md(today)}`}</span>
              </div>
              <div className="legend">
                <span className="sw">
                  <span className="chip none" /> {t('stats.legendNone')}
                </span>
                <span className="sw">
                  <span className="chip l1" /> {t('stats.legend1')}
                </span>
                <span className="sw">
                  <span className="chip l2" /> {t('stats.legend2')}
                </span>
                <span className="sw">
                  <span className="chip l3" /> {t('stats.legend3')}
                </span>
                <span className="sw">
                  <span className="chip l4" /> {t('stats.legend4')}
                </span>
                {goalGoal && (
                  <span className="sw legend__goal">
                    <span className="dash" /> {t('stats.legendGoal')}
                    <span className="dot" /> {t('stats.legendMet')}
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        <div className="cal">
          <div className="cal__head">
            <span className="cal__title">{fmt('month', month)}</span>
            <span className="cal__nav">
              <button
                aria-label={t('stats.prevMonth')}
                title={t('stats.prevMonth')}
                data-testid="stats-prev-month"
                onClick={() => step(-1)}
                disabled={!canPrev}
              >
                ‹
              </button>
              <button
                aria-label={t('stats.nextMonth')}
                title={t('stats.nextMonth')}
                data-testid="stats-next-month"
                onClick={() => step(1)}
                disabled={!canNext}
              >
                ›
              </button>
            </span>
            <span className="cal__sum" data-testid="stats-month-sum">
              {t('stats.monthSum', { value: charsValue(shown.total), days: formatNumber(shown.goalDays, locale) })}
            </span>
          </div>
          <table className="cal__grid" data-testid="stats-calendar">
            <thead>
              <tr>
                {weekdays.map((name) => (
                  <th className="cal__dow" scope="col" key={name}>
                    {name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 6 }, (_, row) => (
                <tr key={row}>
                  {Array.from({ length: 7 }, (_, col) => {
                    const date = cells[row * 7 + col] ?? null;
                    if (!date) return <td className="cal__cell blank" key={col} />;
                    const day = series.day(date);
                    const level = day.recorded ? heatLevel(day.chars) : 0;
                    const className = [
                      'cal__cell',
                      // 기록 전과 '쓴 날 0자' 는 모두 빗금이고, 0자만 짧은 선을 더한다(모양으로 구분).
                      // 아직 오지 않은 날은 빗금 없이 흐리게만(아직 아무것도 정해지지 않았다).
                      day.future ? '' : day.recorded && day.chars > 0 ? `l${level}` : 'none',
                      !day.future && day.recorded && day.chars === 0 ? 'zero' : '',
                      day.goalMet ? 'goal' : '',
                      day.future ? 'future' : '',
                      date === today ? 'today' : '',
                    ]
                      .filter(Boolean)
                      .join(' ');
                    return (
                      <td className={className} key={col} aria-label={dayLabel(day)} title={dayLabel(day)} data-date={date}>
                        {Number(date.slice(-2))}
                        <span className="tip">{dayLabel(day)}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="statsdlg__foot">
          <span data-testid="stats-foot">
            {failed
              ? t('stats.footEmpty')
              : series.firstDate
                ? `${t('stats.footStart', { date: fmt('day', series.firstDate) })} · ${t('stats.footLoss')}`
                : t('stats.footEmpty')}
          </span>
          <span className="acts">
            <button data-testid="stats-toggle-numbers" onClick={() => setNumbers((v) => !v)}>
              {numbers ? t('stats.hideNumbers') : t('stats.showNumbers')}
            </button>
            <button data-testid="stats-done" onClick={onClose}>
              {t('stats.close')}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
