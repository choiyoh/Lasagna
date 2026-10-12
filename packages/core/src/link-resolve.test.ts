import { describe, expect, it } from 'vitest';
import { createLinkResolver } from './link-resolve.js';

const pages = [
  { id: 1, path: '프로젝트/Nopsidian.md', title: 'Nopsidian' },
  { id: 2, path: '독서/클린 코드.md', title: '클린 코드' },
  { id: 3, path: '독서/아카이브/클린 코드.md', title: '클린 코드 (구판)' },
  { id: 4, path: 'a/b/메모.md', title: '메모' },
  { id: 5, path: '메모.md', title: '메모(루트)' },
  { id: 6, path: '일기/2026-10-12.md', title: '오늘' },
];
const aliases = [{ pageId: 2, alias: 'Clean Code' }];
const resolve = createLinkResolver(pages, aliases);

describe('createLinkResolver', () => {
  it('파일명으로 해석하고 .md와 대소문자는 무시한다', () => {
    expect(resolve('nopsidian', '독서/클린 코드.md')).toBe(1);
    expect(resolve('Nopsidian.md', '')).toBe(1);
  });

  it('같은 이름이 여럿이면 경로가 가장 짧은 것', () => {
    expect(resolve('클린 코드', '일기/2026-10-12.md')).toBe(2);
    expect(resolve('메모', '일기/2026-10-12.md')).toBe(5);
  });

  it('깊이가 같으면 링크가 있는 폴더와 가까운 것', () => {
    const r = createLinkResolver(
      [
        { id: 1, path: 'x/메모.md', title: '' },
        { id: 2, path: 'y/메모.md', title: '' },
      ],
      [],
    );
    expect(r('메모', 'y/다른.md')).toBe(2);
    expect(r('메모', 'x/다른.md')).toBe(1);
  });

  it('경로가 포함된 링크는 접미 경로가 맞아야 한다', () => {
    expect(resolve('아카이브/클린 코드', '')).toBe(3);
    expect(resolve('독서/클린 코드', '')).toBe(2);
    expect(resolve('없는폴더/클린 코드', '')).toBeUndefined();
  });

  it('상대 경로(마크다운 링크)는 링크가 있는 노트 기준으로 푼다', () => {
    expect(resolve('../독서/클린 코드.md', '일기/2026-10-12.md')).toBe(2);
    expect(resolve('./메모', 'a/b/다른.md')).toBe(4);
  });

  it('제목과 별칭으로도 해석하고, 없으면 undefined', () => {
    expect(resolve('오늘', '')).toBe(6);
    expect(resolve('clean code', '')).toBe(2);
    expect(resolve('존재하지 않는 노트', '')).toBeUndefined();
    expect(resolve('', '')).toBeUndefined();
  });
});
