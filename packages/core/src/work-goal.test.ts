import { describe, expect, it } from 'vitest';
import { calcWorkGoal, daysUntil, goalLineText, goalTooltip, parseLocalDay, sanitizeWorkGoal, type WorkGoal } from './work-goal.js';

const goal = (over: Partial<WorkGoal> = {}): WorkGoal => ({
  episodes: 80,
  perEpisode: 4000,
  basis: 'include',
  deadline: '2026-12-31',
  preset: 'naver',
  ...over,
});
const current = { episodes: 24, chars: 84200, charsNoSpace: 80100 };
const today = new Date(2026, 10, 20, 9, 0, 0); // 2026-11-20

describe('작품 목표·마감 계산', () => {
  it('남은 회차·총량·남은 글자수·하루 필요(오늘 제외, 올림)', () => {
    const p = calcWorkGoal(goal(), current, today);
    expect(p.remainingEpisodes).toBe(56);
    expect(p.totalTarget).toBe(320000);
    expect(p.remainingChars).toBe(235800);
    expect(p.daysLeft).toBe(41); // 11/20 → 12/31, 오늘 제외
    expect(p.perDay).toBe(Math.ceil(235800 / 41));
    expect(p.status).toBe('ok');
  });

  it('글자수 기준을 바꾸면 현재 글자수가 달라진다', () => {
    const include = calcWorkGoal(goal(), current, today);
    const exclude = calcWorkGoal(goal({ basis: 'exclude' }), current, today);
    expect(include.remainingChars).toBe(235800);
    expect(exclude.remainingChars).toBe(320000 - 80100);
  });

  it('마감 오늘·지남·내일', () => {
    expect(calcWorkGoal(goal({ deadline: '2026-11-20' }), current, today)).toMatchObject({ status: 'dueToday', perDay: null });
    expect(calcWorkGoal(goal({ deadline: '2026-11-19' }), current, today)).toMatchObject({ status: 'overdue', perDay: null });
    const tomorrow = calcWorkGoal(goal({ deadline: '2026-11-21' }), current, today);
    expect(tomorrow.daysLeft).toBe(1);
    expect(tomorrow.perDay).toBe(235800);
  });

  it('마감일 없음 → 하루 필요 없음', () => {
    const p = calcWorkGoal(goal({ deadline: null }), current, today);
    expect(p.daysLeft).toBeNull();
    expect(p.perDay).toBeNull();
  });

  it('완결 도달·초과는 음수 없이 done', () => {
    for (const episodes of [80, 95]) {
      const p = calcWorkGoal(goal(), { ...current, episodes }, today);
      expect(p.status).toBe('done');
      expect(p.remainingEpisodes).toBe(0);
      expect(p.perDay).toBeNull();
    }
  });

  it('완결 0·회당 0 은 목표 없음', () => {
    expect(calcWorkGoal(goal({ episodes: 0 }), current, today).status).toBe('none');
    expect(calcWorkGoal(goal({ perEpisode: 0 }), current, today).status).toBe('none');
  });

  it('날짜 경계: 자정 직전·직후, 잘못된 형식', () => {
    expect(daysUntil('2026-11-21', new Date(2026, 10, 20, 23, 59, 59))).toBe(1);
    expect(daysUntil('2026-11-21', new Date(2026, 10, 21, 0, 0, 1))).toBe(0);
    expect(parseLocalDay('2026-2-3')).toBeNull();
    expect(parseLocalDay('2026-02-31')).toBeNull();
    expect(parseLocalDay(null)).toBeNull();
  });

  it('카드 목표선 문구(ko/en, 920 축약)', () => {
    expect(goalLineText({ locale: 'ko', episodes: 24, goal: 80, perDay: 4191, narrow: false })).toBe('완결 24/80화 · 하루 4,191자');
    expect(goalLineText({ locale: 'ko', episodes: 24, goal: 80, perDay: 4191, narrow: true })).toBe('4,191자/일');
    expect(goalLineText({ locale: 'en', episodes: 24, goal: 80, perDay: 4191, narrow: false })).toBe('24/80 episodes · 4,191 a day');
    expect(goalLineText({ locale: 'ko', episodes: 24, goal: 80, perDay: null, narrow: false })).toBe('완결 24/80화');
  });
});

describe('카드 목표선 툴팁·마감일 정규화', () => {
  it('오늘 마감·지남은 상태 문구, 미래는 날짜·남은 일수(1일 단수)', () => {
    const today = new Date(2026, 10, 20);
    const p = (deadline: string) => calcWorkGoal(goal({ deadline }), current, today);
    expect(goalTooltip({ locale: 'ko', progress: p('2026-11-20'), deadline: '2026-11-20', dateText: '2026. 11. 20.' })).toBe('오늘 마감');
    expect(goalTooltip({ locale: 'ko', progress: p('2026-11-19'), deadline: '2026-11-19', dateText: '2026. 11. 19.' })).toBe('마감일 지남');
    expect(goalTooltip({ locale: 'ko', progress: p('2026-11-21'), deadline: '2026-11-21', dateText: '2026. 11. 21.' })).toBe('마감 2026. 11. 21. · 1일 남음');
    expect(goalTooltip({ locale: 'en', progress: p('2026-11-21'), deadline: '2026-11-21', dateText: 'Nov 21, 2026' })).toBe('Due Nov 21, 2026 · 1 day left');
    expect(goalTooltip({ locale: 'en', progress: p('2026-12-01'), deadline: '2026-12-01', dateText: 'Dec 1, 2026' })).toBe('Due Dec 1, 2026 · 11 days left');
    expect(goalTooltip({ locale: 'ko', progress: p(null as unknown as string), deadline: null, dateText: '' })).toBe('마감일 없음');
  });

  it('잘못된 마감일은 null 로 정리', () => {
    expect(sanitizeWorkGoal(goal({ deadline: 'abc' })).deadline).toBeNull();
    expect(sanitizeWorkGoal(goal({ deadline: '2026-13-45' })).deadline).toBeNull();
    expect(sanitizeWorkGoal(goal({ deadline: '2026-11-21' })).deadline).toBe('2026-11-21');
  });
});
