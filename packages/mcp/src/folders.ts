/**
 * 쓰기 폴더 규칙. Node 의존성이 없어 서버와 앱 렌더러가 같은 함수를 쓴다.
 * 여기 규칙이 느슨해지면 서버가 시작할 때 parseArgs 가 PolicyError 로 죽어
 * 읽기 도구까지 전부 사라지므로, 앱도 같은 함수로 먼저 검증한다.
 */

export class PolicyError extends Error {}

/** 쓰기 폴더 입력을 볼트 상대 경로로 다듬는다. '.'·'' 는 볼트 전체('') */
export function normalizeFolder(input: string): string {
  const f = input.normalize('NFC').replace(/\\/g, '/').trim().replace(/^\.?\/+|\/+$/g, '').trim();
  if (f === '' || f === '.') return '';
  const parts = f.split('/');
  if (parts.some((p) => p === '' || p === '..' || p.startsWith('.'))) throw new PolicyError(`쓰기 폴더로 쓸 수 없는 경로예요: ${input}`);
  return parts.join('/');
}

/** 상위 폴더가 이 경로를 포함하는가. folder ''(볼트 전체)는 모든 경로를 포함한다. */
export function folderCovers(folder: string, rel: string): boolean {
  return folder === '' || rel === folder || rel.startsWith(`${folder}/`);
}
