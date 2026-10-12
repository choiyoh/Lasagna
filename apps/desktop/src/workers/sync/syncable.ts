import path from 'node:path';

/** 볼트 메타 폴더 — 기본은 동기화하지 않지만 예외 몇 개는 올린다. */
const META_DIR = '.nopsidian';

/** `.nopsidian/` 안에서 동기화하는 파일 이름. */
const META_FILES = new Set(['config.json', 'graph.json']);

/** `.nopsidian/` 안에서 동기화하는 폴더 이름. */
const META_DIRS = new Set(['comments']);

/** 이름에 이 조각이 들어가면 저장 중 임시 파일이다(`atomicWrite`). */
const TMP_MARK = '.nops-tmp-';

/** 파일·폴더 이름 하나가 동기화 대상인가 */
function skipName(name: string): boolean {
  return (
    name === '.git' ||
    name === '.DS_Store' ||
    name.includes(TMP_MARK) ||
    name.startsWith('~$') || // Office 잠금 파일
    name.endsWith('.icloud') // iCloud 미다운로드 자리표시자
  );
}

/** `.nopsidian/` 아래 경로가 예외적으로 동기화 대상인가 */
function metaAllowed(rest: string): boolean {
  if (META_FILES.has(rest)) return true;
  const head = rest.split('/')[0];
  return META_DIRS.has(head);
}

/** 볼트 상대 경로(슬래시, NFC)가 동기화 대상인가 */
export function isSyncablePath(rel: string): boolean {
  if (rel === '' || rel.includes('\0') || path.isAbsolute(rel)) return false;
  const segments = rel.normalize('NFC').split('/');
  // 빈 세그먼트(`a//b`, 끝 슬래시)와 상위 탈출(`..`)은 경로가 아니다
  if (segments.some((s) => s === '' || s === '..')) return false;

  if (segments[0] === META_DIR) {
    const rest = segments.slice(1).join('/');
    // `.nopsidian` 자체는 폴더 — 예외 파일에 닿으려면 들어가야 하므로 통과시킨다
    return rest === '' || metaAllowed(rest);
  }
  return !segments.some(skipName);
}
