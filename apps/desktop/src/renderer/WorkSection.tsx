import { formatNumber, pluralCategory, translate } from '@nopsidian/i18n';
import type { WorkSummary } from '@nopsidian/core';

interface Props {
  locale: 'ko' | 'en';
  works: WorkSummary[];
  /** 현재 글자수 기준(공백 포함/제외) */
  spacing: 'include' | 'exclude';
  /** 920px 이하: 칩을 숫자 없이 축약한다(작가 모드에서만) */
  narrow: boolean;
  today: number;
  dailyGoal: number | null;
  onOpenFolder: (path: string) => void;
  onCreateWork: () => void;
  onCreateCharacter: (work: string) => void;
  onCreateEpisode: (work: string) => void;
  /** 작품별 목표선 문구(없으면 목표 설정 버튼) */
  goalLines: Record<string, string>;
  onOpenGoal: (work: string) => void;
}

/** 칩 문구 — 920px 이하에서는 시안대로 숫자를 뺀다. 영어는 1 일 때 단수. */
export function chipText(locale: 'ko' | 'en', kind: 'characters' | 'storyBible', count: number, narrow: boolean): string {
  if (narrow) return translate(locale, kind === 'characters' ? 'work.charactersShort' : 'work.storyBibleShort');
  const base = kind === 'characters' ? 'work.charactersUnit' : 'work.storyBibleUnit';
  return translate(locale, `${base}.${pluralCategory(locale, count)}`, { n: formatNumber(count, locale) });
}

/** 카드 meta 문구 — 언어·글자수 기준을 그대로 반영한다. */
export function workMetaText(locale: 'ko' | 'en', work: Pick<WorkSummary, 'episodes' | 'chars' | 'charsNoSpace'>, spacing: 'include' | 'exclude'): string {
  const n = work.episodes;
  const chars = spacing === 'include' ? work.chars : work.charsNoSpace;
  if (locale === 'en') {
    const episodes = translate('en', `work.episodes.${pluralCategory('en', n)}`, { n: formatNumber(n, 'en') });
    const counted = translate('en', `work.charsUnit.${pluralCategory('en', chars)}`, { n: formatNumber(chars, 'en') });
    return `${episodes} · ${counted}`;
  }
  return `${translate('ko', 'work.episodeUnit', { n: formatNumber(n, 'ko') })} · ${translate('ko', 'work.charsUnit.other', { n: formatNumber(chars, 'ko') })}`;
}

/**
 * 작가용 사이드바의 '작품' 섹션. 작가 모드에서만 렌더된다(일반 모드는 이 DOM 자체가 없다).
 * 카드: 회차 수·총 글자수, 일일 목표가 있으면 오늘 진행 막대. 칩: 캐릭터/설정집(폴더 펼침).
 */
export function WorkSection({ locale, works, spacing, narrow, today, dailyGoal, onOpenFolder, onCreateWork, onCreateCharacter, onCreateEpisode, goalLines, onOpenGoal }: Props) {
  const tr = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) => translate(locale, key, params);
  const count = (n: number) => formatNumber(n, locale);
  const ratio = dailyGoal !== null && dailyGoal > 0 ? Math.min(1, Math.max(0, today / dailyGoal)) : 0;
  return (
    <section className="works" aria-label={tr('work.section')} data-testid="work-section">
      <div className="works__head">
        <span>{tr('work.section')}</span>
        <span className="muted">{works.length > 0 ? tr('work.count', { count: count(works.length) }) : ''}</span>
      </div>
      {works.length > 0 && (
        <div className="works__list">
          {works.map((work) => (
            <div className="workcard" key={work.name} data-testid="work-card">
              <div className="workcard__title" title={work.name}>
                {work.name}
              </div>
              <div className="workcard__meta" data-testid="work-meta">
                {workMetaText(locale, work, spacing)}
              </div>
              <button className="workcard__goal-line" data-testid="work-goal-line" onClick={() => onOpenGoal(work.name)}>
                {goalLines[work.name] || tr('work.goalSet')}
              </button>
              {dailyGoal !== null && dailyGoal > 0 ? (
                <div className="workcard__goal" title={tr('writer.todayGoal', { count: count(today), goal: count(dailyGoal) })}>
                  <span className="workcard__today">{tr('work.today')}</span>
                  <span className="note-editor__goalbar" aria-hidden>
                    <i style={{ width: `${Math.round(ratio * 100)}%` }} />
                  </span>
                  <span className="workcard__goalnum">
                    {count(today)}/{count(dailyGoal)}
                  </span>
                </div>
              ) : null}
              <div className="workcard__links">
                <button className="workchip" onClick={() => onOpenFolder(work.characterFolder)} data-testid="work-chip-characters">
                  {chipText(locale, 'characters', work.characters, narrow)}
                </button>
                {work.storyBible !== null && work.storyBibleFolder !== null ? (
                  <button className="workchip" onClick={() => onOpenFolder(work.storyBibleFolder ?? work.characterFolder)} data-testid="work-chip-story">
                    {chipText(locale, 'storyBible', work.storyBible, narrow)}
                  </button>
                ) : null}
              </div>
              <div className="workcard__newrow">
                <button className="workcard__new" data-testid="new-episode" onClick={() => onCreateEpisode(work.name)}>
                  {tr('work.newEpisode')}
                </button>
                <button className="workcard__new" data-testid="new-character" onClick={() => onCreateCharacter(work.name)}>
                  {tr('work.newCharacter')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <button className="works__add" data-testid="work-add" onClick={onCreateWork}>
        {tr('work.addWork')}
      </button>
    </section>
  );
}
