import { afterEach, describe, expect, it, vi } from 'vitest'
import { en } from './messages/en'
import { ko } from './messages/ko'
import {
  DEFAULT_LOCALE,
  getLocale,
  interpolate,
  pluralCategory,
  resolveLocale,
  setLocale,
  subscribeLocale,
  t,
  tPlural,
  translate,
} from './index'

afterEach(() => {
  setLocale(DEFAULT_LOCALE)
  vi.restoreAllMocks()
})

describe('resolveLocale', () => {
  it('follows the first system language and only accepts Korean for ko', () => {
    expect(resolveLocale('system', ['ko-KR', 'en-US'])).toBe('ko')
    expect(resolveLocale('system', ['KO'])).toBe('ko')
    expect(resolveLocale('system', ['en-US'])).toBe('en')
    expect(resolveLocale('system', ['ja-JP', 'ko-KR'])).toBe('en')
    expect(resolveLocale('system', [])).toBe('en')
  })

  it('lets an explicit setting win over the system languages', () => {
    expect(resolveLocale('en', ['ko-KR'])).toBe('en')
    expect(resolveLocale('ko', ['en-US'])).toBe('ko')
  })
})

describe('messages', () => {
  it('ships the same key set in both languages', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ko).sort())
    expect(Object.keys(ko).length).toBeGreaterThan(80)
  })

  it('fills placeholders and leaves unknown ones alone', () => {
    expect(interpolate('테마: {theme} ({when})', { theme: '다크' })).toBe('테마: 다크 ({when})')
    expect(interpolate('no placeholders')).toBe('no placeholders')
  })

  it('switches the language for t() and notifies subscribers', () => {
    const listener = vi.fn()
    const off = subscribeLocale(listener)
    expect(t('nav.newNote')).toBe('새 노트')
    setLocale('en')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(t('nav.newNote')).toBe('New note')
    expect(t('settings.titleSyncHint', {})).toContain('H1')
    setLocale('en')
    expect(listener).toHaveBeenCalledTimes(1) // 같은 언어면 알리지 않는다
    off()
    setLocale('ko')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(getLocale()).toBe('ko')
  })

  it('falls back to the key and warns when a message is missing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(translate('en', 'settings.missing.key')).toBe('settings.missing.key')
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('chooses plural keys with Intl.PluralRules', () => {
    expect(pluralCategory('en', 1)).toBe('one')
    expect(pluralCategory('en', 2)).toBe('other')
    expect(pluralCategory('ko', 1)).toBe('other')
    const catalog = { 'demo.notes.one': '{n} note', 'demo.notes.other': '{n} notes' }
    setLocale('en')
    expect(tPlural('demo.notes', 1, undefined, catalog)).toBe('1 note')
    expect(tPlural('demo.notes', 3, undefined, catalog)).toBe('3 notes')
    setLocale('ko')
    expect(tPlural('demo.notes', 1, undefined, { ...catalog, 'demo.notes.other': '노트 {n}개' })).toBe('노트 1개')
  })
})
