import { afterEach, describe, expect, it } from 'vitest'
import { setLocale } from './index'
import { formatDateTime, formatRelativeTime, formatShortDateTime } from './format'

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
    expect(formatDateTime(at, 'en')).toBe(at.toLocaleString('en-US'))
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
  })
})
