import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WriterStatsStore } from './writer-stats-store.js';

const dir = () => mkdtempSync(join(tmpdir(), 'writer-stats-'));
interface SavedFile {
  version: number;
  today: { date: string; vaults: Record<string, Record<string, number>> };
  history: Record<string, Record<string, { total: number; works: Record<string, number>; goal?: number }>>;
}
const read = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as SavedFile;

describe('WriterStatsStore', () => {
  it('더하면 파일에 원자적으로 남고, 다시 읽어도 유지된다(앱 재시작)', () => {
    const file = join(dir(), 'writer-stats.json');
    const clock = { at: new Date(2026, 2, 5, 10, 0, 0) };
    const store = new WriterStatsStore(file, () => clock.at);
    expect(store.add('v1', 'a.md', 1200)).toEqual({ date: '2026-03-05', chars: 1200 });
    expect(new WriterStatsStore(file, () => clock.at).todayStats('v1')).toEqual({ date: '2026-03-05', chars: 1200 });
    expect(read(file).today.vaults.v1['a.md']).toBe(1200);
    expect(read(file).version).toBe(2);
  });

  it('자정을 넘기면 지난 날을 history 로 남기고 0 에서 다시 센다', () => {
    const file = join(dir(), 'writer-stats.json');
    const clock = { at: new Date(2026, 2, 5, 23, 59, 0) };
    const store = new WriterStatsStore(file, () => clock.at, () => ':outside');
    store.add('v1', 'a.md', 900);
    clock.at = new Date(2026, 2, 6, 0, 0, 30);
    expect(store.todayStats('v1')).toEqual({ date: '2026-03-06', chars: 0 });
    expect(store.add('v1', 'a.md', 40).chars).toBe(40);
    // 지난 날은 앱을 다시 열어도 남아 있다.
    const saved = read(file);
    expect(saved.history.v1['2026-03-05']).toEqual({ total: 900, works: { ':outside': 900 } });
    expect(new WriterStatsStore(file, () => clock.at).range('v1', '2026-03-05', '2026-03-05')).toEqual({
      '2026-03-05': { total: 900, works: { ':outside': 900 } },
    });
  });

  it('하루를 닫을 때 그 시점의 하루 목표를 남기고, 나중에 목표를 바꿔도 지난 날짜는 그대로다', () => {
    const file = join(dir(), 'writer-stats.json');
    const clock = { at: new Date(2026, 2, 5, 23, 0, 0) };
    const goal = { value: 500 as number | null };
    const store = new WriterStatsStore(file, () => clock.at, () => ':outside', () => goal.value);
    store.add('v1', 'a.md', 600);
    clock.at = new Date(2026, 2, 6, 1, 0, 0);
    store.todayStats('v1'); // 03-05 를 닫는다(목표 500)
    goal.value = 300;
    expect(read(file).history.v1['2026-03-05'].goal).toBe(500);

    store.add('v1', 'a.md', 100);
    clock.at = new Date(2026, 2, 7, 1, 0, 0);
    store.todayStats('v1'); // 03-06 을 닫는다(목표 300)
    expect(read(file).history.v1['2026-03-06']).toEqual({ total: 100, works: { ':outside': 100 }, goal: 300 });
    goal.value = null;
    expect(store.range('v1', '2026-03-05', '2026-03-05')['2026-03-05']?.goal).toBe(500);
  });

  it('목표가 없으면 날짜에 goal 키를 쓰지 않는다', () => {
    const file = join(dir(), 'writer-stats.json');
    const clock = { at: new Date(2026, 2, 5, 23, 0, 0) };
    const store = new WriterStatsStore(file, () => clock.at);
    store.add('v1', 'a.md', 40);
    clock.at = new Date(2026, 2, 6, 1, 0, 0);
    store.todayStats('v1');
    expect(read(file).history.v1['2026-03-05']).toEqual({ total: 40, works: { ':outside': 40 } });
  });

  it('작품 폴더 안 노트는 작품별로, 작품 밖은 :outside 로 센다', () => {
    const file = join(dir(), 'writer-stats.json');
    const clock = { at: new Date(2026, 2, 5, 22, 0, 0) };
    const store = new WriterStatsStore(file, () => clock.at, (_vault, p) => (p.startsWith('달빛/') ? '달빛' : ':outside'));
    store.add('v1', '달빛/회차/1화.md', 1000);
    store.add('v1', '메모.md', 200);
    clock.at = new Date(2026, 2, 6, 9, 0, 0);
    store.todayStats('v1'); // 날짜가 바뀌어 닫힌다
    expect(read(file).history.v1['2026-03-05']).toEqual({ total: 1200, works: { 달빛: 1000, ':outside': 200 } });
  });

  it('v1 파일은 오늘 값을 이어 쓰고, 지난 날짜는 그 날짜로 남긴다', () => {
    const file = join(dir(), 'writer-stats.json');
    const clock = { at: new Date(2026, 2, 5, 10, 0, 0) };
    writeFileSync(file, JSON.stringify({ version: 1, date: '2026-03-04', vaults: { v1: { 'a.md': 700 } } }));
    const store = new WriterStatsStore(file, () => clock.at);
    expect(store.todayStats('v1').chars).toBe(0);
    expect(read(file).history.v1['2026-03-04']).toEqual({ total: 700, works: { ':outside': 700 } });

    const today = join(dir(), 'writer-stats.json');
    writeFileSync(today, JSON.stringify({ version: 1, date: '2026-03-05', vaults: { v1: { 'a.md': 300 } } }));
    const again = new WriterStatsStore(today, () => clock.at);
    expect(again.todayStats('v1').chars).toBe(300);
    expect(again.add('v1', 'a.md', 100).chars).toBe(400);
  });

  it('깨진 파일은 원문을 .bak 으로 남기고 빈 값으로 복구한다', () => {
    const file = join(dir(), 'writer-stats.json');
    writeFileSync(file, '{ 깨짐');
    const clock = { at: new Date(2026, 2, 5, 9, 0, 0) };
    const store = new WriterStatsStore(file, () => clock.at);
    expect(store.todayStats('v1').chars).toBe(0);
    expect(store.add('v1', 'a.md', 15).chars).toBe(15);
    expect(read(file).today.date).toBe('2026-03-05');
    expect(existsSync(`${file}.bak`)).toBe(true);
    expect(readFileSync(`${file}.bak`, 'utf8')).toBe('{ 깨짐');
  });

  it('기간 조회는 오늘의 현재 값까지 돌려준다', () => {
    const file = join(dir(), 'writer-stats.json');
    const clock = { at: new Date(2026, 2, 4, 10, 0, 0) };
    const store = new WriterStatsStore(file, () => clock.at, () => 'A');
    store.add('v1', 'a.md', 100);
    clock.at = new Date(2026, 2, 5, 10, 0, 0);
    store.add('v1', 'a.md', 200);
    expect(store.range('v1', '2026-03-04', '2026-03-05')).toEqual({
      '2026-03-04': { total: 100, works: { A: 100 } },
      '2026-03-05': { total: 200, works: { A: 200 } },
    });
    expect(store.range('v1', '2026-01-01', '2026-01-31')).toEqual({});
  });

  it('작품 이름이 바뀌면 지난 날짜 키가 따라가고, undo 는 옮긴 날짜만 되돌린다', () => {
    const file = join(dir(), 'writer-stats.json');
    const clock = { at: new Date(2026, 2, 4, 10, 0, 0) };
    const store = new WriterStatsStore(file, () => clock.at, (_v, p) => (p.startsWith('달빛/') ? '달빛' : ':outside'));
    store.add('v1', '달빛/회차/1화.md', 100);
    clock.at = new Date(2026, 2, 5, 10, 0, 0);
    store.add('v1', '달빛/회차/1화.md', 200);
    clock.at = new Date(2026, 2, 6, 10, 0, 0);
    store.todayStats('v1'); // 03-05 를 닫는다
    const dates = store.move('v1', '달빛', '별빛');
    expect(dates).toEqual(['2026-03-04', '2026-03-05']);
    expect(store.range('v1', '2026-03-04', '2026-03-04')['2026-03-04']).toEqual({ total: 100, works: { 별빛: 100 } });
    expect(store.undoMove('v1', '달빛', '별빛', dates)).toEqual(dates);
    expect(store.range('v1', '2026-03-05', '2026-03-05')['2026-03-05']).toEqual({ total: 200, works: { 달빛: 200 } });
  });

  it('시계를 뒤로 돌려도 기록이 사라지지 않는다', () => {
    const file = join(dir(), 'writer-stats.json');
    const clock = { at: new Date(2026, 2, 6, 10, 0, 0) };
    const store = new WriterStatsStore(file, () => clock.at);
    store.add('v1', 'a.md', 500);
    clock.at = new Date(2026, 2, 5, 10, 0, 0);
    expect(store.todayStats('v1')).toEqual({ date: '2026-03-05', chars: 0 });
    expect(read(file).history.v1['2026-03-06'].total).toBe(500);
    expect(store.add('v1', 'a.md', 30).chars).toBe(30);
  });

  it('하루 합계는 0 미만으로 내려가지 않는다', () => {
    const file = join(dir(), 'writer-stats.json');
    const clock = { at: new Date(2026, 2, 5, 10, 0, 0) };
    const store = new WriterStatsStore(file, () => clock.at);
    store.add('v1', 'a.md', 10);
    expect(store.add('v1', 'a.md', -50).chars).toBe(0);
  });
});
