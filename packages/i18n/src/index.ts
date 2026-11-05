import { en } from './messages/en'
import { ko } from './messages/ko'

export type Locale = 'ko' | 'en'
/** 무엇을 따를지: OS 언어, 아니면 고정 언어. 설정 파일에 저장되는 값이다. */
export type LanguageSetting = 'system' | 'ko' | 'en'
/** ko 사전의 키 집합. en 은 이 타입의 Record 라서 키가 빠지면 컴파일되지 않는다. */
export type MessageKey = keyof typeof ko
export type MessageCatalog = Record<string, string>
export type TranslateParams = Record<string, string | number>
export type Translate = (key: MessageKey, params?: TranslateParams) => string

export const DEFAULT_LOCALE: Locale = 'ko'
export const LOCALES: readonly Locale[] = ['ko', 'en']

const catalogs: Record<Locale, MessageCatalog> = { ko, en }

/**
 * 표시 언어 상태는 `globalThis` 에 둔다 — 같은 페이지에 이 모듈 인스턴스가 둘 이상 있을 수 있고
 * (에디터처럼 별도 청크로 묶이는 패키지), 그때도 한 곳에서 바꾼 언어를 모두가 봐야 한다.
 */
const STATE_KEY = Symbol.for('nopsidian.i18n.state')
interface I18nState {
  locale: Locale
  listeners: Set<() => void>
}
const state: I18nState = ((globalThis as Record<symbol, I18nState | undefined>)[STATE_KEY] ??= {
  locale: DEFAULT_LOCALE,
  listeners: new Set(),
})

/** 설정이 system 이면 OS 언어 목록의 첫 언어로 정한다: `ko…` 는 한국어, 그 밖은 영어. */
export function resolveLocale(setting: LanguageSetting, systemLanguages: readonly string[]): Locale {
  if (setting !== 'system') return setting
  const first = systemLanguages[0]?.trim().toLowerCase() ?? ''
  return first.startsWith('ko') ? 'ko' : 'en'
}

export function getLocale(): Locale {
  return state.locale
}

/** 앱 전체(렌더러 한 컨텍스트)의 표시 언어를 바꾸고 구독자에게 알린다. */
export function setLocale(next: Locale): void {
  if (next === state.locale) return
  state.locale = next
  for (const listener of [...state.listeners]) listener()
}

export function subscribeLocale(listener: () => void): () => void {
  state.listeners.add(listener)
  return () => {
    state.listeners.delete(listener)
  }
}

/** `{name}` 자리를 채운다. 값이 없는 자리는 그대로 둔다. */
export function interpolate(text: string, params?: TranslateParams): string {
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    params[name] === undefined ? whole : String(params[name]),
  )
}

/** `one`/`other` 두 갈래로만 접는다(ko 는 항상 other, en 은 1 에서 one). */
export function pluralCategory(target: Locale, count: number): 'one' | 'other' {
  return new Intl.PluralRules(target).select(count) === 'one' ? 'one' : 'other'
}

/** 특정 로케일의 문구. 사전에 없는 키는 개발 중 경고를 남기고 키 자체를 돌려준다. */
export function translate(
  target: Locale,
  key: string,
  params?: TranslateParams,
  catalog: MessageCatalog = catalogs[target],
): string {
  const text = catalog[key]
  if (text === undefined) {
    console.warn(`[i18n] missing ${target} message: ${key}`)
    return key
  }
  return interpolate(text, params)
}

/** 지금 언어로 번역한다. */
export const t: Translate = (key, params) => translate(state.locale, key, params)

/** 복수형 키(`base.one`/`base.other`)를 Intl.PluralRules 로 골라 `{n}` 을 채운다. */
export function tPlural(base: string, count: number, params?: TranslateParams, catalog?: MessageCatalog): string {
  return translate(state.locale, `${base}.${pluralCategory(state.locale, count)}`, { n: count, ...params }, catalog ?? catalogs[state.locale])
}

export * from './format'
