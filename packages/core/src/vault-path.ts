import { realpathSync } from 'node:fs';
import path from 'node:path';
import { CodedError } from './errors.js';

/** 볼트 밖으로 나가는 경로. 문구는 표시 시점에 번역한다(코드+params). */
export class PathEscapeError extends CodedError {
  constructor(rel: string) {
    super('core.err.pathEscape', { path: rel });
    this.name = 'PathEscapeError';
  }
}

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * 볼트 루트 기준 상대 경로를 절대 경로로 풀되, 루트 밖으로 나가면 예외를 던진다.
 * 이미 존재하는 가장 깊은 상위 디렉터리를 realpath로 풀어 심볼릭 링크 탈출도 막는다.
 */
export function resolveInVault(vaultRoot: string, rel: string): string {
  if (rel.includes('\0') || path.isAbsolute(rel)) throw new PathEscapeError(rel);
  const root = realpathSync(vaultRoot);
  const target = path.resolve(root, rel);
  if (!isInside(root, target)) throw new PathEscapeError(rel);

  let probe = target;
  for (;;) {
    try {
      const real = realpathSync(probe);
      if (!isInside(root, real)) throw new PathEscapeError(rel);
      break;
    } catch (e) {
      if (e instanceof PathEscapeError) throw e;
      const parent = path.dirname(probe);
      if (parent === probe) break;
      probe = parent;
    }
  }
  return target;
}
