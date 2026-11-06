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

/** 숫자를 한국어로 읽었을 때 받침이 있는지(0 영·1 일·3 삼·6 육·7 칠·8 팔 은 있음). */
const DIGIT_BATCHIM: Record<string, boolean> = {
  '0': true,
  '1': true,
  '2': false,
  '3': true,
  '4': false,
  '5': false,
  '6': true,
  '7': true,
  '8': true,
  '9': false,
};

/**
 * 앞말에 '이에요/예요' 중 무엇이 맞는지. 언어(`target`)마다 다르다 — 영어는 꼬리말이 없어 빈 문자열.
 * - 한글 음절: 받침이 있으면 '이에요', 없으면 '예요'(문자열이에요 · 숫자예요).
 * - 숫자로 끝남: 읽는 소리의 받침으로 고른다(0 영이에요 · 1 일이에요 · 2 이예요 · 3 삼이에요 · 10 십이에요).
 * - 그 밖(영문·기호·이모지): 받침을 알 수 없으므로 안전하게 '이에요' 를 쓴다(문구에서는 값에 따옴표를 붙여 쓴다).
 */
export function copulaSuffix(word: string, target: Locale = getLocale()): string {
  if (target !== 'ko') return '';
  const last = Array.from(word).pop() ?? '';
  const code = last.codePointAt(0) ?? 0;
  if (code >= 0xac00 && code <= 0xd7a3) {
    return (code - 0xac00) % 28 !== 0 ? translate(target, 'copula.ieyo') : translate(target, 'copula.yeyo');
  }
  const digit = DIGIT_BATCHIM[last];
  if (digit !== undefined) return translate(target, digit ? 'copula.ieyo' : 'copula.yeyo');
  return translate(target, 'copula.ieyo');
}

/** 앞말에 맞는 '이에요/예요'를 붙인 문구. */
export const withCopula = (word: string, target: Locale = getLocale()): string => word + copulaSuffix(word, target);

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
  // '…{type} 이에요' 의 꼬리말은 앞말(값 종류 이름)에 맞춰 여기서 정한다(문자열이에요/숫자예요).
  const needsCopula = text.includes('{be}') && params?.be === undefined
  const withCopulaParam = needsCopula
    ? {
        ...params,
        // 꼬리말은 **호출의 target 언어**로 정한다(현재 앱 언어가 아니라).
        be: copulaSuffix(typeof params?.type === 'string' ? params.type : typeof params?.value === 'string' ? params.value : '', target),
      }
    : params
  return interpolate(text, withCopulaParam)
}

/** 지금 언어로 번역한다. */
export const t: Translate = (key, params) => translate(state.locale, key, params)

/** 복수형 키(`base.one`/`base.other`)를 Intl.PluralRules 로 골라 `{n}` 을 채운다. */
export function tPlural(base: string, count: number, params?: TranslateParams, catalog?: MessageCatalog): string {
  return translate(state.locale, `${base}.${pluralCategory(state.locale, count)}`, { n: count, ...params }, catalog ?? catalogs[state.locale])
}

export * from './format'
