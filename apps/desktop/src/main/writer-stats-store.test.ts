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
  pending: Record<string, { date: string; vaults: Record<string, number> }[]>;
}
const read = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as SavedFile;

describe('WriterStatsStore', () => {
  it('더하면 파일에 원자적으로 남고, 다시 읽어도 유지된다(앱 재시작)', () => {
    const file = join(dir(), 'writer-stats.json');
    const clock = { at: new Date(2026, 2, 5, 10, 0, 0) };
    const store = new WriterStatsStore(file, () => clock.at, () => []);
    expect(store.add('v1', 'a.md', 1200)).toEqual({ date: '2026-03-05', chars: 1200 });
    expect(new WriterStatsStore(file, () => clock.at, () => []).todayStats('v1')).toEqual({ date: '2026-03-05', chars: 1200 });
    expect(read(file).today.vaults.v1['a.md']).toBe(1200);
    expect(read(file).version).toBe(2);
  });

  it('자정을 넘기면 지난 날을 history 로 남기고 0 에서 다시 센다', () => {
    const file = join(dir(), 'writer-stats.json');
    const clock = { at: new Date(2026, 2, 5, 23, 59, 0) };
    const store = new WriterStatsStore(file, () => clock.at, () => []);
    store.add('v1', 'a.md', 900);
    clock.at = new Date(2026, 2, 6, 0, 0, 30);
    expect(store.todayStats('v1')).toEqual({ date: '2026-03-06', chars: 0 });
    expect(store.add('v1', 'a.md', 40).chars).toBe(40);
    // 지난 날은 앱을 다시 열어도 남아 있다.
    const saved = read(file);
    expect(saved.history.v1['2026-03-05']).toEqual({ total: 900, works: { ':outside': 900 } });
    expect(new WriterStatsStore(file, () => clock.at, () => []).range('v1', '2026-03-05', '2026-03-05')).toEqual({
      '2026-03-05': { total: 900, works: { ':outside': 900 } },
    });
  });

  it('하루를 닫을 때 그 시점의 하루 목표를 남기고, 나중에 목표를 바꿔도 지난 날짜는 그대로다', () => {
    const file = join(dir(), 'writer-stats.json');
    const clock = { at: new Date(2026, 2, 5, 23, 0, 0) };
    const goal = { value: 500 as number | null };
    const store = new WriterStatsStore(file, () => clock.at, () => [], () => goal.value);
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
    const store = new WriterStatsStore(file, () => clock.at, () => []);
    store.add('v1', 'a.md', 40);
    clock.at = new Date(2026, 2, 6, 1, 0, 0);
    store.todayStats('v1');
    expect(read(file).history.v1['2026-03-05']).toEqual({ total: 40, works: { ':outside': 40 } });
  });

  it('작품 폴더 안 노트는 작품별로, 작품 밖은 :outside 로 센다', () => {
    const file = join(dir(), 'writer-stats.json');
    const clock = { at: new Date(2026, 2, 5, 22, 0, 0) };
    const store = new WriterStatsStore(file, () => clock.at, () => ['달빛']);
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
    const store = new WriterStatsStore(file, () => clock.at, () => []);
    expect(store.todayStats('v1').chars).toBe(0);
    expect(read(file).history.v1['2026-03-04']).toEqual({ total: 700, works: { ':outside': 700 } });

    const today = join(dir(), 'writer-stats.json');
    writeFileSync(today, JSON.stringify({ version: 1, date: '2026-03-05', vaults: { v1: { 'a.md': 300 } } }));
    const again = new WriterStatsStore(today, () => clock.at, () => []);
    expect(again.todayStats('v1').chars).toBe(300);
    expect(again.add('v1', 'a.md', 100).chars).toBe(400);
  });

  it('깨진 파일은 원문을 .bak 으로 남기고 빈 값으로 복구한다', () => {
    const file = join(dir(), 'writer-stats.json');
    writeFileSync(file, '{ 깨짐');
    const clock = { at: new Date(2026, 2, 5, 9, 0, 0) };
    const store = new WriterStatsStore(file, () => clock.at, () => []);
    expect(store.todayStats('v1').chars).toBe(0);
    expect(store.add('v1', 'a.md', 15).chars).toBe(15);
    expect(read(file).today.date).toBe('2026-03-05');
    expect(existsSync(`${file}.bak`)).toBe(true);
    expect(readFileSync(`${file}.bak`, 'utf8')).toBe('{ 깨짐');
  });

  it('기간 조회는 오늘의 현재 값까지 돌려준다', () => {
    const file = join(dir(), 'writer-stats.json');
    const clock = { at: new Date(2026, 2, 4, 10, 0, 0) };
    const store = new WriterStatsStore(file, () => clock.at, () => ['A']);
    store.add('v1', 'A/a.md', 100);
    clock.at = new Date(2026, 2, 5, 10, 0, 0);
    store.add('v1', 'A/a.md', 200);
    expect(store.range('v1', '2026-03-04', '2026-03-05')).toEqual({
      '2026-03-04': { total: 100, works: { A: 100 } },
      '2026-03-05': { total: 200, works: { A: 200 } },
    });
    expect(store.range('v1', '2026-01-01', '2026-01-31')).toEqual({});
  });

  it('작품 이름이 바뀌면 지난 날짜 키가 따라가고, undo 는 옮긴 날짜만 되돌린다', () => {
    const file = join(dir(), 'writer-stats.json');
    const clock = { at: new Date(2026, 2, 4, 10, 0, 0) };
    const store = new WriterStatsStore(file, () => clock.at, () => ['달빛']);
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

  it('오늘 값을 옮긴 뒤 그 값이 마감됐어도 undo(모든 날짜)가 그 날짜를 되돌린다', () => {
    const file = join(dir(), 'writer-stats.json');
    const clock = { at: new Date(2026, 2, 5, 10, 0, 0) };
    const roots = { value: ['작품가'] as string[] };
    const store = new WriterStatsStore(file, () => clock.at, () => roots.value);
    store.add('v1', '작품가/회차/1화.md', 100);
    store.moveToday('v1', '작품가', '작품나');
    roots.value = ['작품나'];
    clock.at = new Date(2026, 2, 6, 10, 0, 0);
    store.todayStats('v1'); // 03-05 가 작품나로 닫힌다
    expect(store.range('v1', '2026-03-05', '2026-03-05')).toEqual({ '2026-03-05': { total: 100, works: { 작품나: 100 } } });

    // undo: 오늘 값은 이미 마감됐으므로 모든 날짜에서 되돌린다.
    expect(store.undoMove('v1', '작품가', '작품나', null)).toEqual(['2026-03-05']);
    expect(store.range('v1', '2026-03-05', '2026-03-05')).toEqual({ '2026-03-05': { total: 100, works: { 작품가: 100 } } });
  });

  it('시계를 뒤로 돌려도 기록이 사라지지 않는다', () => {
    const file = join(dir(), 'writer-stats.json');
    const clock = { at: new Date(2026, 2, 6, 10, 0, 0) };
    const store = new WriterStatsStore(file, () => clock.at, () => []);
    store.add('v1', 'a.md', 500);
    clock.at = new Date(2026, 2, 5, 10, 0, 0);
    expect(store.todayStats('v1')).toEqual({ date: '2026-03-05', chars: 0 });
    expect(read(file).history.v1['2026-03-06'].total).toBe(500);
    expect(store.add('v1', 'a.md', 30).chars).toBe(30);
  });

  it('하루 합계는 0 미만으로 내려가지 않는다', () => {
    const file = join(dir(), 'writer-stats.json');
    const clock = { at: new Date(2026, 2, 5, 10, 0, 0) };
    const store = new WriterStatsStore(file, () => clock.at, () => []);
    store.add('v1', 'a.md', 10);
    expect(store.add('v1', 'a.md', -50).chars).toBe(0);
  });
});

describe('WriterStatsStore — 리뷰 재현 시나리오', () => {
  it('같은 날 작품 폴더 이름을 바꿔도 그날 값이 :outside 로 확정되지 않는다(undo 포함)', () => {
    const file = join(dir(), 'writer-stats.json');
    const clock = { at: new Date(2026, 2, 5, 9, 0, 0) };
    const roots = { value: ['작품가'] as string[] };
    const store = new WriterStatsStore(file, () => clock.at, () => roots.value);
    store.add('v1', '작품가/회차/1화.md', 100);

    // rename: 마감 전에 지난 날짜를 지금 이름으로 닫고, 오늘 키를 새 경로로 옮긴다.
    store.settle();
    store.move('v1', '작품가', '작품나');
    expect(store.moveToday('v1', '작품가', '작품나').moved).toBe(true);
    roots.value = ['작품나'];
    store.add('v1', '작품나/회차/1화.md', 300);

    clock.at = new Date(2026, 2, 6, 9, 0, 0);
    store.todayStats('v1');
    expect(store.range('v1', '2026-03-05', '2026-03-05')).toEqual({ '2026-03-05': { total: 400, works: { 작품나: 400 } } });
  });

  it('같은 날 이름 바꾸기를 취소하면 오늘 키도 원래 경로로 돌아간다', () => {
    const file = join(dir(), 'writer-stats.json');
    const clock = { at: new Date(2026, 2, 5, 9, 0, 0) };
    const roots = { value: ['작품가'] as string[] };
    const store = new WriterStatsStore(file, () => clock.at, () => roots.value);
    store.add('v1', '작품가/회차/1화.md', 100);
    store.move('v1', '작품가', '작품나');
    expect(store.moveToday('v1', '작품가', '작품나').moved).toBe(true);
    roots.value = ['작품나'];

    // undo: 오늘 키를 원래 경로로 되돌린다(아직 닫히지 않았으므로 되돌릴 것이 있다).
    expect(store.moveToday('v1', '작품나', '작품가').moved).toBe(true);
    roots.value = ['작품가'];
    store.add('v1', '작품가/회차/1화.md', 50);
    clock.at = new Date(2026, 2, 6, 9, 0, 0);
    store.todayStats('v1');
    expect(store.range('v1', '2026-03-05', '2026-03-05')).toEqual({ '2026-03-05': { total: 150, works: { 작품가: 150 } } });
  });

  it('다른 볼트를 연 채 자정이 지나도 닫힌 볼트의 작품 귀속이 보존된다', () => {
    const file = join(dir(), 'writer-stats.json');
    const clock = { at: new Date(2026, 2, 5, 22, 0, 0) };
    const known = { vaults: ['a'] as string[], roots: { a: ['작품가'], b: ['겨울'] } as Record<string, string[]> };
    const store = new WriterStatsStore(file, () => clock.at, (vaultId) =>
      known.vaults.includes(vaultId) ? (known.roots[vaultId] ?? []) : null,
    );
    store.add('a', '작품가/회차/1화.md', 200);
    store.add('b', '겨울/회차/1화.md', 700);

    // 볼트 a 를 닫고 b 만 연 채 자정이 지난다(b 의 writer IPC 가 먼저 온다).
    known.vaults = ['b'];
    clock.at = new Date(2026, 2, 6, 0, 5, 0);
    expect(store.todayStats('b').chars).toBe(0);
    expect(read(file).pending.a).toEqual([{ date: '2026-03-05', vaults: { '작품가/회차/1화.md': 200 } }]);
    expect(store.range('b', '2026-03-05', '2026-03-05')).toEqual({ '2026-03-05': { total: 700, works: { 겨울: 700 } } });

    // 볼트 a 를 다시 열면 그때 작품 이름으로 닫힌다.
    known.vaults = ['a'];
    expect(store.range('a', '2026-03-05', '2026-03-05')).toEqual({ '2026-03-05': { total: 200, works: { 작품가: 200 } } });
    expect(read(file).pending).toEqual({});
  });
});

describe('WriterStatsStore — 2회차 리뷰 재현', () => {
  it('보류(pending)를 풀어도 다른 볼트의 오늘 값이 지워지지 않는다', () => {
    const file = join(dir(), 'writer-stats.json');
    const clock = { at: new Date(2026, 2, 5, 10, 0, 0) };
    // A 의 어제 값이 보류돼 있고, 오늘은 B 에서 500자를 쓴 상태의 파일.
    writeFileSync(
      file,
      JSON.stringify({
        version: 2,
        today: { date: '2026-03-05', vaults: { b: { '겨울/1화.md': 500 } } },
        history: {},
        pending: { a: [{ date: '2026-03-04', vaults: { '가을/1화.md': 300 } }] },
      }),
    );
    const known = { a: false };
    const store = new WriterStatsStore(file, () => clock.at, (vaultId) => (vaultId === 'a' && !known.a ? null : vaultId === 'a' ? ['가을'] : ['겨울']));
    expect(store.todayStats('b').chars).toBe(500);

    // 볼트 A 를 열어 보류가 풀린다 — B 의 오늘 값은 그대로여야 한다.
    known.a = true;
    expect(store.todayStats('a').chars).toBe(0);
    expect(store.todayStats('b').chars).toBe(500);
    expect(read(file).today.vaults.b['겨울/1화.md']).toBe(500);
    expect(read(file).history.a['2026-03-04']).toEqual({ total: 300, works: { 가을: 300 } });
  });

  it('undo 는 그 이름 바꾸기의 날짜만 되돌리고 다른 날짜·작품 키는 건드리지 않는다', () => {
    const file = join(dir(), 'writer-stats.json');
    const clock = { at: new Date(2026, 2, 5, 9, 0, 0) };
    writeFileSync(
      file,
      JSON.stringify({
        version: 2,
        today: { date: '2026-03-05', vaults: {} },
        history: {
          v1: {
            // 이번 rename 과 무관한 과거 날짜(다른 작품 이름)
            '2026-02-01': { total: 1200, works: { 봄: 900, 가을: 300 } },
            // rename 이 실제로 옮긴 날짜
            '2026-03-04': { total: 300, works: { 가을: 300 } },
          },
        },
        pending: {},
      }),
    );
    const store = new WriterStatsStore(file, () => clock.at, () => ['가을']);
    expect(store.move('v1', '가을', '겨울나무')).toEqual(['2026-02-01', '2026-03-04']);
    // 오늘 값 이동 뒤 그 값이 마감된 상황: undo 는 그 날짜(03-05)만 되돌린다.
    expect(store.undoMove('v1', '가을', '겨울나무', ['2026-03-04'])).toEqual(['2026-03-04']);
    expect(store.range('v1', '2026-02-01', '2026-02-01')).toEqual({
      '2026-02-01': { total: 1200, works: { 봄: 900, 겨울나무: 300 } },
    });
    expect(store.range('v1', '2026-03-04', '2026-03-04')).toEqual({ '2026-03-04': { total: 300, works: { 가을: 300 } } });
  });
});
