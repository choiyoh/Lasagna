import { afterEach, describe, expect, it, vi } from 'vitest'
import { en } from './messages/en'
import { ko } from './messages/ko'
import {
  copulaSuffix,
  withCopula,
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

  it('keeps the same {placeholders} in both languages for every key', () => {
    const tokens = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    for (const key of Object.keys(ko) as (keyof typeof ko)[]) {
      expect(tokens(en[key]), key).toEqual(tokens(ko[key]));
    }
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

  it('pluralizes English counts and composes multi-count sentences', () => {
    setLocale('en')
    expect(tPlural('count.notes', 1)).toBe('1 note')
    expect(tPlural('count.notes', 2)).toBe('2 notes')
    expect(tPlural('count.notes', 0)).toBe('0 notes')
    expect(tPlural('count.items', 1)).toBe('1 item')
    expect(tPlural('count.links', 2)).toBe('2 links')
    expect(tPlural('history.diff', 1)).toContain('1 line differs')
    expect(tPlural('history.diff', 2)).toContain('2 lines differ')
    expect(t('import.doneNotes.one', { notes: 1 })).toBe('Imported 1 note')
    expect(t('import.doneNotes.other', { notes: 2 })).toBe('Imported 2 notes')
    expect(
      t('import.doneNotesAssets', { notes: tPlural('count.notes', 1), assets: tPlural('count.assets', 2) }),
    ).toBe('Imported 1 note and 2 attachments')
    expect(t('entry.movedWithLinks', { items: tPlural('count.items', 1), links: tPlural('count.links', 1) })).toBe(
      'Moved 1 item (updated 1 link)',
    )
    setLocale('ko')
    expect(tPlural('count.notes', 1)).toBe('노트 1개')
    expect(t('import.doneNotes.other', { notes: 3 })).toBe('노트 3개를 가져왔어요')
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

describe('merge export copy', () => {
  it('회차 수는 Intl.PluralRules 로 단수/복수를 고른다', () => {
    expect(translate('en', 'merge.selected.one', { episodes: '1' })).toBe('Selected: 1 episode')
    expect(translate('en', 'merge.selected.other', { episodes: '2' })).toBe('Selected: 2 episodes')
    expect(translate('en', 'merge.summaryLine.one', { work: 'Moon', episodes: '1', chars: '10' })).toBe('Moon · 1 episode · 10 characters')
    expect(translate('en', 'merge.summaryLine.other', { work: 'Moon', episodes: '3', chars: '10' })).toBe('Moon · 3 episodes · 10 characters')
    expect(translate('ko', 'merge.selected.one', { episodes: '1' })).toBe('선택 범위: 1개 회차')
  })

  it('글자수 기준 문구가 겹치지 않고, 도움말이 주 버튼 이름과 맞는다', () => {
    expect(translate('ko', 'merge.total', { chars: '68', spacing: translate('ko', 'merge.spacing.include') })).toBe('총 68자 · 공백 포함')
    expect(translate('ko', 'merge.total', { chars: '68', spacing: translate('ko', 'merge.spacing.exclude') })).toBe('총 68자 · 공백 제외')
    expect(translate('en', 'merge.total', { chars: '68', spacing: translate('en', 'merge.spacing.exclude') })).toBe('Total 68 characters · spaces excluded')
    expect(translate('ko', 'merge.help')).toContain('저장 위치 고르기…')
    expect(translate('en', 'merge.help')).toContain('Choose location…')
    expect(translate('ko', 'merge.help')).not.toContain('내보내기를 누르면')
  })
})

describe('copulaSuffix', () => {
  it('앞말의 받침에 따라 이에요/예요를 고르고, 영어에서는 빈 문자열이다', () => {
    setLocale('ko')
    expect(withCopula('문자열')).toBe('문자열이에요')
    expect(withCopula('숫자')).toBe('숫자예요')
    expect(withCopula('목록')).toBe('목록이에요')
    expect(withCopula('날짜')).toBe('날짜예요')
    expect(withCopula('')).toBe('이에요') // 빈 값은 받침을 알 수 없어 안전한 쪽
    setLocale('en')
    expect(copulaSuffix('string')).toBe('')
    setLocale('ko')
  })

  it('숫자로 끝나면 읽는 소리의 받침을 따른다(0영·1일·3삼·6육·7칠·8팔 이에요)', () => {
    setLocale('ko')
    const yes = ['0', '1', '3', '6', '7', '8', '10', '13', '100', '123', '1000']
    const no = ['2', '4', '5', '9', '12', '25']
    for (const word of yes) expect([word, copulaSuffix(word)]).toEqual([word, '이에요'])
    for (const word of no) expect([word, copulaSuffix(word)]).toEqual([word, '예요'])
  })

  it('영문·기호·이모지로 끝나면 받침을 알 수 없어 이에요로 둔다(문구에서는 따옴표를 쓴다)', () => {
    setLocale('ko')
    for (const word of ['string', 'Text', 'Date', '%', '#', '🙂', 'a1', '']) {
      expect([word, copulaSuffix(word)]).toEqual([word, '이에요'])
    }
  })

  it('translate(target) 는 그 target 언어로 꼬리말을 정한다(앱 언어와 무관)', () => {
    setLocale('en')
    // en 앱에서도 ko 문구를 만들면 ko 규칙(문자열이에요)
    expect(translate('ko', 'formula.err.needsNumber', { what: 'x', type: '문자열' })).toBe('x: 숫자가 필요한데 문자열이에요')
    expect(translate('ko', 'formula.err.needsNumber', { what: 'x', type: '숫자' })).toBe('x: 숫자가 필요한데 숫자예요')
    setLocale('ko')
    // ko 앱에서도 en 문구에는 꼬리말이 붙지 않는다
    expect(translate('en', 'formula.err.needsNumber', { what: 'x', type: 'Text' })).toBe('x: expected a number but got Text')
  })
})
