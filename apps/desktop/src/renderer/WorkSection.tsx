import { formatNumber, translate } from '@nopsidian/i18n';
import type { WorkSummary } from '@nopsidian/core';

interface Props {
  locale: 'ko' | 'en';
  works: WorkSummary[];
  /** 현재 글자수 기준(공백 포함/제외) */
  spacing: 'include' | 'exclude';
  today: number;
  dailyGoal: number | null;
  onOpenFolder: (path: string) => void;
  onCreateWork: () => void;
  onCreateCharacter: (work: string) => void;
}

/** 카드 meta 문구 — 언어·글자수 기준을 그대로 반영한다. */
export function workMetaText(locale: 'ko' | 'en', work: Pick<WorkSummary, 'episodes' | 'chars' | 'charsNoSpace'>, spacing: 'include' | 'exclude'): string {
  return translate(locale, 'work.meta', {
    episodes: formatNumber(work.episodes, locale),
    chars: formatNumber(spacing === 'include' ? work.chars : work.charsNoSpace, locale),
  });
}

/**
 * 작가용 사이드바의 '작품' 섹션. 작가 모드에서만 렌더된다(일반 모드는 이 DOM 자체가 없다).
 * 카드: 회차 수·총 글자수, 일일 목표가 있으면 오늘 진행 막대. 칩: 캐릭터/설정집(폴더 펼침).
 */
export function WorkSection({ locale, works, spacing, today, dailyGoal, onOpenFolder, onCreateWork, onCreateCharacter }: Props) {
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
                  {tr('work.characters', { count: count(work.characters) })}
                </button>
                {work.storyBible !== null && work.storyBibleFolder !== null ? (
                  <button className="workchip" onClick={() => onOpenFolder(work.storyBibleFolder ?? work.characterFolder)} data-testid="work-chip-story">
                    {tr('work.storyBible', { count: count(work.storyBible) })}
                  </button>
                ) : null}
              </div>
              <button className="workcard__new" data-testid="new-character" onClick={() => onCreateCharacter(work.name)}>
                {tr('work.newCharacter')}
              </button>
            </div>
          ))}
        </div>
      )}
      <button className="works__add" data-testid="work-add" onClick={onCreateWork}>
        {tr('settings.workCreate')}
      </button>
    </section>
  );
}
