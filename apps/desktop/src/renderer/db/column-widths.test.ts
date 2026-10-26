import { describe, expect, it } from 'vitest';
import { ADD_COL_W, COL_MAX, COL_MIN, TITLE_BASE, columnWidths } from './column-widths';

const SIX = ['title', '상태', '담당', '마감', '우선순위', '진척'];

describe('columnWidths', () => {
  it('도크가 닫힌 1,440px 창(표 1,180px)에서는 6열이 전부 들어간다', () => {
    const { widths, total } = columnWidths(1180, SIX, 'title');
    expect(Object.values(widths)).toEqual([260, 176, 176, 176, 176, 176]);
    expect(total).toBe(1180);
    // 리뷰 재현값: 180px 고정이면 1,200px 였다
    expect(total).toBeLessThan(1200);
  });

  it('도크가 열린 880px 에서도 마지막 열이 0px 로 사라지지 않는다(가로 스크롤)', () => {
    const { widths, total } = columnWidths(880, SIX, 'title');
    expect(widths['진척']).toBe(COL_MIN);
    expect(total).toBe(260 + COL_MIN * 5 + ADD_COL_W);
    expect(total).toBeGreaterThan(880);
    expect(Math.min(...Object.values(widths))).toBeGreaterThanOrEqual(COL_MIN);
  });

  it('폭이 남으면 제목 열이 남는 폭을 먹는다', () => {
    const { widths, total } = columnWidths(1600, ['title', '상태', '담당'], 'title');
    expect(widths['상태']).toBe(COL_MAX);
    expect(widths['담당']).toBe(COL_MAX);
    expect(widths.title).toBe(1600 - ADD_COL_W - COL_MAX * 2);
    expect(total).toBe(1600);
  });

  it('사용자가 끈 열 폭은 계산값보다 우선한다', () => {
    const { widths } = columnWidths(1180, SIX, 'title', { 상태: 240 });
    expect(widths['상태']).toBe(240);
    expect(widths['담당']).toBe(176);
  });

  it('제목 열 폭을 직접 줄였으면 남는 폭을 먹지 않는다', () => {
    // 예전에는 max(120, 남는 폭) 로 되돌아가 리사이즈가 고장난 것처럼 보였다
    expect(columnWidths(1180, SIX, 'title', { title: 120 }).widths.title).toBe(120);
    expect(columnWidths(1180, SIX, 'title', { title: 200 }).widths.title).toBe(200);
    // 명시하지 않았을 때는 그대로 남는 폭을 먹는다
    expect(columnWidths(1600, ['title', '상태', '담당'], 'title').widths.title).toBe(1600 - ADD_COL_W - COL_MAX * 2);
  });

  it('폭을 재지 못했을 때(0)도 NaN·음수를 만들지 않는다', () => {
    const { widths, total } = columnWidths(0, SIX, 'title');
    expect(widths.title).toBe(TITLE_BASE);
    expect(widths['상태']).toBe(COL_MIN);
    expect(total).toBe(TITLE_BASE + COL_MIN * 5 + ADD_COL_W);
    expect(Number.isFinite(total)).toBe(true);
  });

  it('열이 제목 하나뿐이면 제목이 표 폭을 채운다', () => {
    const { widths, total } = columnWidths(900, ['title'], 'title');
    expect(widths.title).toBe(900 - ADD_COL_W);
    expect(total).toBe(900);
  });
});
