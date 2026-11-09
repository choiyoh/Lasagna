import { describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  deleteSnapshot,
  listSnapshots,
  normalizeSnapshotName,
  readSnapshot,
  renameSnapshot,
  saveSnapshot,
  snapshotsDir,
} from './snapshots.js';
import { snapshot as saveHistory } from './save.js';
import { listHistory, pruneCandidates } from './history.js';

const root = () => mkdtempSync(path.join(tmpdir(), 'snap-'));
const at = new Date(2026, 10, 9, 14, 20, 0);

describe('이름 붙인 스냅샷 저장소', () => {
  it('빈 이름은 시각(11. 09 14:20), 아니면 공백 정리·80자 제한', () => {
    expect(normalizeSnapshotName('   ', at)).toBe('11. 09 14:20');
    expect(normalizeSnapshotName('  1교   수정  ', at)).toBe('1교 수정');
    expect(normalizeSnapshotName('x'.repeat(100), at)).toHaveLength(80);
  });

  it('저장·목록·읽기, 최신 순, 내용 크기', () => {
    const dir = root();
    const first = saveSnapshot(dir, 'a.md', '1교', '첫 내용\n', new Date(2026, 10, 9, 14, 20));
    const second = saveSnapshot(dir, 'a.md', '2교', '둘째 내용입니다\n', new Date(2026, 10, 9, 15, 0));
    const list = listSnapshots(dir, 'a.md');
    expect(list.map((s) => s.name)).toEqual(['2교', '1교']);
    expect(list[0]?.id).toBe(second.id);
    expect(readSnapshot(dir, 'a.md', first.id).content).toBe('첫 내용\n');
    expect(list[1]?.size).toBe(Buffer.byteLength('첫 내용\n', 'utf8'));
    // 다른 노트와 섞이지 않는다
    expect(listSnapshots(dir, 'b.md')).toEqual([]);
  });

  it('같은 이름도 시각·id 로 구분한다', () => {
    const dir = root();
    saveSnapshot(dir, 'a.md', '수정', '하나', new Date(2026, 10, 9, 14, 20));
    saveSnapshot(dir, 'a.md', '수정', '둘', new Date(2026, 10, 9, 14, 21));
    expect(listSnapshots(dir, 'a.md').map((s) => s.name)).toEqual(['수정', '수정']);
  });

  it('이름 바꾸기·삭제는 그 스냅샷만 바꾼다', () => {
    const dir = root();
    const a = saveSnapshot(dir, 'n.md', '1교', '내용', at);
    const b = saveSnapshot(dir, 'n.md', '2교', '내용2', new Date(2026, 10, 9, 14, 21));
    expect(renameSnapshot(dir, 'n.md', a.id, '수정').name).toBe('수정');
    deleteSnapshot(dir, 'n.md', a.id);
    expect(listSnapshots(dir, 'n.md').map((s) => s.id)).toEqual([b.id]);
    expect(readSnapshot(dir, 'n.md', b.id).content).toBe('내용2');
  });

  it('손상 파일·빈 폴더·잘못된 id 복구', () => {
    const dir = root();
    expect(listSnapshots(dir, 'x.md')).toEqual([]);
    mkdirSync(snapshotsDir(dir, 'x.md'), { recursive: true });
    expect(listSnapshots(dir, 'x.md')).toEqual([]);
    const good = saveSnapshot(dir, 'x.md', '1교', '좋음', at);
    writeFileSync(path.join(snapshotsDir(dir, 'x.md'), 'broken.json'), '{ 깨짐');
    writeFileSync(path.join(snapshotsDir(dir, 'x.md'), '2026-11-09T05-20-00-000Z-deadbeef.json'), 'not json');
    expect(listSnapshots(dir, 'x.md').map((s) => s.id)).toEqual([good.id]);
    expect(() => readSnapshot(dir, 'x.md', '../escape.json')).toThrow();
  });

  it('자동 이력 prune 은 이름 붙인 스냅샷 폴더를 건드리지 않는다', () => {
    const dir = root();
    const snap = saveSnapshot(dir, 'n.md', '1교', '보존', at);
    // 자동 이력도 하나 만든 뒤 prune 후보를 구해도 스냅샷은 그대로다
    writeFileSync(path.join(dir, 'n.md'), '본문\n');
    saveHistory(dir, 'n.md', '이전', at);
    pruneCandidates(listHistory(dir, 'n.md').map((e) => e.id), new Date(2027, 0, 1));
    expect(listSnapshots(dir, 'n.md').map((s) => s.id)).toEqual([snap.id]);
    expect(readdirSync(snapshotsDir(dir, 'n.md'))).toContain(snap.id);
  });
});
