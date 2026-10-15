import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFolder, duplicateNote, listFolders, listTrash, moveToTrash, purgeTrash, restoreFromTrash } from './trash';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const vault = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'nops-trash-'));
  dirs.push(d);
  mkdirSync(path.join(d, '폴더'), { recursive: true });
  writeFileSync(path.join(d, '폴더', '노트.md'), '내용');
  return d;
};

describe('휴지통', () => {
  it('노트를 휴지통으로 옮기고 되돌린다', () => {
    const root = vault();
    const r = moveToTrash(root, '폴더/노트.md');
    expect(existsSync(path.join(root, '폴더/노트.md'))).toBe(false);
    expect(readdirSync(path.join(root, '.nopsidian/trash')).length).toBe(2); // 파일 + 메타
    expect(restoreFromTrash(root, r.trashId)).toBe('폴더/노트.md');
    expect(readFileSync(path.join(root, '폴더/노트.md'), 'utf8')).toBe('내용');
  });
  it('폴더도 통째로 옮기고 되돌린다', () => {
    const root = vault();
    const r = moveToTrash(root, '폴더');
    expect(r.isFolder).toBe(true);
    expect(existsSync(path.join(root, '폴더'))).toBe(false);
    restoreFromTrash(root, r.trashId);
    expect(readFileSync(path.join(root, '폴더/노트.md'), 'utf8')).toBe('내용');
  });
  it('되돌릴 자리가 차 있으면 (복원) 을 붙인다', () => {
    const root = vault();
    const r = moveToTrash(root, '폴더/노트.md');
    writeFileSync(path.join(root, '폴더/노트.md'), '새 노트');
    expect(restoreFromTrash(root, r.trashId)).toBe('폴더/노트 (복원).md');
  });
  it('볼트 밖·없는 항목은 거부한다', () => {
    const root = vault();
    expect(() => moveToTrash(root, '../밖.md')).toThrow();
    expect(() => moveToTrash(root, '없음.md')).toThrow();
    expect(() => restoreFromTrash(root, '../x')).toThrow();
  });
});

describe('휴지통 목록·비우기, 폴더', () => {
  it('목록은 최근 순, 하나·전부 영구 삭제', () => {
    const root = vault();
    writeFileSync(path.join(root, 'b.md'), 'b');
    const a = moveToTrash(root, '폴더/노트.md', new Date('2026-10-01T00:00:00Z'));
    moveToTrash(root, 'b.md', new Date('2026-10-02T00:00:00Z'));
    expect(listTrash(root).map((t) => t.path)).toEqual(['b.md', '폴더/노트.md']);
    expect(purgeTrash(root, a.trashId)).toBe(1);
    expect(listTrash(root).map((t) => t.path)).toEqual(['b.md']);
    expect(purgeTrash(root)).toBe(1);
    expect(listTrash(root)).toEqual([]);
  });
  it('폴더 만들기(겹치면 번호)와 목록(숨김 제외)', () => {
    const root = vault();
    expect(createFolder(root, '새 폴더')).toBe('새 폴더');
    expect(createFolder(root, '새 폴더')).toBe('새 폴더 2');
    mkdirSync(path.join(root, '.숨김'));
    expect(listFolders(root)).toEqual(['새 폴더', '새 폴더 2', '폴더']);
    expect(() => createFolder(root, '../밖')).toThrow();
  });
});

describe('duplicateNote', () => {
  it('같은 폴더에 (사본)으로 복제하고 첫 제목도 바꾼다', () => {
    const root = vault();
    writeFileSync(path.join(root, '폴더/할 일.md'), '---\n상태: 진행\n---\n# 할 일\n\n본문\n');
    expect(duplicateNote(root, '폴더/할 일.md')).toBe('폴더/할 일 (사본).md');
    expect(readFileSync(path.join(root, '폴더/할 일 (사본).md'), 'utf8')).toBe('---\n상태: 진행\n---\n# 할 일 (사본)\n\n본문\n');
    expect(duplicateNote(root, '폴더/할 일.md')).toBe('폴더/할 일 (사본 2).md');
  });
  it('제목이 이름과 다르면 내용은 그대로 둔다', () => {
    const root = vault();
    writeFileSync(path.join(root, 'a.md'), '# 다른 제목\n');
    expect(duplicateNote(root, 'a.md')).toBe('a (사본).md');
    expect(readFileSync(path.join(root, 'a (사본).md'), 'utf8')).toBe('# 다른 제목\n');
  });
});
