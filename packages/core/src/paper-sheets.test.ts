import { describe, expect, it } from 'vitest';
import { PAPER_SHEET_CHARS, paperSheets } from './paper-sheets.js';

describe('paperSheets(원고지 매수)', () => {
  it('200자를 1매로 환산한다', () => {
    expect(PAPER_SHEET_CHARS).toBe(200);
    expect(paperSheets(0)).toBe(0);
    expect(paperSheets(1)).toBe(0);
    expect(paperSheets(99)).toBe(0.5);
    expect(paperSheets(100)).toBe(0.5);
    expect(paperSheets(199)).toBe(1);
    expect(paperSheets(200)).toBe(1);
    expect(paperSheets(201)).toBe(1);
    expect(paperSheets(4321)).toBe(21.6);
    expect(paperSheets(5000)).toBe(25);
  });

  it('소수 첫째 자리로 반올림한다(경계 포함)', () => {
    expect(paperSheets(110)).toBe(0.6); // 0.55 → 0.6
    expect(paperSheets(190)).toBe(1); // 0.95 → 1.0
    expect(paperSheets(9)).toBe(0); // 0.045 → 0.0
    expect(paperSheets(210)).toBe(1.1); // 1.05 → 1.1
  });

  it('음수·NaN·무한대는 0매', () => {
    expect(paperSheets(-1)).toBe(0);
    expect(paperSheets(-5000)).toBe(0);
    expect(paperSheets(Number.NaN)).toBe(0);
    expect(paperSheets(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('큰 수에서도 소수 첫째 자리를 지킨다', () => {
    expect(paperSheets(1_000_000)).toBe(5000);
    expect(paperSheets(1_234_567)).toBe(6172.8);
  });
});
