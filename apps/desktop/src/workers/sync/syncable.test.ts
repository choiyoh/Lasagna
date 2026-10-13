import { describe, expect, it } from 'vitest';
import { isSyncablePath } from './syncable';

/** [경로, 기대값, 이유] — 규칙 하나씩 */
const CASES: [string, boolean, string][] = [
  ['note.md', true, '보통 파일'],
  ['folder/note.md', true, '하위 폴더'],
  ['folder/sub/note.md', true, '깊은 하위 폴더'],
  ['첨부/그림.png', true, '비마크다운 첨부'],

  ['', false, '빈 문자열'],
  ['..', false, '상위 탈출'],
  ['../note.md', false, '볼트 밖'],
  ['folder/../note.md', false, '세그먼트 탈출'],
  ['/abs/note.md', false, '절대 경로'],
  ['folder/', false, '끝 슬래시(빈 세그먼트)'],
  ['a//b.md', false, '빈 세그먼트'],
  ['a\0b.md', false, 'NUL'],

  ['.nopsidian', true, '메타 폴더 자체는 들어가야 한다'],
  ['.nopsidian/config.json', true, '설정'],
  ['.nopsidian/graph.json', true, '그래프'],
  ['.nopsidian/bookmarks.json', true, '북마크'],
  ['.nopsidian/comments', true, '주석 폴더'],
  ['.nopsidian/comments/a.md', true, '주석 파일'],
  ['.nopsidian/comments/2026/a.md', true, '주석 하위 파일'],
  ['.nopsidian/index.sqlite', false, '인덱스 DB'],
  ['.nopsidian/index.sqlite-wal', false, '인덱스 WAL'],
  ['.nopsidian/trash/note.md', false, '휴지통'],
  ['.nopsidian/history/2026-10-12/note.md', false, '히스토리'],
  ['.nopsidian/comments.md', false, '이름이 comments 인 파일은 아님'],

  ['.git', false, 'git 폴더'],
  ['.git/config', false, 'git 내부'],
  ['sub/.git/config', false, '하위 git 폴더'],
  ['.DS_Store', false, '파인더 메타'],
  ['folder/.DS_Store', false, '하위 파인더 메타'],
  ['note.nops-tmp-1234-ab.md', false, '저장 임시 파일'],
  ['folder/note.nops-tmp-1-abc', false, '하위 저장 임시 파일'],
  ['~$보고서.docx', false, 'Office 잠금'],
  ['folder/~$보고서.docx', false, '하위 Office 잠금'],
  ['그림.png.icloud', false, 'iCloud 자리표시자'],
  ['folder/그림.png.icloud', false, '하위 iCloud 자리표시자'],

  ['.obsidian/app.json', true, '다른 숨김 폴더는 포함'],
  ['.hidden.md', true, '숨김 파일'],
  ['folder/.hidden.md', true, '하위 숨김 파일'],
  ['한글/노트.md', true, '유니코드 경로'],
];

describe('isSyncablePath', () => {
  for (const [rel, expected, why] of CASES) {
    it(`${why}: ${JSON.stringify(rel)} → ${expected}`, () => {
      expect(isSyncablePath(rel)).toBe(expected);
    });
  }

  it('NFD 로 들어와도 같은 판단을 한다', () => {
    const nfd = '한글/노트.md'.normalize('NFD');
    expect(isSyncablePath(nfd)).toBe(true);
    expect(isSyncablePath('.nopsidian/trash/노트.md'.normalize('NFD'))).toBe(false);
  });
});
