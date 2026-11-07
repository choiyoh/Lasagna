import { describe, expect, it } from 'vitest';
import { addDailyDelta, dayKey, parseWriterDaily, todayChars } from './writer-daily.js';

const TODAY = '2026-03-05';

describe('오늘 쓴 글자수 통계 파일', () => {
  it('로컬 자정 기준 날짜 키', () => {
    expect(dayKey(new Date(2026, 2, 5, 23, 59, 59))).toBe('2026-03-05');
    expect(dayKey(new Date(2026, 2, 6, 0, 0, 0))).toBe('2026-03-06');
  });

  it('없음·깨짐·형식 불일치·다른 날짜는 빈 값으로 복구한다', () => {
    for (const raw of [null, '', '{', 'null', '[]', JSON.stringify({ version: 2, date: TODAY, vaults: {} }), JSON.stringify({ version: 1, date: '어제', vaults: {} }), JSON.stringify({ version: 1, date: '2026-03-04', vaults: { v: { a: 100 } } })]) {
      expect(parseWriterDaily(raw, TODAY)).toEqual({ version: 1, date: TODAY, vaults: {} });
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
    expect(todayChars(f, 'v1')).toBe(0); // 음수 합은 0 으로
    f = addDailyDelta(f, TODAY, 'v1', 'b.md', 700); // 아직 음수 합이라 0
    expect(todayChars(f, 'v1')).toBe(0);
    f = addDailyDelta(f, TODAY, 'v1', 'b.md', 4000); // 다시 늘리면 상쇄되어 800
    expect(todayChars(f, 'v1')).toBe(800);
  });

  it('자정(날짜 변경)에 초기화되고 새 날의 변화만 센다', () => {
    let f = parseWriterDaily(null, TODAY);
    f = addDailyDelta(f, TODAY, 'v1', 'a.md', 900);
    f = addDailyDelta(f, '2026-03-06', 'v1', 'a.md', 50);
    expect(f.date).toBe('2026-03-06');
    expect(todayChars(f, 'v1')).toBe(50);
  });

  it('시계가 뒤로 가도(과거 날짜) 새 날로 보고 초기화한다(미래 기록을 섞지 않는다)', () => {
    let f = parseWriterDaily(JSON.stringify({ version: 1, date: '2026-03-06', vaults: { v1: { 'a.md': 500 } } }), TODAY);
    expect(todayChars(f, 'v1')).toBe(0);
    f = addDailyDelta(f, TODAY, 'v1', 'a.md', 20);
    expect(todayChars(f, 'v1')).toBe(20);
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
