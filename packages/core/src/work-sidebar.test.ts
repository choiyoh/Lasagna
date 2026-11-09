import { describe, expect, it } from 'vitest';
import { detectWorkRoots, summarizeWorks } from './work-sidebar.js';
import { type TextStats } from './text-stats.js';

const s = (chars: number): TextStats => ({ chars, charsNoSpace: chars - 2, words: 1 });

describe('작품 인식·집계', () => {
  it('한국어 폴더를 둘 다 가진 루트만 작품으로 인식한다', () => {
    const roots = detectWorkRoots(['달빛', '달빛/회차', '달빛/캐릭터', '달빛/설정집', '회차만', '회차만/회차', '기타']);
    expect(roots.map((r) => r.name)).toEqual(['달빛']);
    expect(roots[0]?.storyBibleFolders).toEqual(['달빛/설정집']);
  });

  it('영어 이름만 있어도 인식하고, 설정집이 없으면 null 로 둔다', () => {
    const roots = detectWorkRoots(['Moonlight', 'Moonlight/Episodes', 'Moonlight/Characters']);
    expect(roots).toHaveLength(1);
    expect(roots[0]).toMatchObject({ name: 'Moonlight', locale: 'en' });
  });

  it('한쪽 폴더만 있으면 작품이 아니다', () => {
    expect(detectWorkRoots(['A', 'A/회차'])).toEqual([]);
    expect(detectWorkRoots(['B', 'B/Characters'])).toEqual([]);
  });

  it('회차 수·글자수는 회차 폴더 하위까지 합하고, 캐릭터·설정집 수를 따로 센다', () => {
    const roots = detectWorkRoots(['달빛', '달빛/회차', '달빛/캐릭터', '달빛/설정집']);
    const notes = ['달빛/회차/1화.md', '달빛/회차/2권/2화.md', '달빛/캐릭터/서연.md', '달빛/설정집/세계.md', '다른/회차/x.md'];
    const stats = new Map([
      ['달빛/회차/1화.md', s(120)],
      ['달빛/회차/2권/2화.md', s(80)],
      ['달빛/캐릭터/서연.md', s(50)],
    ]);
    expect(summarizeWorks(roots, notes, stats)).toEqual([
      {
        name: '달빛',
        episodes: 2,
        characters: 1,
        storyBible: 1,
        episodeFolder: '달빛/회차',
        characterFolder: '달빛/캐릭터',
        storyBibleFolder: '달빛/설정집',
        chars: 200,
        charsNoSpace: 196,
        episodeRows: [
          { path: '달빛/회차/1화.md', chars: 120, charsNoSpace: 118 },
          { path: '달빛/회차/2권/2화.md', chars: 80, charsNoSpace: 78 },
        ],
      },
    ]);
  });

  it('글자수 통계가 없는 노트는 회차 수에는 들어가고 합에는 들어가지 않는다', () => {
    const roots = detectWorkRoots(['W', 'W/Episodes', 'W/Characters']);
    expect(summarizeWorks(roots, ['W/Episodes/1.md', 'W/Episodes/2.md'], new Map([['W/Episodes/1.md', s(10)]]))[0]).toMatchObject({
      episodes: 2,
      chars: 10,
      episodeRows: [
        { path: 'W/Episodes/1.md', chars: 10, charsNoSpace: 8 },
        { path: 'W/Episodes/2.md', chars: 0, charsNoSpace: 0 },
      ],
    });
  });
});

describe('출판형 인식(W2b)', () => {
  it('원고+캐릭터도 작품이고 원고가 회차 폴더다', () => {
    const roots = detectWorkRoots(['출판작', '출판작/원고', '출판작/캐릭터', '출판작/교정']);
    expect(roots).toHaveLength(1);
    expect(roots[0]).toMatchObject({ name: '출판작', episodeFolders: ['출판작/원고'], characterFolders: ['출판작/캐릭터'] });
    const notes = ['출판작/원고/1화.md', '출판작/원고/1권/2화.md', '출판작/교정/1교.md', '출판작/캐릭터/서연.md'];
    const summary = summarizeWorks(roots, notes, new Map([['출판작/원고/1화.md', s(10)], ['출판작/교정/1교.md', s(999)]]))[0];
    expect(summary).toMatchObject({ episodes: 2, characters: 1, chars: 10 });
  });

  it('영어 Manuscript+Characters 도 인식', () => {
    expect(detectWorkRoots(['Moon', 'Moon/Manuscript', 'Moon/Characters'])[0]).toMatchObject({ episodeFolders: ['Moon/Manuscript'], locale: 'en' });
  });

  it('혼합 이름(원고+Characters, Manuscript+캐릭터)은 작품이 아니다', () => {
    expect(detectWorkRoots(['A', 'A/원고', 'A/Characters'])).toEqual([]);
    expect(detectWorkRoots(['B', 'B/Manuscript', 'B/캐릭터'])).toEqual([]);
  });
});
