import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { historyKey, moveKeyedDir, moveNoteHistory } from './history-move.js';
import { historyDir } from './history.js';
import { saveSnapshot, listSnapshots, snapshotsDir } from './snapshots.js';

const root = () => mkdtempSync(path.join(tmpdir(), 'histmove-'));
const write = (file: string, text: string) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
};

describe('이름 바꾸기·이동 시 이력 따라가기', () => {
  it('자동 이력과 스냅샷 폴더가 새 경로 키로 옮겨진다', () => {
    const dir = root();
    write(path.join(historyDir(dir, 'a.md'), '2026-11-09T05-00-00-000Z-aaaaaaaa.md'), '옛 내용');
    const snap = saveSnapshot(dir, 'a.md', '1교', '스냅샷 내용');
    moveNoteHistory(dir, 'a.md', 'b.md');
    expect(existsSync(historyDir(dir, 'a.md'))).toBe(false);
    expect(readFileSync(path.join(historyDir(dir, 'b.md'), '2026-11-09T05-00-00-000Z-aaaaaaaa.md'), 'utf8')).toBe('옛 내용');
    expect(listSnapshots(dir, 'b.md').map((s) => s.id)).toEqual([snap.id]);
    expect(listSnapshots(dir, 'a.md')).toEqual([]);
  });

  it('새 경로에 이미 이력이 있으면 병합하고 같은 파일 이름은 덮어쓰지 않는다', () => {
    const dir = root();
    write(path.join(historyDir(dir, 'old.md'), 'same.md'), '옛 쪽');
    write(path.join(historyDir(dir, 'old.md'), 'only-old.md'), '옛 전용');
    write(path.join(historyDir(dir, 'new.md'), 'same.md'), '새 쪽');
    moveKeyedDir(dir, 'history', 'old.md', 'new.md');
    expect(readdirSync(historyDir(dir, 'new.md')).sort()).toEqual(['only-old.md', 'same.md']);
    expect(readFileSync(path.join(historyDir(dir, 'new.md'), 'same.md'), 'utf8')).toBe('새 쪽');
    expect(readFileSync(path.join(historyDir(dir, 'new.md'), 'only-old.md'), 'utf8')).toBe('옛 전용');
    // 내용이 다른 같은 이름은 덮어쓰지 않고 옛 폴더에 남긴다(데이터 보존).
    expect(readFileSync(path.join(historyDir(dir, 'old.md'), 'same.md'), 'utf8')).toBe('옛 쪽');

    // 내용까지 같은 중복은 옛 폴더에서만 지운다.
    const dir2 = root();
    write(path.join(historyDir(dir2, 'x.md'), 'dup.md'), '같음');
    write(path.join(historyDir(dir2, 'y.md'), 'dup.md'), '같음');
    moveKeyedDir(dir2, 'history', 'x.md', 'y.md');
    expect(existsSync(historyDir(dir2, 'x.md'))).toBe(false);
    expect(readdirSync(historyDir(dir2, 'y.md'))).toEqual(['dup.md']);
  });

  it('옮길 이력이 없으면 아무 것도 만들지 않는다(무해)', () => {
    const dir = root();
    moveNoteHistory(dir, 'nothing.md', 'elsewhere.md');
    expect(existsSync(path.join(dir, '.nopsidian', 'history'))).toBe(false);
    expect(existsSync(path.join(dir, '.nopsidian', 'snapshots'))).toBe(false);
  });

  it('폴더 이동으로 하위 노트 경로가 바뀌는 경우도 키만 다르므로 그대로 동작한다', () => {
    const dir = root();
    saveSnapshot(dir, '작품/회차/1화.md', '1교', '내용');
    moveNoteHistory(dir, '작품/회차/1화.md', '작품/원고/1화.md');
    expect(listSnapshots(dir, '작품/원고/1화.md')).toHaveLength(1);
    expect(existsSync(snapshotsDir(dir, '작품/회차/1화.md'))).toBe(false);
  });

  it('같은 경로(키 동일)면 아무 것도 하지 않는다', () => {
    const dir = root();
    saveSnapshot(dir, 'a.md', '1교', '내용');
    moveNoteHistory(dir, 'a.md', 'a.md');
    expect(listSnapshots(dir, 'a.md')).toHaveLength(1);
    expect(historyKey('a.md')).toBe(historyKey('a.md'));
  });
});
