import { t, type MessageKey } from '@nopsidian/i18n';

export type ErrorParams = Record<string, string | number>;

/** 코드+params 가 붙은 오류인지(다른 패키지가 붙인 것 포함). */
export function errorCode(e: unknown): { key: MessageKey; params: ErrorParams } | null {
  const maybe = e as { key?: unknown; params?: unknown } | null;
  if (typeof maybe?.key === 'string' && maybe.key.includes('.')) return { key: maybe.key as MessageKey, params: (maybe.params as ErrorParams | undefined) ?? {} };
  return null;
}

/** 지금 언어로 오류 문구를 만든다(표시 시점 번역). 코드가 없으면 원래 메시지 그대로. */
export function errorText(e: unknown): string {
  const coded = errorCode(e);
  if (coded) return t(coded.key, coded.params);
  return e instanceof Error ? e.message : String(e);
}
