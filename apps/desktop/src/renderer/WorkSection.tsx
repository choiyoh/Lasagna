import { useEffect, useRef, useState } from 'react';
import { formatNumber, pluralCategory, translate } from '@nopsidian/i18n';
import type { WorkSummary } from '@nopsidian/core';
import { MoreIcon } from './icons';
import { SidebarMenu, type SidebarMenuItem } from './SidebarMenu';
import { resolveOpenWork, workOfPath } from './work-list';

interface Props {
  locale: 'ko' | 'en';
  works: WorkSummary[];
  /** 현재 열린 노트 경로(그 노트의 작품을 펼친다) */
  currentPath: string | null;
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
  /** 회차 DB 열기(없으면 그때 만든다) */
  onOpenEpisodeDb: (work: string) => void;
  /** 작품별 목표선 문구(없으면 목표 설정 버튼) */
  goalLines: Record<string, string>;
  /** 목표선 툴팁(마감일·남은 일수) */
  goalTitles: Record<string, string>;
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

/** 마지막으로 연 작품 — 앱 설정이 아니라 이 창(세션)에만 남긴다. */
const LAST_OPEN_KEY = 'nops.works.last';

function readLastOpen(): string | null {
  try {
    return sessionStorage.getItem(LAST_OPEN_KEY);
  } catch {
    return null;
  }
}

/**
 * 작가용 사이드바의 '작품' 섹션(목록형). 작가 모드에서만 렌더된다(일반 모드는 이 DOM 자체가 없다).
 * 열린 작품 1개만 4줄로 펼치고(이름+회차+⋯ / 회차·글자수 / 목표 / 칩 줄), 나머지는 이름 한 줄이다.
 */
export function WorkSection({ locale, works, currentPath, spacing, narrow, today, dailyGoal, onOpenFolder, onCreateWork, onCreateCharacter, onCreateEpisode, goalLines, goalTitles, onOpenGoal, onOpenEpisodeDb }: Props) {
  const tr = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) => translate(locale, key, params);
  const count = (n: number) => formatNumber(n, locale);
  const ratio = dailyGoal !== null && dailyGoal > 0 ? Math.min(1, Math.max(0, today / dailyGoal)) : 0;

  const current = workOfPath(works, currentPath);
  /** undefined = 규칙대로, null = 모두 접힘, 이름 = 사용자가 고른 작품 */
  const [choice, setChoice] = useState<string | null | undefined>(undefined);
  const [last, setLast] = useState<string | null>(readLastOpen);
  const [menu, setMenu] = useState<{ work: string; x: number; y: number } | null>(null);
  const moreRef = useRef<HTMLButtonElement>(null);

  // 다른 작품의 노트를 열면 그 작품을 따른다(사용자가 고른 작품은 그때까지 우선).
  const previousCurrent = useRef(current);
  useEffect(() => {
    if (previousCurrent.current === current) return;
    previousCurrent.current = current;
    setChoice(undefined);
  }, [current]);

  const auto = resolveOpenWork(works, { current, picked: typeof choice === 'string' ? choice : null, last });
  // 작품이 1개면 항상 펼친다. 여러 개일 때만 이름을 눌러 접을 수 있다.
  const openName = choice === null && works.length > 1 ? null : auto;

  useEffect(() => {
    if (!openName || openName === last) return;
    setLast(openName);
    try {
      sessionStorage.setItem(LAST_OPEN_KEY, openName);
    } catch {
      // 저장하지 못해도 이번 세션의 last 상태로 계속 동작한다.
    }
  }, [openName, last]);

  const menuWork = menu ? works.find((w) => w.name === menu.work) : undefined;
  const menuItems: SidebarMenuItem[] = menuWork
    ? [
        { id: 'new-character', testId: 'new-character', label: tr('work.newCharacter'), onRun: () => onCreateCharacter(menuWork.name) },
        ...(menuWork.storyBibleFolder
          ? [{ id: 'story-bible', testId: 'work-menu-story', label: tr('work.openStoryBible'), onRun: () => onOpenFolder(menuWork.storyBibleFolder!) }]
          : []),
      ]
    : [];

  return (
    <section className="works" aria-label={tr('work.section')} data-testid="work-section">
      <div className="works__head">
        <span>{tr('work.section')}</span>
        <span className="muted">{works.length > 0 ? tr('work.count', { count: count(works.length) }) : ''}</span>
      </div>
      {works.length > 0 && (
        <div className="works__list">
          {works.map((work) => {
            if (work.name !== openName) {
              return (
                <button
                  key={work.name}
                  className="workrow"
                  data-testid="work-row"
                  data-work={work.name}
                  aria-expanded={false}
                  title={work.name}
                  onClick={() => setChoice(work.name)}
                >
                  <span className="workrow__chev" aria-hidden>
                    ▸
                  </span>
                  <span className="workrow__name">{work.name}</span>
                  <span className="workrow__count">{count(work.episodes)}</span>
                </button>
              );
            }
            return (
              <div className="workcard" key={work.name} data-testid="work-card" data-work={work.name}>
                <div className="workcard__head">
                  <span className="workcard__chev" aria-hidden>
                    ▾
                  </span>
                  <button
                    className="workcard__name"
                    data-testid="work-open-name"
                    aria-expanded
                    title={work.name}
                    onClick={() => setChoice(null)}
                  >
                    {work.name}
                  </button>
                  <button className="workcard__new" data-testid="new-episode" onClick={() => onCreateEpisode(work.name)}>
                    {tr('work.newEpisode')}
                  </button>
                  <button
                    ref={moreRef}
                    className="iconbtn workcard__more"
                    data-testid="work-more"
                    aria-haspopup="menu"
                    aria-expanded={menu?.work === work.name}
                    aria-label={tr('work.menu')}
                    title={tr('work.menu')}
                    onClick={(e) => {
                      const box = e.currentTarget.getBoundingClientRect();
                      setMenu({ work: work.name, x: box.left, y: box.bottom + 4 });
                    }}
                  >
                    <MoreIcon />
                  </button>
                </div>
                <div className="workcard__meta" data-testid="work-meta">
                  {workMetaText(locale, work, spacing)}
                </div>
                <button
                  className="workcard__goal-line"
                  data-testid="work-goal-line"
                  title={goalTitles[work.name] || undefined}
                  onClick={() => onOpenGoal(work.name)}
                >
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
                  <button className="workcard__link" onClick={() => onOpenEpisodeDb(work.name)} data-testid="work-chip-db">
                    {tr('work.episodeDb')}
                  </button>
                  <span className="workcard__dot" aria-hidden>
                    ·
                  </span>
                  <button className="workcard__link" onClick={() => onOpenFolder(work.characterFolder)} data-testid="work-chip-characters">
                    {chipText(locale, 'characters', work.characters, narrow)}
                  </button>
                  {work.storyBible !== null && work.storyBibleFolder !== null ? (
                    <>
                      <span className="workcard__dot" aria-hidden>
                        ·
                      </span>
                      <button className="workcard__link" onClick={() => onOpenFolder(work.storyBibleFolder ?? work.characterFolder)} data-testid="work-chip-story">
                        {chipText(locale, 'storyBible', work.storyBible, narrow)}
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <button className="works__add" data-testid="work-add" onClick={onCreateWork}>
        {tr('work.addWork')}
      </button>
      {menu && menuWork && (
        <SidebarMenu
          anchor={menu}
          items={menuItems}
          onClose={() => {
            setMenu(null);
            moreRef.current?.focus();
          }}
        />
      )}
    </section>
  );
}
