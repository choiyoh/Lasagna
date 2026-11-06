import { t, translate, type MessageKey, type TranslateParams } from '@nopsidian/i18n';

/** 문장 틀에 넣을 값. `{ key }` 면 그 문구를 지금 언어로 풀어 넣는다(문장 중첩 방지). */
export type Param = string | number | { key: MessageKey; params?: Record<string, string> };
export type Params = Record<string, Param>;

const resolve = (params: Params = {}): TranslateParams =>
  Object.fromEntries(
    Object.entries(params).map(([name, value]) => [name, typeof value === 'object' ? t(value.key, value.params) : value]),
  );

/** 지금 언어로. `{ key }` 파라미터는 중첩 번역한다. */
export const tr = (key: MessageKey, params: Params = {}): string => t(key, resolve(params));

/** 특정 언어로(감사·로그처럼 언어와 무관하게 남겨야 하는 값). */
export const trIn = (locale: 'ko' | 'en', key: MessageKey, params: Params = {}): string =>
  translate(
    locale,
    key,
    Object.fromEntries(
      Object.entries(params).map(([name, value]) => [name, typeof value === 'object' ? translate(locale, value.key, value.params) : value]),
    ),
  );
