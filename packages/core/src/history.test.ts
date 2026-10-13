import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { lineDiff } from './diff.js';
import { historyDir, listHistory, pruneCandidates, pruneHistory, readHistory, timeOfSnapshot } from './history.js';
import { snapshot } from './save.js';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'nops-hist-'));
  dirs.push(d);
  return d;
};

describe('버전 기록', () => {
  it('스냅샷을 최신 순으로 나열하고 읽는다', () => {
    const root = tmp();
    snapshot(root, 'a.md', '첫', new Date('2026-10-10T01:00:00.000Z'));
    snapshot(root, 'a.md', '둘', new Date('2026-10-11T01:00:00.000Z'));
    const list = listHistory(root, 'a.md');
    expect(list.map((e) => e.time)).toEqual(['2026-10-11T01:00:00.000Z', '2026-10-10T01:00:00.000Z']);
    expect(readHistory(root, 'a.md', list[1]!.id)).toBe('첫');
    expect(listHistory(root, 'b.md')).toEqual([]);
  });
  it('이름이 이상하면 읽지 않는다', () => {
    expect(() => readHistory(tmp(), 'a.md', '../../x')).toThrow();
    expect(timeOfSnapshot('x.md')).toBeNull();
  });
  it('보존 정책: 2일 이내 전부, 30일까지 하루 하나, 30일 초과 삭제', () => {
    const now = new Date('2026-10-30T12:00:00.000Z');
    const id = (iso: string) => `${iso.replace(/[:.]/g, '-')}-abcdef12.md`;
    const ids = [
      '2026-09-01T10:00:00.000Z', // 30일 초과 → 삭제
      '2026-10-20T08:00:00.000Z', // 같은 날 두 개 → 앞 것 삭제
      '2026-10-20T20:00:00.000Z',
      '2026-10-29T10:00:00.000Z', // 2일 이내 → 유지
      '2026-10-29T11:00:00.000Z',
    ].map(id);
    expect(pruneCandidates(ids, now).sort()).toEqual([id('2026-09-01T10:00:00.000Z'), id('2026-10-20T08:00:00.000Z')].sort());
  });
  it('스냅샷을 남길 때 오래된 것은 실제로 지워진다', () => {
    const root = tmp();
    snapshot(root, 'a.md', '옛', new Date('2026-08-01T00:00:00.000Z'));
    expect(readdirSync(historyDir(root, 'a.md'))).toHaveLength(1);
    snapshot(root, 'a.md', '새', new Date('2026-10-29T00:00:00.000Z'));
    expect(readdirSync(historyDir(root, 'a.md'))).toHaveLength(1);
    expect(pruneHistory(root, 'a.md', new Date('2026-10-30T00:00:00.000Z'))).toBe(0);
  });
});

describe('lineDiff', () => {
  it('추가·삭제·그대로', () => {
    expect(lineDiff('a\nb\nc', 'a\nx\nc\nd')).toEqual([
      { type: 'same', text: 'a' },
      { type: 'del', text: 'b' },
      { type: 'add', text: 'x' },
      { type: 'same', text: 'c' },
      { type: 'add', text: 'd' },
    ]);
  });
  it('같으면 전부 same', () => {
    expect(lineDiff('a\nb', 'a\nb').every((o) => o.type === 'same')).toBe(true);
  });
});
