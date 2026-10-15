import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

/** MCP 서버가 볼트에 할 수 있는 일의 한도. 기본은 읽기 전용이고, 쓰기는 켜야만 되며 폴더도 좁힌다. */
export interface McpPolicy {
  /** 볼트 폴더(절대 경로) */
  root: string;
  /** 쓰기 도구(노트 만들기·덧붙이기·고치기)를 열어 주는가 */
  write: boolean;
  /** 쓰기를 허용하는 폴더(볼트 상대). 빈 문자열 하나면 볼트 전체 */
  writeFolders: string[];
  /** 1분 안에 허용하는 쓰기 횟수(폭주한 에이전트 방지) */
  maxWritesPerMinute: number;
  /** 한 번에 쓸 수 있는 최대 크기(바이트) */
  maxBytes: number;
}

export const DEFAULT_WRITE_FOLDER = 'AI';
export const DEFAULT_MAX_WRITES_PER_MINUTE = 30;
export const DEFAULT_MAX_BYTES = 1_000_000;

export class PolicyError extends Error {}

export const USAGE = `nopsidian-mcp — Nopsidian 볼트를 MCP(stdio)로 열어 줍니다.

사용법: node nopsidian-mcp.mjs --vault <볼트 폴더> [옵션]

  --vault <폴더>               볼트 폴더(또는 환경 변수 NOPSIDIAN_VAULT)
  --write                      쓰기 도구를 켭니다(기본: 읽기 전용)
  --write-folder <폴더>        쓰기를 허용할 볼트 안 폴더. 여러 번 쓸 수 있고 기본은 "${DEFAULT_WRITE_FOLDER}".
                               볼트 전체를 허용하려면 --write-folder .
  --max-writes-per-minute <N>  1분당 쓰기 횟수 한도(기본 ${DEFAULT_MAX_WRITES_PER_MINUTE})
  --help                       이 도움말
`;

/** 쓰기 폴더 입력을 볼트 상대 경로로 다듬는다. '.'·'' 는 볼트 전체('') */
export function normalizeFolder(input: string): string {
  const f = input.normalize('NFC').replace(/\\/g, '/').replace(/^\.?\/+|\/+$/g, '').trim();
  if (f === '' || f === '.') return '';
  const parts = f.split('/');
  if (parts.some((p) => p === '' || p === '..' || p.startsWith('.'))) throw new PolicyError(`쓰기 폴더로 쓸 수 없는 경로예요: ${input}`);
  return parts.join('/');
}

/** 명령줄 인자·환경 변수에서 정책을 만든다. 잘못되면 PolicyError */
export function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): McpPolicy | 'help' {
  let vault = env.NOPSIDIAN_VAULT ?? '';
  let write = false;
  const folders: string[] = [];
  let maxWrites = DEFAULT_MAX_WRITES_PER_MINUTE;
  const takeValue = (i: number, flag: string): string => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new PolicyError(`${flag} 뒤에 값이 필요해요`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--help' || a === '-h') return 'help';
    else if (a === '--vault') vault = takeValue(i++, a);
    else if (a === '--write') write = true;
    else if (a === '--write-folder') folders.push(normalizeFolder(takeValue(i++, a)));
    else if (a === '--max-writes-per-minute') {
      const n = Number(takeValue(i++, a));
      if (!Number.isInteger(n) || n < 1 || n > 1000) throw new PolicyError('--max-writes-per-minute 는 1~1000 사이의 정수여야 해요');
      maxWrites = n;
    } else throw new PolicyError(`알 수 없는 옵션: ${a}`);
  }
  if (!vault) throw new PolicyError('--vault <볼트 폴더> 가 필요해요');
  const root = path.resolve(vault);
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new PolicyError(`볼트 폴더가 없어요: ${root}`);
  if (folders.length && !write) throw new PolicyError('--write-folder 는 --write 와 함께 써야 해요');
  return {
    root,
    write,
    writeFolders: write ? [...new Set(folders.length ? folders : [DEFAULT_WRITE_FOLDER])] : [],
    maxWritesPerMinute: maxWrites,
    maxBytes: DEFAULT_MAX_BYTES,
  };
}

/** 볼트 안 노트 경로를 정규화·검증한다(절대 경로·`..`·점으로 시작하는 폴더/파일·이상한 글자 거부, `.md` 보장). */
export function validateNotePath(input: string): string {
  let p = input.normalize('NFC').replace(/\\/g, '/').replace(/^(\.\/)+/, '').trim();
  if (!p) throw new PolicyError('경로가 비어 있어요');
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) throw new PolicyError('볼트 안의 상대 경로만 쓸 수 있어요');
  if (!/\.md$/i.test(p)) p += '.md';
  if (p.length > 240) throw new PolicyError('경로가 너무 길어요');
  const parts = p.split('/');
  for (const part of parts) {
    if (part === '' || part === '.' || part === '..') throw new PolicyError(`잘못된 경로예요: ${input}`);
    if (part.startsWith('.')) throw new PolicyError('점(.)으로 시작하는 폴더·파일은 쓸 수 없어요');
    // eslint-disable-next-line no-control-regex
    if (/[\\:*?"<>|\u0000-\u001f]/.test(part)) throw new PolicyError(`이름에 쓸 수 없는 글자가 있어요: ${part}`);
  }
  return p;
}

/** 이 경로에 쓰기가 허용되는가 */
export function canWrite(policy: McpPolicy, rel: string): boolean {
  if (!policy.write) return false;
  return policy.writeFolders.some((f) => f === '' || rel === f || rel.startsWith(`${f}/`));
}
