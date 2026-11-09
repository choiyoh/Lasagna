import { useEffect, useState } from 'react';
import { pluralCategory, t, translate } from '@nopsidian/i18n';
import { calcWorkGoal, KAKAO_EPISODE_HINTS, WORK_GOAL_PRESETS, type WorkGoal, type WorkGoalPreset } from '@nopsidian/core';

interface Props {
  work: string;
  locale: 'ko' | 'en';
  goal: WorkGoal | null;
  current: { episodes: number; chars: number; charsNoSpace: number };
  today: Date;
  /** 오늘 쓴 글자수(상태줄과 같은 값) */
  todayChars: number;
  onSave: (goal: WorkGoal | null) => void;
  onSetDaily: (perDay: number) => void;
  onClose: () => void;
}

const fmt = (locale: 'ko' | 'en', n: number) => new Intl.NumberFormat(locale).format(n);

/** 작품 목표 대화상자 — 플랫폼 프리셋은 회당 글자수·기준만 채우고 완결 회차는 힌트로만 보여 준다. */
export function WorkGoalDialog({ work, locale, goal, current, today, todayChars, onSave, onSetDaily, onClose }: Props) {
  const tr = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) => translate(locale, key, params);
  const [preset, setPreset] = useState<WorkGoalPreset>(goal?.preset ?? 'naver');
  const [episodes, setEpisodes] = useState(String(goal?.episodes ?? ''));
  const [perEpisode, setPerEpisode] = useState(String(goal?.perEpisode ?? WORK_GOAL_PRESETS.naver.perEpisode));
  const [basis, setBasis] = useState<'include' | 'exclude'>(goal?.basis ?? WORK_GOAL_PRESETS.naver.basis);
  const [deadline, setDeadline] = useState(goal?.deadline ?? '');
  const [genre, setGenre] = useState(goal?.genre ?? '');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const episodesNum = Number(episodes.replace(/[^\d]/g, ''));
  const perNum = Number(perEpisode.replace(/[^\d]/g, ''));
  const draft: WorkGoal = {
    episodes: Number.isFinite(episodesNum) ? episodesNum : 0,
    perEpisode: Number.isFinite(perNum) ? perNum : 0,
    basis,
    deadline: deadline || null,
    preset,
    genre: genre || null,
  };
  const progress = calcWorkGoal(draft, current, today);

  const choosePreset = (key: WorkGoalPreset) => {
    setPreset(key);
    if (key !== 'custom') {
      setPerEpisode(String(WORK_GOAL_PRESETS[key].perEpisode));
      setBasis(WORK_GOAL_PRESETS[key].basis);
    }
  };

  // 카카오는 선택한 장르의 권장 범위만 힌트로 보여 준다(고르기 전에는 안내 한 줄).
  const hint =
    preset === 'naver' ? tr('workGoal.hint.naver')
    : preset === 'kakao'
      ? genre
        ? tr('workGoal.hint.kakaoGenre', { range: KAKAO_EPISODE_HINTS[genre] ?? '' })
        : tr('workGoal.hint.kakaoPick')
      : preset === 'ridi' ? tr('workGoal.hint.ridi')
      : null;

  const save = () => {
    if (!Number.isFinite(episodesNum) || episodesNum <= 0) {
      setError(tr('workGoal.err.episodes'));
      return;
    }
    if (!Number.isFinite(perNum) || perNum <= 0) {
      setError(tr('workGoal.err.perEpisode'));
      return;
    }
    onSave(draft);
  };

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog workgoaldlg" role="dialog" aria-modal="true" aria-label={tr('workGoal.title')} data-testid="work-goal-dialog">
        <h2>{tr('workGoal.title')}</h2>
        <p className="muted small">{work}</p>
        <div className="workgoaldlg__presets" role="group" aria-label={tr('workGoal.platform')}>
          {(['naver', 'kakao', 'ridi', 'custom'] as const).map((key) => (
            <button
              key={key}
              type="button"
              className={`workchip${preset === key ? ' active' : ''}`}
              data-testid={`work-goal-preset-${key}`}
              aria-pressed={preset === key}
              onClick={() => choosePreset(key)}
            >
              {key === 'custom' ? tr('workGoal.custom') : tr(`writer.preset.${key}` as Parameters<typeof translate>[1])}
            </button>
          ))}
        </div>
        {hint ? <p className="muted small" data-testid="work-goal-hint">{hint}</p> : null}
        {preset === 'kakao' ? (
          <label className="workdlg__field">
            <span>{tr('workGoal.genre')}</span>
            <select data-testid="work-goal-genre" value={genre} onChange={(e) => setGenre(e.target.value)}>
              <option value="">—</option>
              <option value="romanceFantasy">{tr('workGoal.genre.romanceFantasy')}</option>
              <option value="romance">{tr('workGoal.genre.romance')}</option>
              <option value="fantasy">{tr('workGoal.genre.fantasy')}</option>
              <option value="martial">{tr('workGoal.genre.martial')}</option>
            </select>
          </label>
        ) : null}

        <div className="workgoaldlg__grid">
          <label className="workdlg__field">
            <span>{tr('workGoal.episodes')}</span>
            <input data-testid="work-goal-episodes" inputMode="numeric" value={episodes} onChange={(e) => setEpisodes(e.target.value)} />
          </label>
          <label className="workdlg__field">
            <span>{tr('workGoal.perEpisode')}</span>
            <input data-testid="work-goal-per" inputMode="numeric" value={perEpisode} onChange={(e) => setPerEpisode(e.target.value)} />
          </label>
          <label className="workdlg__field">
            <span>{tr('workGoal.basis')}</span>
            <select data-testid="work-goal-basis" value={basis} onChange={(e) => setBasis(e.target.value as 'include' | 'exclude')}>
              <option value="include">{t('settings.writerSpacing.include')}</option>
              <option value="exclude">{t('settings.writerSpacing.exclude')}</option>
            </select>
          </label>
          <label className="workdlg__field">
            <span>{tr('workGoal.deadline')}</span>
            <input type="date" data-testid="work-goal-deadline" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </label>
        </div>
        {error ? <p className="error" role="alert" data-testid="work-goal-error">{error}</p> : null}

        <div className="workgoaldlg__summary" data-testid="work-goal-summary">
          <span>
            {tr(`workGoal.remaining.${pluralCategory(locale, progress.remainingEpisodes)}`, {
              episodes: fmt(locale, progress.remainingEpisodes),
            })}
          </span>
          <span>
            {tr(`workGoal.remainingChars.${pluralCategory(locale, progress.remainingChars)}`, {
              chars: fmt(locale, progress.remainingChars),
            })}
          </span>
          <span>
            {progress.status === 'done'
              ? tr('workGoal.done')
              : progress.status === 'overdue'
                ? tr('workGoal.overdue')
                : progress.status === 'dueToday'
                  ? tr('workGoal.dueToday')
                  : progress.perDay === null
                    ? tr('workGoal.noDeadline')
                    : tr(`workGoal.perDay.${pluralCategory(locale, progress.perDay)}`, { chars: fmt(locale, progress.perDay) })}
          </span>
          {progress.perDay !== null && progress.perDay > 0 ? (
            <span data-testid="work-goal-today">
              {tr(`workGoal.today.${pluralCategory(locale, todayChars)}`, {
                today: fmt(locale, todayChars),
                percent: Math.round((todayChars / progress.perDay) * 100),
              })}
            </span>
          ) : null}
        </div>

        <div className="dialog__actions">
          <button onClick={onClose}>{t('common.cancel')}</button>
          {progress.perDay !== null ? (
            <button data-testid="work-goal-set-daily" onClick={() => onSetDaily(progress.perDay ?? 0)}>
              {tr('workGoal.setDaily')}
            </button>
          ) : null}
          <button className="primary" data-testid="work-goal-save" onClick={save}>
            {tr('workGoal.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
