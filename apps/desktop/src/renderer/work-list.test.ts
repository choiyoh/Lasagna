import { describe, expect, it } from 'vitest';
import { resolveOpenWork, workOfPath } from './work-list';

const work = (name: string, episodeFolder: string, characterFolder: string, storyBibleFolder: string | null = `${episodeFolder.split('/')[0]}/설정집`) => ({
  name,
  episodeFolder,
  characterFolder,
  storyBibleFolder,
});

const works = [work('달빛', '달빛/회차', '달빛/캐릭터'), work('출판작', '출판작/원고', '출판작/캐릭터'), work('메모작', '메모작/회차', '메모작/캐릭터')];

describe('workOfPath', () => {
  it('회차·캐릭터·설정집 폴더 하위 노트를 그 작품으로 본다', () => {
    expect(workOfPath(works, '달빛/회차/1화.md')).toBe('달빛');
    expect(workOfPath(works, '달빛/캐릭터/서연.md')).toBe('달빛');
    expect(workOfPath(works, '달빛/설정집/세계관.md')).toBe('달빛');
  });

  it('출판형 작품의 원고 하위 노트도 그 작품이다', () => {
    expect(workOfPath(works, '출판작/원고/1권/001화.md')).toBe('출판작');
  });

  it('작품 밖 노트·폴더 자체·빈 경로는 작품이 아니다', () => {
    expect(workOfPath(works, '메모.md')).toBeNull();
    expect(workOfPath(works, '달빛/회차')).toBeNull();
    expect(workOfPath(works, null)).toBeNull();
  });

  it('이름이 겹치는 폴더가 있으면 더 깊은 폴더가 이긴다', () => {
    const nested = [work('바깥', '작품/회차', '작품/캐릭터'), work('안쪽', '작품/회차/안쪽', '작품/회차/안쪽/캐릭터')];
    expect(workOfPath(nested, '작품/회차/안쪽/1화.md')).toBe('안쪽');
  });
});

describe('resolveOpenWork', () => {
  const names = works.map((w) => ({ name: w.name }));

  it('현재 노트의 작품을 먼저 연다', () => {
    expect(resolveOpenWork(names, { current: '출판작', last: '메모작' })).toBe('출판작');
  });

  it('현재 노트가 작품 밖이면 마지막으로 연 작품, 없으면 첫 작품', () => {
    expect(resolveOpenWork(names, { current: null, last: '메모작' })).toBe('메모작');
    expect(resolveOpenWork(names, { current: null, last: null })).toBe('달빛');
  });

  it('사용자가 직접 고른 작품이 가장 세다', () => {
    expect(resolveOpenWork(names, { current: '달빛', picked: '메모작', last: '출판작' })).toBe('메모작');
  });

  it('목록에 없는 이름은 건너뛴다(지워졌거나 이름이 바뀐 작품)', () => {
    expect(resolveOpenWork(names, { current: '없는작품', picked: '사라진작품', last: '출판작' })).toBe('출판작');
  });

  it('작품이 0개면 열 것도 없다', () => {
    expect(resolveOpenWork([], { current: null })).toBeNull();
  });
});
