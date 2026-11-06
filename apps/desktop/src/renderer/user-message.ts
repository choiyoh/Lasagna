import { errorText } from '@nopsidian/core';

/** Electron 이 IPC 예외에 붙이는 접두사 — 사용자에게는 필요 없다. */
const IPC_PREFIX = /^Error invoking remote method '[^']+': (Error: )?/;

/**
 * 화면에 보여 줄 오류 문구. 코어·패키지의 코드+params(`CodedError`·`key`)는 **지금 언어로** 번역하고,
 * IPC 를 거친 오류의 접두사는 떼어 낸다. 키 문자열이 그대로 노출되지 않게 모든 표시 지점이 이 함수를 쓴다.
 */
export function userMessage(e: unknown): string {
  return errorText(e).replace(IPC_PREFIX, '').trim();
}
