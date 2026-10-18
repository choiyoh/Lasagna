import { describe, expect, it } from 'vitest';
import { dateSuggestions } from './date-mention';

// 2026-10-15 는 목요일
const TODAY = new Date(2026, 9, 15);
const dates = (q: string) => dateSuggestions(q, TODAY).map((s) => s.date);

describe('dateSuggestions', () => {
  it('말이 없으면 자주 쓰는 날짜를 보여 준다', () => {
    expect(dates('')).toEqual(['2026-10-15', '2026-10-16', '2026-10-14', '2026-10-19', '2026-10-23']);
    expect(dateSuggestions('', TODAY)[0]!.label).toBe('오늘 · 2026-10-15 (목)');
  });
  it('오늘·내일·어제·모레와 영어, 앞부분만 쳐도', () => {
    expect(dates('오늘')).toEqual(['2026-10-15']);
    expect(dates('내')).toEqual(['2026-10-16']);
    expect(dates('tomorrow')).toEqual(['2026-10-16']);
    expect(dates('yes')).toEqual(['2026-10-14']);
    expect(dates('모레')).toEqual(['2026-10-17']);
  });
  it('요일: 이번(다가오는)과 다음 주', () => {
    expect(dates('금')).toEqual(['2026-10-16', '2026-10-23']);
    expect(dates('목')).toEqual(['2026-10-22']); // 오늘이 목요일이면 다가오는 목요일은 다음 주(둘이 같아 하나만)
    expect(dates('다음 주 월')).toEqual(['2026-10-19']);
    expect(dates('다음주월요일')).toEqual(['2026-10-19']);
    expect(dates('next fri')).toEqual([]); // 영어 요일 이름은 지원하지 않는다
  });
  it('며칠 뒤·전', () => {
    expect(dates('+3')).toEqual(['2026-10-18']);
    expect(dates('-2')).toEqual(['2026-10-13']);
    expect(dates('3일 뒤')).toEqual(['2026-10-18']);
    expect(dates('3일 전')).toEqual(['2026-10-12']);
    expect(dates('+20d')).toEqual(['2026-11-04']);
    expect(dates('0')).toEqual([]); // 기호 없는 숫자는 날짜가 아니다
  });
  it('정확한 날짜', () => {
    expect(dates('2026-12-25')).toEqual(['2026-12-25']);
    expect(dates('12/25')).toEqual(['2026-12-25']);
    expect(dates('1-5')).toEqual(['2026-01-05']);
    expect(dates('2026-02-30')).toEqual([]); // 없는 날짜
    expect(dates('13-40')).toEqual([]);
  });
  it('알 수 없는 말은 후보가 없다', () => {
    expect(dates('zzz')).toEqual([]);
  });
});
