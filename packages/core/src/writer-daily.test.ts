import { describe, expect, it } from 'vitest';
import {
  addDailyDelta,
  closeWriterDay,
  dayKey,
  historyRange,
  moveTodayNoteKeys,
  moveWorkHistory,
  parseWriterDaily,
  parseWriterDailyFile,
  todayChars,
} from './writer-daily.js';

const TODAY = '2026-03-05';

const v1 = (date: string, vaults: Record<string, Record<string, number>>) => JSON.stringify({ version: 1, date, vaults });

describe('쓰기 통계 파일 — 오늘 순변화', () => {
  it('로컬 자정 기준 날짜 키', () => {
    expect(dayKey(new Date(2026, 2, 5, 23, 59, 59))).toBe('2026-03-05');
    expect(dayKey(new Date(2026, 2, 6, 0, 0, 0))).toBe('2026-03-06');
  });

  it('없음·깨짐·모르는 형식은 빈 값(깨짐은 valid=false)', () => {
    for (const raw of [null, '', '{', 'null', '[]', JSON.stringify({ version: 3, today: { date: TODAY, vaults: {} } }), JSON.stringify({ version: 1, date: '어제', vaults: {} })]) {
      const parsed = parseWriterDailyFile(raw, TODAY);
      expect(parsed.file).toEqual({ version: 2, today: { date: TODAY, vaults: {} }, history: {}, pending: {} });
      expect(parsed.valid).toBe(raw === null || raw === '');
    }
  });

  it('문서별 순변화의 합(삭제로 줄고, 합계는 0 미만이 아니다)', () => {
    let f = parseWriterDaily(null, TODAY);
    f = addDailyDelta(f, TODAY, 'v1', 'a.md', 1200);
    f = addDailyDelta(f, TODAY, 'v1', 'b.md', 300);
    expect(todayChars(f, 'v1')).toBe(1500);
    f = addDailyDelta(f, TODAY, 'v1', 'a.md', -400);
    expect(todayChars(f, 'v1')).toBe(1100);
    f = addDailyDelta(f, TODAY, 'v1', 'b.md', -5000);
    expect(todayChars(f, 'v1')).toBe(0);
    f = addDailyDelta(f, TODAY, 'v1', 'b.md', 700);
    expect(todayChars(f, 'v1')).toBe(0);
    f = addDailyDelta(f, TODAY, 'v1', 'b.md', 4000);
    expect(todayChars(f, 'v1')).toBe(800);
  });

  it('변화 0 은 파일을 바꾸지 않는다', () => {
    const f = parseWriterDaily(null, TODAY);
    expect(addDailyDelta(f, TODAY, 'v1', 'a.md', 0)).toBe(f);
  });

  it('볼트별로 섞이지 않는다', () => {
    let f = parseWriterDaily(null, TODAY);
    f = addDailyDelta(f, TODAY, 'v1', 'a.md', 100);
    f = addDailyDelta(f, TODAY, 'v2', 'z.md', 40);
    expect(todayChars(f, 'v1')).toBe(100);
    expect(todayChars(f, 'v2')).toBe(40);
    expect(todayChars(f, 'v3')).toBe(0);
  });
});

describe('쓰기 통계 파일 — 날짜별 기록(history)', () => {
  it('자정이 지나면 지난 날의 합계를 날짜로 남기고 오늘을 비운다', () => {
    let f = parseWriterDaily(null, '2026-03-05');
    f = addDailyDelta(f, '2026-03-05', 'v1', 'a.md', 900);
    f = closeWriterDay(f, '2026-03-06', () => []);
    expect(f.history.v1?.['2026-03-05']).toEqual({ total: 900, works: { ':outside': 900 } });
    expect(f.today).toEqual({ date: '2026-03-06', vaults: {} });
    expect(todayChars(f, 'v1')).toBe(0);
    f = addDailyDelta(f, '2026-03-06', 'v1', 'a.md', 50);
    expect(todayChars(f, 'v1')).toBe(50);
    expect(f.history.v1?.['2026-03-05']?.total).toBe(900);
  });

  it('닫을 때 그 시점의 하루 목표를 날짜에 남긴다(없으면 키 없음)', () => {
    let f = parseWriterDaily(null, '2026-03-05');
    f = addDailyDelta(f, '2026-03-05', 'v1', 'a.md', 600);
    const withGoal = closeWriterDay(f, '2026-03-06', () => [], 500);
    expect(withGoal.history.v1?.['2026-03-05']).toEqual({ total: 600, works: { ':outside': 600 }, goal: 500 });
    const noGoal = closeWriterDay(f, '2026-03-06', () => [], 0);
    expect(noGoal.history.v1?.['2026-03-05']).toEqual({ total: 600, works: { ':outside': 600 } });
  });

  it('이미 기록된 목표는 나중 목표로 바꾸지 않는다', () => {
    let f = parseWriterDaily(null, '2026-03-05');
    f = addDailyDelta(f, '2026-03-05', 'v1', 'a.md', 600);
    f = closeWriterDay(f, '2026-03-06', () => [], 500);
    // 시계를 되돌려 같은 날짜를 다시 닫아도(다른 목표) 기존 목표를 지킨다.
    const again = closeWriterDay({ ...f, today: { date: '2026-03-05', vaults: { v1: { 'a.md': 200 } } } }, '2026-03-06', () => [], 300);
    expect(again.history.v1?.['2026-03-05']?.goal).toBe(500);
  });

  it('저장된 목표를 읽고, 잘못된 값은 버린다', () => {
    const file = {
      version: 2,
      today: { date: '2026-03-05', vaults: {} },
      history: { v1: { '2026-03-01': { total: 100, works: { A: 100 }, goal: 900 }, '2026-03-02': { total: 50, works: { A: 50 }, goal: 0 } } },
    };
    const parsed = parseWriterDaily(JSON.stringify(file), TODAY);
    expect(parsed.history.v1?.['2026-03-01']?.goal).toBe(900);
    expect(parsed.history.v1?.['2026-03-02']).toEqual({ total: 50, works: { A: 50 } });
  });

  it('작품별로 나누고 각각 0 미만은 없다', () => {
    let f = parseWriterDaily(null, '2026-03-05');
    f = addDailyDelta(f, '2026-03-05', 'v1', '달빛/회차/1화.md', 1000);
    f = addDailyDelta(f, '2026-03-05', 'v1', '달빛/회차/2화.md', -300);
    f = addDailyDelta(f, '2026-03-05', 'v1', '별빛/회차/1화.md', 200);
    f = closeWriterDay(f, '2026-03-06', () => ['달빛', '별빛']);
    expect(f.history.v1?.['2026-03-05']).toEqual({ total: 900, works: { 달빛: 700, 별빛: 200 } });
  });

  it('합계가 0 인 날은 기록을 만들지 않는다', () => {
    let f = parseWriterDaily(null, '2026-03-05');
    f = addDailyDelta(f, '2026-03-05', 'v1', 'a.md', 500);
    f = addDailyDelta(f, '2026-03-05', 'v1', 'a.md', -500);
    f = closeWriterDay(f, '2026-03-06', () => []);
    expect(f.history).toEqual({});
    expect(f.today.date).toBe('2026-03-06');
  });

  it('v1 파일의 지난 날짜도 잃지 않고 그 날짜로 닫는다', () => {
    const parsed = parseWriterDailyFile(v1('2026-03-04', { v1: { 'a.md': 700 } }), TODAY);
    expect(parsed.valid).toBe(true);
    const closed = closeWriterDay(parsed.file, TODAY, () => [], 500);
    expect(closed.history.v1?.['2026-03-04']).toEqual({ total: 700, works: { ':outside': 700 }, goal: 500 });
    expect(closed.today).toEqual({ date: TODAY, vaults: {} });
  });

  it('v1 파일의 오늘 값은 그대로 이어 쓴다', () => {
    const f = parseWriterDaily(v1(TODAY, { v1: { 'a.md': 700 } }), TODAY);
    expect(todayChars(f, 'v1')).toBe(700);
    const closed = closeWriterDay(f, TODAY, () => []);
    expect(closed).toBe(f); // 날짜가 같으면 아무 것도 하지 않는다
    expect(addDailyDelta(f, TODAY, 'v1', 'a.md', 100).today.vaults.v1?.['a.md']).toBe(800);
  });

  it('시계를 뒤로 돌려도 지난 기록을 잃지 않는다(그 날짜로 닫고 오늘은 0)', () => {
    let f = parseWriterDaily(null, '2026-03-06');
    f = addDailyDelta(f, '2026-03-06', 'v1', 'a.md', 500);
    f = closeWriterDay(f, '2026-03-05', () => []);
    expect(f.history.v1?.['2026-03-06']?.total).toBe(500);
    expect(f.today).toEqual({ date: '2026-03-05', vaults: {} });
  });

  it('같은 날짜가 이미 기록돼 있으면 줄이지 않는다(항목별 max)', () => {
    let f = parseWriterDaily(null, '2026-03-06');
    f = addDailyDelta(f, '2026-03-06', 'v1', 'a.md', 500);
    f = closeWriterDay(f, '2026-03-07', () => ['A']);
    const again = addDailyDelta(f, '2026-03-07', 'v1', 'a.md', 100);
    const rolled = closeWriterDay({ ...again, today: { date: '2026-03-06', vaults: { v1: { 'a.md': 200 } } } }, '2026-03-07', () => ['A']);
    expect(rolled.history.v1?.['2026-03-06']).toEqual({ total: 500, works: { ':outside': 500 } });
  });

  it('10년이 넘은 날짜는 버린다', () => {
    const days: Record<string, { total: number; works: Record<string, number> }> = {};
    for (const date of ['2015-01-01', '2026-02-01']) days[date] = { total: 10, works: { A: 10 } };
    const f = closeWriterDay({ version: 2, today: { date: '2026-03-04', vaults: {} }, history: { v1: days }, pending: {} }, '2026-03-05', () => []);
    expect(Object.keys(f.history.v1 ?? {})).toEqual(['2026-02-01']);
  });

  it('기간 조회는 그 범위의 날짜만, 오늘은 현재 값을 넣고 기록 없는 날은 키가 없다', () => {
    let f = parseWriterDaily(null, '2026-03-01');
    for (const [date, chars] of [
      ['2026-02-27', 300],
      ['2026-03-01', 100],
      ['2026-03-02', 200],
    ] as const) {
      f = addDailyDelta(f, date, 'v1', 'a.md', chars);
      f = closeWriterDay(f, '2026-03-03', () => []);
    }
    f = addDailyDelta(f, '2026-03-03', 'v1', 'a.md', 40);
    const range = historyRange(f, 'v1', '2026-02-28', '2026-03-03', '2026-03-03', () => []);
    expect(Object.keys(range).sort()).toEqual(['2026-03-01', '2026-03-02', '2026-03-03']);
    expect(range['2026-03-03']).toEqual({ total: 40, works: { ':outside': 40 } });
    expect(historyRange(f, 'v2', '2026-01-01', '2026-03-03', '2026-03-03', () => [])).toEqual({});
  });
});

describe('쓰기 통계 파일 — 작품 이름 변경', () => {
  const withHistory = (): ReturnType<typeof parseWriterDaily> =>
    ({
      version: 2 as const,
      today: { date: TODAY, vaults: {} },
      history: {
        v1: {
          '2026-03-01': { total: 900, works: { 달빛: 700, 메모: 200 } },
          '2026-03-02': { total: 500, works: { 달빛: 500 } },
        },
      },
      pending: {},
    });

  it('모든 날짜의 작품 키를 새 이름으로 옮긴다', () => {
    const { file, moved } = moveWorkHistory(withHistory(), 'v1', '달빛', '별빛');
    expect(moved).toEqual(['2026-03-01', '2026-03-02']);
    expect(file.history.v1?.['2026-03-01']).toEqual({ total: 900, works: { 별빛: 700, 메모: 200 } });
    expect(file.history.v1?.['2026-03-02']).toEqual({ total: 500, works: { 별빛: 500 } });
  });

  it('그 날짜에 새 이름이 이미 있으면 그 날짜는 건드리지 않는다(덮어쓰기 없음)', () => {
    const f = withHistory();
    f.history.v1!['2026-03-02'] = { total: 800, works: { 달빛: 500, 별빛: 300 } };
    const { file, moved } = moveWorkHistory(f, 'v1', '달빛', '별빛');
    expect(moved).toEqual(['2026-03-01']);
    expect(file.history.v1?.['2026-03-02']).toEqual({ total: 800, works: { 달빛: 500, 별빛: 300 } });
  });

  it('옮긴 날짜만 지정해 그대로 되돌린다(왕복이 같다)', () => {
    const original = withHistory();
    const forward = moveWorkHistory(original, 'v1', '달빛', '별빛');
    const back = moveWorkHistory(forward.file, 'v1', '별빛', '달빛', forward.moved);
    expect(back.file.history).toEqual(original.history);
  });

  it('옮길 것이 없으면 파일을 바꾸지 않는다', () => {
    const f = withHistory();
    expect(moveWorkHistory(f, 'v1', '없는작품', '별빛')).toEqual({ file: f, moved: [] });
    expect(moveWorkHistory(f, 'v1', '달빛', '달빛')).toEqual({ file: f, moved: [] });
  });
});

describe('쓰기 통계 파일 — 작품을 모르는 볼트 보류', () => {
  it('작품 폴더를 모르는 볼트는 닫지 않고 보류했다가, 알게 되면 그 날짜로 닫는다', () => {
    let f = parseWriterDaily(null, '2026-03-05');
    f = addDailyDelta(f, '2026-03-05', 'v1', '작품가/회차/1화.md', 200);
    // v1 을 모르는 상태(다른 볼트를 보는 중)로 자정이 지난다.
    f = closeWriterDay(f, '2026-03-06', (vault) => (vault === 'v1' ? null : []));
    expect(f.history).toEqual({});
    expect(f.pending.v1).toEqual([{ date: '2026-03-05', vaults: { '작품가/회차/1화.md': 200 } }]);
    expect(f.today).toEqual({ date: '2026-03-06', vaults: {} });

    // 그 볼트를 열어 작품을 알게 되면 그 날짜로 닫힌다(작품 밖으로 확정되지 않는다).
    f = closeWriterDay(f, '2026-03-06', () => ['작품가']);
    expect(f.pending).toEqual({});
    expect(f.history.v1?.['2026-03-05']).toEqual({ total: 200, works: { 작품가: 200 } });
  });

  it('보류 중에도 그 볼트의 오늘 값은 섞이지 않는다', () => {
    let f = parseWriterDaily(null, '2026-03-05');
    f = addDailyDelta(f, '2026-03-05', 'v1', '작품가/1화.md', 200);
    f = closeWriterDay(f, '2026-03-06', () => null);
    f = addDailyDelta(f, '2026-03-06', 'v2', 'b.md', 40);
    expect(todayChars(f, 'v1')).toBe(0);
    expect(todayChars(f, 'v2')).toBe(40);
  });
});

describe('쓰기 통계 파일 — 같은 날 이름 바꾸기', () => {
  it('오늘의 문서 키를 새 경로로 옮기고, 대상 키가 있으면 합산한다', () => {
    let f = parseWriterDaily(null, TODAY);
    f = addDailyDelta(f, TODAY, 'v1', '작품가/회차/1화.md', 100);
    f = addDailyDelta(f, TODAY, 'v1', '작품가/회차/2화.md', 50);
    f = addDailyDelta(f, TODAY, 'v1', '메모.md', 30);
    const renamed = moveTodayNoteKeys(f, 'v1', '작품가', '작품나');
    expect(renamed.moved).toBe(true);
    expect(renamed.file.today.vaults.v1).toEqual({ '작품나/회차/1화.md': 100, '작품나/회차/2화.md': 50, '메모.md': 30 });
    // 그대로 닫으면 새 이름 하나로 접힌다.
    const closed = closeWriterDay(renamed.file, '2026-03-06', () => ['작품나']);
    expect(closed.history.v1?.[TODAY]).toEqual({ total: 180, works: { 작품나: 150, ':outside': 30 } });
  });

  it('노트 하나의 이름을 바꿔도 옮기고, 관계없는 키는 그대로 둔다', () => {
    let f = parseWriterDaily(null, TODAY);
    f = addDailyDelta(f, TODAY, 'v1', '작품/회차/1화.md', 100);
    f = addDailyDelta(f, TODAY, 'v1', '작품/회차/10화.md', 70);
    const { file, moved } = moveTodayNoteKeys(f, 'v1', '작품/회차/1화.md', '작품/회차/1화-개정.md');
    expect(moved).toBe(true);
    expect(file.today.vaults.v1).toEqual({ '작품/회차/1화-개정.md': 100, '작품/회차/10화.md': 70 });
    expect(moveTodayNoteKeys(file, 'v1', '없는/경로.md', '다른.md')).toEqual({ file, moved: false });
  });
});
