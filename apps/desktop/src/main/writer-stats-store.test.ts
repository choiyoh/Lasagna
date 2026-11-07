import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WriterStatsStore } from './writer-stats-store.js';

const dir = () => mkdtempSync(join(tmpdir(), 'writer-stats-'));

describe('WriterStatsStore', () => {
  it('더하면 파일에 원자적으로 남고, 다시 읽어도 유지된다(앱 재시작)', () => {
    const file = join(dir(), 'writer-stats.json');
    const clock = { at: new Date(2026, 2, 5, 10, 0, 0) };
    const store = new WriterStatsStore(file, () => clock.at);
    expect(store.add('v1', 'a.md', 1200)).toEqual({ date: '2026-03-05', chars: 1200 });
    expect(new WriterStatsStore(file, () => clock.at).todayStats('v1')).toEqual({ date: '2026-03-05', chars: 1200 });
    expect(JSON.parse(readFileSync(file, 'utf8')).vaults.v1['a.md']).toBe(1200);
  });

  it('자정을 넘기면 0 에서 다시 센다', () => {
    const file = join(dir(), 'writer-stats.json');
    const clock = { at: new Date(2026, 2, 5, 23, 59, 0) };
    const store = new WriterStatsStore(file, () => clock.at);
    store.add('v1', 'a.md', 900);
    clock.at = new Date(2026, 2, 6, 0, 0, 30);
    expect(store.todayStats('v1')).toEqual({ date: '2026-03-06', chars: 0 });
    expect(store.add('v1', 'a.md', 40).chars).toBe(40);
  });

  it('깨진 파일은 빈 값으로 복구하고 덮어쓴다', () => {
    const file = join(dir(), 'writer-stats.json');
    writeFileSync(file, '{ 깨짐');
    const clock = { at: new Date(2026, 2, 5, 9, 0, 0) };
    const store = new WriterStatsStore(file, () => clock.at);
    expect(store.todayStats('v1').chars).toBe(0);
    expect(store.add('v1', 'a.md', 15).chars).toBe(15);
    expect(JSON.parse(readFileSync(file, 'utf8')).date).toBe('2026-03-05');
  });
});
