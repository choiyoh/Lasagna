/** 해시·인코딩 유틸 — 순수 TS(테스트와 메모리 가짜가 공용으로 쓴다). */

import { createHash } from 'node:crypto';

/** UTF-8 인코딩 */
export const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

/** UTF-8 디코딩 */
export const text = (b: Uint8Array): string => new TextDecoder().decode(b);

/** SHA-256(hex). 문자열은 UTF-8 로 인코딩해서 계산한다. */
export function sha256Hex(bytes: Uint8Array | string): string {
  const buf = typeof bytes === 'string' ? utf8(bytes) : bytes;
  return createHash('sha256').update(buf).digest('hex');
}

/** 문자열|바이트를 바이트로. 복사본을 돌려주므로 넘긴 배열을 나중에 고쳐도 영향이 없다. */
export const toBytes = (content: Uint8Array | string): Uint8Array =>
  typeof content === 'string' ? utf8(content) : content.slice();
