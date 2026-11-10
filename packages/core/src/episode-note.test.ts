import { describe, expect, it } from 'vitest';
import { isEpisodeNote } from './episode-note.js';

const work = (episodeFolder: string) => [{ episodeFolder }];

describe('isEpisodeNote', () => {
  it('한국어 회차 폴더와 하위·권 폴더는 회차 노트다', () => {
    const works = work('달빛/회차');
    expect(isEpisodeNote(works, '달빛/회차/001화.md')).toBe(true);
    expect(isEpisodeNote(works, '달빛/회차/2권/010화.md')).toBe(true);
  });

  it('영어 Episodes·출판형 원고/Manuscript 도 회차 노트다', () => {
    expect(isEpisodeNote(work('Moon/Episodes'), 'Moon/Episodes/ep1.md')).toBe(true);
    expect(isEpisodeNote(work('출판작/원고'), '출판작/원고/1화.md')).toBe(true);
    expect(isEpisodeNote(work('Moon/Manuscript'), 'Moon/Manuscript/ch1.md')).toBe(true);
  });

  it('캐릭터·설정집·템플릿·교정·시놉시스·작품 밖은 아니다', () => {
    const works = work('달빛/회차');
    for (const p of [
      '달빛/캐릭터/주인공.md',
      '달빛/설정집/세계관.md',
      '달빛/템플릿/회차.md',
      '달빛/교정/1교.md',
      '달빛/시놉시스/줄거리.md',
      '메모.md',
      '다른작품/회차/1화.md',
    ]) {
      expect(isEpisodeNote(works, p)).toBe(false);
    }
  });

  it('작품 목록이 비었거나 경로가 비면 숨김(회차 아님)', () => {
    expect(isEpisodeNote([], '달빛/회차/1화.md')).toBe(false);
    expect(isEpisodeNote(work('달빛/회차'), '')).toBe(false);
  });
});
