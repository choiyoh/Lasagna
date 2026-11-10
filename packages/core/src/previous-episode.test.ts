import { describe, expect, it } from 'vitest';
import { compareEpisodePaths, previousEpisodePath } from './previous-episode.js';

const work = (episodeFolder: string, paths: string[]) => [{ name: '달빛', episodeFolder, episodeRows: paths.map((path) => ({ path })) }];

describe('previousEpisodePath', () => {
  it('숫자 인식 자연 정렬로 바로 앞 회차를 찾는다(001 < 002 < 10)', () => {
    const works = work('달빛/회차', ['달빛/회차/001화.md', '달빛/회차/002화.md', '달빛/회차/10화.md']);
    expect(previousEpisodePath(works, '달빛/회차/10화.md')).toBe('달빛/회차/002화.md');
    expect(previousEpisodePath(works, '달빛/회차/002화.md')).toBe('달빛/회차/001화.md');
  });

  it('첫 회차·회차 폴더 밖·빈 폴더면 없다', () => {
    const works = work('달빛/회차', ['달빛/회차/001화.md', '달빛/회차/002화.md']);
    expect(previousEpisodePath(works, '달빛/회차/001화.md')).toBeNull();
    expect(previousEpisodePath(works, '달빛/캐릭터/주인공.md')).toBeNull();
    expect(previousEpisodePath(work('달빛/회차', []), '달빛/회차/001화.md')).toBeNull();
  });

  it('권 폴더가 있으면 경로 순서를 따르고 하위 폴더도 포함한다', () => {
    const works = work('달빛/회차', [
      '달빛/회차/1권/010화.md',
      '달빛/회차/1권/002화.md',
      '달빛/회차/2권/001화.md',
    ]);
    expect(previousEpisodePath(works, '달빛/회차/1권/010화.md')).toBe('달빛/회차/1권/002화.md');
    expect(previousEpisodePath(works, '달빛/회차/2권/001화.md')).toBe('달빛/회차/1권/010화.md');
  });

  it('출판형 원고·영어 Episodes 도 같은 규칙이다', () => {
    expect(previousEpisodePath(work('출판작/원고', ['출판작/원고/1화.md', '출판작/원고/2화.md']), '출판작/원고/2화.md')).toBe(
      '출판작/원고/1화.md',
    );
    expect(previousEpisodePath(work('Moon/Episodes', ['Moon/Episodes/ep1.md', 'Moon/Episodes/ep2.md']), 'Moon/Episodes/ep2.md')).toBe(
      'Moon/Episodes/ep1.md',
    );
  });

  it('현재 노트가 목록에 없어도 경로로 끼워 비교한다', () => {
    expect(previousEpisodePath(work('달빛/회차', ['달빛/회차/1화.md']), '달빛/회차/2화.md')).toBe('달빛/회차/1화.md');
  });

  it('비교 함수는 숫자를 수로 본다', () => {
    expect(compareEpisodePaths('a/2화.md', 'a/10화.md')).toBeLessThan(0);
  });
});
