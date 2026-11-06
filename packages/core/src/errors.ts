import { t, type MessageKey } from '@nopsidian/i18n';

/** 문구 틀에 넣을 값(번역 전). */
export type ErrorParams = Record<string, string | number>;

/**
 * 번역하지 않은(코드+params) 오류. 던지는 쪽은 언어를 모르고, **보여 주는 쪽**이 지금 언어로 번역한다.
 * `message` 는 사람이 디버깅할 때 보는 코드 값이며 화면에는 `errorText()` 결과를 쓴다.
 */
export class CodedError extends Error {
  constructor(
    readonly key: MessageKey,
    readonly params: ErrorParams = {},
  ) {
    super(key);
    this.name = 'CodedError';
  }
}

/** 코드+params 가 붙은 오류인지(다른 패키지가 붙인 것 포함). */
export function errorCode(e: unknown): { key: MessageKey; params: ErrorParams } | null {
  if (e instanceof CodedError) return { key: e.key, params: e.params };
  const maybe = e as { key?: unknown; params?: unknown } | null;
  if (typeof maybe?.key === 'string' && maybe.key.includes('.')) {
    return { key: maybe.key as MessageKey, params: (maybe.params as ErrorParams | undefined) ?? {} };
  }
  return null;
}

/** 지금 언어로 오류 문구를 만든다(표시 시점 번역). 코드가 없으면 원래 메시지 그대로. */
export function errorText(e: unknown): string {
  const coded = errorCode(e);
  if (coded) return t(coded.key, coded.params);
  return e instanceof Error ? e.message : String(e);
}
