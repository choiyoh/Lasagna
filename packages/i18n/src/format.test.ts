import { afterEach, describe, expect, it } from 'vitest'
import { setLocale } from './index'
import {
  formatCompactDateTime,
  formatDateTime,
  formatMonthTitle,
  formatRelativeTime,
  formatShortDateTime,
  formatWeekdayShort,
} from './format'

const at = new Date(2026, 10, 4, 15, 12, 33, 0)

afterEach(() => setLocale('ko'))

describe('formatShortDateTime', () => {
  it('keeps the Korean M/D HH:mm output', () => {
    expect(formatShortDateTime(at, {}, 'ko')).toBe('11/4 15:12')
    expect(formatShortDateTime(at, { seconds: true }, 'ko')).toBe('11/4 15:12:33')
  })

  it('uses the English month name', () => {
    expect(formatShortDateTime(at, {}, 'en')).toContain('Nov')
    expect(formatShortDateTime(at, {}, 'en')).toContain('15:12')
  })
})

describe('formatDateTime', () => {
  it('matches toLocaleString for Korean and keeps seconds by default', () => {
    expect(formatDateTime(at, 'ko')).toBe(at.toLocaleString('ko-KR'))
    expect(formatDateTime(at, 'ko', false)).not.toBe(formatDateTime(at, 'ko'))
    const english = formatDateTime(at, 'en')
    expect(english).toContain('Nov')
    expect(english).toContain('2026')
    expect(english).toContain('15:12')
    expect(english).not.toContain('33') // 초 없음
    expect(english).not.toMatch(/AM|PM/) // 24시간
  })
})

describe('formatCompactDateTime', () => {
  it('keeps the Korean YYYY-MM-DD HH:mm and uses the English locale format', () => {
    expect(formatCompactDateTime(new Date(2026, 10, 4, 17, 53), 'ko')).toBe('2026-11-04 17:53')
    const english = formatCompactDateTime(new Date(2026, 10, 4, 17, 53), 'en')
    expect(english).toContain('Nov')
    expect(english).toContain('2026')
    expect(english).toContain('17:53') // 댓글·찾기와 같은 24시간 표기
    expect(english).not.toBe('2026-11-04 17:53')
  })

  it('returns an empty string for an invalid date', () => {
    expect(formatCompactDateTime('not a date', 'ko')).toBe('')
  })
})

describe('formatRelativeTime', () => {
  const now = at.getTime()

  it('says just now, minutes ago, then a full date in both languages', () => {
    setLocale('ko')
    expect(formatRelativeTime(null, now)).toBe('없음')
    expect(formatRelativeTime(now - 5_000, now)).toBe('방금')
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe('5분 전')
    expect(formatRelativeTime(now - 2 * 3600_000, now)).toBe(new Date(now - 2 * 3600_000).toLocaleString('ko-KR'))
    setLocale('en')
    expect(formatRelativeTime(now - 5_000, now)).toBe('Just now')
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe('5 min ago')
    // 한 시간이 넘으면 같은 24시간·초 없음 규칙으로 떨어진다.
    const old = formatRelativeTime(new Date(2026, 10, 4, 23, 39, 33).getTime(), new Date(2026, 10, 4, 23, 39, 33).getTime() + 2 * 3600_000)
    expect(old).toContain('23:39')
    expect(old).not.toMatch(/AM|PM|33$/)
  })
})

describe('formatWeekdayShort / formatMonthTitle', () => {
  // 2024-01-01 은 월요일 — 달력·날짜 고르기가 쓰는 첫 요일.
  const monday = new Date(2024, 0, 1)

  it('keeps the Korean weekday and month wording the app already had', () => {
    expect(formatWeekdayShort(monday, 'ko')).toBe('월')
    expect(formatWeekdayShort(new Date(2024, 0, 7), 'ko')).toBe('일')
    expect(formatMonthTitle(new Date(2026, 10, 1), 'ko')).toBe('2026년 11월')
  })

  it('uses short English weekdays and a month-year title', () => {
    expect(formatWeekdayShort(monday, 'en')).toBe('Mon')
    expect(formatWeekdayShort(new Date(2024, 0, 7), 'en')).toBe('Sun')
    expect(formatMonthTitle(new Date(2026, 10, 1), 'en')).toBe('November 2026')
  })
})
